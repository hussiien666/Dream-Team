import assert from 'node:assert/strict';
import { firebaseAuth, firebasePasswordToken } from '../dist/auth/firebase-auth.js';
import { digest } from '../dist/common/crypto.util.js';
import { seal } from '../dist/common/encryption.util.js';
import { totp } from '../dist/auth/totp.js';
export function registerFirebaseNativeTests({ test, request, getAuth, getDb, getOrigin }) {
  test('Firebase native enrollment, verified email, MFA, reset, revocation and role boundaries', {
    skip: process.env.RUN_FIREBASE_AUTH_TESTS !== 'true', timeout: 90000,
  }, async () => {
    const before = process.env.FIREBASE_AUTH_NATIVE_ENABLED;
    process.env.FIREBASE_AUTH_NATIVE_ENABLED = 'true';
    const db = getDb(), auth = getAuth(), provider = await firebaseAuth();
    const email = `native-${Date.now()}@example.test`, password = 'native-secure-password', resetPassword = 'native-reset-password';
    const original = await db.user.findUniqueOrThrow({ where: { id: 1 } });
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const user = await db.user.create({ data: { username: `native_${Date.now()}`, displayName: 'Synthetic Native Admin',
      passwordHash: original.passwordHash, role: 'admin', organizationUser: { create: { organizationId: 1, role: 'super_admin' } },
      securityProfile: { create: { factorMethod: 'totp', totpSecret: seal(secret) } } } });
    const rest = async (method, body) => {
      const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=synthetic-emulator-key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const signIn = () => rest('signInWithPassword', { email, password, returnSecureToken: true });
    const oob = async (type) => {
      const response = await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-dream-events/oobCodes');
      assert.equal(response.status, 200); return (await response.json()).oobCodes.filter(c => c.email === email && c.requestType === type).at(-1).oobCode;
    };
    try {
      const login = await auth.login(user.username, 'legacy-test-password');
      const hash = digest(login.accessToken);
      assert.equal((await request('auth/firebase-register', { token: login.accessToken, body: { email, password } })).status, 403);
      await auth.verifyFactor(hash, totp(secret)); const codes = (await auth.regenerateRecovery(hash)).recoveryCodes;
      assert.equal((await request('auth/firebase-register', { token: login.accessToken, body: { email, password } })).status, 200);
      let native = await signIn(); assert.equal(native.status, 200);
      assert.equal((await request('auth/firebase-link', { token: login.accessToken, body: { idToken: native.body.idToken } })).status, 401);
      assert.equal((await request('auth/firebase-login', { body: { idToken: native.body.idToken } })).status, 401);
      assert.equal((await rest('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: native.body.idToken })).status, 200);
      assert.equal((await rest('update', { oobCode: await oob('VERIFY_EMAIL') })).status, 200);
      native = await signIn();
      assert.equal((await request('auth/firebase-link', { token: login.accessToken, body: { idToken: native.body.idToken } })).status, 200);
      assert.equal((await request('auth/me', { token: login.accessToken })).status, 401);
      await assert.rejects(auth.login(user.username, 'legacy-test-password'));
      let signed = await request('auth/firebase-login', { body: { idToken: native.body.idToken } });
      assert.equal(signed.status, 200); assert.equal(signed.body.requiresFactor, true);
      assert.equal((await request('events', { token: signed.body.accessToken })).status, 403);
      await auth.verifyFactor(digest(signed.body.accessToken), codes[0]);
      assert.equal((await request('events', { token: signed.body.accessToken })).status, 200);
      assert.equal((await request('auth/change-password', { token: signed.body.accessToken, body: { currentPassword: password, newPassword: resetPassword } })).status, 400);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, original.passwordHash);
      assert.equal((await rest('sendOobCode', { requestType: 'PASSWORD_RESET', email })).status, 200);
      await new Promise(r => setTimeout(r, 1100));
      assert.equal((await rest('resetPassword', { oobCode: await oob('PASSWORD_RESET'), newPassword: resetPassword })).status, 200);
      assert.equal((await request('events', { token: signed.body.accessToken })).status, 401);
      assert.equal((await signIn()).status, 400);
      native = await rest('signInWithPassword', { email, password: resetPassword, returnSecureToken: true }); assert.equal(native.status, 200);
      const previousKey=process.env.FIREBASE_WEB_API_KEY;
      try{
        process.env.FIREBASE_WEB_API_KEY='synthetic-emulator-key';
        const cliToken=await firebasePasswordToken(email,resetPassword);
        assert.equal((await provider.verifyIdToken(cliToken)).uid,`legacy-${user.id}`);
        await assert.rejects(firebasePasswordToken(email,'incorrect-synthetic-password'),/could not be verified/);
      }finally{if(previousKey===undefined)delete process.env.FIREBASE_WEB_API_KEY;else process.env.FIREBASE_WEB_API_KEY=previousKey;}
      signed = await request('auth/firebase-login', { body: { idToken: native.body.idToken } }); assert.equal(signed.status, 200);
      await auth.verifyFactor(digest(signed.body.accessToken), codes[1]);
      // Role changes are checked live, never trusted from a Firebase token.
      await db.organizationUser.update({ where: { userId: user.id }, data: { role: 'ticket_manager' } });
      assert.equal((await request('auth/me', { token: signed.body.accessToken })).body.role, 'ticket_manager');
      assert.equal((await request('auth/logout', { token: signed.body.accessToken, method: 'POST' })).status, 204);
      assert.equal((await request('auth/me', { token: signed.body.accessToken })).status, 401);
      // A verified but unprovisioned Firebase account has no application access.
      const outsider = await rest('signUp', { email: `outsider-${Date.now()}@example.test`, password, returnSecureToken: true });
      await provider.updateUser(outsider.body.localId, { emailVerified: true });
      const outsiderSignIn = await rest('signInWithPassword', { email: outsider.body.email, password, returnSecureToken: true });
      assert.equal((await request('auth/firebase-login', { body: { idToken: outsiderSignIn.body.idToken } })).status, 401);
      await (await import('./firebase-native.browser.mjs')).runFirebaseNativeBrowser(getOrigin(),email,resetPassword);
    } finally {
      if (before === undefined) delete process.env.FIREBASE_AUTH_NATIVE_ENABLED; else process.env.FIREBASE_AUTH_NATIVE_ENABLED = before;
    }
  });
}
