import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma, Event, EventStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import {
  CreateEventDto,
  UpdateEventDto,
  EventConfigurationDto,
} from './dto/create-event.dto.js';
import { hasPermission } from '../common/guards/jwt-auth.guard.js';

type Tx = Prisma.TransactionClient;
const dateKeys = [
  'eventDate',
  'startsAt',
  'endsAt',
  'distributionStart',
  'distributionEnd',
  'registrationDeadline',
] as const;
const textKeys = [
  'name',
  'subtitle',
  'description',
  'organization',
  'eventType',
  'venue',
  'country',
  'city',
  'building',
  'address',
  'instructions',
  'timezone',
] as const;
const openStatuses: EventStatus[] = [
  'Published',
  'Ongoing',
  'Upcoming',
  'Active',
];

export function rejectNulls(value: object, allowed: string[] = []) {
  for (const [key, item] of Object.entries(value))
    if (item === null && !allowed.includes(key))
      throw new BadRequestException(`${key} cannot be empty.`);
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number, orgRole: string, orgId: number) {
    if (!hasPermission(orgRole, 'events.view'))
      throw new ForbiddenException('Permission denied.');
    return this.prisma.event.findMany({
      where: {
        organizationEvent: { organizationId: orgId },
        ...(orgRole === 'super_admin'
          ? {}
          : { eventAssignments: { some: { userId } } }),
      },
      orderBy: [{ eventDate: 'desc' }, { id: 'desc' }],
      include: {
        categories: {
          select: { id: true, name: true, code: true, active: true },
        },
        entrances: { select: { id: true, name: true, active: true } },
      },
    });
  }
  async findOne(id: number, userId: number, orgRole: string, orgId: number) {
    await this.assertAccess(id, userId, orgRole, orgId, 'events.view');
    return this.prisma.event.findUniqueOrThrow({
      where: { id },
      include: {
        categories: true,
        entrances: true,
        _count: { select: { attendees: true, tickets: true, checkIns: true } },
      },
    });
  }

  /** Serialize event mutations with scanner admission; authorize again inside the transaction. */
  async mutate<T>(
    id: number,
    userId: number,
    role: string,
    orgId: number,
    permission: string,
    change: (tx: Tx, event: Event) => Promise<T>,
    allowClosed = false,
    timeout = 20000,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM events WHERE id=${id} FOR UPDATE`;
        await this.assertAccess(id, userId, role, orgId, permission, tx);
        const event = await tx.event.findUniqueOrThrow({ where: { id } });
        if (!allowClosed) this.assertEditable(event);
        return change(tx, event);
      },
      { timeout },
    );
  }

  async create(
    dto: CreateEventDto,
    userId: number,
    role: string,
    orgId: number,
  ) {
    if (!hasPermission(role, 'events.create'))
      throw new ForbiddenException('Permission denied.');
    rejectNulls(dto);
    if (dto.status && !['Draft', ...openStatuses].includes(dto.status))
      throw new BadRequestException(
        'Create an event as Draft, Upcoming or Active.',
      );
    const data = this.eventData(dto);
    const merged = {
      ...data,
      maxTickets: dto.maxTickets ?? dto.capacity,
      timezone: dto.timezone ?? 'Africa/Cairo',
    };
    this.validateEvent(merged);
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationUser.findUnique({
        where: { userId },
      });
      if (
        !membership ||
        membership.organizationId !== orgId ||
        membership.role !== role
      )
        throw new ForbiddenException('Organization access changed.');
      const event = await tx.event.create({
        data: {
          ...merged,
          organizationEvent: { create: { organizationId: orgId } },
        } as Prisma.EventCreateInput,
      });
      await tx.auditLog.create({
        data: { actorId: userId, eventId: event.id, action: 'event.created' },
      });
      return event;
    });
  }

  async update(
    id: number,
    dto: UpdateEventDto,
    userId: number,
    role: string,
    orgId: number,
  ) {
    return this.mutate(
      id,
      userId,
      role,
      orgId,
      'events.manage',
      async (tx, existing) => {
        rejectNulls(dto, [
          'distributionStart',
          'distributionEnd',
          'registrationDeadline',
        ]);
        const data = this.eventData(dto);
        if (dto.status === 'Cancelled')
          throw new BadRequestException(
            'Use Cancel event to preserve cancellation history.',
          );
        const next = { ...existing, ...data };
        this.validateEvent(next);
        const settings = await tx.eventSetting.findUnique({
          where: { eventId_key: { eventId: id, key: 'product.v1' } },
        });
        const transferDeadline = settings
          ? JSON.parse(settings.value).transferDeadline
          : null;
        if (transferDeadline && new Date(transferDeadline) > next.endsAt!)
          throw new BadRequestException(
            'Update the transfer deadline before shortening the event.',
          );
        const used = await tx.ticket.count({
          where: { eventId: id, status: { in: ['Active', 'Used'] } },
        });
        if (next.maxTickets! < used || next.capacity! < used)
          throw new BadRequestException(
            'Capacity and ticket limit cannot be below issued active/used tickets.',
          );
        const bound =
          +next.endsAt! !== +existing.endsAt
            ? await tx.$queryRaw<
                { id: number }[]
              >`SELECT t.id FROM tickets t JOIN events e ON e.id=t.event_id WHERE t.event_id=${id} AND t.expires_at=e.ends_at`
            : [];
        const event = await tx.event.update({ where: { id }, data });
        if (+event.endsAt !== +existing.endsAt) {
          // Keep credentials and identities. Only event-bound, unused expiries change.
          await tx.ticket.updateMany({
            where: {
              eventId: id,
              id: { in: bound.map((t) => t.id) },
              status: 'Active',
            },
            data: { expiresAt: event.endsAt },
          });
          if (event.endsAt > new Date())
            await tx.ticket.updateMany({
              where: {
                eventId: id,
                id: { in: bound.map((t) => t.id) },
                status: 'Expired',
                checkIn: { is: null },
                attendee: { status: 'Registered' },
              },
              data: { status: 'Active', expiresAt: event.endsAt },
            });
        }
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId: id,
            action:
              +event.startsAt !== +existing.startsAt ||
              +event.endsAt !== +existing.endsAt
                ? 'event.rescheduled'
                : 'event.updated',
            details: JSON.stringify({
              fields: Object.keys(dto),
              from: existing.status,
              to: event.status,
              previousStart: existing.startsAt,
              previousEnd: existing.endsAt,
            }),
          },
        });
        return event;
      },
    );
  }

  async delete(id: number, userId: number, role: string, orgId: number) {
    return this.mutate(
      id,
      userId,
      role,
      orgId,
      'events.manage',
      async (tx, event) => {
        if (await tx.ticket.count({ where: { eventId: id } }))
          throw new BadRequestException(
            'This event has ticket history. Complete and archive it instead.',
          );
        // Retain even ticket-free records: no cascading loss of registration or audit evidence.
        await tx.event.update({ where: { id }, data: { archived: true } });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId: id,
            action: 'event.removed_from_active',
            details: `Previous status: ${event.status}; records retained`,
          },
        });
      },
    );
  }
  async archive(
    id: number,
    userId: number,
    role: string,
    orgId: number,
    archived = true,
  ) {
    if (!archived && role !== 'super_admin')
      throw new ForbiddenException('Only Super Admin can restore an event.');
    return this.mutate(
      id,
      userId,
      role,
      orgId,
      archived ? 'events.manage' : 'events.restore',
      async (tx, event) => {
        if (archived && event.status !== 'Completed')
          throw new BadRequestException(
            'Only completed events can be archived.',
          );
        if (event.archived === archived) return;
        await tx.event.update({ where: { id }, data: { archived } });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId: id,
            action: archived ? 'event.archived' : 'event.restored',
          },
        });
      },
      true,
    );
  }
  async cancel(id: number, userId: number, role: string, orgId: number) {
    return this.mutate(
      id,
      userId,
      role,
      orgId,
      'events.manage',
      async (tx, event) => {
        if (event.archived || event.status === 'Completed')
          throw new BadRequestException('This event is read-only.');
        if (event.status === 'Cancelled') return;
        await tx.event.update({ where: { id }, data: { status: 'Cancelled' } });
        const cancelled = await tx.ticket.updateMany({
          where: { eventId: id, status: { in: ['Active', 'Expired'] } },
          data: { status: 'Cancelled' },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId: id,
            action: 'event.cancelled',
            details: `Cancelled unused tickets: ${cancelled.count}; used/revoked history retained`,
          },
        });
      },
      true,
    );
  }
  async reopen(id: number, userId: number, role: string, orgId: number) {
    if (role !== 'super_admin')
      throw new ForbiddenException(
        'Only Super Admin can reopen a cancelled event.',
      );
    return this.mutate(
      id,
      userId,
      role,
      orgId,
      'events.manage',
      async (tx, event) => {
        if (event.archived || event.status !== 'Cancelled')
          throw new BadRequestException(
            'Only an unarchived cancelled event can be reopened.',
          );
        await tx.event.update({
          where: { id },
          data: { status: event.startsAt > new Date() ? 'Upcoming' : 'Active' },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId: id,
            action: 'event.reopened',
            details: 'Old tickets remain cancelled; issue new tickets.',
          },
        });
      },
      true,
    );
  }

  async duplicate(id: number, userId: number, role: string, orgId: number) {
    return this.mutate(
      id,
      userId,
      role,
      orgId,
      'events.create',
      async (tx) => {
        const source = await tx.event.findUniqueOrThrow({
          where: { id },
          include: {
            categories: true,
            entrances: { include: { entrancePermissions: true } },
            eventSettings: true,
            registrationFields: true,
            eventAssignments: true,
            accessCodes: { include: { codeEntrances: true, codeStaff: true } },
          },
        });
        const {
          id: _id,
          createdAt: _created,
          updatedAt: _updated,
          categories,
          entrances,
          eventSettings,
          registrationFields,
          eventAssignments,
          accessCodes,
          ...fields
        } = source;
        const copy = await tx.event.create({
          data: {
            ...fields,
            name: (source.name + ' (Copy)').slice(0, 200),
            status: 'Draft',
            archived: false,
            organizationEvent: { create: { organizationId: orgId } },
          },
        });
        const categoriesMap = new Map<number, number>();
        const entrancesMap = new Map<number, number>();
        for (const {
          id: oldId,
          eventId: _event,
          createdAt: _c,
          updatedAt: _u,
          ...data
        } of categories) {
          const category = await tx.ticketCategory.create({
            data: { ...data, eventId: copy.id },
          });
          categoriesMap.set(oldId, category.id);
        }
        for (const {
          id: oldId,
          eventId: _event,
          createdAt: _c,
          updatedAt: _u,
          entrancePermissions,
          ...data
        } of entrances) {
          const entrance = await tx.entrance.create({
            data: { ...data, eventId: copy.id },
          });
          entrancesMap.set(oldId, entrance.id);
          await tx.entrancePermission.createMany({
            data: entrancePermissions.map((p) => ({
              eventId: copy.id,
              entranceId: entrance.id,
              categoryId: categoriesMap.get(p.categoryId)!,
            })),
          });
        }
        for (const setting of eventSettings) {
          let value = setting.value;
          if (setting.key === 'product.v1') {
            const config = JSON.parse(value);
            if (config.defaultCategoryId)
              config.defaultCategoryId =
                categoriesMap.get(config.defaultCategoryId) ?? null;
            value = JSON.stringify(config);
          }
          if (setting.key === 'invitations.v1') {
            const config = JSON.parse(value);
            config.categoryLimits = (config.categoryLimits ?? []).map((c: {categoryId:number;limit:number}) => ({...c,categoryId:categoriesMap.get(c.categoryId)})).filter((c: {categoryId?:number})=>c.categoryId);
            value = JSON.stringify(config);
          }
          await tx.eventSetting.create({
            data: { eventId: copy.id, key: setting.key, value },
          });
        }
        for (const field of registrationFields) {
          await tx.registrationField.create({data:{eventId:copy.id,target:field.target,key:field.key,label:field.label,type:field.type,required:field.required,active:field.active,options:field.options as Prisma.InputJsonValue}});
        }
        await tx.eventAssignment.createMany({
          data: eventAssignments.map((a) => ({
            eventId: copy.id,
            userId: a.userId,
            organizationId: orgId,
          })),
        });
        // Copy grants, never share credentials between events. New codes remain disabled until explicitly activated.
        for (const code of accessCodes) {
          const { randomBytes } = await import('node:crypto');
          const { digest } = await import('../common/crypto.util.js');
          await tx.accessCode.create({
            data: {
              eventId: copy.id,
              name: code.name,
              active: false,
              codeHash: digest(randomBytes(32).toString('hex')),
              codeEntrances: {
                create: code.codeEntrances.map((e) => ({
                  eventId: copy.id,
                  entranceId: entrancesMap.get(e.entranceId)!,
                })),
              },
              codeStaff: {
                create: code.codeStaff.map((s) => ({ userId: s.userId })),
              },
            },
          });
        }
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId: copy.id,
            action: 'event.duplicated',
            details: `Source ${id}; credentials not copied; no registrations, tickets or activity copied`,
          },
        });
        return copy;
      },
      true,
    );
  }

  async settings(id: number, userId: number, role: string, orgId: number) {
    await this.assertAccess(id, userId, role, orgId, 'events.view');
    const saved = await this.prisma.eventSetting.findUnique({
      where: { eventId_key: { eventId: id, key: 'product.v1' } },
    });
    return { settings: saved ? JSON.parse(saved.value) : {} };
  }
  async updateSettings(
    id: number,
    settings: EventConfigurationDto,
    userId: number,
    role: string,
    orgId: number,
  ) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new BadRequestException('Provide event settings.');
    rejectNulls(settings, ['defaultCategoryId', 'transferDeadline']);
    return this.mutate(
      id,
      userId,
      role,
      orgId,
      'events.manage',
      async (tx, event) => {
        const saved = await tx.eventSetting.findUnique({
          where: { eventId_key: { eventId: id, key: 'product.v1' } },
        });
        const config = {
          ...(saved ? JSON.parse(saved.value) : {}),
          ...settings,
        };
        if ((settings.guestLimit !== undefined || settings.perStudentLimit !== undefined) && await tx.guestInvitation.count({where:{eventId:id}})) throw new BadRequestException('Change invitation limits in Students & Invitations, where existing registrations and override reasons are checked.');
        if (
          config.defaultCategoryId &&
          !(await tx.ticketCategory.findFirst({
            where: { id: config.defaultCategoryId, eventId: id, active: true },
          }))
        )
          throw new BadRequestException(
            'Default category must be active and belong to this event.',
          );
        if (
          config.transferDeadline &&
          !/(Z|[+-]\d{2}:\d{2})$/.test(config.transferDeadline)
        )
          throw new BadRequestException(
            'Transfer deadline requires an explicit time zone offset.',
          );
        if (
          config.transferDeadline &&
          new Date(config.transferDeadline) > event.endsAt
        )
          throw new BadRequestException(
            'Transfer deadline cannot be after the event ends.',
          );
        await tx.eventSetting.upsert({
          where: { eventId_key: { eventId: id, key: 'product.v1' } },
          create: {
            eventId: id,
            key: 'product.v1',
            value: JSON.stringify(config),
          },
          update: { value: JSON.stringify(config) },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            eventId: id,
            action: 'event.settings_updated',
            details: JSON.stringify({ fields: Object.keys(settings) }),
          },
        });
        return { settings: config };
      },
    );
  }

  async getDashboard(id: number, userId: number, role: string, orgId: number) {
    await this.assertAccess(id, userId, role, orgId, 'events.view');
    const [
      event,
      totalAttendees,
      checkedIn,
      activeTickets,
      failedEmails,
      checkedAttendees,
    ] = await Promise.all([
      this.prisma.event.findUniqueOrThrow({ where: { id } }),
      this.prisma.attendee.count({
        where: { eventId: id, status: 'Registered' },
      }),
      this.prisma.checkIn.count({ where: { eventId: id } }),
      this.prisma.ticket.count({ where: { eventId: id, status: 'Active' } }),
      this.prisma.emailDelivery.count({
        where: { eventId: id, status: 'Failed' },
      }),
      this.prisma.attendee.count({
        where: {
          eventId: id,
          status: 'Registered',
          tickets: { some: { checkIn: { isNot: null } } },
        },
      }),
    ]);
    return {
      event,
      totalAttendees,
      checkedIn,
      checkedAttendees,
      remaining: Math.max(0, totalAttendees - checkedAttendees),
      activeTickets,
      failedEmails,
    };
  }
  async assertAccess(
    eventId: number,
    userId: number,
    role: string,
    orgId: number,
    permission: string,
    db: Tx = this.prisma,
  ) {
    if (!hasPermission(role, permission))
      throw new ForbiddenException('Permission denied.');
    const owner = await db.organizationEvent.findUnique({ where: { eventId } });
    if (!owner || owner.organizationId !== orgId)
      throw new ForbiddenException('Event not in your organization.');
    const member = await db.organizationUser.findUnique({ where: { userId } });
    if (!member || member.organizationId !== orgId || member.role !== role)
      throw new ForbiddenException('Organization access changed.');
    if (
      role !== 'super_admin' &&
      !(await db.eventAssignment.findUnique({
        where: { userId_eventId: { userId, eventId } },
      }))
    )
      throw new ForbiddenException('You are not assigned to this event.');
  }
  assertEditable(event: Event) {
    if (event.archived || ['Cancelled', 'Completed'].includes(event.status))
      throw new BadRequestException(
        'This event is archived, cancelled or completed.',
      );
  }
  async getActiveEvent(id: number, db: Tx = this.prisma) {
    const event = await db.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found.');
    this.assertEditable(event);
    return event;
  }
  private eventData(dto: UpdateEventDto) {
    const data: Record<string, string | number | Date | null> = {};
    for (const key of textKeys)
      if (dto[key] !== undefined) data[key] = dto[key]!.trim();
    for (const key of dateKeys)
      if (dto[key] !== undefined) {
        const value = dto[key];
        if (
          value !== null &&
          key !== 'eventDate' &&
          !/(Z|[+-]\d{2}:\d{2})$/.test(value!)
        )
          throw new BadRequestException(
            `${key} requires an explicit time zone offset.`,
          );
        data[key] = value === null ? null : new Date(value!);
      }
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.maxTickets !== undefined) data.maxTickets = dto.maxTickets;
    if (dto.status !== undefined) data.status = dto.status;
    return data as Partial<Event>;
  }
  private validateEvent(event: Partial<Event>) {
    if (!event.name?.trim() || !event.venue?.trim())
      throw new BadRequestException('Event name and venue are required.');
    if (
      !event.startsAt ||
      !event.endsAt ||
      !Number.isFinite(+event.startsAt) ||
      !Number.isFinite(+event.endsAt) ||
      event.endsAt <= event.startsAt
    )
      throw new BadRequestException('End time must be later than start time.');
    if (
      !event.capacity ||
      !event.maxTickets ||
      event.maxTickets > event.capacity
    )
      throw new BadRequestException(
        'Maximum tickets must be positive and cannot exceed capacity.',
      );
    try {
      new Intl.DateTimeFormat('en', { timeZone: event.timezone });
    } catch {
      throw new BadRequestException('Use a valid IANA time zone.');
    }
    if (
      event.distributionStart &&
      event.distributionEnd &&
      event.distributionStart > event.distributionEnd
    )
      throw new BadRequestException('Distribution end must follow its start.');
    if (
      (event.distributionEnd && event.distributionEnd > event.endsAt) ||
      (event.distributionStart && event.distributionStart > event.endsAt) ||
      (event.registrationDeadline && event.registrationDeadline > event.endsAt)
    )
      throw new BadRequestException(
        'Registration and distribution dates cannot be after the event ends.',
      );
  }
}
