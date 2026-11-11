import React, { useState } from "react";
import type { Client } from "./api";
import type { EventRecord, Identity, Settings } from "./types";
import {
  Field,
  Notice,
  Loading,
  Empty,
  Dialog,
  Confirm,
  Link,
  useAction,
  useResource,
} from "./ui";
const statuses = [
  "Draft",
  "Upcoming",
  "Active",
  "Published",
  "Ongoing",
  "Completed",
  "Cancelled",
];
const fields = [
  ["name", "Event name", 200],
  ["venue", "Venue", 200],
  ["subtitle", "Subtitle", 200],
  ["organization", "Organization", 200],
  ["eventType", "Event type", 100],
  ["country", "Country", 100],
  ["city", "City", 100],
  ["building", "Building", 200],
  ["address", "Address", 500],
  ["timezone", "Time zone", 80],
] as const;
const local = (value?: string | null) =>
  value
    ? new Date(+new Date(value) - new Date(value).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
const dates = [
  ["startsAt", "Start time"],
  ["endsAt", "End time"],
  ["distributionStart", "Ticket distribution starts"],
  ["distributionEnd", "Ticket distribution ends"],
  ["registrationDeadline", "Registration deadline"],
] as const;
export const editable = (event: EventRecord) =>
  !event.archived && !["Cancelled", "Completed"].includes(event.status);
export function EventForm({
  api,
  event,
  close,
  saved,
}: {
  api: Client;
  event?: EventRecord;
  close: () => void;
  saved: () => void;
}) {
  const a = useAction();
  function original(key: string) {
    if (key === "eventDate") return event?.eventDate.slice(0, 10) ?? "";
    if (dates.some(([k]) => k === key))
      return local(event?.[key as keyof EventRecord] as string);
    return String(
      event?.[key as keyof EventRecord] ??
        (
          {
            timezone: "Africa/Cairo",
            organization: "AAST",
            eventType: "University event",
            country: "Egypt",
            status: "Draft",
          } as Record<string, string>
        )[key] ??
        "",
    );
  }
  return (
    <Dialog
      title={event ? "Edit event" : "Create event"}
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void a.run(async () => {
            const body: Record<string, unknown> = {};
            for (const [key, raw] of fd) {
              const value = String(raw);
              if (event && value === original(key)) continue;
              if (["capacity", "maxTickets"].includes(key)) {
                if (value) body[key] = Number(value);
              } else if (dates.some(([k]) => k === key)) {
                if (value) body[key] = new Date(value).toISOString();
                else if (event) body[key] = null;
              } else body[key] = value;
            }
            await api.request(
              event ? "events/" + event.id : "events",
              event ? "PATCH" : "POST",
              body,
            );
            saved();
            close();
          });
        }}
      >
        <Notice error={a.error} />
        <div className="form-grid">
          {fields.map(([key, label, max]) => (
            <Field key={key} label={label}>
              <input
                name={key}
                defaultValue={original(key)}
                maxLength={max}
                required={["name", "venue", "timezone"].includes(key)}
              />
            </Field>
          ))}
          <Field label="Event date">
            <input
              name="eventDate"
              type="date"
              defaultValue={original("eventDate")}
              required
            />
          </Field>
          {dates.map(([key, label]) => (
            <Field key={key} label={label + " (device time)"}>
              <input
                name={key}
                type="datetime-local"
                defaultValue={original(key)}
                required={["startsAt", "endsAt"].includes(key)}
              />
            </Field>
          ))}
          <Field label="Capacity">
            <input
              name="capacity"
              type="number"
              min="1"
              max="2147483647"
              defaultValue={original("capacity")}
              required
            />
          </Field>
          <Field label="Maximum tickets (blank uses capacity)">
            <input
              name="maxTickets"
              type="number"
              min="1"
              max="2147483647"
              defaultValue={original("maxTickets")}
            />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={original("status")}>
              {statuses
                .filter((s) => !["Cancelled", "Completed"].includes(s))
                .map((s) => (
                  <option key={s}>{s}</option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Description">
          <textarea
            name="description"
            maxLength={10000}
            defaultValue={original("description")}
          />
        </Field>
        <Field label="Access instructions">
          <textarea
            name="instructions"
            maxLength={3000}
            defaultValue={original("instructions")}
          />
        </Field>
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy}>
            {a.busy ? "Saving..." : "Save event"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export function EventsPage({
  api,
  identity,
  refresh,
}: {
  api: Client;
  identity: Identity;
  refresh: () => void;
}) {
  const r = useResource<EventRecord[]>(api, "events");
  const [form, setForm] = useState<EventRecord | "new">();
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("All"),
    [sort, setSort] = useState("date"),
    [view, setView] = useState("table");
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    path: string;
    method?: string;
    body?: unknown;
  }>();
  const reload = () => {
    r.reload();
    refresh();
  };
  const rows = (r.data ?? [])
    .filter(
      (e) =>
        e.name.toLowerCase().includes(search.toLowerCase()) &&
        (status === "All" ||
          (status === "Archived"
            ? e.archived
            : !e.archived &&
              (e.status === status ||
                (status === "Upcoming" && e.status === "Published") ||
                (status === "Active" && e.status === "Ongoing")))),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.eventDate.localeCompare(a.eventDate),
    );
  const manage = identity.permissions.includes("events.manage"),
    superAdmin = identity.role === "super_admin";
  const action = (e: EventRecord, operation: string) => {
    const descriptions: Record<string, string> = {
      cancel:
        "Cancel this event and invalidate all unused tickets? Admission will be blocked. History is preserved.",
      reopen: "Reopen this event? Old cancelled tickets remain invalid.",
      archive: "Archive this completed event? It becomes read-only.",
      restore: "Restore this archived event? Its status remains unchanged.",
      duplicate:
        "Duplicate the event configuration? Attendees, tickets and activity are excluded. Copied access codes require new credentials.",
      complete: "Mark this event completed? Admission and editing will stop.",
      delete:
        "Remove this ticket-free event from active use? Its records will be retained.",
    };
    setConfirm({
      title:
        operation === "complete"
          ? "Complete event"
          : operation[0].toUpperCase() + operation.slice(1) + " event",
      description: descriptions[operation],
      path:
        "events/" +
        e.id +
        (operation === "complete" || operation === "delete"
          ? ""
          : "/" + operation),
      method:
        operation === "complete"
          ? "PATCH"
          : operation === "delete"
            ? "DELETE"
            : "POST",
      body: operation === "complete" ? { status: "Completed" } : undefined,
    });
  };
  const buttons = (e: EventRecord) => (
    <div className="actions">
      <Link to={"/events/" + e.id + "/dashboard"}>Open</Link>
      {manage && editable(e) && (
        <>
          <button onClick={() => setForm(e)}>Edit</button>
          <button onClick={() => action(e, "complete")}>Complete</button>
          <button onClick={() => action(e, "cancel")}>Cancel event</button>
        </>
      )}
      {superAdmin && (
        <button onClick={() => action(e, "duplicate")}>Duplicate</button>
      )}
      {manage && e.status === "Completed" && !e.archived && (
        <button onClick={() => action(e, "archive")}>Archive</button>
      )}
      {superAdmin && e.archived && (
        <button onClick={() => action(e, "restore")}>Restore</button>
      )}
      {superAdmin && !e.archived && e.status === "Cancelled" && (
        <button onClick={() => action(e, "reopen")}>Reopen</button>
      )}
      {manage && editable(e) && (
        <button onClick={() => action(e, "delete")}>Delete</button>
      )}
    </div>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Events</h1>
          <p>Create and manage university events.</p>
        </div>
        {identity.permissions.includes("events.create") && (
          <button className="primary" onClick={() => setForm("new")}>
            Add event
          </button>
        )}
      </div>
      <div className="toolbar">
        <Field label="Search events">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Event name"
          />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {[
              "All",
              "Active",
              "Upcoming",
              "Draft",
              "Completed",
              "Cancelled",
              "Archived",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Sort">
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="date">Newest date first</option>
            <option value="name">Name A-Z</option>
          </select>
        </Field>
        <Field label="View">
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="table">Table</option>
            <option value="cards">Cards</option>
          </select>
        </Field>
        <button onClick={r.reload}>Refresh</button>
      </div>
      <Notice error={r.error} />
      {r.loading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>No events match this selection.</Empty>
      ) : view === "cards" ? (
        <div className="event-grid">
          {rows.map((e) => (
            <article className="event-summary" key={e.id}>
              <h2>{e.name}</h2>
              <p>
                {e.eventDate.slice(0, 10)} &middot; {e.venue}
              </p>
              <p>{e.archived ? "Archived" : e.status}</p>
              {buttons(e)}
            </article>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Venue</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <th scope="row">{e.name}</th>
                  <td>{e.eventDate.slice(0, 10)}</td>
                  <td>{e.venue}</td>
                  <td>
                    <span className="status">
                      {e.archived ? "Archived" : e.status}
                    </span>
                  </td>
                  <td>{buttons(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <EventForm
          api={api}
          event={form === "new" ? undefined : form}
          close={() => setForm(undefined)}
          saved={reload}
        />
      )}
      {confirm && (
        <Confirm
          {...confirm}
          close={() => setConfirm(undefined)}
          act={async () => {
            await api.request(confirm.path, confirm.method, confirm.body);
            reload();
          }}
        />
      )}
    </>
  );
}
export function Dashboard({ api, event }: { api: Client; event: EventRecord }) {
  const r = useResource<{
    totalAttendees: number;
    checkedIn: number;
    remaining: number;
    activeTickets: number;
    failedEmails: number;
  }>(api, "events/" + event.id + "/dashboard");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{event.name}</h1>
          <p>
            {event.eventDate.slice(0, 10)} &middot; {event.venue} &middot;{" "}
            {event.archived ? "Archived" : event.status}
          </p>
        </div>
        <button onClick={r.reload}>Refresh</button>
      </div>
      <Notice error={r.error} />
      {r.loading ? (
        <Loading />
      ) : (
        r.data && (
          <>
            <dl className="totals">
              {[
                ["Registered attendees", r.data.totalAttendees],
                ["Accepted entries", r.data.checkedIn],
                ["Remaining attendees", r.data.remaining],
                ["Active tickets", r.data.activeTickets],
                ["Email issues", r.data.failedEmails],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <section className="plain-section">
              <h2>Event details</h2>
              <dl className="details">
                <dt>Start</dt>
                <dd>
                  {new Date(event.startsAt).toLocaleString(undefined, {
                    timeZone: event.timezone,
                  })}{" "}
                  ({event.timezone})
                </dd>
                <dt>End</dt>
                <dd>
                  {new Date(event.endsAt).toLocaleString(undefined, {
                    timeZone: event.timezone,
                  })}
                </dd>
                <dt>Capacity</dt>
                <dd>{event.capacity}</dd>
                <dt>Ticket limit</dt>
                <dd>{event.maxTickets}</dd>
              </dl>
              {event.description && <p>{event.description}</p>}
            </section>
          </>
        )
      )}
    </>
  );
}
export function EventSettings({
  api,
  event,
  identity,
  refresh,
}: {
  api: Client;
  event: EventRecord;
  identity: Identity;
  refresh: () => void;
}) {
  const r = useResource<{ settings: Settings }>(
      api,
      "events/" + event.id + "/settings",
    ),
    a = useAction();
  const [edit, setEdit] = useState(false),
    [saved, setSaved] = useState(false);
  const allowed =
    identity.permissions.includes("events.manage") && editable(event);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Event settings</h1>
          <p>{event.name}</p>
        </div>
        {allowed && (
          <button onClick={() => setEdit(true)}>Edit event details</button>
        )}
      </div>
      <Notice error={r.error || a.error} />
      {saved && (
        <p role="status" className="notice">
          Preferences saved.
        </p>
      )}
      {r.loading ? (
        <Loading />
      ) : (
        r.data && (
          <form
            key={JSON.stringify(r.data)}
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void a.run(async () => {
                await api.request("events/" + event.id + "/settings", "PATCH", {
                  settings: {
                    automaticTicketGeneration:
                      d.get("automaticTicketGeneration") === "on",
                    directGuestDelivery: d.get("directGuestDelivery") === "on",
                    studentCopies: d.get("studentCopies") === "on",
                    notifyEmailFailures: d.get("notifyEmailFailures") === "on",
                    defaultCategoryId: d.get("defaultCategoryId")
                      ? Number(d.get("defaultCategoryId"))
                      : null,
                    primaryColor: d.get("primaryColor"),
                    accentColor: d.get("accentColor"),
                    transferApproval: String(d.get("transferApproval") || "admin"),
                    transferDeadline: d.get("transferDeadline")
                      ? new Date(String(d.get("transferDeadline"))).toISOString()
                      : null,
                    notifyGuestChanges: d.get("notifyGuestChanges") === "on",
                  },
                });
                setSaved(true);
                r.reload();
              });
            }}
          >
            <fieldset disabled={!allowed || a.busy}>
              <legend>Event preferences</legend>
              <Field label="Default guest category">
                <select
                  name="defaultCategoryId"
                  defaultValue={r.data.settings.defaultCategoryId ?? ""}
                >
                  <option value="">No default</option>
                  {event.categories
                    .filter((c) => c.active)
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              <div className="form-grid">
                <Field label="Primary color">
                  <input
                    name="primaryColor"
                    type="color"
                    defaultValue={r.data.settings.primaryColor ?? "#142d4e"}
                  />
                </Field>
                <Field label="Accent color">
                  <input
                    name="accentColor"
                    type="color"
                    defaultValue={r.data.settings.accentColor ?? "#b6984e"}
                  />
                </Field>
              </div>
              <fieldset>
                <legend>Ticket generation and delivery</legend>
                <label className="check">
                  <input
                    type="checkbox"
                    name="automaticTicketGeneration"
                    defaultChecked={
                      r.data.settings.automaticTicketGeneration ?? false
                    }
                  />
                  Automatically generate tickets for new guests
                </label>
                <p>
                  Applies to manual and Excel registrations in published/open
                  events. Capacity, distribution and rendering errors roll the
                  registration batch back. Draft registrations wait for
                  manual/group generation. Enabling this does not enable email.
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    name="directGuestDelivery"
                    defaultChecked={r.data.settings.directGuestDelivery ?? true}
                  />
                  Send tickets directly to guest email addresses
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    name="studentCopies"
                    defaultChecked={r.data.settings.studentCopies ?? true}
                  />
                  Send copies to inviting students
                </label>
                <p>
                  Guests without email receive their copy through the inviting
                  student. Email requires configured delivery and its worker.
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    name="notifyEmailFailures"
                    defaultChecked={r.data.settings.notifyEmailFailures ?? true}
                  />
                  Notify administrators about failed ticket emails
                </label>
              </fieldset>
              <fieldset>
                <legend>Ticket transfers</legend>
                <Field label="Transfer approval">
                  <select
                    name="transferApproval"
                    defaultValue={r.data.settings.transferApproval ?? "admin"}
                  >
                    <option value="admin">Require administrator approval</option>
                    <option value="automatic">Automatic approval</option>
                  </select>
                </Field>
                <Field label="Transfer deadline (optional)">
                  <input
                    type="datetime-local"
                    name="transferDeadline"
                    defaultValue={
                      r.data.settings.transferDeadline
                        ? new Date(r.data.settings.transferDeadline)
                            .toISOString()
                            .slice(0, 16)
                        : ""
                    }
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    name="notifyGuestChanges"
                    defaultChecked={r.data.settings.notifyGuestChanges ?? true}
                  />
                  Notify student and administrator on guest cancellations and transfers
                </label>
              </fieldset>
              {allowed && <button className="primary">Save preferences</button>}
            </fieldset>
          </form>
        )
      )}
      {!editable(event) && <p>This event is read-only.</p>}
      {edit && (
        <EventForm
          api={api}
          event={event}
          close={() => setEdit(false)}
          saved={refresh}
        />
      )}
    </>
  );
}
