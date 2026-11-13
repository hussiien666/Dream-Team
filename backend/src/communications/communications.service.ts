import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { NotificationsService } from '../email/notifications.service.js';
import type { AuthenticatedRequest } from '../common/request.js';
import { parse, hash } from '../students/validation.js';
import { seal, unseal } from '../common/encryption.util.js';
const input = z.object({ subject: z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/),
  text: z.string().trim().min(1).max(10000), audience: z.enum(['students','guests','all']) }).strict();
@Injectable()
export class CommunicationsService {
  constructor(private readonly db: PrismaService, private readonly events: EventsService, private readonly notifications: NotificationsService) {}
  private async recipients(tx: Prisma.TransactionClient, eventId: number, audience: string) {
    const students = audience === 'guests' ? [] : await tx.student.findMany({ where: { eventId, active: true }, select: { email: true }, take: 501 });
    const guests = audience === 'students' ? [] : await tx.guestInvitation.findMany({ where: { eventId, active: true, attendee: { status: 'Registered' }, student: { active: true } }, select: { email: true }, take: 501 });
    const legacy = audience === 'students' ? [] : await tx.attendee.findMany({ where: { eventId, status: 'Registered', guestInvitation: { is: null } }, select: { email: true }, take: 501 });
    const recipients = [...new Set([...students,...guests,...legacy].map(r => r.email?.trim().toLowerCase()).filter((v): v is string => !!v && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)))].sort();
    if ([students,guests,legacy].some(r => r.length > 500) || recipients.length > 500) throw new BadRequestException('Announcements support up to 500 recipients per operation. Choose a smaller audience.');
    return recipients;
  }
  async preview(eventId: number, body: unknown, r: AuthenticatedRequest) {
    const dto = parse(input, body);
    await this.events.assertAccess(eventId, r.user.id, r.orgRole, r.orgId, 'events.manage');
    const recipients = await this.db.$transaction(tx => this.recipients(tx, eventId, dto.audience));
    return { recipients, count: recipients.length, digest: hash({ ...dto, recipients }) };
  }
  async send(eventId: number, body: unknown, r: AuthenticatedRequest) {
    const dto = parse(input.extend({ confirmed: z.literal(true), digest: z.string().regex(/^[a-f0-9]{64}$/), requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/) }), body);
    if (!this.notifications.enabled()) throw new BadRequestException('Configure and authorize email sending first.');
    return this.events.mutate(eventId, r.user.id, r.orgRole, r.orgId, 'events.manage', async (tx, event) => {
      if (event.archived) throw new BadRequestException('Archived events are read-only.');
      const key = { eventId, kind: 'announcement', requestKey: dto.requestKey };
      const prior = await tx.eventCommunication.findUnique({ where: { eventId_kind_requestKey: key } });
      const contentHash = hash(dto);
      if (prior) {
        if (prior.actorId !== r.user.id || prior.contentHash !== contentHash) throw new ConflictException('This request key belongs to another operation.');
        return JSON.parse(unseal(prior.protectedResult));
      }
      const recipients = await this.recipients(tx, eventId, dto.audience);
      if (!recipients.length || hash({ subject: dto.subject, text: dto.text, audience: dto.audience, recipients }) !== dto.digest)
        throw new ConflictException('The recipients or message changed. Review a fresh preview.');
      const jobs = await this.notifications.event(tx, eventId, r.user.id, recipients, dto.subject, dto.text, `announcement:${dto.requestKey}`);
      const result = { queued: jobs.length, jobIds: jobs };
      await tx.eventCommunication.create({ data: { ...key, actorId: r.user.id, contentHash, protectedResult: seal(JSON.stringify(result)), recipientCount: jobs.length } });
      await tx.auditLog.create({ data: { eventId, actorId: r.user.id, action: 'announcement.queued', details: `Recipients: ${jobs.length}` } });
      return result;
    }, false, 120000);
  }
  async history(eventId: number, r: AuthenticatedRequest) {
    await this.events.assertAccess(eventId, r.user.id, r.orgRole, r.orgId, 'events.manage');
    const rows = await this.db.eventCommunication.findMany({ where: { eventId, kind: 'announcement' }, take: 50, orderBy: { id: 'desc' } });
    return Promise.all(rows.map(async row => {
      const result = JSON.parse(unseal(row.protectedResult)) as { jobIds: number[] };
      const jobs = await this.db.backgroundJob.findMany({ where: { id: { in: result.jobIds }, eventId }, select: { status: true } });
      return { id: row.id, createdAt: row.createdAt, recipients: row.recipientCount,
        states: jobs.reduce<Record<string,number>>((counts,j) => { counts[j.status] = (counts[j.status] ?? 0) + 1; return counts; }, {}) };
    }));
  }
}
