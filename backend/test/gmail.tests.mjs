import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EmailService } from '../dist/email/email.service.js';
import { GmailProvider } from '../dist/email/gmail.provider.js';
import { ProviderError } from '../dist/email/resend.provider.js';
export function registerGmailTests({ test, getApp, getDb }) {
  async function withGmail(fn) {
    const env = { ...process.env }, provider = getApp().get(GmailProvider), send = provider.send;
    Object.assign(process.env, { EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'gmail', EMAIL_FROM: 'Dream Events <tickets@example.test>',
      GMAIL_MAILBOX: 'tickets@example.test', GMAIL_CLIENT_ID: 'synthetic', GMAIL_CLIENT_SECRET: 'synthetic', GMAIL_REFRESH_TOKEN: 'synthetic',
      GMAIL_MAX_PER_MINUTE: '1', GMAIL_MAX_PER_DAY: '400' });
    try { await fn(getApp().get(EmailService), provider, getDb()); }
    finally { provider.send = send; process.env = env; }
  }
  const queue = email => email.enqueue(1, null, 1, { to: ['guest@example.test'], subject: 'Gmail synthetic', html: 'Test only' }, randomUUID());
  test('Gmail quota reservations serialize concurrent workers and pin transport', async () => withGmail(async (email, provider, db) => {
    await db.mailSendAttempt.deleteMany(); let sends = 0; provider.send = async () => 'gmail:test-' + (++sends);
    const first = await queue(email), second = await queue(email); const now = new Date();
    await Promise.all([email.tick(now), email.tick(now)]); assert.equal(sends, 1);
    assert.equal(await db.mailSendAttempt.count(), 1);
    assert.equal((await db.backgroundJob.findUnique({ where: { id: first.id } })).kind, 'gmail.email');
    await email.tick(new Date(+now + 61000)); assert.equal(sends, 2);
    assert.equal((await db.backgroundJob.findUnique({ where: { id: second.id } })).status, 'Sent');
    assert.ok((await db.mailSendAttempt.findFirst()).mailboxHash.match(/^[a-f0-9]{64}$/));
  }));
  test('Gmail honors rejection delay and preserves Unknown without automatic duplicate sends', async () => withGmail(async (email, provider, db) => {
    await db.mailSendAttempt.deleteMany(); const job = await queue(email); let sends = 0; const now = new Date();
    provider.send = async () => { sends++; throw new ProviderError(true, 'gmail_rate_limited', 1200000); };
    await email.tick(now);
    assert.equal(+(await db.backgroundJob.findUnique({ where: { id: job.id } })).availableAt, +now + 1200000);
    provider.send = async () => { sends++; throw new ProviderError(false, 'gmail_uncertain'); };
    await email.tick(new Date(+now + 1200001)); assert.equal(sends, 2);
    assert.equal((await db.backgroundJob.findUnique({ where: { id: job.id } })).status, 'Unknown');
    await email.tick(new Date(+now + 3600000)); assert.equal(sends, 2);
    const interrupted = await queue(email);
    await db.backgroundJob.update({ where: { id: interrupted.id }, data: { status: 'Running', leaseUntil: new Date(+now - 1), leaseToken: 'interrupted' } });
    await email.tick(now); assert.equal(sends, 2);
    assert.equal((await db.mailDelivery.findUnique({ where: { jobId: interrupted.id } })).status, 'Unknown');
  }));
}
