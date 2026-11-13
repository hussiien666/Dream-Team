import assert from 'node:assert/strict';
import { firebaseAuth } from '../dist/auth/firebase-auth.js';
import { digest } from '../dist/common/crypto.util.js';

export function registerFirebaseAuthTests({ test, request, verifiedLogin, getAuth, getDb, getOrigin }) {
  test('Firebase bridge rejects incomplete MFA and stays disabled by default', async () => {
    const auth = getAuth();
    const pending = await auth.login('legacy_admin', 'legacy-test-password');
    assert.equal((await request('auth/firebase-exchange', { token: pending.accessToken, method: 'POST' })).status, 403);
    const token = await verifiedLogin();
    if (process.env.FIREBASE_AUTH_BRIDGE_ENABLED !== 'true')
      assert.equal((await request('auth/firebase-exchange', { token, method: 'POST' })).status, 503);
  });
  test('Firebase emulator identity preserves password/MFA and live session revocation', {
    skip: process.env.RUN_FIREBASE_AUTH_TESTS !== 'true',
  }, async () => {
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
    const token = await verifiedLogin();
    const db = getDb();
    const before = await db.user.findUnique({ where: { id: 1 } });
    const profile = await db.securityProfile.findUnique({ where: { userId: 1 } });
    const exchange = await request('auth/firebase-exchange', { token, method: 'POST' });
    assert.equal(exchange.status, 200);
    assert.equal(exchange.body.uid, 'legacy-1');
    async function signIn(customToken) {
      const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic-emulator-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      });
      assert.equal(response.status, 200, 'Emulator custom-token sign-in failed');
      return (await response.json()).idToken;
    }
    const identityToken = await signIn(exchange.body.customToken);
    const me = await request('auth/me', { token: identityToken });
    assert.equal(me.status, 200); assert.equal(me.body.user.id, 1);
    assert.equal(me.body.requiresFactor, false);
    assert.equal((await request('events', { token: identityToken })).status, 200);
    assert.equal((await db.user.findUnique({ where: { id: 1 } })).passwordHash, before.passwordHash);
    assert.equal((await db.securityProfile.findUnique({ where: { userId: 1 } })).totpSecret, profile.totpSecret);
    const forgedBinding = await (await firebaseAuth()).createCustomToken('legacy-999999', {
      legacyUserId: 999999, legacySessionHash: digest(token), migrationStage: 'legacy-session-v1',
    });
    assert.equal((await request('events', { token: await signIn(forgedBinding) })).status, 401);
    await (await firebaseAuth()).updateUser('legacy-1', { disabled: true });
    assert.equal((await request('events', { token: identityToken })).status, 401);
    await (await firebaseAuth()).updateUser('legacy-1', { disabled: false });
    assert.equal((await request('auth/logout', { token: identityToken, method: 'POST' })).status, 204);
    assert.equal((await request('events', { token: identityToken })).status, 401);
    assert.equal((await request('events', { token })).status, 401);
  });
  test('Firebase browser uses refreshed identity tokens and preserves deep links and logout', {
    skip: process.env.RUN_FIREBASE_AUTH_TESTS !== 'true', timeout: 90000,
  }, async () => {
    const token = await verifiedLogin();
    const { runFirebaseAuthBrowser } = await import('./firebase-auth.browser.mjs');
    await runFirebaseAuthBrowser(getOrigin(), token);
    await assert.rejects(getAuth().authenticate(token));
  });
}
