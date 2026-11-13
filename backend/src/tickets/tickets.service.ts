import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma, Event, Ticket } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { newToken, digest, parseQrPayload } from '../common/crypto.util.js';
import { seal, unseal } from '../common/encryption.util.js';
import { generatePdfTicket } from './ticket-engine/pdf.util.js';
import { generateMobileTicket } from './ticket-engine/mobile.util.js';
import { eventDesign } from './ticket-engine/design.js';
import { ticketZip } from './ticket-engine/zip.js';
import { DeliveryService } from './delivery.service.js';
import { listPage,pageResult } from '../common/list-page.js';
type Tx = Prisma.TransactionClient;
const live = ['Active', 'Used'] as const;
const ticketView = {
  id: true,
  number: true,
  eventId: true,
  attendeeId: true,
  categoryId: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const;
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly delivery: DeliveryService,
  ) {}

  async findAll(eventId: number, userId: number, role: string, orgId: number,query?:unknown) {
    await this.events.assertAccess(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
    );
    const q=query===undefined?undefined:listPage(query);
    const rows = await this.prisma.ticket.findMany({
      where: { eventId,...(q?.after?{id:{gt:q.after}}:{}),...(q?.search?{OR:[{number:{contains:q.search,mode:'insensitive'}},{attendee:{fullName:{contains:q.search,mode:'insensitive'}}}]}:{}) },
      select: {
        ...ticketView,
        attendee: { select: { fullName: true } },
        category: { select: { name: true } },
        credential: { select: { ticketId: true } },
      },
      orderBy: { id:q?'asc':'desc' },...(q?{take:51}:{}),
    });
    const result=rows.map(({ credential, ...row }) => ({
      ...row,
      recoverable: !!credential,
    }));
    return q?pageResult(result):result;
  }
  async candidates(
    eventId: number,
    userId: number,
    role: string,
    orgId: number,
    query?:unknown,
  ) {
    await this.events.assertAccess(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
    );
    const q=query===undefined?undefined:listPage(query);
    const rows=await this.prisma.attendee.findMany({
      where: { eventId, status: 'Registered',...(q?.after?{id:{gt:q.after}}:{}),...(q?{tickets:{none:{status:{in:[...live]}}},category:{active:true},OR:[{guestInvitation:{is:null}},{guestInvitation:{active:true,student:{active:true}}}]}:{}),
        ...(q?.studentId?{guestInvitation:{studentId:q.studentId,active:true,student:{active:true},...(q.group?{invitationGroup:q.group}:{})}}:q?.group?{guestInvitation:{invitationGroup:q.group,active:true,student:{active:true}}}:{}),
        ...(q?.search?{AND:{OR:[{fullName:{contains:q.search,mode:'insensitive'}},{guestInvitation:{student:{fullName:{contains:q.search,mode:'insensitive'}}}},{guestInvitation:{student:{studentId:{contains:q.search,mode:'insensitive'}}}},{guestInvitation:{invitationGroup:{contains:q.search,mode:'insensitive'}}}]}}:{}) },
      select: {
        id: true,
        fullName: true,
        categoryId: true,
        category: { select: { name: true, active: true } },
        guestInvitation: {
          select: {
            active: true,
            invitationGroup: true,
            studentId: true,
            student: { select: { fullName: true, active: true } },
          },
        },
        tickets: { where: { status: { in: [...live] } }, select: { id: true } },
      },
      orderBy:q?{id:'asc'}:{fullName:'asc'},...(q?{take:51}:{}),
    });
    return q?pageResult(rows):rows;
  }
  async issue(
    eventId: number,
    attendeeId: number,
    userId: number,
    role: string,
    orgId: number,
    requestKey: string = randomUUID(),
  ) {
    return this.issueBatch(
      eventId,
      [attendeeId],
      userId,
      role,
      orgId,
      requestKey,
    );
  }
  async issueBatch(
    eventId: number,
    attendeeIds: number[],
    userId: number,
    role: string,
    orgId: number,
    requestKey: string = randomUUID(),
  ) {
    if (
      !Array.isArray(attendeeIds) ||
      !attendeeIds.length ||
      attendeeIds.length > 500 ||
      attendeeIds.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(attendeeIds).size !== attendeeIds.length
    )
      throw new BadRequestException('Select 1-500 different attendees.');
    const ids = [...attendeeIds].sort((a, b) => a - b);
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        return this.issueInside(tx, event, ids, userId, orgId, requestKey);
      },
      true,
      120000,
    );
  }

  async issueInside(
    tx: Tx,
    event: Event,
    ids: number[],
    userId: number | null,
    orgId: number,
    requestKey: string,
    operationHash?: string,
  ) {
    const eventId = event.id,
      contentHash = operationHash ?? digest(JSON.stringify(ids));
    const old = await tx.ticketIssueReceipt.findUnique({
      where: { eventId_requestKey: { eventId, requestKey } },
    });
    if (old) {
      if (old.actorId !== userId || old.contentHash !== contentHash)
        throw new ConflictException(
          'This request key belongs to another issuance.',
        );
      return old.result;
    }
    this.assertIssuable(event);
    if (!ids.length || ids.length > 500)
      throw new BadRequestException('Select 1-500 eligible attendees.');
    const deliveries: unknown[] = [];
    const tickets: { id: number; number: string; attendeeId: number }[] = [];
    for (const attendeeId of ids) {
      const attendee = await tx.attendee.findFirst({
        where: { id: attendeeId, eventId },
        include: { guestInvitation: { include: { student: true } } },
      });
      if (!attendee)
        throw new NotFoundException(
          'An attendee is outside this event or no longer exists.',
        );
      if (
        attendee.status !== 'Registered' ||
        (attendee.guestInvitation &&
          (!attendee.guestInvitation.active ||
            !attendee.guestInvitation.student.active))
      )
        throw new BadRequestException('A selected registration is cancelled.');
      if (
        await tx.ticket.count({
          where: { eventId, attendeeId, status: { in: [...live] } },
        })
      )
        throw new ConflictException(
          `${attendee.fullName} already has a live ticket.`,
        );
      await this.assertAllocation(tx, event, attendee.categoryId);
      const { raw, hash } = newToken();
      const ticket = await tx.ticket.create({
        data: {
          number: 'AAST-' + randomBytes(8).toString('hex').toUpperCase(),
          eventId,
          attendeeId,
          categoryId: attendee.categoryId,
          tokenHash: hash,
          status: 'Active',
          expiresAt: event.endsAt,
          credential: {
            create: { tokenHash: hash, protectedToken: seal(raw) },
          },
        },
      });
      const mobileToken = newToken();
      await tx.publicTicketLink.create({
        data: {
          eventId,
          ticketId: ticket.id,
          tokenHash: digest('DEM1.' + mobileToken.raw),
          expiresAt: event.endsAt,
        },
      });
      // A render failure must roll back the entire issuance, including its credentials and audit.
      await this.render(tx, event, ticket, raw);
      await this.audit(tx, eventId, userId, 'ticket.issued', ticket.number);
      tickets.push({ id: ticket.id, number: ticket.number, attendeeId });
      deliveries.push(
        await this.delivery.queue(
          tx,
          ticket,
          userId,
          orgId,
          'generated:' + requestKey,
        ),
      );
    }
    const result = {
      tickets,
      count: tickets.length,
      delivery: deliveries as Prisma.InputJsonValue[],
    };
    await tx.ticketIssueReceipt.create({
      data: { eventId, actorId: userId, requestKey, contentHash, result },
    });
    return result;
  }
  async issueGroup(
    eventId: number,
    selector: { studentId?: number; invitationGroup?: string },
    userId: number,
    role: string,
    orgId: number,
    key: string,
  ) {
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        if (
          selector.studentId &&
          !(await tx.student.count({
            where: { id: selector.studentId, eventId, active: true },
          }))
        )
          throw new BadRequestException(
            'Select an active student in this event.',
          );
        const rows = await tx.attendee.findMany({
          where: {
            eventId,
            status: 'Registered',
            category: { active: true },
            guestInvitation: {
              is: { active: true, student: { active: true }, ...selector },
            },
            tickets: { none: { status: { in: [...live] } } },
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: 501,
        });
        return this.issueInside(
          tx,
          event,
          rows.map((r) => r.id),
          userId,
          orgId,
          key,
          digest(
            JSON.stringify({
              studentId: selector.studentId ?? null,
              invitationGroup: selector.invitationGroup ?? null,
            }),
          ),
        );
      },
      true,
      120000,
    );
  }
  async regenerate(
    eventId: number,
    ticketId: number,
    userId: number,
    role: string,
    orgId: number,
  ) {
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        const ticket = await this.ticket(tx, eventId, ticketId),
          raw = await this.raw(tx, ticket);
        await this.render(tx, event, ticket, raw);
        await this.audit(
          tx,
          eventId,
          userId,
          'ticket.artifacts_refreshed',
          ticket.number,
        );
        return { id: ticket.id, number: ticket.number };
      },
      true,
    );
  }
  async adopt(
    eventId: number,
    ticketId: number,
    qr: string,
    userId: number,
    role: string,
    orgId: number,
  ) {
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        const ticket = await this.ticket(tx, eventId, ticketId);
        if (
          !/^AAST1\.[A-Za-z0-9_-]{43}$/.test(qr) ||
          parseQrPayload(qr) !== ticket.tokenHash
        )
          throw new BadRequestException(
            'The original QR does not match this ticket.',
          );
        const raw = qr.slice(6);
        await this.render(tx, event, ticket, raw);
        await tx.ticketCredential.upsert({
          where: { ticketId },
          create: {
            ticketId,
            tokenHash: ticket.tokenHash,
            protectedToken: seal(raw),
          },
          update: { tokenHash: ticket.tokenHash, protectedToken: seal(raw) },
        });
        await this.audit(
          tx,
          eventId,
          userId,
          'ticket.credential_adopted',
          ticket.number,
        );
        return { id: ticket.id, number: ticket.number };
      },
      true,
    );
  }
  async lifecycle(
    eventId: number,
    ticketId: number,
    action: 'cancel' | 'reactivate' | 'revoke' | 'replace',
    reason: string,
    userId: number,
    role: string,
    orgId: number,
  ) {
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        const ticket = await this.ticket(tx, eventId, ticketId);
        if (
          ticket.status === 'Used' ||
          (await tx.checkIn.count({ where: { ticketId } }))
        )
          throw new BadRequestException(
            'Used tickets preserve their admission history.',
          );
        if (ticket.status === 'Revoked')
          throw new BadRequestException('This ticket is permanently revoked.');
        let status: Ticket['status'] = ticket.status,
          tokenHash = ticket.tokenHash;
        if (action === 'reactivate' || action === 'replace') {
          this.assertIssuable(event);
          const attendee = await tx.attendee.findFirst({
            where: { id: ticket.attendeeId, eventId, status: 'Registered' },
            include: { guestInvitation: { include: { student: true } } },
          });
          if (
            !attendee ||
            (attendee.guestInvitation &&
              (!attendee.guestInvitation.active ||
                !attendee.guestInvitation.student.active))
          )
            throw new BadRequestException(
              'Restore the registration before reactivating a ticket.',
            );
          if (
            action === 'reactivate' &&
            !['Cancelled', 'Expired'].includes(ticket.status)
          )
            throw new BadRequestException(
              'Only cancelled or expired unused tickets can be reactivated.',
            );
          if (action === 'replace' && ticket.status !== 'Active')
            throw new BadRequestException(
              'Only active unused tickets can be replaced.',
            );
          if (action === 'reactivate')
            await this.assertAllocation(
              tx,
              event,
              ticket.categoryId,
              ticket.attendeeId,
            );
          else {
            const category = await tx.ticketCategory.findFirst({
              where: { id: ticket.categoryId, eventId, active: true },
            });
            if (!category)
              throw new BadRequestException('Category is inactive.');
          }
          if (ticket.expiresAt <= new Date())
            throw new BadRequestException(
              'Ticket has expired. Extend its event-bound expiry by rescheduling first.',
            );
          status = 'Active';
          if (action === 'replace') {
            const token = newToken();
            tokenHash = token.hash;
            await tx.ticketCredential.upsert({
              where: { ticketId },
              create: { ticketId, tokenHash, protectedToken: seal(token.raw) },
              update: { tokenHash, protectedToken: seal(token.raw) },
            });
            await this.render(
              tx,
              event,
              { ...ticket, tokenHash, status },
              token.raw,
            );
          }
        } else if (action === 'revoke') status = 'Revoked';
        else {
          if (ticket.status === 'Cancelled')
            throw new BadRequestException('Ticket is already cancelled.');
          status = 'Cancelled';
        }
        await tx.ticket.update({
          where: { id: ticketId },
          data: { status, tokenHash },
        });
        await this.audit(
          tx,
          eventId,
          userId,
          'ticket.' + action,
          `${ticket.number}: ${ticket.status} -> ${status}; ${reason}`,
        );
        return { id: ticket.id, number: ticket.number, status };
      },
      true,
    );
  }
  async revoke(
    eventId: number,
    ticketId: number,
    userId: number,
    role: string,
    orgId: number,
    reason = 'Administrative revocation',
  ) {
    return this.lifecycle(
      eventId,
      ticketId,
      'revoke',
      reason,
      userId,
      role,
      orgId,
    );
  }
  async artifact(
    eventId: number,
    ticketId: number,
    userId: number,
    role: string,
    orgId: number,
    format: 'pdf' | 'html',
  ) {
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        const ticket = await this.ticket(tx, eventId, ticketId),
          raw = await this.raw(tx, ticket);
        const files = await this.render(tx, event, ticket, raw);
        return { number: ticket.number, bytes: files[format] };
      },
      true,
    );
  }
  async getPdf(
    eventId: number,
    ticketId: number,
    userId: number,
    role: string,
    orgId: number,
  ) {
    return (await this.artifact(eventId, ticketId, userId, role, orgId, 'pdf'))
      .bytes;
  }
  async zip(
    eventId: number,
    ids: number[],
    userId: number,
    role: string,
    orgId: number,
  ) {
    return this.events.mutate(
      eventId,
      userId,
      role,
      orgId,
      'tickets.manage',
      async (tx, event) => {
        const files: { name: string; bytes: Buffer }[] = [];
        let total = 0;
        for (const id of ids) {
          const ticket = await this.ticket(tx, eventId, id),
            raw = await this.raw(tx, ticket),
            rendered = await this.render(tx, event, ticket, raw);
          total += rendered.pdf.length + rendered.html.length;
          if (total > 30 * 1024 * 1024)
            throw new BadRequestException(
              'Ticket archive exceeds 30 MB. Select fewer tickets.',
            );
          const name = `${ticket.id}-${ticket.number.replace(/[^A-Za-z0-9_-]/g, '_')}`;
          files.push(
            { name: name + '.pdf', bytes: rendered.pdf },
            { name: name + '.html', bytes: rendered.html },
          );
        }
        return ticketZip(files);
      },
      true,
      120000,
    );
  }
  private async ticket(tx: Tx, eventId: number, id: number) {
    const ticket = await tx.ticket.findFirst({ where: { id, eventId } });
    if (!ticket) throw new NotFoundException('Ticket not found in this event.');
    return ticket;
  }
  async raw(tx: Tx, ticket: Ticket) {
    const credential = await tx.ticketCredential.findUnique({
      where: { ticketId: ticket.id },
    });
    if (!credential)
      throw new BadRequestException(
        'This historical ticket has only a QR hash. Supply its original QR to recover the same ticket, or explicitly replace an eligible unused ticket.',
      );
    let raw: string;
    try {
      raw = unseal(credential.protectedToken);
    } catch {
      throw new BadRequestException(
        'Ticket recovery key is unavailable. Restore the original installation key.',
      );
    }
    if (
      credential.tokenHash !== ticket.tokenHash ||
      digest(raw) !== ticket.tokenHash
    )
      throw new ConflictException(
        'Stored credential does not match the current QR.',
      );
    return raw;
  }
  private assertIssuable(event: Event) {
    this.events.assertEditable(event);
    if (!['Published', 'Ongoing', 'Upcoming', 'Active'].includes(event.status))
      throw new BadRequestException(
        'Publish the event before issuing tickets.',
      );
    const now = new Date();
    if (event.endsAt <= now) throw new BadRequestException('Event has ended.');
    if (event.distributionStart && now < event.distributionStart)
      throw new BadRequestException('Distribution has not started.');
    if (event.distributionEnd && now > event.distributionEnd)
      throw new BadRequestException('Distribution has ended.');
  }
  private async assertAllocation(
    tx: Tx,
    event: Event,
    categoryId: number,
    attendeeId?: number,
  ) {
    const category = await tx.ticketCategory.findFirst({
      where: { id: categoryId, eventId: event.id, active: true },
    });
    if (!category)
      throw new BadRequestException(
        'Category is inactive or outside this event.',
      );
    if (
      !(await tx.entrance.count({
        where: {
          eventId: event.id,
          active: true,
          entrancePermissions: { some: { categoryId } },
        },
      }))
    )
      throw new BadRequestException(
        `Configure an active entrance for ${category.name}.`,
      );
    if (
      (await tx.ticket.count({
        where: { eventId: event.id, status: { in: [...live] } },
      })) >= Math.min(event.capacity, event.maxTickets)
    )
      throw new BadRequestException('Event ticket limit reached.');
    if (
      (await tx.ticket.count({
        where: { eventId: event.id, categoryId, status: { in: [...live] } },
      })) >= category.allocation
    )
      throw new BadRequestException('Category allocation is full.');
    if (
      attendeeId &&
      (await tx.ticket.count({
        where: { eventId: event.id, attendeeId, status: { in: [...live] } },
      }))
    )
      throw new ConflictException('This attendee already has a live ticket.');
  }
  async render(tx: Tx, event: Event, ticket: Ticket, raw: string) {
    const design = await eventDesign(tx, event.id);
    const [attendee, category, entrances] = await Promise.all([
      tx.attendee.findUniqueOrThrow({
        where: { id: ticket.attendeeId },
        include: { guestInvitation: { include: { student: true } } },
      }),
      tx.ticketCategory.findUniqueOrThrow({ where: { id: ticket.categoryId } }),
      tx.entrance.findMany({
        where: {
          eventId: event.id,
          active: true,
          entrancePermissions: { some: { categoryId: ticket.categoryId } },
        },
      }),
    ]);
    return {
      pdf: await generatePdfTicket(
        event,
        attendee,
        category,
        ticket,
        raw,
        entrances,
        design,
      ),
      html: await generateMobileTicket(
        event,
        attendee,
        category,
        ticket,
        raw,
        entrances,
        design,
      ),
    };
  }
  private audit(
    tx: Tx,
    eventId: number,
    actorId: number | null,
    action: string,
    details: string,
  ) {
    return tx.auditLog.create({ data: { eventId, actorId, action, details } });
  }
}
