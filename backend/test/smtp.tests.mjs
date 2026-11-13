import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EmailService } from '../dist/email/email.service.js';
import { SmtpProvider } from '../dist/email/smtp.provider.js';
import { ProviderError } from '../dist/email/resend.provider.js';
export function registerSmtpTests({ test, getApp, getDb }) {
  async function withSmtp(fn) {
    const before = { ...process.env }, provider = getApp().get(SmtpProvider), original = provider.send;
    Object.assign(process.env, { EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'Dream Events <no-reply@example.test>',
      SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USERNAME: 'synthetic', SMTP_PASSWORD: 'synthetic' });
    try { await fn(getApp().get(EmailService), provider, getDb()); }
    finally { provider.send = original; process.env = before; }
  }
  const queue = email => email.enqueue(1, null, 1, { to: ['synthetic@example.test'], subject: 'SMTP regression', html: 'Synthetic only' }, randomUUID());
  test('SMTP queue pins its transport, deduplicates and retries explicit temporary rejection', async () => withSmtp(async (email, provider, db) => {
    const key = randomUUID(), message = { to: ['synthetic@example.test'], subject: 'SMTP dedupe', html: 'Synthetic only' };
    const job = await email.enqueue(1, null, 1, message, key);
    assert.equal((await email.enqueue(1, null, 1, message, key)).id, job.id);
    assert.equal((await db.backgroundJob.findUnique({ where: { id: job.id } })).kind, 'smtp.email');
    let sends = 0;
    provider.send = async () => { if (++sends === 1) throw new ProviderError(true, 'smtp_rejected_451'); return 'smtp:synthetic-id'; };
    await email.tick(); assert.equal((await db.backgroundJob.findUnique({ where: { id: job.id } })).status, 'Pending');
    await email.tick(new Date(Date.now() + 61000)); assert.equal(sends, 2);
    assert.equal((await db.mailDelivery.findUnique({ where: { jobId: job.id } })).status, 'Sent');
  }));
  test('SMTP uncertain and expired sending leases never trigger an automatic duplicate', async () => withSmtp(async (email, provider, db) => {
    const uncertain = await queue(email); let sends = 0;
    provider.send = async () => { sends++; throw new ProviderError(false, 'smtp_uncertain'); };
    await email.tick(); assert.equal((await db.backgroundJob.findUnique({ where: { id: uncertain.id } })).status, 'Unknown');
    await email.tick(new Date(Date.now() + 61000)); assert.equal(sends, 1);
    const interrupted = await queue(email);
    await db.backgroundJob.update({ where: { id: interrupted.id }, data: { status: 'Running', leaseUntil: new Date(Date.now() - 1), leaseToken: 'synthetic-interrupted' } });
    await email.tick(); assert.equal(sends, 1);
    assert.equal((await db.mailDelivery.findUnique({ where: { jobId: interrupted.id } })).status, 'Unknown');
  }));
}
