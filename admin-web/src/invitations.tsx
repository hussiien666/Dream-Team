import { useMemo, useState } from "react";
import { Client } from "./api";
import { Dialog, Field, Notice, Loading, useAction, useResource } from "./ui";
import { TurnstileChallenge } from './turnstile';

export function InvitationLinkDialog({
  api,
  eventId,
  student,
  close,
}: {
  api: Client;
  eventId: number;
  student: { id: number; fullName: string; email?: string };
  close: () => void;
}) {
  const base = `events/${eventId}/students/${student.id}/invitation-links`;
  const data = useResource<
    { id: number; expiresAt: string; revokedAt: string | null }[]
  >(api, base);
  const a = useAction();
  const [sendEmail, setSendEmail] = useState(false), [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [url, setUrl] = useState(""),
    [message, setMessage] = useState("");
  return (
    <Dialog title="Personal invitation link" close={close}>
      <p>{student.fullName}</p>
      <Notice error={a.error || data.error} />
      <p role="status">{message}</p>
      <p>
        This link lets the student add and cancel their own guests until event
        end. Registration deadlines still apply. Share it privately.
      </p>
      <p>
        {data.data?.filter(
          (l) => !l.revokedAt && new Date(l.expiresAt) > new Date(),
        ).length ?? 0}{" "}
        active links.
      </p>
      <Field label="Link action reason">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={1000}
        />
      </Field>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I confirm that existing links will stop working
      </label>
      <div className="actions">
        {student.email && <label><input type="checkbox" checked={sendEmail} onChange={e => { setSendEmail(e.target.checked); setRequestKey(crypto.randomUUID()); }} />Queue the private link to {student.email}</label>}
        <button
          disabled={a.busy || !confirmed || reason.trim().length < 5}
          onClick={() =>
            void a.run(async () => {
              const r = await api.request<{ path: string }>(base, "POST", {
                confirmed: true,
                reason,
                email: sendEmail,
                requestKey,
              });
              setUrl(new URL(r.path, location.origin).href);
              setMessage(
                "Link created. Copy it now; it cannot be retrieved later.",
              );
              data.reload();
              setRequestKey(crypto.randomUUID());
            })
          }
        >
          Create replacement link
        </button>
        <button
          disabled={a.busy || !confirmed || reason.trim().length < 5}
          onClick={() =>
            void a.run(async () => {
              await api.request(base + "/revoke", "POST", {
                confirmed: true,
                reason,
              });
              setUrl("");
              setMessage("All links revoked.");
              data.reload();
            })
          }
        >
          Revoke all links
        </button>
      </div>
      {url && (
        <>
          <Field label="Private invitation URL">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>
          <button
            onClick={() =>
              void a.run(async () => {
                await navigator.clipboard.writeText(url);
                setMessage("Link copied.");
              })
            }
          >
            Copy link
          </button>
          <a href={url} target="_blank" rel="noreferrer">
            Open invitation page
          </a>
        </>
      )}
    </Dialog>
  );
}
type Definition = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
};
type View = {
  turnstile: { siteKey: string } | null;
  event: {
    name: string;
    venue: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
  };
  studentName: string;
  guestLimit: number;
  defaultCategoryId: number | null;
  canAdd: boolean;
  categories: { id: number; name: string }[];
  fields: Definition[];
  guests: {
    id: number;
    active: boolean;
    attendee: {
      fullName: string;
      category: { name: string };
      tickets: { status: string }[];
    };
  }[];
};
export function PublicInvitationPage() {
  const api = useMemo(
    () =>
      new Client(import.meta.env.VITE_API_URL || "", location.hash.slice(1)),
    [],
  );
  const data = useResource<View>(api, "public/invitations"),
    a = useAction();
  const [adding, setAdding] = useState(false),
    [cancel, setCancel] = useState<number>(),
    [message, setMessage] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID());
  const [challenge, setChallenge] = useState(''), [challengeVersion, setChallengeVersion] = useState(0);
  const submit = async (body: unknown) => {
    try {
      await api.request('public/invitations', 'POST', body, undefined, false,
        challenge ? { 'X-Turnstile-Token': challenge } : undefined);
    } finally {
      setChallenge(''); setChallengeVersion(n => n + 1);
    }
  };
  return (
    <main className="auth public-invitation">
      <h1>Dream Events · Invitation</h1>
      <Notice error={data.error || a.error} />
      <p role="status">{message}</p>
      {data.loading ? (
        <Loading />
      ) : data.data ? (
        <>
          <h2>{data.data.event.name}</h2>
          <p>
            {data.data.event.venue} ·{" "}
            {new Date(data.data.event.startsAt).toLocaleString(undefined, {
              timeZone: data.data.event.timezone,
            })}
          </p>
          <p>
            Invitation for {data.data.studentName}.{" "}
            {data.data.guests.filter((g) => g.active).length} active guests;
            your limit is {data.data.guestLimit}.
          </p>
          <p>Keep this link private. Tickets are distributed separately.</p>
          {!data.data.canAdd && (
            <p className="notice">
              Registration has closed. Existing invitations may still be
              cancelled until event end.
            </p>
          )}
          <button
            disabled={!data.data.canAdd || a.busy}
            onClick={() => {
              setAdding(true);
              setChallenge('');
              setKey(crypto.randomUUID());
            }}
          >
            Add guest
          </button>
          {!data.data.guests.length ? (
            <p>No guests added yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.guests.map((g) => (
                    <tr key={g.id}>
                      <th>{g.attendee.fullName}</th>
                      <td>{g.attendee.category.name}</td>
                      <td>
                        {!g.active
                          ? "Cancelled"
                          : g.attendee.tickets.some((t) => t.status === "Used")
                            ? "Checked in"
                            : "Active"}
                      </td>
                      <td>
                        <button
                          disabled={!g.active || a.busy}
                          onClick={() => {
                            setCancel(g.id);
                            setChallenge('');
                            setKey(crypto.randomUUID());
                          }}
                        >
                          Cancel invitation
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {adding && (
            <Dialog
              title="Add invited guest"
              close={() => !a.busy && setAdding(false)}
            >
              <Notice error={a.error} />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const customValues: Record<string, unknown> = {};
                  for (const f of data.data!.fields) {
                    const v = fd.get("field_" + f.key);
                    customValues[f.key] =
                      f.type === "checkbox"
                        ? v === "on"
                        : v === ""
                          ? null
                          : f.type === "number"
                            ? Number(v)
                            : v;
                  }
                  void a.run(async () => {
                    await submit({
                      action: "add",
                      requestKey: key,
                      confirmed: true,
                      guest: {
                        fullName: fd.get("fullName"),
                        email: fd.get("email"),
                        phone: fd.get("phone"),
                        categoryId: Number(fd.get("categoryId")),
                        customValues,
                      },
                    });
                    setAdding(false);
                    setMessage("Guest added.");
                    data.reload();
                  });
                }}
              >
                <Field label="Guest name">
                  <input name="fullName" required maxLength={200} />
                </Field>
                <Field label="Guest email">
                  <input name="email" type="email" maxLength={254} />
                </Field>
                <Field label="Guest phone">
                  <input name="phone" type="tel" maxLength={40} />
                </Field>
                <Field label="Ticket category">
                  <select
                    aria-label="Ticket category"
                    name="categoryId"
                    required
                    defaultValue={data.data.defaultCategoryId ?? ""}
                  >
                    <option value="" disabled>
                      Select category
                    </option>
                    {data.data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {data.data.fields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    {f.type === "dropdown" ? (
                      <select
                        aria-label={f.label}
                        name={"field_" + f.key}
                        required={f.required}
                        defaultValue=""
                      >
                        <option value="">Select value</option>
                        {f.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        name={"field_" + f.key}
                        type={f.type === "phone" ? "tel" : f.type}
                        required={f.required && f.type !== "checkbox"}
                        step={f.type === "number" ? "any" : undefined}
                        maxLength={3000}
                      />
                    )}
                  </Field>
                ))}
                <label>
                  <input type="checkbox" required />I confirm these guest
                  details
                </label>
                <TurnstileChallenge key={challengeVersion} siteKey={data.data.turnstile?.siteKey} onToken={setChallenge} />
                <div className="actions">
                  <button type="submit" disabled={a.busy || (!!data.data.turnstile && !challenge)}>
                    Save guest
                  </button>
                  <button
                    type="button"
                    disabled={a.busy}
                    onClick={() => setAdding(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </Dialog>
          )}
          {cancel !== undefined && (
            <Dialog
              title="Cancel guest invitation"
              close={() => !a.busy && setCancel(undefined)}
            >
              <Notice error={a.error} />
              <p>
                This cancels unused tickets immediately. Existing admission
                history is retained.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  void a.run(async () => {
                    await submit({
                      action: "cancel",
                      guestId: cancel,
                      reason: fd.get("reason"),
                      requestKey: key,
                      confirmed: true,
                    });
                    setCancel(undefined);
                    setMessage(
                      "Invitation cancelled. You may add a replacement while registration is open.",
                    );
                    data.reload();
                  });
                }}
              >
                <Field label="Cancellation reason">
                  <input
                    name="reason"
                    required
                    minLength={5}
                    maxLength={1000}
                  />
                </Field>
                <label>
                  <input type="checkbox" required />I confirm cancellation
                </label>
                <TurnstileChallenge key={challengeVersion} siteKey={data.data.turnstile?.siteKey} onToken={setChallenge} />
                <button disabled={a.busy || (!!data.data.turnstile && !challenge)} type="submit">
                  Confirm cancellation
                </button>
              </form>
            </Dialog>
          )}
        </>
      ) : (
        <p>
          Reopen the original invitation link or ask the event administrator for
          a new one.
        </p>
      )}
    </main>
  );
}
