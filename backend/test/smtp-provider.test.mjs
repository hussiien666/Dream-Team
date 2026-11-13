import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { SmtpProvider } from '../dist/email/smtp.provider.js';
import { smtpOptions } from '../dist/email/smtp.config.js';
import { ProviderError } from '../dist/email/resend.provider.js';
test('SMTP requires verified TLS and sends private credentials only to the transport', async () => {
  const before = { ...process.env }, original = nodemailer.createTransport;
  try {
    Object.assign(process.env, { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USERNAME: 'personal-login@example.test', SMTP_PASSWORD: 'synthetic-private-password' });
    const messages = []; let closed = 0;
    nodemailer.createTransport = options => {
      assert.equal(options.requireTLS, true); assert.equal(options.secure, false);
      assert.equal(options.tls.rejectUnauthorized, true);
      assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
      assert.equal(options.logger, false); assert.equal(options.debug, false);
      return { sendMail: async message => { messages.push(message); return { accepted: ['guest@example.test'], rejected: [] }; }, close: () => closed++ };
    };
    const provider = new SmtpProvider(), payload = { from: 'Dream Events <no-reply@example.test>', to: ['guest@example.test'], replyTo: 'support@example.test', subject: 'Synthetic ticket', html: 'Private', attachments: [{ filename: 'ticket.pdf', content: Buffer.from('%PDF').toString('base64') }] };
    assert.equal(await provider.send(payload, 'stable-key'), await provider.send(payload, 'stable-key'));
    assert.equal(messages[0].messageId, messages[1].messageId); assert.equal(closed, 2);
    assert.equal(messages[0].from, payload.from); assert.equal(messages[0].replyTo, payload.replyTo);
    assert.equal(messages[0].attachments[0].content.toString(), '%PDF');
    assert.ok(!JSON.stringify(messages).includes('personal-login')); assert.ok(!JSON.stringify(messages).includes('synthetic-private-password'));
    assert.throws(() => smtpOptions({ ...process.env, SMTP_PORT: '25' }));
  } finally { nodemailer.createTransport = original; process.env = before; }
});
test('SMTP retries explicit temporary rejection and keeps post-DATA disconnect uncertain', async () => {
  const before = { ...process.env }, original = nodemailer.createTransport;
  try {
    Object.assign(process.env, { SMTP_HOST: 'smtp.example.test', SMTP_USERNAME: 'synthetic', SMTP_PASSWORD: 'synthetic' });
    const provider = new SmtpProvider();
    for (const [error, retryable, code] of [
      [{ responseCode: 451 }, true, 'smtp_rejected_451'],
      [{ code: 'EAUTH' }, false, 'smtp_authentication'],
      [{ code: 'ESOCKET', command: 'DATA' }, false, 'smtp_uncertain'],
      [{ code: 'ETIMEDOUT', command: 'CONN' }, true, 'smtp_pre_delivery_connection'],
    ]) {
      nodemailer.createTransport = () => ({ sendMail: async () => { throw error; }, close: () => {} });
      await assert.rejects(provider.send({ to: ['guest@example.test'] }, 'key'), e => e instanceof ProviderError && e.retryable === retryable && e.safeCode === code);
    }
  } finally { nodemailer.createTransport = original; process.env = before; }
});
