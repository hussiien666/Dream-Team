import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Event, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import type { AuthenticatedRequest } from '../common/request.js';
import { newToken, digest } from '../common/crypto.util.js';
import { StudentsService } from './students.service.js';
import { parse, hash, guestSchema } from './validation.js';

type Tx = Prisma.TransactionClient;
const confirmation = z
  .object({
    confirmed: z.literal(true),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
const guest = guestSchema.omit({
  studentId: true,
  overrideReason: true,
  invitationGroup: true,
});
const operation = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('add'),
      requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
      confirmed: z.literal(true),
      guest,
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel'),
      requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
      confirmed: z.literal(true),
      guestId: z.number().int().positive(),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
]);

@Injectable()
export class InvitationLinksService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: EventsService,
    private readonly students: StudentsService,
  ) {}

  async list(eventId: number, studentId: number, r: AuthenticatedRequest) {
    await this.events.assertAccess(
      eventId,
      r.user.id,
      r.orgRole,
      r.orgId,
      'attendees.manage',
    );
    if (
      !(await this.db.student.findFirst({ where: { id: studentId, eventId } }))
    )
      throw new NotFoundException('Student not found.');
    return this.db.publicInvitationLink.findMany({
      where: { eventId, studentId },
      select: { id: true, expiresAt: true, revokedAt: true, createdAt: true },
      orderBy: { id: 'desc' },
    });
  }

  async rotate(
    eventId: number,
    studentId: number,
    body: unknown,
    r: AuthenticatedRequest,
  ) {
    const dto = parse(confirmation, body);
    return this.events.mutate(
      eventId,
      r.user.id,
      r.orgRole,
      r.orgId,
      'attendees.manage',
      async (tx, event) => {
        this.open(event);
        const student = await tx.student.findFirst({
          where: { id: studentId, eventId, active: true },
        });
        if (!student)
          throw new NotFoundException(
            'Active student not found in this event.',
          );
        await tx.publicInvitationLink.updateMany({
          where: { eventId, studentId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const token = newToken();
        const link = await tx.publicInvitationLink.create({
          data: {
            eventId,
            studentId,
            tokenHash: digest('DEI1.' + token.raw),
            expiresAt: event.endsAt,
          },
        });
        await tx.auditLog.create({
          data: {
            eventId,
            actorId: r.user.id,
            action: 'invitation.link_created',
            details: JSON.stringify({
              linkId: link.id,
              studentId,
              reason: dto.reason,
            }),
          },
        });
        return {
          id: link.id,
          path: '/invitation#DEI1.' + token.raw,
          expiresAt: link.expiresAt,
        };
      },
    );
  }

  async revoke(
    eventId: number,
    studentId: number,
    body: unknown,
    r: AuthenticatedRequest,
  ) {
    const dto = parse(confirmation, body);
    return this.events.mutate(
      eventId,
      r.user.id,
      r.orgRole,
      r.orgId,
      'attendees.manage',
      async (tx) => {
        if (
          !(await tx.student.findFirst({ where: { id: studentId, eventId } }))
        )
          throw new NotFoundException('Student not found.');
        const result = await tx.publicInvitationLink.updateMany({
          where: { eventId, studentId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            eventId,
            actorId: r.user.id,
            action: 'invitation.link_revoked',
            details: JSON.stringify({
              studentId,
              reason: dto.reason,
              count: result.count,
            }),
          },
        });
        return { revoked: result.count };
      },
    );
  }

  private open(e: Event) {
    if (
      e.archived ||
      !['Published', 'Ongoing', 'Upcoming', 'Active'].includes(e.status) ||
      e.endsAt <= new Date()
    )
      throw new BadRequestException('Invitations are closed for this event.');
  }
  private async capability<T>(
    token: string,
    fn: (
      tx: Tx,
      event: Event,
      link: { id: number; studentId: number },
    ) => Promise<T>,
  ) {
    const denied = () =>
      new UnauthorizedException(
        'This invitation link is invalid, expired or no longer available.',
      );
    if (!/^DEI1\.[A-Za-z0-9_-]{43}$/.test(token)) throw denied();
    const seed = await this.db.publicInvitationLink.findUnique({
      where: { tokenHash: digest(token) },
      select: { eventId: true },
    });
    if (!seed) throw denied();
    return this.db.$transaction(
      async (tx) => {
        // Same lock as registration, issuance, lifecycle changes and scanner admission.
        await tx.$queryRaw`SELECT id FROM events WHERE id=${seed.eventId} FOR UPDATE`;
        const link = await tx.publicInvitationLink.findUnique({
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
          !(await tx.student.findFirst({
            where: { id: link.studentId, eventId: link.eventId, active: true },
          }))
        )
          throw denied();
        this.open(event);
        return fn(tx, event, link);
      },
      { timeout: 120000 },
    );
  }

  view(token: string) {
    return this.capability(token, async (tx, event, link) => {
      const [student, guests, fields, categories, settings] = await Promise.all(
        [
          tx.student.findUniqueOrThrow({
            where: { id: link.studentId },
            select: { fullName: true, guestLimit: true },
          }),
          tx.guestInvitation.findMany({
            where: { studentId: link.studentId, eventId: event.id },
            select: {
              id: true,
              active: true,
              attendee: {
                select: {
                  fullName: true,
                  category: { select: { name: true } },
                  tickets: { select: { status: true } },
                },
              },
            },
            orderBy: { id: 'asc' },
          }),
          tx.registrationField.findMany({
            where: { eventId: event.id, target: 'guest', active: true },
            select: {
              key: true,
              label: true,
              type: true,
              required: true,
              options: true,
            },
            orderBy: { id: 'asc' },
          }),
          tx.ticketCategory.findMany({
            where: { eventId: event.id, active: true },
            select: { id: true, name: true },
          }),
          tx.eventSetting.findUnique({
            where: { eventId_key: { eventId: event.id, key: 'product.v1' } },
          }),
        ],
      );
      const product = JSON.parse(settings?.value ?? '{}');
      return {
        event: {
          name: event.name,
          venue: event.venue,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          timezone: event.timezone,
        },
        studentName: student.fullName,
        guests,
        fields,
        categories,
        guestLimit:
          student.guestLimit ?? product.perStudentLimit ?? event.maxTickets,
        defaultCategoryId: product.defaultCategoryId ?? null,
        canAdd:
          !event.registrationDeadline ||
          event.registrationDeadline > new Date(),
      };
    });
  }

  operate(token: string, body: unknown) {
    const dto = parse(operation, body);
    return this.capability(token, async (tx, event, link) => {
      const contentHash = hash(dto);
      const old = await tx.publicInvitationOperation.findUnique({
        where: {
          linkId_requestKey: { linkId: link.id, requestKey: dto.requestKey },
        },
      });
      if (old) {
        if (old.contentHash !== contentHash)
          throw new ConflictException(
            'This request key belongs to another operation.',
          );
        return old.result;
      }
      let result: { id: number; action: string };
      if (dto.action === 'add')
        result = await this.students.addFromInvitation(
          tx,
          event,
          link,
          dto.guest,
        );
      else {
        const guest = await tx.guestInvitation.findFirst({
          where: {
            id: dto.guestId,
            studentId: link.studentId,
            eventId: event.id,
          },
        });
        if (!guest)
          throw new NotFoundException('Guest not found for this invitation.');
        await tx.guestInvitation.update({
          where: { id: guest.id },
          data: { active: false },
        });
        await tx.attendee.update({
          where: { id: guest.attendeeId },
          data: { status: 'Cancelled' },
        });
        await tx.ticket.updateMany({
          where: {
            eventId: event.id,
            attendeeId: guest.attendeeId,
            status: { in: ['Active', 'Expired'] },
            checkIn: { is: null },
          },
          data: { status: 'Cancelled' },
        });
        await tx.auditLog.create({
          data: {
            eventId: event.id,
            actorId: null,
            action: 'invitation.guest_cancelled',
            details: JSON.stringify({
              linkId: link.id,
              guestId: guest.id,
              reason: dto.reason,
            }),
          },
        });
        result = { id: guest.id, action: 'cancelled' };
      }
      await tx.publicInvitationOperation.create({
        data: {
          linkId: link.id,
          requestKey: dto.requestKey,
          contentHash,
          result,
        },
      });
      return result;
    });
  }
}
