import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { ProviderError, type EmailPayload } from './resend.provider.js';
import { gmailOptions, GMAIL_SEND_SCOPE } from './gmail.config.js';

/** Send-only OAuth. No mailbox reads, drafts, polling, webhooks or automatic POST retries. */
@Injectable()
export class GmailProvider {
  private cached?: { key: string; token: string; expiresAt: number };
  private async accessToken() {
    const config = gmailOptions();
    const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    if (this.cached?.key === key && this.cached.expiresAt > Date.now() + 60000)
      return this.cached.token;
    let response: Response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId,
          client_secret: config.clientSecret, refresh_token: config.refreshToken }),
      });
    } catch { throw new ProviderError(true, 'gmail_token_connection'); }
    if (!response.ok)
      throw new ProviderError(response.status === 429 || response.status >= 500, 'gmail_token_rejected');
    const value = await response.json().catch(() => null) as {
      access_token?: string; expires_in?: number; token_type?: string; scope?: string;
    } | null;
    if (!value?.access_token || value.token_type?.toLowerCase() !== 'bearer' ||
        !Number.isFinite(value.expires_in) || value.expires_in! <= 0 ||
        (value.scope !== undefined && value.scope.trim() !== GMAIL_SEND_SCOPE))
      throw new ProviderError(false, 'gmail_token_scope_or_response');
    this.cached = { key, token: value.access_token, expiresAt: Date.now() + Math.min(value.expires_in!, 3600) * 1000 };
    return value.access_token;
  }
  async send(payload: EmailPayload, key: string): Promise<string> {
    const config = gmailOptions();
    // One envelope recipient per job: explicit deduplication and conservative quota accounting.
    if (payload.to.length !== 1 || /[\r\n]/.test(payload.subject + payload.from + payload.to[0]) ||
        /(?:^|<)([^<>\s]+@[^<>\s]+)>?$/.exec(payload.from)?.[1]?.toLowerCase() !== config.mailbox)
      throw new ProviderError(false, 'gmail_invalid_message');
    const token = await this.accessToken();
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    const mime = await composer.sendMail({
      from: payload.from, to: payload.to, replyTo: payload.replyTo, subject: payload.subject,
      text: payload.text, html: payload.html,
      // Stable Message-ID helps human review; Gmail does not promise deduplication by this value.
      messageId: `<${createHash('sha256').update(key).digest('hex')}@${config.mailbox.split('@')[1]}>`,
      attachments: payload.attachments?.map(a => ({ filename: a.filename, content: Buffer.from(a.content, 'base64') })),
      disableFileAccess: true, disableUrlAccess: true,
    });
    if (!Buffer.isBuffer(mime.message)) throw new ProviderError(false, 'gmail_invalid_message');
    let response: Response;
    try {
      response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: mime.message.toString('base64url') }),
      });
    } catch { throw new ProviderError(false, 'gmail_uncertain'); }
    if (!response.ok) {
      this.cached = undefined;
      if (response.status === 429) {
        const header = response.headers.get('retry-after') ?? '';
        const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
        throw new ProviderError(true, 'gmail_rate_limited', Number.isFinite(seconds) ? Math.min(86400000, Math.max(60000, seconds * 1000)) : 900000);
      }
      // A server error can occur after acceptance; send-only access cannot reconcile Sent mail.
      throw new ProviderError(false, response.status >= 500 ? 'gmail_uncertain' : `gmail_rejected_${response.status}`);
    }
    const value = await response.json().catch(() => null) as { id?: string } | null;
    if (!value?.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id))
      throw new ProviderError(false, 'gmail_uncertain');
    return `gmail:${value.id}`;
  }
}
