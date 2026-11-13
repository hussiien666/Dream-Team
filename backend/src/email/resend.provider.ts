import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
export type EmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  capability?: { kind: 'invitation' | 'ticket'; id: number; tokenHash: string };
  attachments?: { filename: string; content: string }[];
};
export class ProviderError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly safeCode: string,
    readonly retryAfterMs?: number,
  ) {
    super('Email delivery could not be confirmed.');
  }
}
@Injectable()
export class ResendProvider {
  async send(payload: EmailPayload, key: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ ...payload, capability: undefined, replyTo: undefined, ...(payload.replyTo ? { reply_to: payload.replyTo } : {}) }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
    } catch {
      throw new ProviderError(true, 'provider_connection');
    }
    if (!response.ok)
      throw new ProviderError(
        response.status === 429 || response.status >= 500,
        `provider_${response.status}`,
      );
    const result = (await response.json().catch(() => null)) as {
      id?: string;
    } | null;
    if (!result?.id || result.id.length > 120)
      throw new ProviderError(true, 'provider_invalid_response');
    return result.id;
  }
  verify(
    payload: string,
    headers: { id: string; timestamp: string; signature: string },
  ) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) throw new Error('Webhook verification is not configured.');
    return new Resend(
      process.env.RESEND_API_KEY || 'webhook_verification_only',
    ).webhooks.verify({ payload, headers, webhookSecret: secret });
  }
}
