import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';

const clean = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
};
const csv = (rows: unknown[][]) =>
  '\uFEFF' + rows.map((row) => row.map((cell) => `"${clean(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');

@Injectable()
export class ReportsService {
  constructor(private readonly db: PrismaService, private readonly events: EventsService) {}

  async audit(eventId: number, actorId: number, role: string, orgId: number) {
    await this.events.assertAccess(eventId, actorId, role, orgId, 'system.manage');
    const rows = await this.db.auditLog.findMany({
      where: { eventId }, orderBy: { id: 'desc' }, take: 201,
      select: { id: true, action: true, details: true, createdAt: true,
        actor: { select: { displayName: true, username: true } } },
    });
    return { rows: rows.slice(0, 200).map((row) => ({ ...row, actor: row.actor?.displayName ?? 'System or removed account' })), hasMore: rows.length > 200 };
  }

  async exportAudit(eventId: number, actorId: number, role: string, orgId: number) {
    await this.events.assertAccess(eventId, actorId, role, orgId, 'system.manage');
    await this.events.assertAccess(eventId, actorId, role, orgId, 'exports.create');
    const rows = await this.db.auditLog.findMany({
      where: { eventId }, orderBy: { id: 'asc' }, take: 5001,
      select: { id: true, action: true, details: true, createdAt: true,
        actor: { select: { displayName: true, username: true } } },
    });
    if (rows.length > 5000) throw new BadRequestException('Audit export exceeds 5,000 entries.');
    return Buffer.from(csv([['ID', 'Time UTC', 'Action', 'Actor', 'Username', 'Details'],
      ...rows.map((row) => [row.id, row.createdAt.toISOString(), row.action,
        row.actor?.displayName ?? 'System or removed account', row.actor?.username ?? '', row.details])]), 'utf8');
  }

  async scanners(eventId: number, actorId: number, role: string, orgId: number) {
    if (role !== 'super_admin' && role !== 'checkin_supervisor') throw new ForbiddenException('Scanner monitoring requires a supervisor.');
    await this.events.assertAccess(eventId, actorId, role, orgId, 'reports.view');
    const [assignments, counts] = await Promise.all([
      this.db.eventAssignment.findMany({ where: { eventId, organizationId: orgId, user: { organizationUser: { role: 'scanner' } } },
        select: { user: { select: { id: true, username: true, displayName: true, active: true,
          scannerSession: { select: { eventId: true, lastSeen: true, entrance: { select: { name: true } }, code: { select: { active: true } } } } } } },
        orderBy: { userId: 'asc' }, take: 201 }),
      this.db.scanAttempt.groupBy({ by: ['userId', 'accepted'], where: { eventId }, _count: { _all: true } }),
    ]);
    const now = Date.now();
    return { staff: assignments.slice(0, 200).map(({ user }) => {
      const session = user.scannerSession?.eventId === eventId && user.scannerSession.code.active ? user.scannerSession : null;
      return { id: user.id, username: user.username, name: user.displayName, active: user.active,
        connected: !!(user.active && session && now - session.lastSeen.getTime() <= 120000),
        lastSeen: session?.lastSeen ?? null, entrance: session?.entrance?.name ?? null,
        accepted: counts.find((row) => row.userId === user.id && row.accepted)?._count._all ?? 0,
        rejected: counts.find((row) => row.userId === user.id && !row.accepted)?._count._all ?? 0 };
    }), truncated: assignments.length > 200 };
  }

  async snapshot(eventId: number, actorId: number, role: string, orgId: number, full = false) {
    await this.events.assertAccess(eventId, actorId, role, orgId, 'reports.view');
    return this.db.$transaction(async (tx) => {
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: {
        id: true, name: true, startsAt: true, endsAt: true, timezone: true, capacity: true, maxTickets: true,
      }});
      const [registered, cancelled, ticketGroups, categories, entrances, byEntrance,
        checkInCount, checkedAttendees, remaining, timeline, noShows,
        transfers, rejectedScans, students, invitations, deliveryGroups] = await Promise.all([
        tx.attendee.count({ where: { eventId, status: 'Registered' } }),
        tx.attendee.count({ where: { eventId, status: 'Cancelled' } }),
        tx.ticket.groupBy({ by: ['categoryId', 'status'], where: { eventId }, _count: { _all: true } }),
        tx.ticketCategory.findMany({ where: { eventId }, select: { id: true, name: true, code: true, allocation: true }, orderBy: { id: 'asc' } }),
        tx.entrance.findMany({ where: { eventId }, select: { id: true, name: true, code: true }, orderBy: { id: 'asc' } }),
        tx.checkIn.groupBy({ by: ['entranceId'], where: { eventId }, _count: { _all: true } }),
        tx.checkIn.count({ where: { eventId } }),
        tx.attendee.count({ where: { eventId, tickets: { some: { checkIn: { isNot: null } } } } }),
        tx.attendee.count({ where: { eventId, status: 'Registered', tickets: { none: { checkIn: { isNot: null } } } } }),
        tx.checkIn.findMany({ where: { eventId }, orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }], take: full ? 20001 : 200, select: {
          checkedAt: true, ticket: { select: { number: true, attendee: { select: { fullName: true } }, category: { select: { name: true } } } },
          entrance: { select: { name: true } }, staff: { select: { displayName: true } },
        } }),
        tx.attendee.findMany({ where: { eventId, status: 'Registered', tickets: { none: { checkIn: { isNot: null } } } }, orderBy: { id: 'asc' }, take: full ? 20001 : 500, select: {
          id: true, fullName: true, email: true, category: { select: { name: true } }, tickets: { select: { number: true, status: true } },
        } }),
        tx.ticketTransfer.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true } }),
        tx.scanAttempt.count({ where: { eventId, accepted: false } }),
        tx.student.count({ where: { eventId, active: true } }),
        tx.guestInvitation.count({ where: { eventId, active: true } }),
        tx.ticketDispatch.findMany({ where: { eventId }, select: { job: { select: { status: true } } } }),
      ]);
      if (full && (timeline.length > 20000 || noShows.length > 20000))
        throw new BadRequestException('This export exceeds 20,000 rows. Filter or split the event report.');
      const issued = ticketGroups.reduce((n, row) => n + row._count._all, 0);
      const used = ticketGroups.filter((row) => row.status === 'Used').reduce((n, row) => n + row._count._all, 0);
      const allocated = ticketGroups.filter((row) => row.status === 'Active' || row.status === 'Used').reduce((n, row) => n + row._count._all, 0);
      return {
        event, summary: { registered, cancelled, issued, used, checkedIn: checkInCount,
          checkedAttendees, remaining, ticketCapacityRemaining: Math.max(0, Math.min(event.capacity, event.maxTickets) - allocated),
          students, invitations, rejectedScans,
          transfers: Object.fromEntries(transfers.map((row) => [row.status, row._count._all])),
          delivery: Object.fromEntries(Object.entries(deliveryGroups.reduce<Record<string, number>>((acc, row) => {
            acc[row.job.status] = (acc[row.job.status] ?? 0) + 1; return acc;
          }, {}))),
        },
        categories: categories.map((category) => ({ ...category,
          issued: ticketGroups.filter((row) => row.categoryId === category.id).reduce((n, row) => n + row._count._all, 0),
          used: ticketGroups.filter((row) => row.categoryId === category.id && row.status === 'Used').reduce((n, row) => n + row._count._all, 0),
        })),
        entrances: entrances.map((entrance) => ({ ...entrance, checkedIn: byEntrance.find((row) => row.entranceId === entrance.id)?._count._all ?? 0 })),
        timeline: timeline.map((row) => ({ checkedAt: row.checkedAt, ticketNumber: row.ticket.number,
          attendee: row.ticket.attendee.fullName, category: row.ticket.category.name,
          entrance: row.entrance.name, staff: row.staff.displayName })),
        noShows: noShows.map((row) => ({ id: row.id, name: row.fullName, email: row.email,
          category: row.category.name, tickets: row.tickets.map((ticket) => `${ticket.number} (${ticket.status})`).join(', ') })),
        noShowLabel: new Date() >= event.endsAt ? 'No-shows' : 'Not yet checked in',
        truncated: { timeline: checkInCount > 200, noShows: remaining > 500 },
      };
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
  }

  async export(eventId: number, actorId: number, role: string, orgId: number, format: string) {
    await this.events.assertAccess(eventId, actorId, role, orgId, 'reports.view');
    await this.events.assertAccess(eventId, actorId, role, orgId, 'exports.create');
    if (format !== 'csv' && format !== 'xlsx') throw new BadRequestException('Choose CSV or Excel.');
    const report = await this.snapshot(eventId, actorId, role, orgId, true);
    const sheets: { name: string; rows: unknown[][] }[] = [
      { name: 'Summary', rows: [['Measure', 'Value'], ...Object.entries(report.summary).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : value])] },
      { name: 'Categories', rows: [['Category', 'Code', 'Allocation', 'Issued', 'Used'], ...report.categories.map((row) => [row.name, row.code, row.allocation, row.issued, row.used])] },
      { name: 'Entrances', rows: [['Entrance', 'Code', 'Checked in'], ...report.entrances.map((row) => [row.name, row.code, row.checkedIn])] },
      { name: 'Recent check-ins', rows: [['Time UTC', 'Ticket', 'Attendee', 'Category', 'Entrance', 'Staff'], ...report.timeline.map((row) => [row.checkedAt.toISOString(), row.ticketNumber, row.attendee, row.category, row.entrance, row.staff])] },
      { name: report.noShowLabel, rows: [['ID', 'Name', 'Email', 'Category', 'Tickets'], ...report.noShows.map((row) => [row.id, row.name, row.email, row.category, row.tickets])] },
    ];
    if (format === 'csv') return { bytes: Buffer.from(csv(sheets[0].rows), 'utf8'), type: 'text/csv; charset=utf-8', extension: 'csv' };
    const book = new ExcelJS.Workbook();
    book.creator = 'Dream Events';
    for (const sheet of sheets) {
      const page = book.addWorksheet(sheet.name);
      for (const row of sheet.rows) page.addRow(row.map(clean));
      page.getRow(1).font = { bold: true };
    }
    return { bytes: Buffer.from(await book.xlsx.writeBuffer()), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
  }
}
