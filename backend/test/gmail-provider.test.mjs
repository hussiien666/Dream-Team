import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GmailProvider } from '../dist/email/gmail.provider.js';
import { gmailOptions, GMAIL_SEND_SCOPE } from '../dist/email/gmail.config.js';
import { databaseOptions } from '../dist/config/runtime.js';
import pg from 'pg';
const setup = () => Object.assign(process.env, { EMAIL_FROM: 'Dream Events <tickets@example.test>', GMAIL_MAILBOX: 'tickets@example.test',
  GMAIL_CLIENT_ID: 'synthetic-client', GMAIL_CLIENT_SECRET: 'private-test-secret', GMAIL_REFRESH_TOKEN: 'private-test-refresh' });
const payload = { from: 'Dream Events <tickets@example.test>', to: ['guest@example.test'], subject: 'Synthetic Arabic ticket تذكرة',
  html: '<p>Private ticket</p>', text: 'Private ticket', attachments: [{ filename: 'ticket.pdf', content: Buffer.from('%PDF synthetic').toString('base64') }] };
const token = () => Response.json({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 3600, scope: GMAIL_SEND_SCOPE });
test('Gmail sends MIME attachments using only the send endpoint and keeps OAuth secrets out of messages', async () => {
  const env = { ...process.env }, original = globalThis.fetch;
  try {
    setup(); const messages = [], urls = []; let refreshes = 0;
    globalThis.fetch = async (url, options) => {
      urls.push(url); assert.equal(options.redirect, 'error');
      if (url === 'https://oauth2.googleapis.com/token') { refreshes++; return token(); }
      assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
      const raw = Buffer.from(JSON.parse(options.body).raw, 'base64url').toString(); messages.push(raw);
      assert.ok(raw.includes('Content-Type: application/pdf')); assert.ok(raw.includes('filename=ticket.pdf') || raw.includes('filename="ticket.pdf"'));
      assert.ok(raw.includes(Buffer.from('%PDF synthetic').toString('base64')));
      assert.ok(!raw.includes('private-test-')); return Response.json({ id: 'abc123' });
    };
    const provider = new GmailProvider();
    assert.equal(await provider.send(payload, 'same-operation'), 'gmail:abc123');
    await provider.send(payload, 'same-operation'); assert.equal(refreshes, 1);
    assert.equal(messages[0].match(/Message-ID:\s*(<[^>]+>)/i)[1], messages[1].match(/Message-ID:\s*(<[^>]+>)/i)[1]);
    assert.deepEqual([...new Set(urls)], ['https://oauth2.googleapis.com/token', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send']);
  } finally { process.env = env; globalThis.fetch = original; }
});
test('Gmail refuses excessive scopes, honors rate limit delay, and never retries ambiguous send POSTs', async () => {
  const env = { ...process.env }, original = globalThis.fetch;
  try {
    setup();
    globalThis.fetch = async () => Response.json({ access_token: 'x', token_type: 'Bearer', expires_in: 3600, scope: 'https://mail.google.com/' });
    await assert.rejects(new GmailProvider().send(payload, 'scope'), e => e.safeCode === 'gmail_token_scope_or_response');
    for (const [outcome, code, retryable] of [[429, 'gmail_rate_limited', true], [503, 'gmail_uncertain', false], [401, 'gmail_rejected_401', false], ['disconnect', 'gmail_uncertain', false], ['bad-success', 'gmail_uncertain', false]]) {
      let sends = 0;
      globalThis.fetch = async (url) => {
        if (url.includes('oauth2')) return token(); sends++;
        if (outcome === 'disconnect') throw new Error('Private network detail');
        if (outcome === 'bad-success') return Response.json({});
        return new Response('', { status: outcome, headers: { 'Retry-After': '1200' } });
      };
      await assert.rejects(new GmailProvider().send(payload, 'failure'), e => e.safeCode === code && e.retryable === retryable && (outcome !== 429 || e.retryAfterMs === 1200000));
      assert.equal(sends, 1);
    }
    assert.throws(() => gmailOptions({ ...process.env, EMAIL_FROM: 'Other <other@example.test>' }));
    assert.throws(() => gmailOptions({ ...process.env, GMAIL_MAX_PER_DAY: '2001' }));
  } finally { process.env = env; globalThis.fetch = original; }
});
test('Cloud SQL uses only the managed socket and ordinary production TCP retains verified TLS', () => {
  const options = databaseOptions({ NODE_ENV: 'production', K_SERVICE: 'dream-events', CLOUD_SQL_CONNECTION_NAME: 'dream-team-bed27:us-east4:dream-team-bed27-instance',
    NODE_DATABASE_URL: 'postgresql://app:private@localhost/dream_events', PG_POOL_MAX: '2' });
  const client = new pg.Client(options);
  assert.equal(client.host, '/cloudsql/dream-team-bed27:us-east4:dream-team-bed27-instance');
  assert.equal(client.connectionParameters.ssl, false); assert.equal(options.max, 2);
  assert.throws(() => databaseOptions({ NODE_ENV: 'production', NODE_DATABASE_URL: 'postgresql://app:private@remote.example/db', PG_SSL: 'false' }));
  assert.throws(() => databaseOptions({ NODE_DATABASE_URL: 'postgresql://app:private@localhost/db', CLOUD_SQL_CONNECTION_NAME: 'bad/path' }));
});
