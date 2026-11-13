import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma, Event, Ticket, Attendee } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { TicketsService } from './tickets.service.js';
import { TransfersService } from './transfers.service.js';
import type { AuthenticatedRequest } from '../common/request.js';
import { newToken, digest } from '../common/crypto.util.js';
import { generateQrPng } from './ticket-engine/qr.util.js';
import { generatePdfTicket } from './ticket-engine/pdf.util.js';
import { eventDesign } from './ticket-engine/design.js';
import { text, phone, email, values, reason, parse, hash } from '../students/validation.js';
import { NotificationsService } from '../email/notifications.service.js';

type Tx = Prisma.TransactionClient;

const confirmation = z
  .object({
    confirmed: z.literal(true),
    reason: text.min(5).max(1000),
  })
  .strict();

const guestTransferSchema = z
  .object({
    action: z.literal('transfer'),
    requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    recipientName: text.min(2).max(200),
    recipientEmail: z
      .union([email, z.literal(''), z.null()])
      .optional()
      .transform((v) => v || null),
    recipientPhone: phone.default(''),
    customValues: values.default({}),
    reason: text.max(1000).default(''),
  })
  .strict();

const guestCancelSchema = z
  .object({
    action: z.literal('cancel'),
    requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    confirmed: z.literal(true),
    reason: text.min(5).max(1000),
  })
  .strict();

@Injectable()
export class MobileTicketsService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: EventsService,
    private readonly tickets: TicketsService,
    private readonly transfers: TransfersService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(eventId: number, ticketId: number, r: AuthenticatedRequest) {
    await this.events.assertAccess(eventId, r.user.id, r.orgRole, r.orgId, 'tickets.manage');
    if (!(await this.db.ticket.findFirst({ where: { id: ticketId, eventId } }))) {
      throw new NotFoundException('Ticket not found in this event.');
    }
    return this.db.publicTicketLink.findMany({
      where: { eventId, ticketId },
      select: { id: true, expiresAt: true, revokedAt: true, createdAt: true },
      orderBy: { id: 'desc' },
    });
  }

  async rotate(eventId: number, ticketId: number, body: unknown, r: AuthenticatedRequest) {
    const dto = parse(confirmation, body);
    return this.events.mutate(
      eventId,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived) throw new BadRequestException('Archived events are read-only.');
        const ticket = await tx.ticket.findFirst({ where: { id: ticketId, eventId } });
        if (!ticket) throw new NotFoundException('Ticket not found in this event.');
        if (ticket.status === 'Cancelled' || ticket.status === 'Revoked') {
          throw new BadRequestException('Cannot create links for cancelled or revoked tickets.');
        }

        await tx.publicTicketLink.updateMany({
          where: { eventId, ticketId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        const token = newToken();
        const link = await tx.publicTicketLink.create({
          data: {
            eventId,
            ticketId,
            tokenHash: digest('DEM1.' + token.raw),
            expiresAt: event.endsAt,
          },
        });

        await tx.auditLog.create({
          data: {
            eventId,
            actorId: r.user.id,
            action: 'ticket.mobile_link_created',
            details: JSON.stringify({
              linkId: link.id,
              ticketId,
              reason: dto.reason,
            }),
          },
        });

        return {
          id: link.id,
          path: '/ticket#DEM1.' + token.raw,
          expiresAt: link.expiresAt,
        };
      },
    );
  }

  async revoke(eventId: number, ticketId: number, body: unknown, r: AuthenticatedRequest) {
    const dto = parse(confirmation, body);
    return this.events.mutate(
      eventId,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
      async (tx) => {
        if (!(await tx.ticket.findFirst({ where: { id: ticketId, eventId } }))) {
          throw new NotFoundException('Ticket not found in this event.');
        }
        const result = await tx.publicTicketLink.updateMany({
          where: { eventId, ticketId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            eventId,
            actorId: r.user.id,
            action: 'ticket.mobile_link_revoked',
            details: JSON.stringify({
              ticketId,
              reason: dto.reason,
              count: result.count,
            }),
          },
        });
        return { revoked: result.count };
      },
    );
  }

  private async capability<T>(
    token: string,
    fn: (
      tx: Tx,
      event: Event,
      link: { id: number; ticketId: number; eventId: number },
      ticket: Ticket & { attendee: Attendee },
    ) => Promise<T>,
  ) {
    const denied = () =>
      new UnauthorizedException(
        'This ticket link is invalid, expired or no longer available.',
      );
    if (!/^DEM1\.[A-Za-z0-9_-]{43}$/.test(token)) throw denied();

    const seed = await this.db.publicTicketLink.findUnique({
      where: { tokenHash: digest(token) },
      select: { eventId: true },
    });
    if (!seed) throw denied();

    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM events WHERE id=${seed.eventId} FOR UPDATE`;
        const link = await tx.publicTicketLink.findUnique({
          where: { tokenHash: digest(token) },
        });
        const event = await tx.event.findUnique({
          where: { id: seed.eventId },
        });
        if (
          !link ||
          !event ||
          link.revokedAt ||
          link.expiresAt <= new Date() ||
          event.archived ||
          event.endsAt <= new Date()
        ) {
          throw denied();
        }

        const ticket = await tx.ticket.findUnique({
          where: { id: link.ticketId },
          include: { attendee: true },
        });
        if (!ticket || ticket.eventId !== event.id) throw denied();

        return fn(tx, event, link, ticket);
      },
      { timeout: 120000 },
    );
  }

  async view(token: string) {
    return this.capability(token, async (tx, event, link, ticket) => {
      const [category, entrances, guestInvitation, settingsRow, checkIn] = await Promise.all([
        tx.ticketCategory.findUniqueOrThrow({ where: { id: ticket.categoryId } }),
        tx.entrance.findMany({
          where: {
            eventId: event.id,
            active: true,
            entrancePermissions: { some: { categoryId: ticket.categoryId } },
          },
          select: { name: true },
        }),
        tx.guestInvitation.findUnique({
          where: { attendeeId: ticket.attendeeId },
          include: { student: { select: { fullName: true } } },
        }),
        tx.eventSetting.findUnique({
          where: { eventId_key: { eventId: event.id, key: 'product.v1' } },
        }),
        tx.checkIn.findUnique({ where: { ticketId: ticket.id } }),
      ]);

      const product = settingsRow ? JSON.parse(settingsRow.value) : {};
      const deadline = product.transferDeadline ? new Date(product.transferDeadline) : event.endsAt;
      const now = new Date();

      const pendingTransfer = await tx.ticketTransfer.findFirst({
        where: { ticketId: ticket.id, status: 'Pending' },
        select: { id: true, recipientName: true, createdAt: true, status: true },
      });

      const checkedIn = Boolean(checkIn || ticket.status === 'Used');
      const canTransfer =
        ticket.status === 'Active' &&
        !checkedIn &&
        !pendingTransfer &&
        now <= deadline &&
        now <= event.endsAt;

      const canCancel =
        ticket.status === 'Active' &&
        !checkedIn &&
        now <= event.endsAt;

      let qrDataUri: string | null = null;
      if (ticket.status === 'Active' && !checkedIn) {
        try {
          const raw = await this.tickets.raw(tx, ticket);
          const qrPng = await generateQrPng(raw);
          qrDataUri = `data:image/png;base64,${qrPng.toString('base64')}`;
        } catch {
          // Recovery key missing or unavailable
        }
      }

      const design = await eventDesign(tx, event.id);

      return {
        event: {
          id: event.id,
          name: event.name,
          venue: event.venue,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          timezone: event.timezone,
          instructions: event.instructions,
        },
        ticket: {
          id: ticket.id,
          number: ticket.number,
          status: ticket.status,
          categoryName: category.name,
          categoryColor: category.color,
          expiresAt: ticket.expiresAt,
          checkedIn,
        },
        attendee: {
          fullName: ticket.attendee.fullName,
          email: ticket.attendee.email,
          phone: ticket.attendee.phone,
        },
        studentName: guestInvitation?.student.fullName ?? null,
        entrances: entrances.map((e) => e.name),
        qrDataUri,
        pdfAvailable: ticket.status === 'Active' && !checkedIn,
        transfer: {
          allowed: canTransfer,
          deadline: product.transferDeadline ?? event.endsAt.toISOString(),
          pending: pendingTransfer,
        },
        canCancel,
        design: {
          primaryColor: design.primaryColor,
          accentColor: design.accentColor,
          backgroundColor: design.backgroundColor,
          layout: design.layout,
          heading: design.heading,
          footer: design.footer,
        },
      };
    });
  }

  async pdf(token: string) {
    return this.capability(token, async (tx, event, link, ticket) => {
      if (ticket.status !== 'Active') {
        throw new BadRequestException('PDF tickets are only downloadable for active tickets.');
      }
      if (await tx.checkIn.count({ where: { ticketId: ticket.id } })) {
        throw new BadRequestException('Used tickets cannot be re-downloaded.');
      }
      const raw = await this.tickets.raw(tx, ticket);
      const [category, entrances, design] = await Promise.all([
        tx.ticketCategory.findUniqueOrThrow({ where: { id: ticket.categoryId } }),
        tx.entrance.findMany({
          where: {
            eventId: event.id,
            active: true,
            entrancePermissions: { some: { categoryId: ticket.categoryId } },
          },
        }),
        eventDesign(tx, event.id),
      ]);
      const pdfBuffer = await generatePdfTicket(
        event,
        ticket.attendee,
        category,
        ticket,
        raw,
        entrances,
        design,
      );
      return { number: ticket.number, bytes: pdfBuffer };
    });
  }

  private async completedOperation(token: string, requestKey: string, contentHash: string) {
    if (!/^DEM1\.[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const link = await this.db.publicTicketLink.findUnique({
      where: { tokenHash: digest(token) },
      select: { id: true },
    });
    if (!link) return undefined;
    const old = await this.db.publicTicketOperation.findUnique({
      where: { linkId_requestKey: { linkId: link.id, requestKey } },
    });
    if (!old) return undefined;
    if (old.contentHash !== contentHash) {
      throw new ConflictException('This request key belongs to another operation.');
    }
    return old.result;
  }

  async transfer(token: string, body: unknown) {
    const dto = parse(guestTransferSchema, body);
    try {
      return await this.capability(token, async (tx, event, link, ticket) => {
      const contentHash = hash(dto);
      const old = await tx.publicTicketOperation.findUnique({
        where: { linkId_requestKey: { linkId: link.id, requestKey: dto.requestKey } },
      });
      if (old) {
        if (old.contentHash !== contentHash) {
          throw new ConflictException('This request key belongs to another operation.');
        }
        return old.result;
      }

      if (ticket.status !== 'Active') {
        throw new BadRequestException('Only active unused tickets can be transferred.');
      }
      if (await tx.checkIn.count({ where: { ticketId: ticket.id } })) {
        throw new BadRequestException('Used tickets preserve their admission history.');
      }

      if (await tx.ticketTransfer.count({ where: { ticketId: ticket.id, status: 'Pending' } })) {
        throw new ConflictException('A transfer is already pending for this ticket.');
      }

      const settingsRow = await tx.eventSetting.findUnique({
        where: { eventId_key: { eventId: event.id, key: 'product.v1' } },
      });
      const product = settingsRow ? JSON.parse(settingsRow.value) : {};
      const deadline = product.transferDeadline ? new Date(product.transferDeadline) : event.endsAt;
      const now = new Date();

      if (now > deadline) {
        throw new BadRequestException('Transfer deadline has passed for this event.');
      }

      await this.transfers.validateDuplicateGuest(
        tx,
        event.id,
        ticket.attendeeId,
        dto.recipientName,
        dto.recipientEmail,
        dto.recipientPhone,
      );

      let result: { action: string; status: string; transferId?: number; newTicketNumber?: string };

      if (product.transferApproval === 'automatic') {
        const executed = await this.transfers.executeTransfer(
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
          null,
          dto.reason,
          {
            initiatedBy: 'guest',
            deadline,
          },
        );
        result = { action: 'transferred', status: 'Approved', newTicketNumber: executed.newTicketNumber };
      } else {
        const transfer = await tx.ticketTransfer.create({
          data: {
            eventId: event.id,
            ticketId: ticket.id,
            fromAttendeeId: ticket.attendeeId,
            initiatedBy: 'guest',
            recipientName: dto.recipientName,
            recipientEmail: dto.recipientEmail,
            recipientPhone: dto.recipientPhone,
            customValues: dto.customValues,
            reason: dto.reason,
            status: 'Pending',
            deadline,
          },
        });
        await tx.auditLog.create({
          data: {
            eventId: event.id,
            actorId: null,
            action: 'ticket.transfer_requested',
            details: JSON.stringify({
              transferId: transfer.id,
              ticketId: ticket.id,
              fromAttendeeId: ticket.attendeeId,
              recipientName: dto.recipientName,
              reason: dto.reason,
            }),
          },
        });
        await this.notifications.event(tx,event.id,null,await this.notifications.attendeeRecipients(tx,ticket.attendeeId),
          `${event.name}: transfer awaiting approval`,'Your ticket transfer request is awaiting event administrator approval.',`transfer-pending:${transfer.id}`);
        result = { action: 'transfer_requested', status: 'Pending', transferId: transfer.id };
      }

      await tx.publicTicketOperation.create({
        data: {
          linkId: link.id,
          requestKey: dto.requestKey,
          contentHash,
          result,
        },
      });

      return result;
      });
    } catch (e) {
      // The first successful transfer revokes this link. Return its committed
      // receipt for a matching retry, including one racing that transaction.
      if (e instanceof UnauthorizedException) {
        const old = await this.completedOperation(token, dto.requestKey, hash(dto));
        if (old !== undefined) return old;
      }
      throw e;
    }
  }

  async cancelTransfer(token: string) {
    return this.capability(token, async (tx, event, link, ticket) => {
      const transfer = await tx.ticketTransfer.findFirst({
        where: { ticketId: ticket.id, status: 'Pending' },
      });
      if (!transfer) {
        throw new NotFoundException('No pending transfer found for this ticket.');
      }

      await tx.ticketTransfer.update({
        where: { id: transfer.id },
        data: { status: 'Cancelled' },
      });

      await tx.auditLog.create({
        data: {
          eventId: event.id,
          actorId: null,
          action: 'ticket.transfer_cancelled',
          details: JSON.stringify({
            transferId: transfer.id,
            ticketId: ticket.id,
          }),
        },
      });

      await this.notifications.event(tx,event.id,null,await this.notifications.attendeeRecipients(tx,ticket.attendeeId),
        `${event.name}: transfer request cancelled`,'Your pending ticket transfer request was cancelled. Its original ticket remains valid under the event rules.',`transfer-cancelled:${transfer.id}`);
      return { action: 'transfer_cancelled' };
    });
  }

  async cancelTicket(token: string, body: unknown) {
    const dto = parse(guestCancelSchema, body);
    try {
      return await this.capability(token, async (tx, event, link, ticket) => {
      const contentHash = hash(dto);
      const old = await tx.publicTicketOperation.findUnique({
        where: { linkId_requestKey: { linkId: link.id, requestKey: dto.requestKey } },
      });
      if (old) {
        if (old.contentHash !== contentHash) {
          throw new ConflictException('This request key belongs to another operation.');
        }
        return old.result;
      }

      if (ticket.status !== 'Active') {
        throw new BadRequestException('Only active tickets can be cancelled.');
      }
      if (await tx.checkIn.count({ where: { ticketId: ticket.id } })) {
        throw new BadRequestException('Used tickets preserve their admission history.');
      }

      // Cancel any pending transfer
      await tx.ticketTransfer.updateMany({
        where: { ticketId: ticket.id, status: 'Pending' },
        data: { status: 'Cancelled' },
      });

      // Cancel ticket
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: 'Cancelled' },
      });

      // Cancel attendee
      await tx.attendee.update({
        where: { id: ticket.attendeeId },
        data: { status: 'Cancelled' },
      });

      // Deactivate guest invitation (restores student's quota slot)
      const guest = await tx.guestInvitation.findUnique({
        where: { attendeeId: ticket.attendeeId },
      });
      if (guest) {
        await tx.guestInvitation.update({
          where: { id: guest.id },
          data: { active: false },
        });
      }

      // Revoke the mobile link
      await tx.publicTicketLink.update({
        where: { id: link.id },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          eventId: event.id,
          actorId: null,
          action: 'ticket.guest_cancelled',
          details: JSON.stringify({
            linkId: link.id,
            ticketId: ticket.id,
            reason: dto.reason,
          }),
        },
      });

      const result = { action: 'cancelled' };
      const guestRecipient = await tx.guestInvitation.findUnique({ where: { attendeeId: ticket.attendeeId }, include: { student: true } });
      await this.notifications.event(tx, event.id, null, [ticket.attendee.email, guestRecipient?.email, guestRecipient?.student.email], `${event.name}: ticket cancelled`,
        `Ticket ${ticket.number} is cancelled. Its QR can no longer admit a guest.`, `ticket-cancelled:${ticket.id}`);
      await tx.publicTicketOperation.create({
        data: {
          linkId: link.id,
          requestKey: dto.requestKey,
          contentHash,
          result,
        },
      });

      return result;
      });
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        const old = await this.completedOperation(token, dto.requestKey, hash(dto));
        if (old !== undefined) return old;
      }
      throw e;
    }
  }
}
