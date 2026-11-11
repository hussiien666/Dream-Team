import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Prisma, Ticket } from '@prisma/client';
import type { AuthenticatedRequest as Request } from '../common/request.js';
import { PrismaService } from '../database/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { EmailService } from '../email/email.service.js';
import { digest } from '../common/crypto.util.js';
import { unseal } from '../common/encryption.util.js';
import {
  mailContext,
  defaultMailTemplate,
  ticketMessage,
} from './ticket-engine/mail-context.js';
import { generatePdfTicket } from './ticket-engine/pdf.util.js';
type Tx = Prisma.TransactionClient;
const emailText = z
  .string()
  .trim()
  .max(6000)
  .refine(
    (v) =>
      !(v.match(/\{[^{}]*\}/g) ?? []).some(
        (p) =>
          ![
            '{guest_name}',
            '{student_name}',
            '{event_name}',
            '{event_date}',
          ].includes(p),
      ),
    'Use supported placeholders only.',
  );
const templateSchema = z
  .object({
    subject: emailText.refine(
      (v) => v.length > 0 && v.length <= 300 && !/[\r\n]/.test(v),
    ),
    greeting: emailText,
    body: emailText.refine((v) => v.length > 0),
    signature: emailText,
    contact: emailText,
  })
  .strict();
export function mailInput<T>(schema: z.ZodType<T>, body: unknown) {
  const p = schema.safeParse(body);
  if (!p.success)
    throw new BadRequestException(
      p.error.issues.map((i) => i.message).join('; '),
    );
  return p.data;
}
export const sendSchema = z
  .object({
    ticketIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
    requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    confirmed: z.literal(true),
    resend: z.boolean().default(false),
    reason: z.string().trim().min(5).max(1000).optional(),
  })
  .strict()
  .refine(
    (v) => !v.resend || !!v.reason,
    'Record a reason for an intentional resend.',
  );
@Injectable()
export class DeliveryService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: EventsService,
    private readonly email: EmailService,
  ) {}
  async settings(e: number, r: Request) {
    await this.events.assertAccess(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
    );
    return {
      enabled: this.email.isEnabled(),
      template: await this.template(this.db, e),
    };
  }
  async saveSettings(e: number, body: unknown, r: Request) {
    const template = mailInput(templateSchema, body);
    return this.events.mutate(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
      async (tx, event) => {
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        const value = JSON.stringify(template);
        await tx.eventSetting.upsert({
          where: { eventId_key: { eventId: e, key: 'ticket-email.v1' } },
          create: { eventId: e, key: 'ticket-email.v1', value },
          update: { value },
        });
        await tx.auditLog.create({
          data: {
            actorId: r.user.id,
            eventId: e,
            action: 'ticket.email_template_updated',
          },
        });
        return { template };
      },
      true,
    );
  }
  private async template(tx: Tx, e: number) {
    const setting = await tx.eventSetting.findUnique({
      where: { eventId_key: { eventId: e, key: 'ticket-email.v1' } },
    });
    return setting
      ? mailInput(templateSchema, JSON.parse(setting.value))
      : defaultMailTemplate;
  }
  async preview(e: number, body: unknown, r: Request) {
    const { ticketIds } = mailInput(
      z
        .object({
          ticketIds: z.array(z.number().int().positive()).min(1).max(50),
        })
        .strict(),
      body,
    );
    return this.events.mutate(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
      async (tx) => {
        const rows = [];
        for (const id of ticketIds) {
          const ticket = await tx.ticket.findFirst({
            where: { id, eventId: e },
          });
          if (!ticket)
            throw new BadRequestException('Ticket is outside this event.');
          const context = await mailContext(tx, id);
          rows.push({
            ticketId: id,
            number: ticket.number,
            attendee: context.attendee.fullName,
            recipients: context.recipients,
            eligible: context.valid,
          });
        }
        return { enabled: this.email.isEnabled(), rows };
      },
      true,
    );
  }
  async history(e: number, r: Request) {
    await this.events.assertAccess(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
    );
    const rows = await this.db.ticketDispatch.findMany({
      where: { eventId: e },
      take: 200,
      orderBy: { jobId: 'desc' },
      select: {
        jobId: true,
        ticketId: true,
        recipient: true,
        createdAt: true,
        ticket: {
          select: { number: true, attendee: { select: { fullName: true } } },
        },
        job: {
          select: {
            status: true,
            attempts: true,
            availableAt: true,
            lastError: true,
            mailDelivery: { select: { status: true, providerMessageId: true } },
          },
        },
      },
    });
    return {
      enabled: this.email.isEnabled(),
      deliveries: rows,
      notices: await this.db.ticketMailNotice.findMany({
        where: { eventId: e },
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
    };
  }
  async send(e: number, body: unknown, r: Request) {
    const d = mailInput(sendSchema, body),
      ids = [...d.ticketIds].sort((a, b) => a - b),
      hash = digest(
        JSON.stringify({ ids, resend: d.resend, reason: d.reason }),
      );
    return this.events.mutate(
      e,
      r.user.id,
      r.orgRole,
      r.orgId,
      'tickets.manage',
      async (tx, event) => {
        const old = await tx.ticketMailOperation.findUnique({
          where: {
            eventId_requestKey: { eventId: e, requestKey: d.requestKey },
          },
        });
        if (old) {
          if (old.actorId !== r.user.id || old.contentHash !== hash)
            throw new ConflictException(
              'This request key belongs to a different email operation.',
            );
          return old.result;
        }
        if (event.archived)
          throw new BadRequestException('Archived events are read-only.');
        if (!this.email.isEnabled())
          throw new BadRequestException(
            'Email delivery is disabled. Tickets remain downloadable.',
          );
        const results = [];
        for (const id of ids) {
          const ticket = await tx.ticket.findFirst({
            where: { id, eventId: e },
          });
          if (!ticket)
            throw new BadRequestException('Ticket is outside this event.');
          results.push(
            await this.queue(
              tx,
              ticket,
              r.user.id,
              r.orgId,
              `manual:${d.requestKey}`,
              d.resend,
            ),
          );
        }
        const result = {
          tickets: results,
          queued: results.reduce((sum, t) => sum + t.queued, 0),
        };
        await tx.ticketMailOperation.create({
          data: {
            eventId: e,
            actorId: r.user.id,
            requestKey: d.requestKey,
            contentHash: hash,
            result,
          },
        });
        await tx.auditLog.create({
          data: {
            eventId: e,
            actorId: r.user.id,
            action: d.resend ? 'ticket.email_resent' : 'ticket.email_requested',
            details: JSON.stringify({
              ticketIds: ids,
              queued: result.queued,
              reason: d.reason ?? null,
            }),
          },
        });
        return result;
      },
      true,
      120000,
    );
  }
  async queue(
    tx: Tx,
    ticket: Ticket,
    actorId: number | null,
    orgId: number,
    key: string,
    resend = false,
  ) {
    if (!this.email.isEnabled())
      return {
        ticketId: ticket.id,
        queued: 0,
        state: 'Disabled',
        recipients: [] as string[],
      };
    const context = await mailContext(tx, ticket.id);
    if (!context.valid)
      throw new BadRequestException(
        'Only active, unexpired tickets for open events and registered attendees can be emailed.',
      );
    const recipients = context.recipients;
    if (!recipients.length)
      return {
        ticketId: ticket.id,
        queued: 0,
        state: 'No recipient',
        recipients,
      };
    const credential = await tx.ticketCredential.findUnique({
      where: { ticketId: ticket.id },
    });
    if (!credential)
      throw new BadRequestException(
        'Recover the original QR before emailing this historical ticket.',
      );
    let raw: string;
    try {
      raw = unseal(credential.protectedToken);
    } catch {
      throw new BadRequestException(
        'The ticket encryption key is unavailable.',
      );
    }
    if (
      credential.tokenHash !== ticket.tokenHash ||
      digest(raw) !== ticket.tokenHash
    )
      throw new ConflictException(
        'Stored QR is stale. Recover the original credential.',
      );
    const message = ticketMessage(
      await this.template(tx, ticket.eventId),
      context,
    );
    let pdf: Buffer | undefined,
      queued = 0;
    for (const recipient of recipients) {
      const old = await tx.ticketDispatch.findFirst({
        where: { ticketId: ticket.id, tokenHash: ticket.tokenHash, recipient },
        orderBy: { jobId: 'desc' },
        include: { job: true },
      });
      if (old && (['Pending', 'Running'].includes(old.job.status) || !resend))
        continue;
      pdf ??= await generatePdfTicket(
        context.event,
        context.attendee,
        context.category,
        ticket,
        raw,
        context.entrances,
        context.design,
      );
      const job = await this.email.enqueue(
        orgId,
        ticket.eventId,
        actorId,
        {
          to: [recipient],
          ...message,
          attachments: [
            {
              filename: ticket.number.replace(/[^A-Za-z0-9_-]/g, '_') + '.pdf',
              content: pdf.toString('base64'),
            },
          ],
        },
        `ticket:${ticket.id}:${digest(recipient)}:${key}`,
        tx,
      );
      await tx.ticketDispatch.create({
        data: {
          jobId: job.id,
          ticketId: ticket.id,
          eventId: ticket.eventId,
          tokenHash: ticket.tokenHash,
          recipient,
          fingerprint: context.fingerprint,
        },
      });
      queued++;
    }
    return {
      ticketId: ticket.id,
      queued,
      state: queued
        ? 'Queued'
        : 'Already queued/sent; use an explicit resend for another copy',
      recipients,
    };
  }
}
