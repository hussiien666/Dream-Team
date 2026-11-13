import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import ExcelJS from '../../backend/node_modules/exceljs/excel.js';
import { totp } from '../../backend/dist/auth/totp.js';
const base = 'http://127.0.0.1:5001/demo-dream-events/europe-west1/api/api/v1/';
let token, coldLoginMs;
async function request(path, { method = 'GET', body, bearer = token, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
    ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  return response;
}
before(async () => {
  const started = performance.now();
  const login = await request('auth/login', { method: 'POST', body: { username: 'legacy_admin', password: 'legacy-test-password' } });
  coldLoginMs = Math.round(performance.now() - started);
  assert.equal(login.status, 200, 'Functions emulator API login failed'); token = (await login.json()).accessToken;
  assert.equal((await request('events')).status, 403);
  const verified = await request('auth/factor/verify', { method: 'POST', body: { code: totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ') } });
  assert.equal(verified.status, 200);
}, { timeout: 200000 });
test('Firebase Functions preserves API authorization, CORS and no-store headers', async () => {
  const started = performance.now();
  const response = await request('events'); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok((await response.json()).some(e => e.id === 7));
  console.log(`Local Functions timing: cold login ${coldLoginMs} ms; warm authorized events ${Math.round(performance.now() - started)} ms.`);
  const preflight = await request('events', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5174', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5174');
  const challengePreflight = await request('public/invitations', { method: 'OPTIONS', headers: {
    Origin: 'http://127.0.0.1:5174', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type,x-turnstile-token' } });
  assert.equal(challengePreflight.status, 204);
  assert.match(challengePreflight.headers.get('access-control-allow-headers'), /x-turnstile-token/i);
  const blocked = await request('events', { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  assert.equal((await request('events', { bearer: 'x'.repeat(43) })).status, 401);
});
test('Firebase Functions imports real Excel using pre-parsed multipart bodies and idempotent receipts', async () => {
  const created = await request('events', { method: 'POST', body: { name: 'Functions import event', eventDate: '2036-04-05',
    startsAt: '2036-04-05T08:00:00Z', endsAt: '2036-04-05T18:00:00Z', venue: 'Functions hall', capacity: 20 } });
  assert.equal(created.status, 201); const event = (await created.json()).id;
  const category = await request(`events/${event}/categories`, { method: 'POST', body: { name: 'Guest', code: 'GUEST', allocation: 20 } });
  assert.equal(category.status, 201);
  const template = await request(`events/${event}/registration-template`); assert.equal(template.status, 200);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await template.arrayBuffer()));
  const categories = await (await request(`events/${event}/categories`)).json();
  workbook.getWorksheet('Students').getRow(2).values = ['firebase-0001', 'Firebase student', 'firebase-student@example.test', '00123456789'];
  workbook.getWorksheet('Guests').getRow(2).values = ['firebase-0001', 'Firebase guest', 'firebase-guest@example.test', '', categories[0].code, 'Friends'];
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const form = () => { const data = new FormData(); data.set('file', new Blob([bytes]), 'students.xlsx'); return data; };
  const preview = await request(`events/${event}/registration-import/preview`, { method: 'POST', body: form() });
  assert.equal(preview.status, 201); const result = await preview.json(); assert.deepEqual(result.errors, []);
  const key = randomUUID();
  const commit = () => { const data = form(); data.set('previewHash', result.previewHash); data.set('confirmed', 'true'); data.set('requestKey', key); return data; };
  const saved = await request(`events/${event}/registration-import/commit`, { method: 'POST', body: commit() });
  assert.equal(saved.status, 201); const receipt = await saved.json();
  const retry = await request(`events/${event}/registration-import/commit`, { method: 'POST', body: commit() });
  assert.equal(retry.status, 201); assert.deepEqual(await retry.json(), receipt);
});
test('Firebase Functions preserves raw webhook signatures and rejects oversized JSON', async () => {
  const value = { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'synthetic-functions-message' } };
  const id = 'synthetic-functions-event', timestamp = String(Math.floor(Date.now() / 1000));
  const signature = 'v1,' + createHmac('sha256', Buffer.alloc(32, 8)).update(id + '.' + timestamp + '.' + JSON.stringify(value)).digest('base64');
  const headers = { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature };
  assert.equal((await request('email/resend/webhook', { method: 'POST', body: value, headers })).status, 204);
  headers['svix-signature'] = 'v1,invalid';
  assert.equal((await request('email/resend/webhook', { method: 'POST', body: value, headers })).status, 401);
  assert.equal((await request('auth/login', { method: 'POST', body: { payload: 'x'.repeat(1024 * 1024) } })).status, 413);
});
test('Firebase Functions scanner accepts the original legacy QR exactly once', async () => {
  const code = await request('events/7/access-codes', { method: 'POST', body: { name: 'Functions gate', entranceIds: [4], staffIds: [2] } });
  assert.equal(code.status, 201);
  const login = await request('scanner/login', { method: 'POST', body: { username: 'legacy_scanner', password: 'scanner-test-password', eventCode: (await code.json()).code } });
  assert.equal(login.status, 200); const scanner = (await login.json()).token;
  const entrance = await request('scanner/entrance', { method: 'POST', bearer: scanner, body: { entranceId: 4 } });
  assert.equal(entrance.status, 200);
  const body = { qr: 'AAST1.' + 'x'.repeat(43) };
  const one = await request('scanner/checkin', { method: 'POST', bearer: scanner, body });
  const two = await request('scanner/checkin', { method: 'POST', bearer: scanner, body });
  assert.equal((await one.json()).accepted, true); assert.equal((await two.json()).accepted, false);
});
test('Firebase Functions includes the independent scanner static entry point', async () => {
  const response = await fetch(base.replace(/api\/v1\/$/, '') + 'scan/');
  assert.equal(response.status, 200); assert.ok((await response.text()).includes('/scan/assets/'));
});
