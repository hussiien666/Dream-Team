import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Event, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { hasPermission } from '../common/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../common/request.js';
import {
  studentSchema,
  guestSchema,
  fieldSchema,
  limitsSchema,
  parse,
  hash,
  guestKey,
  custom,
  reason,
} from './validation.js';
import type { Field } from './validation.js';
import { readWorkbook, makeTemplate } from './workbook.js';
import type { RowError } from './workbook.js';
import {TicketsService} from '../tickets/tickets.service.js';
type Tx = Prisma.TransactionClient;
type Actor = Pick<AuthenticatedRequest, 'user' | 'orgRole' | 'orgId'>;
type PublicPrincipal = { linkId: number; orgId: number };
type Principal = Actor | PublicPrincipal;
type Input = {
  sheet: string;
  row: number;
  id?: number;
  mode: 'create' | 'update' | 'upsert';
  data: Record<string, unknown>;
};
const guestInclude = {
  attendee: {
    include: {
      category: { select: { id: true, name: true, code: true } },
      tickets: {
        select: {
          id: true,
          number: true,
          status: true,
          categoryId: true,
          checkIn: { select: { id: true } },
        },
      },
    },
  },
} as const;
@Injectable()
export class StudentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: EventsService,
    private readonly tickets:TicketsService,
  ) {}
  private access(
    eventId: number,
    a: Actor,
    tx: Tx = this.db,
    permission = 'attendees.manage',
  ) {
    return this.events.assertAccess(
      eventId,
      a.user.id,
      a.orgRole,
      a.orgId,
      permission,
      tx,
    );
  }
  private write<T>(
    eventId: number,
    a: Actor,
    fn: (tx: Tx, event: Event) => Promise<T>,
  ) {
    return this.events.mutate(
      eventId,
      a.user.id,
      a.orgRole,
      a.orgId,
      'attendees.manage',
      async (tx, event) => {
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        return fn(tx, event);
      },
      true,
      120000,
    );
  }
  private audit(
    tx: Tx,
    eventId: number,
    a: Principal,
    action: string,
    details: unknown,
  ) {
    return tx.auditLog.create({
      data: {
        eventId,
        actorId: 'linkId' in a ? null : a.user.id,
        action,
        details: JSON.stringify('linkId' in a ? { linkId: a.linkId, details } : details),
      },
    });
  }
  private async fields(tx: Tx, eventId: number) {
    return (await tx.registrationField.findMany({
      where: { eventId },
      orderBy: { id: 'asc' },
    })) as unknown as (Field & { id: number })[];
  }
  private async limits(tx: Tx, eventId: number, event?: Event) {
    const settings = await tx.eventSetting.findMany({
      where: { eventId, key: { in: ['product.v1', 'invitations.v1'] } },
    });
    const product = JSON.parse(
        settings.find((s) => s.key === 'product.v1')?.value || '{}',
      ),
      inv = JSON.parse(
        settings.find((s) => s.key === 'invitations.v1')?.value || '{}',
      );
    const e =
      event ?? (await tx.event.findUniqueOrThrow({ where: { id: eventId } }));
    return {
      guestLimit: product.guestLimit ?? e.maxTickets,
      perStudentLimit: product.perStudentLimit ?? e.maxTickets,
      defaultCategoryId: product.defaultCategoryId ?? null,
      categoryLimits: inv.categoryLimits ?? [],
    } as {
      guestLimit: number;
      perStudentLimit: number;
      defaultCategoryId: number | null;
      categoryLimits: { categoryId: number; limit: number }[];
    };
  }
  async overview(eventId: number, a: Actor) {
    await this.access(eventId, a);
    const [students, guests, fields, limits, categories] = await Promise.all([
      this.db.student.findMany({
        where: { eventId },
        orderBy: { fullName: 'asc' },
        include: { _count: { select: { guests: true } } },
      }),
      this.db.guestInvitation.findMany({
        where: { eventId },
        include: guestInclude,
        orderBy: { id: 'asc' },
      }),
      this.fields(this.db, eventId),
      this.limits(this.db, eventId),
      this.db.ticketCategory.findMany({
        where: { eventId },
        select: { id: true, name: true, code: true, active: true },
      }),
    ]);
    return {
      students: students.map((s) => ({
        ...s,
        guestCount: guests.filter((g) => g.studentId === s.id && g.active)
          .length,
      })),
      guests,
      fields,
      limits,
      categories,
    };
  }
  async list(eventId: number, a: Actor, kind: 'students' | 'guests') {
    return (await this.overview(eventId, a))[kind];
  }
  async one(
    eventId: number,
    id: number,
    a: Actor,
    kind: 'students' | 'guests',
  ) {
    const rows = await this.list(eventId, a, kind);
    const found = rows.find((r) => r.id === id);
    if (!found) throw new NotFoundException('Registration not found.');
    return found;
  }
  async save(
    eventId: number,
    id: number | undefined,
    kind: 'student' | 'guest',
    body: unknown,
    a: Actor,
  ) {
    const schema = kind === 'student' ? studentSchema : guestSchema;
    const parsed = parse<Record<string, unknown>>(
      id ? schema.partial() : schema,
      body,
    ) as Record<string, unknown>;
    const dto = id
      ? Object.fromEntries(
          Object.keys(body as object).map((key) => [key, parsed[key]]),
        )
      : parsed;
    return this.write(eventId, a, async (tx, event) => {
      const input: Input = {
        sheet: kind === 'student' ? 'Students' : 'Guests',
        row: 0,
        id,
        mode: id ? 'update' : 'create',
        data: dto,
      };
      const plan = await this.plan(
        tx,
        event,
        kind === 'student' ? [input] : [],
        kind === 'guest' ? [input] : [],
        a,
        dto.overrideReason as string | undefined,
      );
      this.noErrors(plan.errors);
      await this.apply(tx, event, a, plan);
      const changed = kind === 'student' ? plan.students[0] : plan.guests[0];
      return { id: changed.id, action: id ? 'updated' : 'created' };
    });
  }
  private noErrors(errors: RowError[]) {
    if (errors.length)
      throw new BadRequestException(
        errors
          .map((e) => `${e.sheet}${e.row ? ' row ' + e.row : ''}: ${e.message}`)
          .join('; '),
      );
  }
  private async plan(
    tx: Tx,
    event: Event,
    studentRows: Input[],
    guestRows: Input[],
    a: Principal,
    overrideReason?: string,
  ) {
    const eventId = event.id;
    const [existingStudents, existingGuests, defs, limits, categories] =
      await Promise.all([
        tx.student.findMany({ where: { eventId }, orderBy: { id: 'asc' } }),
        tx.guestInvitation.findMany({
          where: { eventId },
          include: guestInclude,
          orderBy: { id: 'asc' },
        }),
        this.fields(tx, eventId),
        this.limits(tx, eventId, event),
        tx.ticketCategory.findMany({
          where: { eventId },
          include: {
            entrancePermissions: {
              include: { entrance: { select: { active: true } } },
            },
          },
        }),
      ]);
    if (overrideReason) {
      parse(reason, overrideReason);
      if ('linkId' in a) throw new ForbiddenException('Invitation links cannot override limits.');
      await this.access(eventId, a, tx, 'events.manage');
    }
    const errors: RowError[] = [],
      students: any[] = [],
      guests: any[] = [],
      seenStudents = new Set<string>(),
      seenGuests = new Set<string>();
    const stateStudents = existingStudents.map((s) => ({
      ...s,
      customValues: s.customValues as Record<string, unknown>,
    }));
    const stateGuests = existingGuests.map((g) => ({
      ...g,
      fullName: g.attendee.fullName,
      phone: g.attendee.phone,
      categoryId: g.attendee.categoryId,
      customValues: g.customValues as Record<string, unknown>,
    }));
    const canCreate = () => {
      if (['Cancelled', 'Completed'].includes(event.status))
        throw new BadRequestException(
          'New registrations are closed for this event.',
        );
      if (event.registrationDeadline && event.registrationDeadline < new Date())
        throw new BadRequestException('The registration deadline has passed.');
    };
    let temporary = -1;
    for (const row of studentRows)
      try {
        const data = row.data;
        const external =
          typeof data.studentId === 'string'
            ? data.studentId.trim().toUpperCase()
            : undefined;
        const old = row.id
          ? stateStudents.find((s) => s.id === row.id)
          : stateStudents.find((s) => s.studentId === external);
        if (row.mode === 'update' && !old)
          throw new NotFoundException('Student not found in this event.');
        if (row.mode === 'create' && old)
          throw new BadRequestException(
            'This Student ID already exists in the event.',
          );
        if (old && !old.active)
          throw new BadRequestException(
            'This student is cancelled. Imports and edits cannot reactivate them.',
          );
        const dto = parse(studentSchema, {
          ...(old
            ? {
                studentId: old.studentId,
                fullName: old.fullName,
                email: old.email,
                phone: old.phone,
                customValues: old.customValues,
                guestLimit: old.guestLimit,
              }
            : {}),
          ...data,
        });
        if (
          seenStudents.has(dto.studentId) ||
          stateStudents.some(
            (s) => s.studentId === dto.studentId && s.id !== old?.id,
          )
        )
          throw new BadRequestException('Duplicate Student ID.');
        seenStudents.add(dto.studentId);
        if (
          dto.guestLimit !== undefined &&
          dto.guestLimit !== (old?.guestLimit ?? null)
        ) {
          if ('linkId' in a) throw new ForbiddenException('Invitation links cannot override limits.');
      await this.access(eventId, a, tx, 'events.manage');
          if (!overrideReason)
            throw new BadRequestException(
              'Changing an individual limit requires an audited override reason.',
            );
        }
        if (!old) canCreate();
        const next = {
          id: old?.id ?? temporary--,
          eventId,
          studentId: dto.studentId,
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          active: true,
          guestLimit: dto.guestLimit ?? null,
          customValues: custom(
            dto.customValues,
            defs.filter((f) => f.target === 'student'),
            old?.customValues,
          ),
          source: { sheet: row.sheet, row: row.row },
          isNew: !old,
        };
        if (old) Object.assign(old, next);
        else stateStudents.push(next as never);
        students.push(next);
      } catch (e) {
        errors.push({
          sheet: row.sheet,
          row: row.row,
          message: e instanceof Error ? e.message : 'Invalid student.',
        });
      }
    for (const row of guestRows)
      try {
        const data = row.data,
          old = row.id ? stateGuests.find((g) => g.id === row.id) : undefined;
        if (row.mode === 'update' && !old)
          throw new NotFoundException('Guest not found in this event.');
        let sid = data.studentId ?? old?.studentId;
        if (typeof sid === 'string') {
          const external = sid.trim().toUpperCase();
          sid = stateStudents.find((s) => s.studentId === external)?.id;
        }
        const student = stateStudents.find((s) => s.id === sid);
        if (!student || !student.active)
          throw new BadRequestException(
            'Student ID must reference an active student in this event.',
          );
        if (old && old.studentId !== student.id)
          throw new BadRequestException(
            'Moving guests between students requires the later transfer workflow.',
          );
        let categoryId =
          data.categoryId ?? old?.categoryId ?? limits.defaultCategoryId;
        if (data.categoryName) {
          const matches = categories.filter((c) =>
            [c.code.toLowerCase(), c.name.toLowerCase()].includes(
              String(data.categoryName).trim().toLowerCase(),
            ),
          );
          if (matches.length !== 1)
            throw new BadRequestException(
              'Category is unknown or ambiguous; use its unique code.',
            );
          categoryId = matches[0].id;
        }
        const { categoryName, ...plain } = data;
        const dto = parse(guestSchema.extend({ studentId: z.number().int() }), {
          ...(old
            ? {
                studentId: old.studentId,
                fullName: old.fullName,
                email: old.email,
                phone: old.phone,
                categoryId: old.categoryId,
                invitationGroup: old.invitationGroup,
                customValues: old.customValues,
              }
            : {}),
          ...plain,
          studentId: student.id,
          categoryId,
        });
        const category = categories.find(
          (c) => c.id === dto.categoryId && c.active,
        );
        if (!category)
          throw new BadRequestException(
            'Select an active category from this event or configure its default.',
          );
        const key = guestKey(dto.email, dto.fullName, dto.phone),
          matched =
            old ??
            stateGuests.find(
              (g) => g.studentId === student.id && g.matchKey === key,
            );
        if (row.mode === 'create' && matched)
          throw new BadRequestException(
            'This guest is already registered under the student.',
          );
        if (matched && !matched.active)
          throw new BadRequestException(
            'This guest is cancelled. Imports and edits cannot reactivate them.',
          );
        if (
          stateGuests.some(
            (g) =>
              g.studentId === student.id &&
              g.matchKey === key &&
              g.id !== matched?.id,
          ) ||
          seenGuests.has(student.id + ':' + key)
        )
          throw new BadRequestException('Duplicate guest under this student.');
        seenGuests.add(student.id + ':' + key);
        if (!matched) canCreate();
        const next = {
          id: matched?.id ?? temporary--,
          eventId,
          studentId: student.id,
          attendeeId: matched?.attendeeId ?? null,
          email: dto.email,
          matchKey: key,
          fullName: dto.fullName,
          phone: dto.phone,
          categoryId: category.id,
          invitationGroup: dto.invitationGroup,
          active: true,
          customValues: custom(
            dto.customValues,
            defs.filter((f) => f.target === 'guest'),
            matched?.customValues,
          ),
          tickets: matched?.attendee.tickets ?? [],
          source: { sheet: row.sheet, row: row.row },
          isNew: !matched,
        };
        if (matched) Object.assign(matched, next);
        else stateGuests.push({ ...next, attendee: { tickets: [] } } as never);
        guests.push(next);
      } catch (e) {
        errors.push({
          sheet: row.sheet,
          row: row.row,
          message: e instanceof Error ? e.message : 'Invalid guest.',
        });
      }
    const before = existingGuests.filter(
        (g) => g.active && g.attendee.status === 'Registered',
      ),
      after = stateGuests.filter((g) => g.active);
    const growth = (
      oldCount: number,
      newCount: number,
      limit: number,
      label: string,
    ) => {
      if (newCount > limit && newCount > oldCount && !overrideReason)
        errors.push({
          sheet: 'Limits',
          row: 0,
          message: `${label} limit is ${limit}; proposed count is ${newCount}.`,
        });
    };
    growth(before.length, after.length, limits.guestLimit, 'Event guests');
    for (const s of stateStudents) {
      const b = before.filter((g) => g.studentId === s.id),
        n = after.filter((g) => g.studentId === s.id);
      growth(
        b.length,
        n.length,
        s.guestLimit ?? limits.perStudentLimit,
        `Student ${s.studentId}`,
      );
      for (const c of limits.categoryLimits)
        growth(
          b.filter((g) => g.attendee.categoryId === c.categoryId).length,
          n.filter((g) => g.categoryId === c.categoryId).length,
          c.limit,
          `Student ${s.studentId}, category ${c.categoryId}`,
        );
    }
    // Check the final ticket allocation after all category edits, preserving used categories.
    const moving = guests.filter(
      (g) =>
        !g.isNew &&
        existingGuests.find((old) => old.id === g.id)?.attendee.categoryId !==
          g.categoryId,
    );
    const currentTickets = await tx.ticket.findMany({
      where: { eventId, status: { in: ['Active', 'Used'] } },
      select: {
        id: true,
        attendeeId: true,
        categoryId: true,
        status: true,
        checkIn: { select: { id: true } },
      },
    });
    for (const g of moving) {
      const cat = categories.find((c) => c.id === g.categoryId)!;
      const eligible = g.tickets.filter(
        (t: any) => ['Active', 'Expired'].includes(t.status) && !t.checkIn,
      );
      if (
        eligible.some((t: any) => t.status === 'Active') &&
        !cat.entrancePermissions.some((p) => p.entrance.active)
      )
        errors.push({
          ...g.source,
          message:
            'The new category needs an active permitted entrance for its active tickets.',
        });
      const count =
        eligible.filter((t: any) => t.status === 'Active').length +
        g.tickets.filter(
          (t: any) => t.status === 'Used' && t.categoryId === cat.id,
        ).length;
      if (count > cat.maxPerAttendee)
        errors.push({
          ...g.source,
          message:
            'The new category per-attendee ticket limit would be exceeded.',
        });
    }
    const allocation = new Map<number, number>();
    for (const t of currentTickets) {
      const move =
        t.status === 'Active' && !t.checkIn
          ? moving.find((g) => g.attendeeId === t.attendeeId)
          : undefined;
      const cid = move?.categoryId ?? t.categoryId;
      allocation.set(cid, (allocation.get(cid) ?? 0) + 1);
    }
    for (const c of categories)
      if (
        (allocation.get(c.id) ?? 0) > c.allocation &&
        moving.some((g) => g.categoryId === c.id)
      )
        errors.push({
          sheet: 'Tickets',
          row: 0,
          message: `${c.name} ticket allocation would be exceeded.`,
        });
    const automaticTicketGeneration=JSON.parse((await tx.eventSetting.findUnique({where:{eventId_key:{eventId:event.id,key:'product.v1'}}}))?.value??'{}').automaticTicketGeneration??false;
    if(automaticTicketGeneration&&['Published','Ongoing','Upcoming','Active'].includes(event.status)&&guests.filter(g=>g.isNew).length>500)errors.push({sheet:'Tickets',row:0,message:'Automatic generation allows up to 500 new guests per import. Split this workbook or disable automatic generation before importing.'});
    const fingerprint = hash({
      automaticTicketGeneration,
      students: existingStudents,
      guests: existingGuests,
      defs,
      limits,
      categories: categories.map((c) => ({
        id: c.id,
        active: c.active,
        allocation: c.allocation,
        maxPerAttendee: c.maxPerAttendee,
        entrancePermissions: c.entrancePermissions,
      })),
      currentTickets,
    });
    return { students, guests, errors, fingerprint, overrideReason };
  }
  private async apply(
    tx: Tx,
    event: Event,
    a: Principal,
    plan: Awaited<ReturnType<StudentsService['plan']>>,
  ) {
    const ids = new Map<number, number>();
    for (const s of plan.students) {
      const { studentId, fullName, email, phone, guestLimit, customValues } = s,
        data = { studentId, fullName, email, phone, guestLimit, customValues };
      if (s.isNew) {
        const created = await tx.student.create({
          data: { ...data, eventId: event.id },
        });
        ids.set(s.id, created.id);
        s.id = created.id;
      } else await tx.student.update({ where: { id: s.id }, data });
    }
    for (const g of plan.guests) {
      g.studentId = ids.get(g.studentId) ?? g.studentId;
      const { email, matchKey, invitationGroup, customValues, studentId } = g;
      if (g.isNew) {
        const attendee = await tx.attendee.create({
          data: {
            eventId: event.id,
            categoryId: g.categoryId,
            fullName: g.fullName,
            phone: g.phone,
            email: null,
            identityNumber: null,
          },
        });
        g.attendeeId = attendee.id;
        const created = await tx.guestInvitation.create({
          data: {
            eventId: event.id,
            studentId,
            attendeeId: attendee.id,
            email,
            matchKey,
            invitationGroup,
            customValues,
          },
        });
        g.id = created.id;
      } else {
        await tx.attendee.update({
          where: { id: g.attendeeId },
          data: {
            fullName: g.fullName,
            phone: g.phone,
            categoryId: g.categoryId,
          },
        });
        await tx.ticket.updateMany({
          where: {
            eventId: event.id,
            attendeeId: g.attendeeId,
            status: { in: ['Active', 'Expired'] },
            checkIn: { is: null },
          },
          data: { categoryId: g.categoryId },
        });
        await tx.guestInvitation.update({
          where: { id: g.id },
          data: { email, matchKey, invitationGroup, customValues },
        });
      }
    }
    await this.audit(tx, event.id, a, 'registration.saved', {
      studentIds: plan.students.map((s) => s.id),
      guestIds: plan.guests.map((g) => g.id),
      overrideReason: plan.overrideReason ?? null,
    });
    const product=await tx.eventSetting.findUnique({where:{eventId_key:{eventId:event.id,key:'product.v1'}}});
    if(JSON.parse(product?.value??'{}').automaticTicketGeneration&&['Published','Ongoing','Upcoming','Active'].includes(event.status)){
      if (!('linkId' in a)) await this.access(event.id,a,tx,'tickets.manage');
      const ids=plan.guests.filter(g=>g.isNew).map(g=>g.attendeeId);
      if(ids.length)await this.tickets.issueInside(tx,event,ids,'linkId' in a ? null : a.user.id,a.orgId,'auto_'+hash(ids));
    }
  }
  async addFromInvitation(tx: Tx, event: Event, link: { id: number; studentId: number }, body: unknown) {
    const dto = parse(guestSchema.omit({ studentId: true, overrideReason: true, invitationGroup: true }), body);
    const principal: PublicPrincipal = { linkId: link.id, orgId: (await tx.organizationEvent.findUniqueOrThrow({ where: { eventId: event.id } })).organizationId };
    const plan = await this.plan(tx, event, [], [{ sheet: 'Guests', row: 0, mode: 'create', data: { ...dto, studentId: link.studentId } }], principal);
    this.noErrors(plan.errors);
    await this.apply(tx, event, principal, plan);
    return { id: plan.guests[0].id, action: 'created' };
  }
  async impact(eventId: number, id: number, a: Actor) {
    await this.access(eventId, a);
    if (!(await this.db.student.findFirst({ where: { eventId, id } })))
      throw new NotFoundException('Student not found.');
    return {
      guestCount: await this.db.guestInvitation.count({
        where: { eventId, studentId: id },
      }),
      activeGuestCount: await this.db.guestInvitation.count({
        where: { eventId, studentId: id, active: true },
      }),
    };
  }
  async cancel(
    eventId: number,
    id: number,
    kind: 'student' | 'guest',
    body: unknown,
    a: Actor,
  ) {
    const dto = parse(
      z
        .object({
          reason: z.string().trim().min(5).max(1000),
          confirmed: z.literal(true),
          expectedGuestCount: z.number().int().min(0).optional(),
        })
        .strict(),
      body,
    );
    return this.write(eventId, a, async (tx) => {
      const student =
        kind === 'student'
          ? await tx.student.findFirst({ where: { eventId, id } })
          : null;
      const guests = await tx.guestInvitation.findMany({
        where: {
          eventId,
          ...(kind === 'student' ? { studentId: id } : { id }),
        },
      });
      if (kind === 'student' ? !student : !guests.length)
        throw new NotFoundException('Registration not found.');
      if (kind === 'student' && dto.expectedGuestCount !== guests.length)
        throw new ConflictException(
          `This student has ${guests.length} linked guests. Review the updated count before confirming.`,
        );
      const attendeeIds = guests.map((g) => g.attendeeId);
      await tx.guestInvitation.updateMany({
        where: { id: { in: guests.map((g) => g.id) }, eventId },
        data: { active: false },
      });
      await tx.attendee.updateMany({
        where: { id: { in: attendeeIds }, eventId },
        data: { status: 'Cancelled' },
      });
      await tx.ticket.updateMany({
        where: {
          eventId,
          attendeeId: { in: attendeeIds },
          status: { in: ['Active', 'Expired'] },
          checkIn: { is: null },
        },
        data: { status: 'Cancelled' },
      });
      if (student)
        await tx.student.update({ where: { id }, data: { active: false } });
      await this.audit(tx, eventId, a, 'registration.cancelled', {
        kind,
        id,
        guestCount: guests.length,
        reason: dto.reason,
      });
      return { cancelled: true, guestCount: guests.length };
    });
  }
  async saveField(
    eventId: number,
    id: number | undefined,
    body: unknown,
    a: Actor,
  ) {
    const parsed = parse(id ? fieldSchema.partial() : fieldSchema, body);
    const dto = id
      ? Object.fromEntries(
          Object.keys(body as object).map((key) => [
            key,
            parsed[key as keyof typeof parsed],
          ]),
        )
      : parsed;
    return this.write(eventId, a, async (tx) => {
      const existing = id
        ? await tx.registrationField.findFirst({ where: { eventId, id } })
        : null;
      if (id && !existing)
        throw new NotFoundException('Custom field not found.');
      const next = parse(fieldSchema, {
        ...(existing
          ? {
              target: existing.target,
              key: existing.key,
              label: existing.label,
              type: existing.type,
              required: existing.required,
              active: existing.active,
              options: existing.options,
            }
          : {}),
        ...dto,
      });
      if (
        next.type === 'dropdown' &&
        (!next.options.length ||
          new Set(next.options).size !== next.options.length)
      )
        throw new BadRequestException('Provide unique dropdown options.');
      if (
        existing &&
        (next.key !== existing.key ||
          next.target !== existing.target ||
          next.type !== existing.type ||
          JSON.stringify(next.options) !== JSON.stringify(existing.options))
      )
        throw new BadRequestException(
          'Field key, target, type and options cannot change. Deactivate it and add a new field.',
        );
      if (
        !existing &&
        (await tx.registrationField.findUnique({
          where: {
            eventId_target_key: { eventId, target: next.target, key: next.key },
          },
        }))
      )
        throw new BadRequestException(
          'This custom field key already exists for the registration type.',
        );
      if (
        !existing &&
        (await tx.registrationField.count({
          where: { eventId, target: next.target },
        })) >= 44
      )
        throw new BadRequestException(
          'At most 44 fields per registration type.',
        );
      const field = existing
        ? await tx.registrationField.update({ where: { id }, data: next })
        : await tx.registrationField.create({ data: { ...next, eventId } });
      await this.audit(tx, eventId, a, 'registration.field_saved', {
        id: field.id,
        key: field.key,
      });
      return field;
    });
  }
  async saveLimits(eventId: number, body: unknown, a: Actor) {
    const dto = parse(limitsSchema, body);
    return this.write(eventId, a, async (tx, event) => {
      if ('linkId' in a) throw new ForbiddenException('Invitation links cannot override limits.');
      await this.access(eventId, a, tx, 'events.manage');
      const categories = await tx.ticketCategory.findMany({
        where: { eventId, active: true },
      });
      const ids = [
        ...(dto.defaultCategoryId ? [dto.defaultCategoryId] : []),
        ...dto.categoryLimits.map((c) => c.categoryId),
      ];
      if (
        ids.some((id) => !categories.some((c) => c.id === id)) ||
        new Set(dto.categoryLimits.map((c) => c.categoryId)).size !==
          dto.categoryLimits.length
      )
        throw new BadRequestException(
          'Use unique active categories from this event.',
        );
      const guests = await tx.guestInvitation.findMany({
        where: { eventId, active: true },
        include: {
          attendee: { select: { categoryId: true } },
          student: { select: { guestLimit: true } },
        },
      });
      const exceeded =
        guests.length > dto.guestLimit ||
        guests.some(
          (g) =>
            guests.filter((x) => x.studentId === g.studentId).length >
            (g.student.guestLimit ?? dto.perStudentLimit),
        ) ||
        dto.categoryLimits.some((c) =>
          guests.some(
            (g) =>
              guests.filter(
                (x) =>
                  x.studentId === g.studentId &&
                  x.attendee.categoryId === c.categoryId,
              ).length > c.limit,
          ),
        );
      if (exceeded && !dto.overrideReason)
        throw new BadRequestException(
          'Limits are below existing invitations. An audited override reason is required.',
        );
      const existing = await tx.eventSetting.findUnique({
        where: { eventId_key: { eventId, key: 'product.v1' } },
      });
      const product = {
        ...JSON.parse(existing?.value ?? '{}'),
        guestLimit: dto.guestLimit,
        perStudentLimit: dto.perStudentLimit,
        defaultCategoryId: dto.defaultCategoryId,
      };
      for (const [key, value] of [
        ['product.v1', product],
        ['invitations.v1', { categoryLimits: dto.categoryLimits }],
      ] as const)
        await tx.eventSetting.upsert({
          where: { eventId_key: { eventId, key } },
          create: { eventId, key, value: JSON.stringify(value) },
          update: { value: JSON.stringify(value) },
        });
      await this.audit(tx, eventId, a, 'registration.limits_saved', { ...dto });
      return this.limits(tx, eventId, event);
    });
  }
  async template(eventId: number, a: Actor) {
    await this.access(eventId, a);
    return makeTemplate(
      await this.fields(this.db, eventId),
      await this.db.ticketCategory.findMany({
        where: { eventId, active: true },
        select: { name: true, code: true },
      }),
    );
  }
  async importFile(
    eventId: number,
    buffer: Buffer,
    body: unknown,
    commit: boolean,
    a: Actor,
  ) {
    const dto = parse(
      z
        .object({
          previewHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          requestKey: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{10,80}$/)
            .optional(),
          confirmed: z.enum(['true']).optional(),
          overrideReason: reason,
        })
        .strict(),
      body,
    );
    if (
      commit &&
      (!dto.previewHash || !dto.requestKey || dto.confirmed !== 'true')
    )
      throw new BadRequestException(
        'Preview the file and confirm before importing.',
      );
    await this.access(eventId, a);
    const contentHash = hash({
      file: hash(buffer.toString('base64')),
      previewHash: dto.previewHash,
      overrideReason: dto.overrideReason,
    });
    return this.write(eventId, a, async (tx, event) => {
      if (commit) {
        const old = await tx.registrationImport.findUnique({
          where: {
            eventId_requestKey: { eventId, requestKey: dto.requestKey! },
          },
        });
        if (old) {
          if (old.contentHash !== contentHash || old.actorId !== a.user.id)
            throw new ConflictException(
              'This import key belongs to a different request.',
            );
          return old.result;
        }
      }
      const defs = await this.fields(tx, eventId),
        workbook = await readWorkbook(buffer, defs);
      const students: Input[] = [],
        guests: Input[] = [];
      for (const row of workbook.rows) {
        const d = row.data,
          target = row.sheet === 'Students' ? 'student' : 'guest',
          customValues: Record<string, unknown> = {};
        for (const f of defs.filter((f) => f.target === target && f.active))
          if (d['Field: ' + f.key] !== undefined && d['Field: ' + f.key] !== '')
            customValues[f.key] = d['Field: ' + f.key];
        const data =
          target === 'student'
            ? {
                studentId: d['Student ID'],
                fullName: d['Student name'],
                email: d.Email,
                phone: d.Phone || '',
                customValues,
              }
            : {
                studentId: d['Student ID'],
                fullName: d['Guest name'],
                email: d['Guest email'] || null,
                phone: d['Guest phone'] || '',
                ...(d.Category ? { categoryName: d.Category } : {}),
                invitationGroup: d['Invitation group'] || '',
                customValues,
              };
        (target === 'student' ? students : guests).push({
          ...row,
          data,
          mode: 'upsert',
        });
      }
      const plan = await this.plan(
        tx,
        event,
        students,
        guests,
        a,
        dto.overrideReason,
      );
      plan.errors.unshift(...workbook.errors);
      const previewHash = hash({
        fingerprint: plan.fingerprint,
        students: plan.students,
        guests: plan.guests,
        errors: plan.errors,
      });
      const result = {
        previewHash,
        errors: plan.errors,
        students: plan.students.map((s) => ({
          row: s.source.row,
          studentId: s.studentId,
          fullName: s.fullName,
          action: s.isNew ? 'new' : 'update',
        })),
        guests: plan.guests.map((g) => ({
          row: g.source.row,
          fullName: g.fullName,
          studentId:
            plan.students.find((s) => s.id === g.studentId)?.studentId ??
            g.studentId,
          action: g.isNew ? 'new' : 'update',
        })),
        counts: {
          newStudents: plan.students.filter((s) => s.isNew).length,
          updatedStudents: plan.students.filter((s) => !s.isNew).length,
          newGuests: plan.guests.filter((g) => g.isNew).length,
          updatedGuests: plan.guests.filter((g) => !g.isNew).length,
        },
      };
      if (!commit) return result;
      this.noErrors(plan.errors);
      if (previewHash !== dto.previewHash)
        throw new ConflictException(
          'Registrations or settings changed. Preview the file again before confirming.',
        );
      await this.apply(tx, event, a, plan);
      await tx.registrationImport.create({
        data: {
          eventId,
          actorId: a.user.id,
          requestKey: dto.requestKey!,
          contentHash,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit(tx, eventId, a, 'registration.imported', {
        requestKey: dto.requestKey,
        counts: result.counts,
      });
      return result;
    });
  }
}
