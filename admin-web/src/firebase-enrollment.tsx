import { useState } from "react";
import type { Client } from "./api";
import type { Identity } from "./types";
import { Field, Notice, useAction } from "./ui";
export function FirebaseEnrollment({ api, identity, logout }: { api: Client; identity: Identity; logout: () => void }) {
  const a = useAction();
  const [message, setMessage] = useState("");
  if (import.meta.env.VITE_FIREBASE_AUTH_NATIVE !== "true") return null;
  return <section className="plain-section"><h2>Firebase account</h2><Notice error={a.error} />
    {message && <p role="status">{message}</p>}
    {identity.authProvider === "firebase" ? <>
      <p>Sign in with {identity.email}. Existing account verification and permissions remain enforced.</p>
      <button disabled={a.busy} onClick={() => void a.run(async () => {
        await (await import("./firebase-auth")).resetFirebasePassword(identity.email!);
        setMessage("Firebase will send password reset instructions. Existing sessions expire after reset.");
      })}>Send password reset email</button>
    </> : <form className="settings-form" onSubmit={e => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      void a.run(async () => {
        const email = String(data.get("email")), password = String(data.get("password"));
        await api.request("auth/firebase-register", "POST", { email, password });
        const result = await (await import("./firebase-auth")).nativeFirebaseSignIn(email, password);
        if (result.verified) {
          await api.request("auth/firebase-link", "POST", { idToken: result.idToken }); logout();
        } else {
          await (await import("./firebase-auth")).nativeFirebaseSignIn(email, password, true);
          setMessage("Open the Firebase verification email, then submit this form again to activate email sign-in. Activation signs out existing sessions.");
        }
      });
    }}>
      <p>Enroll this existing account for email sign-in. After activation, use this email and password instead of the legacy username.</p>
      <Field label="Account email"><input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={identity.email} /></Field>
      <Field label="Firebase password"><input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></Field>
      <button disabled={a.busy}>Enroll or activate email sign-in</button>
    </form>}
  </section>;
}
