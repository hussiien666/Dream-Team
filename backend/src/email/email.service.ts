import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { seal, unseal } from '../common/encryption.util.js';
import { digest } from '../common/crypto.util.js';
import { ResendProvider, ProviderError } from './resend.provider.js';
import type { EmailPayload } from './resend.provider.js';
import { SmtpProvider } from './smtp.provider.js';
import { emailConfigured, emailMode } from './smtp.config.js';
import { mailContext } from '../tickets/ticket-engine/mail-context.js';
import { GmailProvider } from './gmail.provider.js';
import { gmailOptions } from './gmail.config.js';
const retries = [60000, 300000, 900000];
const states: Record<string, string> = {
  'email.sent': 'Sent',
  'email.delivered': 'Delivered',
  'email.delivery_delayed': 'Delayed',
  'email.bounced': 'Bounced',
  'email.complained': 'Complained',
  'email.failed': 'Failed',
};
@Injectable()
export class EmailService {
  constructor(
    private readonly db: PrismaService,
    private readonly provider: ResendProvider,
    private readonly smtp: SmtpProvider,
    private readonly gmail: GmailProvider,
  ) {}
  isEnabled() {
    return emailConfigured();
  }
  private enabled() {
    if (!this.isEnabled())
      throw new ServiceUnavailableException('Email delivery is not enabled.');
  }
  async broadcast(tx: Prisma.TransactionClient, organizationId: number, eventId: number, actorId: number, subject: string, text: string, key: string) {
    this.enabled();
    const dedupeKey = 'notice-expand:' + digest(`${organizationId}:${eventId}:${key}`);
    await tx.backgroundJob.create({ data: { organizationId, eventId, kind: emailMode() + '.expand', dedupeKey,
      payload: seal(JSON.stringify({ actorId, subject, text, source: 0, cursor: 0 })) } });
  }
  private async expandNotice(now: Date, mode: string) {
    return this.db.$transaction(async tx => {
      const [job] = await tx.$queryRaw<{ id: number; event_id: number; organization_id: number; payload: string }[]>`
        SELECT id,event_id,organization_id,payload FROM background_jobs WHERE kind=${mode + '.expand'} AND status='Pending' AND available_at<=${now}
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!job) return false;
      const state = JSON.parse(unseal(job.payload)) as { actorId: number; subject: string; text: string; source: number; cursor: number };
      let rows: {id:number;email:string|null}[];
      if (state.source === 0) rows = await tx.student.findMany({ where: { eventId: job.event_id, active: true, id: { gt: state.cursor } }, select: { id:true,email:true }, orderBy: {id:'asc'}, take:100 });
      else if (state.source === 1) rows = await tx.guestInvitation.findMany({ where: { eventId: job.event_id, active: true, id: { gt: state.cursor } }, select: { id:true,email:true }, orderBy: {id:'asc'}, take:100 });
      else rows = await tx.attendee.findMany({ where: { eventId: job.event_id, status: 'Registered', guestInvitation: {is:null}, id: {gt:state.cursor} }, select: {id:true,email:true}, orderBy:{id:'asc'}, take:100 });
      for (const row of rows) {
        const recipient = row.email?.trim().toLowerCase();
        if (!recipient || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) continue;
        const html = state.text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)).replace(/\n/g,'<br>');
        await this.enqueue(job.organization_id, job.event_id, null, { to:[recipient], subject:state.subject, text:state.text, html:`<p>${html}</p>` }, `notice:${job.id}:${digest(recipient)}`,tx);
      }
      if (rows.length) state.cursor = rows.at(-1)!.id;
      if (rows.length < 100) { state.source++; state.cursor=0; }
      await tx.backgroundJob.update({ where:{id:job.id}, data:{payload:seal(JSON.stringify(state)),status:state.source>2?'Sent':'Pending',attempts:{increment:1}} });
      return true;
    }, {timeout:120000});
  }
  async enqueue(
    organizationId: number,
    eventId: number | null,
    actorId: number | null,
    message: Omit<EmailPayload, 'from'>,
    idempotencyKey: string,
    transaction?: Prisma.TransactionClient,
  ) {
    this.enabled();
    if (
      !idempotencyKey ||
      idempotencyKey.length > 200 ||
      !message.to.length ||
      message.to.length > 50 ||
      (emailMode() === 'gmail' && message.to.length !== 1) ||
      message.to.some((v) => !/^\S+@[^\s@]+\.[^\s@]+$/.test(v)) ||
      !message.subject ||
      message.subject.length > 300 ||
      JSON.stringify(message).length > 2000000
    )
      throw new BadRequestException('Invalid email message.');
    const payload = seal(
      JSON.stringify({ ...message, from: process.env.EMAIL_FROM,
        ...(process.env.EMAIL_REPLY_TO ? { replyTo: process.env.EMAIL_REPLY_TO } : {}) }),
    );
    const dedupeKey =
      'resend:' + digest(`${organizationId}:${eventId}:${idempotencyKey}`);
    const queue = async (tx: Prisma.TransactionClient) => {
      if (actorId !== null) {
        const member = await tx.organizationUser.findUnique({
          where: { userId: actorId },
        });
        if (!member || member.organizationId !== organizationId)
          throw new ForbiddenException('Organization access denied.');
      }
      if (eventId !== null) {
        const owner = await tx.organizationEvent.findUnique({
          where: { eventId },
        });
        if (!owner || owner.organizationId !== organizationId)
          throw new ForbiddenException('Event not in your organization.');
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dedupeKey},0))`;
      const existing = await tx.backgroundJob.findUnique({
        where: { dedupeKey },
      });
      if (existing) {
        if (unseal(existing.payload) !== unseal(payload))
          throw new BadRequestException(
            'This email operation was already queued with different contents.',
          );
        return { id: existing.id, status: existing.status };
      }
      const job = await tx.backgroundJob.create({
        data: {
          organizationId,
          eventId,
          kind: emailMode() + '.email',
          dedupeKey,
          payload,
          mailDelivery: { create: {} },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          eventId,
          action: 'email.queued',
          details: `Job ${job.id}`,
        },
      });
      return { id: job.id, status: job.status };
    };
    return transaction ? queue(transaction) : this.db.$transaction(queue);
  }
  /** One leased job per tick. Safe to run multiple workers against PostgreSQL. */
  async tick(now = new Date()): Promise<boolean> {
    this.enabled();
    const mode = emailMode();
    if (await this.expandNotice(now, mode)) return true;
    const kind = mode + '.email';
    const claimed = await this.db.$transaction(async (tx) => {
      const limit = mode === 'gmail' ? gmailOptions() : null;
      const mailboxHash = limit ? digest(limit.mailbox) : '';
      // Serialize mailbox quota reservations across workers/organizations/Cloud Run executions.
      if (limit) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${mailboxHash}, 7))`;
      const rows = await tx.$queryRaw<
        { id: number; status: string }[]
      >`SELECT id, status FROM background_jobs WHERE kind=${kind} AND ((status='Pending' AND available_at<=${now}) OR (status='Running' AND lease_until<=${now})) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows.length) return null;
      if (limit && rows[0].status !== 'Running') {
        const [counts] = await tx.$queryRaw<{ minute: number; day: number }[]>`
          SELECT count(*) FILTER (WHERE reserved_at > ${new Date(+now - 60000)})::int AS minute,
            count(*)::int AS day FROM mail_send_attempts
          WHERE mailbox_hash=${mailboxHash} AND reserved_at > ${new Date(+now - 86400000)}`;
        if (counts.minute >= limit.perMinute || counts.day >= limit.perDay) return null;
      }
      const leaseToken = randomBytes(24).toString('hex');
      const job = await tx.backgroundJob.update({
        where: { id: rows[0].id },
        data: {
          status: 'Running',
          attempts: { increment: 1 },
          leaseToken,
          leaseUntil: new Date(+now + 60000),
        },
      });
      const delivery = await tx.mailDelivery.findUniqueOrThrow({
        where: { jobId: job.id },
      });
      if (!delivery.firstAttemptAt)
        await tx.mailDelivery.update({
          where: { jobId: job.id },
          data: { firstAttemptAt: now },
        });
      if (limit && rows[0].status !== 'Running')
        await tx.mailSendAttempt.create({ data: { jobId: job.id, mailboxHash, reservedAt: now } });
      return { job, firstAttemptAt: delivery.firstAttemptAt ?? now, interrupted: mode !== 'resend' && rows[0].status === 'Running' };
    });
    if (!claimed) return false;
    const { job, firstAttemptAt } = claimed;
    if (claimed.interrupted) {
      await this.finish(job.id, job.leaseToken, 'Unknown', 'Unknown', mode + '_interrupted');
      return true;
    }
    const dispatch = await this.db.ticketDispatch.findUnique({
      where: { jobId: job.id },
    });
    if (dispatch) {
      const current = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM events WHERE id=${dispatch.eventId} FOR UPDATE`;
        return mailContext(tx, dispatch.ticketId);
      });
      if (
        !current.valid ||
        current.ticket.tokenHash !== dispatch.tokenHash ||
        current.fingerprint !== dispatch.fingerprint ||
        !current.recipients.includes(dispatch.recipient)
      ) {
        await this.finish(
          job.id,
          job.leaseToken,
          'Failed',
          'Failed',
          'ticket_or_recipient_changed',
        );
        return true;
      }
    }
    if (+now - +firstAttemptAt > 23 * 3600000) {
      await this.finish(
        job.id,
        job.leaseToken,
        'Unknown',
        'Unknown',
        'idempotency_window_expired',
      );
      return true;
    }
    if (job.attempts > 4) {
      await this.finish(
        job.id,
        job.leaseToken,
        'Unknown',
        'Unknown',
        'worker_attempt_limit',
      );
      return true;
    }
    let message: EmailPayload;
    try {
      message = JSON.parse(unseal(job.payload));
    } catch {
      await this.finish(
        job.id,
        job.leaseToken,
        'Failed',
        'Failed',
        'email_payload_unavailable',
      );
      return true;
    }
    let sent = false;
    if (message.capability) {
      const cap = message.capability;
      let live = false;
      if (cap.kind === 'invitation') {
        const link = await this.db.publicInvitationLink.findFirst({ where: { id: cap.id, tokenHash: cap.tokenHash, revokedAt: null, expiresAt: { gt: now } } });
        live = !!link && !!await this.db.student.findFirst({where:{id:link.studentId,eventId:link.eventId,active:true,email:message.to[0]}});
      } else {
        const link = await this.db.publicTicketLink.findFirst({ where: { id: cap.id, tokenHash: cap.tokenHash, revokedAt: null, expiresAt: { gt: now } } });
        live = !!link && !!await this.db.ticket.findFirst({where:{id:link.ticketId,eventId:link.eventId,status:'Active',attendee:{status:'Registered'}}});
      }
      if (!live) { await this.finish(job.id, job.leaseToken, 'Failed', 'Failed', 'private_link_expired_or_revoked'); return true; }
    }
    try {
      const id = await (mode === 'gmail' ? this.gmail : mode === 'smtp' ? this.smtp : this.provider).send(message, job.dedupeKey);
      sent = true;
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM background_jobs WHERE id=${job.id} FOR UPDATE`;
        if (
          !(await tx.backgroundJob.findFirst({
            where: {
              id: job.id,
              status: 'Running',
              leaseToken: job.leaseToken,
            },
          }))
        )
          return;
        await tx.backgroundJob.update({
          where: { id: job.id },
          data: {
            status: 'Sent',
            leaseUntil: null,
            leaseToken: '',
            lastError: '',
          },
        });
        await tx.mailDelivery.update({
          where: { jobId: job.id },
          data: { providerMessageId: id, status: 'Sent' },
        });
        await this.applyEvents(tx, job.id, id);
      });
    } catch (error) {
      // If provider accepted but persistence failed, retain the lease. A later worker
      // replays the same idempotency key instead of reporting a false send failure.
      if (sent) throw new Error('Email result persistence is unavailable.');
      const retryable = error instanceof ProviderError && error.retryable;
      const safe =
        error instanceof ProviderError
          ? error.safeCode
          : 'email_processing_error';
      const baseDelay = retries[job.attempts - 1];
      const delay = baseDelay === undefined ? undefined : Math.max(baseDelay, error instanceof ProviderError ? error.retryAfterMs ?? 0 : 0);
      if (retryable && delay !== undefined)
        await this.db.backgroundJob.updateMany({
          where: { id: job.id, status: 'Running', leaseToken: job.leaseToken },
          data: {
            status: 'Pending',
            availableAt: new Date(+now + delay),
            leaseUntil: null,
            leaseToken: '',
            lastError: safe,
          },
        });
      else {
        const uncertain = [
          'provider_connection',
          'provider_invalid_response',
          'smtp_uncertain',
          'smtp_partial_acceptance',
          'gmail_uncertain',
        ].includes(safe);
        await this.finish(
          job.id,
          job.leaseToken,
          uncertain ? 'Unknown' : 'Failed',
          uncertain ? 'Unknown' : 'Failed',
          safe,
        );
      }
    }
    return true;
  }
  private async finish(
    id: number,
    leaseToken: string,
    jobStatus: 'Failed' | 'Unknown',
    status: string,
    safe: string,
  ) {
    await this.db.$transaction(async (tx) => {
      const changed = await tx.backgroundJob.updateMany({
        where: { id, status: 'Running', leaseToken },
        data: {
          status: jobStatus,
          lastError: safe,
          leaseUntil: null,
          leaseToken: '',
        },
      });
      if (changed.count) {
        await tx.mailDelivery.update({
          where: { jobId: id },
          data: { status },
        });
        const job = await tx.backgroundJob.findUniqueOrThrow({ where: { id } });
        await tx.auditLog.create({
          data: {
            eventId: job.eventId,
            action: 'email.failed',
            details: `Job ${id}; ${safe}`,
          },
        });
        await this.notifyTicketFailure(tx, id, safe);
      }
    });
  }
  private async notifyTicketFailure(
    tx: Prisma.TransactionClient,
    id: number,
    safe: string,
  ) {
    const dispatch = await tx.ticketDispatch.findUnique({
      where: { jobId: id },
    });
    if (!dispatch) return;
    const job = await tx.backgroundJob.findUniqueOrThrow({ where: { id } });
    const setting = await tx.eventSetting.findUnique({
      where: { eventId_key: { eventId: dispatch.eventId, key: 'product.v1' } },
    });
    if (JSON.parse(setting?.value ?? '{}').notifyEmailFailures === false)
      return;
    const created = await tx.ticketMailNotice.createMany({
      data: [{ jobId: id, eventId: dispatch.eventId, message: safe }],
      skipDuplicates: true,
    });
    if (!created.count) return;
    if(!this.isEnabled())return;
    const admins = await tx.securityProfile.findMany({
      where: {
        emailVerified: true,
        email: { not: null },
        user: {
          active: true,
          organizationUser: {
            is: { organizationId: job.organizationId, role: 'super_admin' },
          },
        },
      },
      select: { email: true },
    });
    for (const admin of admins)
      if (admin.email&&/^\S+@[^\s@]+\.[^\s@]+$/.test(admin.email))
        await this.enqueue(
          job.organizationId,
          job.eventId,
          null,
          {
            to: [admin.email],
            subject: 'Ticket email delivery needs attention',
            text: `Ticket delivery job ${id} needs review in event administration. Reason: ${safe}`,
            html: `<p>Ticket delivery job ${id} needs review in event administration.</p>`,
          },
          `ticket-failure:${id}:${digest(admin.email)}`,
          tx,
        );
  }
  async webhook(id: string, event: unknown) {
    const input = event as {
      type?: string;
      created_at?: string;
      data?: { email_id?: string };
    };
    if (!input.type || !states[input.type]) return;
    const providerId = input.data?.email_id,
      occurredAt = new Date(input.created_at ?? '');
    if (
      !id ||
      id.length > 160 ||
      !providerId ||
      providerId.length > 120 ||
      !Number.isFinite(+occurredAt)
    )
      throw new BadRequestException('Invalid webhook event.');
    await this.db.$transaction(async (tx) => {
      await tx.mailWebhook.createMany({
        data: [
          {
            id,
            eventType: input.type!,
            providerMessageId: providerId,
            occurredAt,
          },
        ],
        skipDuplicates: true,
      });
      const delivery = await tx.mailDelivery.findUnique({
        where: { providerMessageId: providerId },
      });
      if (delivery) {
        await tx.$queryRaw`SELECT job_id FROM mail_deliveries WHERE job_id=${delivery.jobId} FOR UPDATE`;
        await this.applyEvents(tx, delivery.jobId, providerId);
      }
    });
  }
  private async applyEvents(
    tx: Prisma.TransactionClient,
    jobId: number,
    providerMessageId: string,
  ) {
    const events = await tx.mailWebhook.findMany({
      where: { providerMessageId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    let current = await tx.mailDelivery.findUniqueOrThrow({ where: { jobId } });
    for (const event of events) {
      if (current.lastEventAt && event.occurredAt < current.lastEventAt)
        continue;
      if (
        ['Bounced', 'Complained', 'Failed'].includes(current.status) ||
        (current.status === 'Delivered' &&
          ['Sent', 'Delayed'].includes(states[event.eventType]))
      )
        continue;
      current = await tx.mailDelivery.update({
        where: { jobId },
        data: {
          status: states[event.eventType],
          lastEventAt: event.occurredAt,
        },
      });
    }
    if (['Bounced', 'Complained', 'Failed'].includes(current.status))
      await this.notifyTicketFailure(
        tx,
        jobId,
        'provider_' + current.status.toLowerCase(),
      );
  }
}
