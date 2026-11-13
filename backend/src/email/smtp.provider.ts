import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { ProviderError, type EmailPayload } from './resend.provider.js';
import { smtpOptions } from './smtp.config.js';

@Injectable()
export class SmtpProvider {
  async send(payload: EmailPayload, key: string): Promise<string> {
    const transport = nodemailer.createTransport(smtpOptions());
    const messageId = '<' + createHash('sha256').update(key).digest('hex') + '@dream-events.invalid>';
    try {
      const info = await transport.sendMail({
        from: payload.from, to: payload.to, replyTo: payload.replyTo,
        subject: payload.subject, html: payload.html, text: payload.text,
        messageId,
        attachments: payload.attachments?.map(a => ({ filename: a.filename, content: Buffer.from(a.content, 'base64') })),
        disableFileAccess: true, disableUrlAccess: true,
      });
      if (info.rejected?.length || info.accepted?.length !== payload.to.length)
        throw new ProviderError(false, 'smtp_partial_acceptance');
      return 'smtp:' + createHash('sha256').update(messageId).digest('hex');
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const e = error as { code?: string; responseCode?: number; command?: string };
      if (e.responseCode && e.responseCode >= 400 && e.responseCode < 600)
        throw new ProviderError(e.responseCode < 500, `smtp_rejected_${e.responseCode}`);
      if (e.code === 'EAUTH') throw new ProviderError(false, 'smtp_authentication');
      // A disconnect after DATA may follow acceptance. SMTP has no provider
      // idempotency API: keep Unknown for explicit review, never auto-resend it.
      if (['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH'].includes(e.command ?? ''))
        throw new ProviderError(true, 'smtp_pre_delivery_connection');
      throw new ProviderError(false, 'smtp_uncertain');
    } finally { transport.close(); }
  }
}
