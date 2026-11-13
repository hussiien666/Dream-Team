import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnstileService, turnstileConfig } from '../dist/students/turnstile.js';

const enabled = { TURNSTILE_ENABLED: 'true', TURNSTILE_SITE_KEY: 'synthetic-site-key',
  TURNSTILE_SECRET_KEY: 'synthetic-secret-key', TURNSTILE_HOSTNAMES: 'dream-team-peach.vercel.app' };
const success = () => ({ success: true, action: 'public-invitation', hostname: 'dream-team-peach.vercel.app', challenge_ts: new Date().toISOString() });
test('Turnstile configuration rejects unsafe hostnames, missing secrets and production testing keys', () => {
  assert.equal(turnstileConfig({}), undefined);
  assert.throws(() => turnstileConfig({ TURNSTILE_ENABLED: 'yes' }));
  assert.throws(() => turnstileConfig({ ...enabled, TURNSTILE_SECRET_KEY: '' }));
  for (const host of ['*.vercel.app', 'https://dream-team-peach.vercel.app', 'dream-team-peach.vercel.app/path', ''])
    assert.throws(() => turnstileConfig({ ...enabled, TURNSTILE_HOSTNAMES: host }));
  assert.throws(() => turnstileConfig({ ...enabled, NODE_ENV: 'production', TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }));
});

test('Turnstile validates action, exact hostname, freshness and provider result without disclosing secrets', async () => {
  const before = { ...process.env }, original = globalThis.fetch;
  Object.assign(process.env, enabled);
  const service = new TurnstileService();
  try {
    assert.deepEqual(service.publicSettings(), { siteKey: enabled.TURNSTILE_SITE_KEY });
    let calls = 0, reply = success();
    globalThis.fetch = async (url, options) => {
      calls++; assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), { secret: enabled.TURNSTILE_SECRET_KEY, response: 'synthetic-token' });
      return Response.json(reply);
    };
    await assert.rejects(service.verify(undefined), { status: 400 });
    await assert.rejects(service.verify('x'.repeat(2049)), { status: 400 });
    assert.equal(calls, 0);
    await service.verify('synthetic-token');
    for (const changed of [{ success: false }, { success: true, 'error-codes': ['timeout-or-duplicate'], action: 'login' },
      { hostname: 'attacker.example' }, { challenge_ts: new Date(Date.now() - 301000).toISOString() },
      { challenge_ts: new Date(Date.now() + 120000).toISOString() }, { challenge_ts: null }]) {
      reply = { ...success(), ...changed };
      await assert.rejects(service.verify('synthetic-token'), { status: 400 });
    }
    globalThis.fetch = async () => { throw new Error('private-provider-detail'); };
    await assert.rejects(service.verify('synthetic-token'), error => error.status === 503 && !error.message.includes('private-provider-detail'));
    globalThis.fetch = async () => new Response('x'.repeat(16385));
    await assert.rejects(service.verify('synthetic-token'), { status: 503 });
    process.env.TURNSTILE_ENABLED = 'false';
    await service.verify(undefined);
  } finally { process.env = before; globalThis.fetch = original; }
});
