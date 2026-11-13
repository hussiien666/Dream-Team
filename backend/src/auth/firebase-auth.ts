import { ServiceUnavailableException } from '@nestjs/common';

/** Transitional identity only: every API call still checks its live legacy session. */
export async function firebaseAuth() {
  if (process.env.FIREBASE_AUTH_BRIDGE_ENABLED !== 'true' && process.env.FIREBASE_AUTH_NATIVE_ENABLED !== 'true')
    throw new ServiceUnavailableException('Firebase sign-in transition is not enabled.');
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))
    throw new ServiceUnavailableException('Configure a Firebase project ID.');
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator && (process.env.NODE_ENV === 'production' ||
      !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(emulator)))
    throw new ServiceUnavailableException('Authentication emulator must be local and non-production.');
  const [{ applicationDefault, getApps, initializeApp }, { getAuth }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/auth'),
  ]);
  const name = `dream-events-${projectId}`;
  const app = getApps().find(a => a.name === name) ?? initializeApp({
    projectId,
    ...(emulator ? {} : { credential: applicationDefault() }),
  }, name);
  return getAuth(app);
}

export async function firebaseSession(token: string) {
  if (process.env.FIREBASE_AUTH_BRIDGE_ENABLED !== 'true') throw new Error('Transition bridge is disabled.');
  if (token.length > 8192) throw new Error('Invalid identity.');
  const decoded = await (await firebaseAuth()).verifyIdToken(token, true);
  if (decoded.migrationStage !== 'legacy-session-v1' ||
      !Number.isSafeInteger(decoded.legacyUserId) || decoded.legacyUserId <= 0 ||
      decoded.uid !== `legacy-${decoded.legacyUserId}` ||
      typeof decoded.legacySessionHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(decoded.legacySessionHash))
    throw new Error('Invalid transition identity.');
  return { userId: decoded.legacyUserId as number, hash: decoded.legacySessionHash };
}

export async function nativeFirebaseIdentity(token: string) {
  if (process.env.FIREBASE_AUTH_NATIVE_ENABLED !== 'true' || token.length > 8192) throw new Error('Native sign-in is disabled.');
  const auth = await firebaseAuth();
  const decoded = await auth.verifyIdToken(token, true);
  const now = Date.now() / 1000;
  if (decoded.firebase.sign_in_provider !== 'password' || !decoded.email_verified || !decoded.email ||
      !Number.isSafeInteger(decoded.auth_time) || decoded.auth_time > now + 30 || decoded.auth_time < now - 300)
    throw new Error('Use a recent verified Firebase password sign-in.');
  return { uid: decoded.uid, email: decoded.email.toLowerCase(), authTime: decoded.auth_time };
}

export async function verifyNativeSession(uid: string, authTime: number) {
  const user = await (await firebaseAuth()).getUser(uid);
  if (user.disabled || !user.emailVerified || (user.tokensValidAfterTime && Date.parse(user.tokensValidAfterTime) / 1000 > authTime))
    throw new Error('Firebase session was revoked.');
}

/** Interactive operator CLI only. Firebase handles password verification and lockout. */
export async function firebasePasswordToken(email: string, password: string) {
  if (process.env.FIREBASE_AUTH_NATIVE_ENABLED !== 'true') throw new Error('Native sign-in is disabled.');
  await firebaseAuth(); // Enforce project/emulator restrictions before forwarding credentials.
  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!key || key.length > 200) throw new Error('Configure the public Firebase Web API key for native CLI sign-in.');
  const origin = process.env.FIREBASE_AUTH_EMULATOR_HOST
    ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const response = await fetch(`${origin}/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, {
    method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000),
    body:JSON.stringify({email,password,returnSecureToken:true}),
  }).catch(()=>null);
  if (!response?.ok) throw new Error('Firebase sign-in could not be verified.');
  const value=await response.json().catch(()=>null) as {idToken?:string}|null;
  if (!value?.idToken) throw new Error('Firebase sign-in could not be verified.');
  return value.idToken;
}
