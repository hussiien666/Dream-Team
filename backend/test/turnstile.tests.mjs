import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export function registerTurnstileTests({ test, adminRequest: api, getOrigin, getDb, eventInput }) {
  test('public invitations require server-verified Turnstile at the direct API and keep atomic retry receipts', async () => {
    const ok = (r, status = 201) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
    const event = ok(await api('events', { body: { ...eventInput, status: 'Published', name: 'Synthetic Turnstile event', capacity: 20 } }));
    const base = `events/${event.id}`;
    const category = ok(await api(base + '/categories', { body: { name: 'Guests', code: 'TURNSTILE', allocation: 20 } }));
    const student = ok(await api(base + '/students', { body: { studentId: 'BOTCHECK1', fullName: 'Synthetic sender', email: 'sender@example.test' } }));
    const link = ok(await api(base + `/students/${student.id}/invitation-links`, { body: { confirmed: true, reason: 'Synthetic protection verification' } }));
    const token = link.path.split('#')[1];
    const before = { ...process.env }, nativeFetch = globalThis.fetch;
    Object.assign(process.env, { TURNSTILE_ENABLED: 'true', TURNSTILE_SITE_KEY: 'synthetic-site-key',
      TURNSTILE_SECRET_KEY: 'synthetic-secret-key', TURNSTILE_HOSTNAMES: 'dream-team-peach.vercel.app' });
    let accepted = false, verifications = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url) !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return nativeFetch(url, options);
      verifications++;
      return Response.json({ success: accepted, action: 'public-invitation', hostname: 'dream-team-peach.vercel.app', challenge_ts: new Date().toISOString() });
    };
    const operation = { action: 'add', requestKey: randomUUID(), confirmed: true,
      guest: { fullName: 'Protected synthetic guest', email: 'guest@example.test', categoryId: category.id } };
    const post = challenge => nativeFetch(getOrigin() + '/api/v1/public/invitations', { method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(challenge ? { 'X-Turnstile-Token': challenge } : {}) },
      body: JSON.stringify(operation) });
    try {
      const view = await nativeFetch(getOrigin() + '/api/v1/public/invitations', { headers: { Authorization: 'Bearer ' + token } });
      const data = await view.json(); assert.deepEqual(data.turnstile, { siteKey: 'synthetic-site-key' });
      assert.equal(JSON.stringify(data).includes('synthetic-secret-key'), false);
      const count = await getDb().guestInvitation.count({ where: { eventId: event.id } });
      assert.equal((await post()).status, 400); assert.equal(verifications, 0);
      assert.equal((await post('synthetic-rejected')).status, 400);
      assert.equal(await getDb().guestInvitation.count({ where: { eventId: event.id } }), count);
      accepted = true;
      const committed = await post('synthetic-accepted'); assert.equal(committed.status, 200); const result = await committed.json();
      const retried = await post('synthetic-fresh-challenge'); assert.equal(retried.status, 200);
      assert.deepEqual(await retried.json(), result);
      assert.equal(await getDb().guestInvitation.count({ where: { eventId: event.id } }), count + 1);
    } finally { globalThis.fetch = nativeFetch; process.env = before; }
  });
}
