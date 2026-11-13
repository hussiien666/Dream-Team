import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, inMemoryPersistence, setPersistence,
  signInWithCustomToken, signOut, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail } from "firebase/auth";

/** Loaded only when explicitly enabled; private tokens stay in SDK memory. */
async function configuredAuth(expectedProject?: string) {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  if (!projectId || (expectedProject && projectId !== expectedProject) || !apiKey || !authDomain)
    throw new Error("Firebase sign-in configuration does not match this server.");
  const name = "dream-events-admin";
  const app = getApps().find(a => a.name === name) ?? initializeApp({ projectId, apiKey, authDomain }, name);
  const auth = getAuth(app);
  const emulator = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL;
  if (emulator) {
    if (import.meta.env.PROD || !["localhost", "127.0.0.1"].includes(location.hostname) ||
        !/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(emulator))
      throw new Error("Firebase emulator is allowed only in local development.");
    if (!auth.emulatorConfig) connectAuthEmulator(auth, emulator, { disableWarnings: true });
  }
  await setPersistence(auth, inMemoryPersistence);
  return auth;
}
export async function nativeFirebaseSignIn(email: string, password: string, verify = false) {
  if (import.meta.env.VITE_FIREBASE_AUTH_NATIVE !== "true") throw new Error("Firebase sign-in is not enabled.");
  const auth = await configuredAuth();
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (verify) await sendEmailVerification(credential.user);
    return { idToken: await credential.user.getIdToken(true), verified: credential.user.emailVerified };
  } catch { throw new Error("Sign-in or verification could not complete. Check your credentials and email verification."); }
  finally { await signOut(auth); }
}
export async function resetFirebasePassword(email: string) {
  if (import.meta.env.VITE_FIREBASE_AUTH_NATIVE !== "true") throw new Error("Firebase sign-in is not enabled.");
  const auth = await configuredAuth();
  try { await sendPasswordResetEmail(auth, email); }
  catch (error) {
    // Avoid account enumeration; operational/network failures still surface.
    if ((error as {code?: string}).code !== "auth/user-not-found")
      throw new Error("The reset request could not complete. Try again later.");
  }
}
export async function exchangeFirebase(customToken: string, expectedProject: string) {
  const auth = await configuredAuth(expectedProject);
  const credential = await signInWithCustomToken(auth, customToken);
  return {
    bearer: async () => {
      try { return await credential.user.getIdToken(); }
      catch { throw new Error("Firebase sign-in could not be refreshed. Sign in again."); }
    },
    dispose: () => signOut(auth),
  };
}
