import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  lazy,
  Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import { Client } from "./api";
import type { EventRecord, Identity } from "./types";
import { AuthScreen } from "./auth";
import { FirebaseEnrollment } from "./firebase-enrollment";
import {
  Confirm,
  Field,
  Link,
  Loading,
  Notice,
  Empty,
  useAction,
  useResource,
  navigate,
} from "./ui";
import "./style.css";
const EventsPage = lazy(() => import("./events").then(m => ({ default: m.EventsPage })));
const Dashboard = lazy(() => import("./events").then(m => ({ default: m.Dashboard })));
const EventSettings = lazy(() => import("./events").then(m => ({ default: m.EventSettings })));
const AccessPage = lazy(() => import("./access").then(m => ({ default: m.AccessPage })));
const StudentsPage = lazy(() => import("./students").then(m => ({ default: m.StudentsPage })));
const TicketsPage = lazy(() => import("./tickets").then(m => ({ default: m.TicketsPage })));
const TemplatesPage = lazy(() => import("./templates").then(m => ({ default: m.TemplatesPage })));
const ReportsPage = lazy(() => import("./reports").then(m => ({ default: m.ReportsPage })));
const Announcements = lazy(() => import("./announcements").then(m => ({ default: m.Announcements })));
const Attendees = lazy(() => import("./attendees").then(m => ({ default: m.Attendees })));
const OrganizationAudit = lazy(() => import("./organization-audit").then(m => ({ default: m.OrganizationAudit })));
const PublicInvitationPage = lazy(() => import("./invitations").then(m => ({ default: m.PublicInvitationPage })));
const MobileTicketPage = lazy(() => import("./mobile-ticket").then(m => ({ default: m.MobileTicketPage })));
const tokenKey = "dream-events-admin-token";
function Account({
  api,
  identity,
  logout,
}: {
  api: Client;
  identity: Identity;
  logout: () => void;
}) {
  const a = useAction(),
    [codes, setCodes] = useState<string[]>(),
    [replace, setReplace] = useState(false);
  return (
    <>
      <h1>Account security</h1>
      <p>
        {identity.user.displayName} ({identity.user.username})
      </p>
      <Notice error={a.error} />
      <FirebaseEnrollment api={api} identity={identity} logout={logout} />
      {identity.authProvider !== "firebase" && <section className="plain-section">
        <h2>Change password</h2>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void a.run(async () => {
              if (d.get("newPassword") !== d.get("confirm"))
                throw new Error("The passwords do not match.");
              await api.request("auth/change-password", "POST", {
                currentPassword: d.get("currentPassword"),
                newPassword: d.get("newPassword"),
              });
              logout();
            });
          }}
        >
          <Field label="Current password">
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New password">
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
          </Field>
          <Field label="Confirm new password">
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
          </Field>
          <button className="primary" disabled={a.busy}>
            Save and sign in again
          </button>
        </form>
      </section>}
      {identity.role === "super_admin" && (
        <section className="plain-section">
          <h2>Recovery codes</h2>
          <p>
            Generate new recovery codes if the old ones are lost or have been
            used.
          </p>
          <button onClick={() => setReplace(true)}>
            Replace recovery codes
          </button>
          {codes && (
            <>
              <p>Save these codes privately. Each works once.</p>
              <pre>{codes.join("\n")}</pre>
              <button onClick={() => setCodes(undefined)}>
                I saved my recovery codes
              </button>
            </>
          )}
        </section>
      )}
      {replace && (
        <Confirm
          title="Replace recovery codes"
          description="Invalidate every previous recovery code and create a new set?"
          close={() => setReplace(false)}
          act={async () => {
            const r = await api.request<{ recoveryCodes: string[] }>(
              "auth/recovery/regenerate",
              "POST",
            );
            setCodes(r.recoveryCodes);
          }}
        />
      )}
    </>
  );
}
function Workspace({
  api,
  identity,
  logout,
}: {
  api: Client;
  identity: Identity;
  logout: () => void;
}) {
  const events = useResource<EventRecord[]>(api, "events"),
    [path, setPath] = useState(location.pathname),
    [selected, setSelected] = useState<number>(),
    [signout, setSignout] = useState(false);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const match = path.match(
    /^\/events\/(\d+)\/(dashboard|settings|access|students|tickets|templates|reports|announcements|attendees)\/?$/,
  );
  const requested = match ? Number(match[1]) : selected;
  const event =
    events.data?.find((e) => e.id === requested) ??
    (!match ? events.data?.[0] : undefined);
  const link = (name: string, to: string) => (
    <Link key={to} to={to} aria-current={path === to ? "page" : undefined}>
      {name}
    </Link>
  );
  return (
    <div className="shell">
      <aside>
        <Link className="brand" to="/events">
          Dream Events
        </Link>
        <p className="organization">Event administration</p>
        <nav aria-label="Main navigation">
          {link("Events", "/events")}
          {event && (
            <>
              {link("Event dashboard", `/events/${event.id}/dashboard`)}
              {link("Event settings", `/events/${event.id}/settings`)}
              {identity.permissions.includes("events.manage") && link("Announcements", `/events/${event.id}/announcements`)}
              {identity.permissions.includes("attendees.manage") &&
                link("Students & Invitations", `/events/${event.id}/students`)}
              {identity.permissions.includes("attendees.manage") && link("Independent attendees", `/events/${event.id}/attendees`)}
              {identity.permissions.includes("tickets.manage") &&
                link("Tickets", `/events/${event.id}/tickets`)}
              {identity.permissions.includes("tickets.manage") &&
                link("Ticket templates", `/events/${event.id}/templates`)}
              {identity.permissions.includes("access.manage") &&
                link("Entrances & staff", `/events/${event.id}/access`)}
              {identity.permissions.includes("reports.view") &&
                link("Reports", `/events/${event.id}/reports`)}
            </>
          )}
          {link("Account security", "/account")}
          {identity.role === "super_admin" && link("Audit history", "/audit")}
        </nav>
        <div className="account">
          <strong>{identity.user.displayName}</strong>
          <span>{identity.role.replaceAll("_", " ")}</span>
          <button onClick={() => setSignout(true)}>Sign out</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Administration</span>
          {events.data && events.refreshing && <span role="status">Refreshing events…</span>}
          {!!events.data?.length && (
            <label>
              Selected event
              <select
                aria-label="Selected event"
                value={event?.id ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSelected(id);
                  if (match) navigate(`/events/${id}/${match[2]}`);
                }}
              >
                {!event && <option value="">Choose event</option>}
                {events.data.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                    {e.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        <main className="content">
          <Notice error={events.error} />
          {path === "/audit" ? (
            identity.role === "super_admin" ? <OrganizationAudit api={api}/> : <Empty>You do not have access to this section.</Empty>
          ) : path === "/account" ? (
            <Account api={api} identity={identity} logout={logout} />
          ) : path === "/" || path === "/events" || path === "/events/" ? (
            <EventsPage api={api} identity={identity} refresh={events.reload} />
          ) : events.loading ? (
            <Loading />
          ) : match && event ? (
            match[2] === "dashboard" ? (
              <Dashboard key={event.id} api={api} event={event} />
            ) : match[2] === "settings" ? (
              <EventSettings
                key={event.id}
                api={api}
                event={event}
                identity={identity}
                refresh={events.reload}
              />
            ) : match[2] === "templates" ? (
              identity.permissions.includes("tickets.manage") ? (
                <TemplatesPage key={event.id} api={api} event={event} />
              ) : (
                <Empty>You do not have access to this section.</Empty>
              )
            ) : match[2] === "attendees" ? (
              identity.permissions.includes("attendees.manage") ? <Attendees key={event.id} api={api} event={event} /> : <Empty>You do not have access to this section.</Empty>
            ) : match[2] === "announcements" ? (
              identity.permissions.includes("events.manage") ? <Announcements key={event.id} api={api} event={event} /> : <Empty>You do not have access to this section.</Empty>
            ) : match[2] === "reports" ? (
              identity.permissions.includes("reports.view") ? (
                <ReportsPage key={event.id} api={api} event={event} identity={identity} />
              ) : (
                <Empty>You do not have access to this section.</Empty>
              )
            ) : match[2] === "tickets" ? (
              identity.permissions.includes("tickets.manage") ? (
                <TicketsPage
                  key={event.id}
                  api={api}
                  event={event}
                  isSuperAdmin={identity.role === "super_admin"}
                />
              ) : (
                <Empty>You do not have access to this section.</Empty>
              )
            ) : match[2] === "students" ? (
              identity.permissions.includes("attendees.manage") ? (
                <StudentsPage
                  key={event.id}
                  api={api}
                  event={event}
                  identity={identity}
                />
              ) : (
                <Empty>You do not have access to this section.</Empty>
              )
            ) : identity.permissions.includes("access.manage") ? (
              <AccessPage
                key={event.id}
                api={api}
                event={event}
                identity={identity}
                refresh={events.reload}
              />
            ) : (
              <Empty>You do not have access to this section.</Empty>
            )
          ) : (
            <>
              <h1>Page unavailable</h1>
              <p>
                The event may be unavailable or outside your assigned events.
              </p>
              <Link to="/events">Return to events</Link>
            </>
          )}
        </main>
      </div>
      {signout && (
        <Confirm
          title="Sign out"
          description="End your current administration session?"
          close={() => setSignout(false)}
          act={async () => {
            await api.request("auth/logout", "POST");
            logout();
          }}
        />
      )}
    </div>
  );
}
function App() {
  const [token, setToken] = useState(
      () => sessionStorage.getItem(tokenKey) ?? "",
    ),
    [identity, setIdentity] = useState<Identity>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const currentToken = useRef(token);
  const currentClient = useRef<Client | undefined>(undefined);
  const firebaseDispose = useRef<(() => Promise<void>) | undefined>(undefined);
  currentToken.current = token;
  const signedOut = useCallback(() => {
    currentClient.current?.clearResources();
    void firebaseDispose.current?.();
    firebaseDispose.current = undefined;
    currentToken.current = "";
    setLoading(false);
    sessionStorage.removeItem(tokenKey);
    setToken("");
    setIdentity(undefined);
    setError("");
    navigate("/events");
  }, []);
  const api = useMemo(
    () =>
      new Client(import.meta.env.VITE_API_URL ?? "", token, () => {
        if (currentToken.current !== token) return;
        signedOut();
        setError("Your session expired. Sign in again.");
      }),
    [token, signedOut],
  );
  currentClient.current = api;
  useEffect(() => () => api.clearResources(), [api]);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.request<Identity>("auth/me");
      if (import.meta.env.VITE_FIREBASE_AUTH_BRIDGE === "true" &&
          !result.requiresFactor && !result.requiresPasswordChange) {
        const transition = await api.request<{ customToken: string; projectId: string }>("auth/firebase-exchange", "POST");
        if (currentToken.current !== token) return;
        const { exchangeFirebase } = await import("./firebase-auth");
        const firebase = await exchangeFirebase(transition.customToken, transition.projectId);
        if (currentToken.current !== token) { await firebase.dispose(); return; }
        firebaseDispose.current = firebase.dispose;
        api.setBearerProvider(firebase.bearer);
      }
      if (currentToken.current === token) {
        // A live permission/organization change invalidates every private view.
        api.clearResources();
        setIdentity(result);
      }
    } catch (e) {
      if (currentToken.current === token)
        setError(
          e instanceof Error ? e.message : "The server could not be reached.",
        );
    } finally {
      if (currentToken.current === token) setLoading(false);
    }
  }, [api, token]);
  useEffect(() => {
    if (token) void reload();
  }, [token, reload]);
  const save = (value: string) => {
    currentToken.current = value;
    sessionStorage.setItem(tokenKey, value);
    setToken(value);
    setIdentity(undefined);
  };
  if (loading || (token && !identity && !error))
    return (
      <main className="auth">
        <div className="brand">Dream Events</div>
        <Loading />
      </main>
    );
  if (token && !identity && error)
    return (
      <main className="auth">
        <h1>Connection unavailable</h1>
        <Notice error={error} />
        <button onClick={() => void reload()}>Try again</button>
        <button onClick={signedOut}>Return to sign in</button>
      </main>
    );
  if (!identity || identity.requiresFactor || identity.requiresPasswordChange)
    return (
      <>
        <Notice error={error} />
        <AuthScreen
          api={api}
          identity={identity}
          onToken={save}
          reload={reload}
          signedOut={signedOut}
        />
      </>
    );
  return <Workspace key={JSON.stringify([identity.user.id, identity.organizationId, identity.role, identity.permissions])} api={api} identity={identity} logout={signedOut} />;
}
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="auth">
        <h1>Dream Events</h1>
        <p>
          The page could not be loaded. Check the application configuration or
          refresh.
        </p>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <Suspense fallback={<main className="auth"><Loading /></main>}>
    {location.pathname === "/invitation" ? (
      <PublicInvitationPage />
    ) : location.pathname === "/ticket" ? (
      <MobileTicketPage />
    ) : (
      <App />
    )}
    </Suspense>
  </ErrorBoundary>,
);
