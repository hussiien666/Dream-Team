import React, { useState } from "react";
import { Client } from "./api";
import type { Identity } from "./types";
import { Field, Notice, useAction } from "./ui";
export function AuthScreen({
  api,
  identity,
  onToken,
  reload,
  signedOut,
}: {
  api: Client;
  identity?: Identity;
  onToken: (token: string) => void;
  reload: () => Promise<void>;
  signedOut: () => void;
}) {
  const a = useAction();
  const native = import.meta.env.VITE_FIREBASE_AUTH_NATIVE === "true";
  const [loginName, setLoginName] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [enrollment, setEnrollment] = useState<{
    secret: string;
    qrPng: string;
  }>();
  const [codes, setCodes] = useState<string[]>();
  function submit(
    e: React.FormEvent<HTMLFormElement>,
    task: (data: FormData) => Promise<void>,
  ) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void a.run(() => task(data));
  }
  return (
    <main className="auth">
      <div className="brand">Dream Events</div>
      <section className="auth-panel">
        <h1>
          {!identity
            ? "Administrator sign in"
            : identity.requiresPasswordChange
              ? "Change temporary password"
              : "Verify your account"}
        </h1>
        <Notice error={a.error} />
        {authMessage && <p role="status">{authMessage}</p>}
        {codes ? (
          <>
            <p>Save these recovery codes privately. Each code works once.</p>
            <pre>{codes.join("\n")}</pre>
            <button
              className="primary"
              onClick={() => {
                setCodes(undefined);
                void reload();
              }}
            >
              I saved my recovery codes
            </button>
          </>
        ) : !identity ? (
          <form
            onSubmit={(e) =>
              submit(e, async (d) => {
                const name = String(d.get("username") ?? "");
                const nativeToken = native && name.includes("@") ? await (await import("./firebase-auth")).nativeFirebaseSignIn(name, String(d.get("password"))) : null;
                const result = await api.request<{ accessToken: string }>(
                  nativeToken ? "auth/firebase-login" : "auth/login",
                  "POST",
                  nativeToken ? { idToken: nativeToken.idToken } : { username: name, password: d.get("password") },
                );
                onToken(result.accessToken);
              })
            }
          >
            <Field label={native ? "Email or legacy username" : "Username"}>
              <input
                name="username"
                autoComplete="username"
                maxLength={native ? 254 : 80}
                value={loginName}
                onChange={e => setLoginName(e.target.value)}
                required
              />
            </Field>
            <Field label="Password">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={256}
                required
              />
            </Field>
            <button className="primary" disabled={a.busy}>
              {a.busy ? "Signing in..." : "Sign in"}
            </button>
            {native && <button type="button" disabled={a.busy || !loginName.includes("@")} onClick={() => void a.run(async () => {
              await (await import("./firebase-auth")).resetFirebasePassword(loginName);
              setAuthMessage("If this email is registered, Firebase will send password reset instructions.");
            })}>Forgot password</button>}
          </form>
        ) : identity.requiresPasswordChange ? (
          <form
            onSubmit={(e) =>
              submit(e, async (d) => {
                if (d.get("newPassword") !== d.get("confirm"))
                  throw new Error("The new passwords do not match.");
                await api.request("auth/change-password", "POST", {
                  currentPassword: d.get("currentPassword"),
                  newPassword: d.get("newPassword"),
                });
                signedOut();
              })
            }
          >
            <Field label="Temporary password">
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password">
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
              />
            </Field>
            <button className="primary" disabled={a.busy}>
              Change password and sign in again
            </button>
          </form>
        ) : !identity.enrolled ? (
          <>
            <p>Super Admin accounts require two-step verification.</p>
            {!enrollment ? (
              <button
                className="primary"
                disabled={a.busy}
                onClick={() =>
                  a.run(async () =>
                    setEnrollment(await api.request("auth/totp/begin", "POST")),
                  )
                }
              >
                Set up authenticator
              </button>
            ) : (
              <>
                <img
                  alt="Authenticator setup QR"
                  width="230"
                  height="230"
                  src={"data:image/png;base64," + enrollment.qrPng}
                />
                <p>Or enter this setup key in your authenticator:</p>
                <code className="secret">{enrollment.secret}</code>
                <form
                  onSubmit={(e) =>
                    submit(e, async (d) => {
                      const r = await api.request<{ recoveryCodes: string[] }>(
                        "auth/totp/finish",
                        "POST",
                        { code: d.get("code") },
                      );
                      setEnrollment(undefined);
                      setCodes(r.recoveryCodes);
                    })
                  }
                >
                  <Field label="Authenticator code">
                    <input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      required
                    />
                  </Field>
                  <button className="primary" disabled={a.busy}>
                    Enable authenticator
                  </button>
                </form>
              </>
            )}
          </>
        ) : (
          <form
            onSubmit={(e) =>
              submit(e, async (d) => {
                await api.request("auth/factor/verify", "POST", {
                  code: d.get("code"),
                });
                await reload();
              })
            }
          >
            <p>Enter an authenticator code or an unused recovery code.</p>
            <Field label="Verification code">
              <input
                name="code"
                autoComplete="one-time-code"
                maxLength={32}
                required
                autoFocus
              />
            </Field>
            <button className="primary" disabled={a.busy}>
              Verify
            </button>
          </form>
        )}
        {identity && !codes && (
          <button
            className="quiet"
            disabled={a.busy}
            onClick={() =>
              a.run(async () => {
                await api.request("auth/logout", "POST");
                signedOut();
              })
            }
          >
            Return to sign in
          </button>
        )}
      </section>
    </main>
  );
}
