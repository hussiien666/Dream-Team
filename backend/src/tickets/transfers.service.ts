import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma, Event, Ticket, Attendee } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { DeliveryService } from './delivery.service.js';
import { NotificationsService } from '../email/notifications.service.js';
import { TicketsService } from './tickets.service.js';
import { newToken, digest } from '../common/crypto.util.js';
import { seal } from '../common/encryption.util.js';
import {
  text,
  phone,
  email,
  values,
  reason,
  parse,
  guestKey,
} from '../students/validation.js';

type Tx = Prisma.TransactionClient;

export const transferInputSchema = z
  .object({
    recipientName: text.min(2).max(200),
    recipientEmail: z
      .union([email, z.literal(''), z.null()])
      .optional()
      .transform((v) => v || null),
    recipientPhone: phone.default(''),
    customValues: values.default({}),
    reason: text.max(1000).default(''),
    approveImmediately: z.boolean().default(false),
    superAdminOverride: z.boolean().default(false),
    overrideReason: reason,
  })
  .strict();

export const approveSchema = z
  .object({
    confirmed: z.literal(true),
    superAdminOverride: z.boolean().default(false),
    overrideReason: reason,
  })
  .strict();

export const rejectSchema = z
  .object({
    reason: text.min(5).max(1000),
  })
  .strict();

@Injectable()
export class TransfersService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: EventsService,
    private readonly tickets: TicketsService,
    private readonly delivery: DeliveryService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    eventId: number,
    userId: number,
    role: string,
    orgId: number,
    status?: string,
  ) {
    await this.events.assertAccess(eventId, userId, role, orgId, 'tickets.manage');
    const where: Prisma.TicketTransferWhereInput = { eventId };
    if (status && ['Pending', 'Approved', 'Rejected', 'Cancelled'].includes(status)) {
      where.status = status as Prisma.EnumTicketTransferStatusFilter;
    }
    return this.db.ticketTransfer.findMany({
      where,
      include: {
        ticket: { select: { number: true, status: true } },
        fromAttendee: { select: { id: true, fullName: true, email: true, phone: true } },
        toAttendee: { select: { id: true, fullName: true, email: true, phone: true } },
        resolver: { select: { id: true, displayName: true, username: true } },
        requesterActor: { select: { id: true, displayName: true, username: true } },
      },
      orderBy: { id: 'desc' },
    });
  }

  async getOne(eventId: number, transferId: number, userId: number, role: string, orgId: number) {
    await this.events.assertAccess(eventId, userId, role, orgId, 'tickets.manage');
    const transfer = await this.db.ticketTransfer.findFirst({
      where: { id: transferId, eventId },
      include: {
        ticket: { select: { number: true, status: true } },
        fromAttendee: { select: { id: true, fullName: true, email: true, phone: true } },
        toAttendee: { select: { id: true, fullName: true, email: true, phone: true } },
        resolver: { select: { id: true, displayName: true, username: true } },
        requesterActor: { select: { id: true, displayName: true, username: true } },
      },
    });
    if (!transfer) throw new NotFoundException('Transfer record not found.');
    return transfer;
  }

  async initiateAdmin(
    eventId: number,
    ticketId: number,
    body: unknown,
    userId: number,
    role: string,
    orgId: number,
  ) {
    const dto = parse(transferInputSchema, body);
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived) throw new BadRequestException('Archived events are read-only.');
        const ticket = await tx.ticket.findFirst({
          where: { id: ticketId, eventId },
          include: { attendee: true },
        });
        if (!ticket) throw new NotFoundException('Ticket not found in this event.');
        if (ticket.status !== 'Active') {
          throw new BadRequestException('Only active unused tickets can be transferred.');
        }
        if (await tx.checkIn.count({ where: { ticketId } })) {
          throw new BadRequestException('Used tickets preserve their admission history.');
        }
        if (await tx.ticketTransfer.count({ where: { ticketId, status: 'Pending' } })) {
          throw new ConflictException('A transfer is already pending for this ticket.');
        }

        const settingsRow = await tx.eventSetting.findUnique({
          where: { eventId_key: { eventId, key: 'product.v1' } },
        });
        const product = settingsRow ? JSON.parse(settingsRow.value) : {};
        const deadline = product.transferDeadline ? new Date(product.transferDeadline) : event.endsAt;
        const now = new Date();

        if (now > deadline) {
          if (role === 'super_admin' && dto.superAdminOverride && dto.overrideReason && dto.overrideReason.trim().length >= 5) {
            // Authorized Super Admin override
          } else {
            throw new BadRequestException('Transfer deadline has passed for this event.');
          }
        }

        await this.validateDuplicateGuest(tx, eventId, ticket.attendeeId, dto.recipientName, dto.recipientEmail, dto.recipientPhone);

        const autoApprove = dto.approveImmediately || product.transferApproval === 'automatic';

        if (autoApprove) {
          const executed = await this.executeTransfer(
            tx,
            event,
            ticket,
            ticket.attendee,
            {
              name: dto.recipientName,
              email: dto.recipientEmail,
              phone: dto.recipientPhone,
              customValues: dto.customValues,
            },
            userId,
            dto.reason,
            {
              initiatedBy: 'admin',
              requesterActorId: userId,
              deadline,
              superAdminOverride: dto.superAdminOverride,
              overrideReason: dto.overrideReason ?? '',
            },
          );
          return { transferId: executed.transferId, status: 'Approved', newTicketNumber: executed.newTicketNumber };
        }

        const transfer = await tx.ticketTransfer.create({
          data: {
            eventId,
            ticketId,
            fromAttendeeId: ticket.attendeeId,
            initiatedBy: 'admin',
            requesterActorId: userId,
            recipientName: dto.recipientName,
            recipientEmail: dto.recipientEmail,
            recipientPhone: dto.recipientPhone,
            customValues: dto.customValues,
            reason: dto.reason,
            status: 'Pending',
            deadline,
            superAdminOverride: dto.superAdminOverride,
            overrideReason: dto.overrideReason ?? '',
          },
        });

        await tx.auditLog.create({
          data: {
            eventId,
            actorId: userId,
            action: 'ticket.transfer_requested',
            details: JSON.stringify({
              transferId: transfer.id,
              ticketId,
              fromAttendeeId: ticket.attendeeId,
              recipientName: dto.recipientName,
              reason: dto.reason,
            }),
          },
        });

        await this.notifications.event(tx,eventId,userId,await this.notifications.attendeeRecipients(tx,ticket.attendeeId),
          'Dream Events transfer awaiting approval','A ticket transfer was requested and is awaiting event administrator approval.',`transfer-pending:${transfer.id}`);
        return { transferId: transfer.id, status: 'Pending' };
      },
      true,
      120000,
    );
  }

  async approve(
    eventId: number,
    transferId: number,
    body: unknown,
    userId: number,
    role: string,
    orgId: number,
  ) {
    const dto = parse(approveSchema, body);
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived) throw new BadRequestException('Archived events are read-only.');
        const transfer = await tx.ticketTransfer.findFirst({
          where: { id: transferId, eventId },
          include: { ticket: { include: { attendee: true } } },
        });
        if (!transfer) throw new NotFoundException('Transfer record not found.');
        if (transfer.status !== 'Pending') {
          throw new BadRequestException('Only pending transfers can be approved.');
        }

        const ticket = transfer.ticket;
        if (ticket.status !== 'Active') {
          throw new BadRequestException('Ticket is no longer active.');
        }
        if (await tx.checkIn.count({ where: { ticketId: ticket.id } })) {
          throw new BadRequestException('Used tickets preserve their admission history.');
        }

        const settingsRow = await tx.eventSetting.findUnique({
          where: { eventId_key: { eventId, key: 'product.v1' } },
        });
        const product = settingsRow ? JSON.parse(settingsRow.value) : {};
        const deadline = product.transferDeadline ? new Date(product.transferDeadline) : event.endsAt;
        const now = new Date();

        const isOverride = Boolean(
          role === 'super_admin' &&
            dto.superAdminOverride &&
            dto.overrideReason &&
            dto.overrideReason.trim().length >= 5,
        );
        if (now > deadline && !isOverride) {
          throw new BadRequestException('Transfer deadline has passed for this event.');
        }

        await this.validateDuplicateGuest(
          tx,
          eventId,
          transfer.fromAttendeeId,
          transfer.recipientName,
          transfer.recipientEmail,
          transfer.recipientPhone,
        );

        const executed = await this.executeTransfer(
          tx,
          event,
          ticket,
          ticket.attendee,
          {
            name: transfer.recipientName,
            email: transfer.recipientEmail,
            phone: transfer.recipientPhone,
            customValues: transfer.customValues as Record<string, unknown>,
          },
          userId,
          transfer.reason,
          {
            existingTransferId: transfer.id,
            initiatedBy: transfer.initiatedBy,
            requesterActorId: transfer.requesterActorId,
            deadline,
            superAdminOverride: isOverride,
            overrideReason: dto.overrideReason ?? transfer.overrideReason,
          },
        );

        return { id: transfer.id, status: 'Approved', newTicketNumber: executed.newTicketNumber };
      },
      true,
      120000,
    );
  }

  async reject(
    eventId: number,
    transferId: number,
    body: unknown,
    userId: number,
    role: string,
    orgId: number,
  ) {
    const dto = parse(rejectSchema, body);
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx) => {
        const transfer = await tx.ticketTransfer.findFirst({
          where: { id: transferId, eventId },
        });
        if (!transfer) throw new NotFoundException('Transfer record not found.');
        if (transfer.status !== 'Pending') {
          throw new BadRequestException('Only pending transfers can be rejected.');
        }

        await tx.ticketTransfer.update({
          where: { id: transferId },
          data: {
            status: 'Rejected',
            resolvedAt: new Date(),
            resolvedBy: userId,
            rejectionReason: dto.reason,
          },
        });

        await tx.auditLog.create({
          data: {
            eventId,
            actorId: userId,
            action: 'ticket.transfer_rejected',
            details: JSON.stringify({
              transferId,
              ticketId: transfer.ticketId,
              reason: dto.reason,
            }),
          },
        });

        await this.notifications.event(tx,eventId,userId,await this.notifications.attendeeRecipients(tx,transfer.fromAttendeeId),
          'Dream Events transfer rejected','Your ticket transfer request was rejected. Review its status or contact the organizer.',`transfer-rejected:${transfer.id}`);
        return { id: transfer.id, status: 'Rejected' };
      },
      true,
      120000,
    );
  }

  public async validateDuplicateGuest(
    tx: Tx,
    eventId: number,
    fromAttendeeId: number,
    name: string,
    guestEmail: string | null,
    guestPhone: string,
  ) {
    const oldGuest = await tx.guestInvitation.findUnique({
      where: { attendeeId: fromAttendeeId },
    });
    if (!oldGuest) return;

    const matchKey = guestKey(guestEmail, name, guestPhone);
    const existing = await tx.guestInvitation.findFirst({
      where: {
        eventId,
        studentId: oldGuest.studentId,
        matchKey,
        active: true,
        attendeeId: { not: fromAttendeeId },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This student already has an active guest matching this name or email.',
      );
    }
  }

  public async executeTransfer(
    tx: Tx,
    event: Event,
    oldTicket: Ticket,
    fromAttendee: Attendee,
    recipient: {
      name: string;
      email: string | null;
      phone: string;
      customValues: Record<string, unknown>;
    },
    actorId: number | null,
    reasonText: string,
    options: {
      existingTransferId?: number;
      initiatedBy: string;
      requesterActorId?: number | null;
      deadline: Date | null;
      superAdminOverride?: boolean;
      overrideReason?: string;
    },
  ) {
    // 1. Create recipient Attendee
    const newAttendee = await tx.attendee.create({
      data: {
        eventId: event.id,
        categoryId: oldTicket.categoryId,
        fullName: recipient.name,
        email: recipient.email || null,
        phone: recipient.phone || '',
        status: 'Registered',
      },
    });

    // 2. Link GuestInvitation if the original attendee had one
    const oldGuest = await tx.guestInvitation.findUnique({
      where: { attendeeId: fromAttendee.id },
    });
    if (oldGuest) {
      await tx.guestInvitation.update({
        where: { id: oldGuest.id },
        data: { active: false },
      });
      await tx.guestInvitation.create({
        data: {
          eventId: event.id,
          studentId: oldGuest.studentId,
          attendeeId: newAttendee.id,
          email: recipient.email || null,
          matchKey: guestKey(recipient.email || null, recipient.name, recipient.phone || ''),
          invitationGroup: oldGuest.invitationGroup,
          active: true,
          customValues: (recipient.customValues ?? {}) as Prisma.InputJsonValue,
        },
      });
    }

    // 3. Invalidate old QR and ticket
    await tx.ticket.update({
      where: { id: oldTicket.id },
      data: { status: 'Cancelled' },
    });
    await tx.attendee.update({
      where: { id: fromAttendee.id },
      data: { status: 'Cancelled' },
    });

    // 4. Revoke existing mobile links for the old ticket
    await tx.publicTicketLink.updateMany({
      where: { ticketId: oldTicket.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // 5. Generate new QR and ticket
    const { raw, hash: tokenHash } = newToken();
    const newTicket = await tx.ticket.create({
      data: {
        number: 'AAST-' + randomBytes(8).toString('hex').toUpperCase(),
        eventId: event.id,
        attendeeId: newAttendee.id,
        categoryId: oldTicket.categoryId,
        tokenHash,
        status: 'Active',
        expiresAt: event.endsAt,
        credential: {
          create: { tokenHash, protectedToken: seal(raw) },
        },
      },
    });

    // 6. Render new ticket artifacts
    await this.tickets.render(tx, event, newTicket, raw);

    // 7. Create new PublicTicketLink capability for new ticket
    const newMobileToken = newToken();
    const newMobileLink = await tx.publicTicketLink.create({
      data: {
        eventId: event.id,
        ticketId: newTicket.id,
        tokenHash: digest('DEM1.' + newMobileToken.raw),
        expiresAt: event.endsAt,
      },
    });

    // 8. Update or create TicketTransfer record
    let transferId: number;
    if (options.existingTransferId) {
      transferId = options.existingTransferId;
      await tx.ticketTransfer.update({
        where: { id: transferId },
        data: {
          status: 'Approved',
          resolvedAt: new Date(),
          resolvedBy: actorId,
          toAttendeeId: newAttendee.id,
          newTicketId: newTicket.id,
          superAdminOverride: options.superAdminOverride ?? false,
          overrideReason: options.overrideReason ?? '',
        },
      });
    } else {
      const created = await tx.ticketTransfer.create({
        data: {
          eventId: event.id,
          ticketId: oldTicket.id,
          fromAttendeeId: fromAttendee.id,
          toAttendeeId: newAttendee.id,
          newTicketId: newTicket.id,
          initiatedBy: options.initiatedBy,
          requesterActorId: options.requesterActorId ?? actorId,
          recipientName: recipient.name,
          recipientEmail: recipient.email || null,
          recipientPhone: recipient.phone || '',
          customValues: (recipient.customValues ?? {}) as Prisma.InputJsonValue,
          reason: reasonText,
          status: 'Approved',
          resolvedAt: new Date(),
          resolvedBy: actorId,
          deadline: options.deadline,
          superAdminOverride: options.superAdminOverride ?? false,
          overrideReason: options.overrideReason ?? '',
        },
      });
      transferId = created.id;
    }

    // 9. Audit log
    await tx.auditLog.create({
      data: {
        eventId: event.id,
        actorId,
        action: 'ticket.transferred',
        details: JSON.stringify({
          transferId,
          fromTicket: oldTicket.number,
          newTicket: newTicket.number,
          fromAttendeeId: fromAttendee.id,
          toAttendeeId: newAttendee.id,
          recipientName: recipient.name,
          superAdminOverride: options.superAdminOverride ?? false,
        }),
      },
    });

    // 10. Queue delivery if configured
    await this.notifications.event(tx, event.id, actorId, await this.notifications.attendeeRecipients(tx,fromAttendee.id), `${event.name}: ticket transferred`,
      `Ticket ${oldTicket.number} has been transferred and its old QR is invalid.`, `transfer-old:${transferId}`);
    if (recipient.email && this.notifications.enabled()) await this.notifications.event(tx, event.id, actorId, [recipient.email], `${event.name}: your transferred ticket`,
      `Your ticket is available privately:\n${this.notifications.publicUrl('/ticket#DEM1.' + newMobileToken.raw)}\nDo not share the link publicly.`, `transfer-new:${transferId}`,
      { kind: 'ticket', id: newMobileLink.id, tokenHash: newMobileLink.tokenHash });
    // Optional PDF delivery may fail without undoing the transfer/private mobile
    // link. Recover its writes and PostgreSQL error state before committing.
    await tx.$executeRawUnsafe('SAVEPOINT transfer_pdf_delivery');
    try {
      const org = await tx.organizationEvent.findUniqueOrThrow({ where: { eventId: event.id } });
      await this.delivery.queue(tx, newTicket, actorId, org.organizationId, 'transfer:' + newTicket.id);
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT transfer_pdf_delivery');
    } catch {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT transfer_pdf_delivery');
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT transfer_pdf_delivery');
      await tx.auditLog.create({data:{eventId:event.id,actorId,action:'ticket.transfer_pdf_email_not_queued',
        details:`Ticket ${newTicket.id}; private mobile link remains available; review delivery before resending`}});
    }

    return {
      transferId,
      newTicketId: newTicket.id,
      newTicketNumber: newTicket.number,
      newMobileToken: newMobileToken.raw,
    };
  }
}
