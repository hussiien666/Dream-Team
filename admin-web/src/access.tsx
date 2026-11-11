import React, { useState } from "react";
import type { Client } from "./api";
import type {
  AccessCode,
  Category,
  Entrance,
  EventRecord,
  Identity,
  Staff,
} from "./types";
import {
  Checks,
  Confirm,
  Dialog,
  Empty,
  Field,
  Loading,
  Notice,
  useAction,
  useResource,
} from "./ui";
import { editable } from "./events";
export function AccessPage({
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
  const [tab, setTab] = useState("Categories");
  const cats = useResource<Category[]>(api, `events/${event.id}/categories`),
    gates = useResource<Entrance[]>(api, `events/${event.id}/entrances`);
  const [edit, setEdit] = useState<{
    kind: "categories" | "entrances";
    item?: Category | Entrance;
  }>();
  const [remove, setRemove] = useState<{
    kind: string;
    id: number;
    name: string;
  }>();
  const allowed =
    identity.permissions.includes("access.manage") && editable(event);
  const reload = () => {
    cats.reload();
    gates.reload();
    refresh();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Entrances, categories &amp; staff</h1>
          <p>{event.name}</p>
        </div>
      </div>
      <div className="tabs" role="group" aria-label="Access sections">
        {[
          "Categories",
          "Entrances",
          ...(identity.role === "super_admin" ? ["Staff & codes"] : []),
        ].map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <Notice error={cats.error || gates.error} />
      {tab === "Staff & codes" ? (
        <StaffAccess
          api={api}
          event={event}
          identity={identity}
          entrances={gates.data ?? []}
        />
      ) : (
        <>
          {allowed && (
            <button
              className="primary"
              onClick={() =>
                setEdit({
                  kind: tab === "Categories" ? "categories" : "entrances",
                })
              }
            >
              Add {tab === "Categories" ? "category" : "entrance"}
            </button>
          )}
          {cats.loading || gates.loading ? (
            <Loading />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th>
                      {tab === "Categories"
                        ? "Allocation"
                        : "Allowed categories"}
                    </th>
                    <th>Status</th>
                    {allowed && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {(tab === "Categories" ? cats.data : gates.data)?.map(
                    (item) => (
                      <tr key={item.id}>
                        <th scope="row">{item.name}</th>
                        <td>{item.code}</td>
                        <td>
                          {"allocation" in item
                            ? item.allocation
                            : (item.entrancePermissions ?? [])
                                .map(
                                  (p) =>
                                    cats.data?.find(
                                      (c) => c.id === p.categoryId,
                                    )?.name ?? p.categoryId,
                                )
                                .join(", ") || "None"}
                        </td>
                        <td>{item.active ? "Active" : "Inactive"}</td>
                        {allowed && (
                          <td>
                            <div className="actions">
                              <button
                                onClick={() =>
                                  setEdit({
                                    kind:
                                      tab === "Categories"
                                        ? "categories"
                                        : "entrances",
                                    item,
                                  })
                                }
                              >
                                Edit
                              </button>
                              <button
                                onClick={() =>
                                  setRemove({
                                    kind:
                                      tab === "Categories"
                                        ? "categories"
                                        : "entrances",
                                    id: item.id,
                                    name: item.name,
                                  })
                                }
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              {!(tab === "Categories" ? cats.data : gates.data)?.length && (
                <Empty>No {tab.toLowerCase()} yet.</Empty>
              )}
            </div>
          )}
        </>
      )}
      {!editable(event) && <p>This event is read-only.</p>}
      {edit && (
        <AccessForm
          api={api}
          event={event}
          {...edit}
          categories={cats.data ?? []}
          close={() => setEdit(undefined)}
          saved={reload}
        />
      )}
      {remove && (
        <Confirm
          title="Delete access record"
          description={`Remove ${remove.name} from active use? History is retained. Records with attendees or check-ins cannot be deleted.`}
          close={() => setRemove(undefined)}
          act={async () => {
            await api.request(
              `events/${event.id}/${remove.kind}/${remove.id}`,
              "DELETE",
            );
            reload();
          }}
        />
      )}
    </>
  );
}
function AccessForm({
  api,
  event,
  kind,
  item,
  categories,
  close,
  saved,
}: {
  api: Client;
  event: EventRecord;
  kind: "categories" | "entrances";
  item?: Category | Entrance;
  categories: Category[];
  close: () => void;
  saved: () => void;
}) {
  const a = useAction();
  const [ids, setIds] = useState(
    item && "entrancePermissions" in item
      ? (item.entrancePermissions ?? []).map((p) => p.categoryId)
      : [],
  );
  return (
    <Dialog
      title={`${item ? "Edit" : "Add"} ${kind === "categories" ? "category" : "entrance"}`}
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void a.run(async () => {
            const data: Record<string, unknown> = {
              name: d.get("name"),
              code: d.get("code"),
              description: d.get("description"),
              active: d.has("active"),
            };
            if (kind === "categories") {
              Object.assign(data, {
                allocation: Number(d.get("allocation")),
                maxPerAttendee: Number(d.get("maxPerAttendee")),
                price: Number(d.get("price")),
                color: d.get("color"),
              });
            } else
              Object.assign(data, {
                location: d.get("location"),
                instructions: d.get("instructions"),
                categoryIds: ids,
              });
            await api.request(
              `events/${event.id}/${kind}` + (item ? "/" + item.id : ""),
              item ? "PATCH" : "POST",
              data,
            );
            saved();
            close();
          });
        }}
      >
        <Notice error={a.error} />
        <div className="form-grid">
          <Field label="Name">
            <input
              name="name"
              defaultValue={item?.name}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Code">
            <input
              name="code"
              defaultValue={item?.code}
              maxLength={40}
              pattern="[A-Za-z0-9_-]+"
              required
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            name="description"
            maxLength={3000}
            defaultValue={item?.description}
          />
        </Field>
        {kind === "categories" ? (
          <div className="form-grid">
            <Field label="Ticket allocation">
              <input
                name="allocation"
                type="number"
                min="1"
                max="2147483647"
                required
                defaultValue={
                  item && "allocation" in item
                    ? item.allocation
                    : event.maxTickets
                }
              />
            </Field>
            <Field label="Maximum tickets per attendee">
              <input
                name="maxPerAttendee"
                type="number"
                min="1"
                max="2147483647"
                required
                defaultValue={
                  item && "maxPerAttendee" in item ? item.maxPerAttendee : 1
                }
              />
            </Field>
            <Field label="Price (record only)">
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={item && "price" in item ? item.price : 0}
              />
            </Field>
            <Field label="Color">
              <input
                name="color"
                type="color"
                defaultValue={item && "color" in item ? item.color : "#142d4e"}
              />
            </Field>
          </div>
        ) : (
          <>
            <Field label="Location">
              <input
                name="location"
                maxLength={200}
                defaultValue={item && "location" in item ? item.location : ""}
              />
            </Field>
            <Field label="Entrance instructions">
              <textarea
                name="instructions"
                maxLength={3000}
                defaultValue={
                  item && "instructions" in item ? item.instructions : ""
                }
              />
            </Field>
            <Checks
              legend="Allowed ticket categories"
              items={categories.filter((c) => c.active)}
              chosen={ids}
              set={setIds}
            />
            <p className="muted">
              No categories selected means this entrance admits nobody.
            </p>
          </>
        )}
        <label className="check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={item?.active ?? true}
          />
          Active
        </label>
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy}>
            Save
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function StaffAccess({
  api,
  event,
  identity,
  entrances,
}: {
  api: Client;
  event: EventRecord;
  identity: Identity;
  entrances: Entrance[];
}) {
  const users = useResource<Staff[]>(api, "users"),
    codes = useResource<AccessCode[]>(api, `events/${event.id}/access-codes`);
  const [newUser, setNewUser] = useState(false),
    [editUser, setEditUser] = useState<Staff>(),
    [codeForm, setCodeForm] = useState<AccessCode | "new">(),
    [secret, setSecret] = useState<{ title: string; value: string }>();
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    act: () => Promise<void>;
  }>();
  const active = editable(event);
  const reload = () => {
    users.reload();
    codes.reload();
  };
  function codeAction(code: AccessCode, operation: string) {
    setConfirm({
      title: operation[0].toUpperCase() + operation.slice(1) + " code",
      description:
        operation === "regenerate"
          ? "Replace this access code and terminate its sessions? The old code will stop working."
          : operation === "deactivate"
            ? "Deactivate this code and immediately terminate its scanner sessions?"
            : "Activate this code for its assigned staff and entrances?",
      act: async () => {
        const r = await api.request<{ code?: string }>(
          `events/${event.id}/access-codes/${code.id}/${operation}`,
          "POST",
        );
        if (r.code) setSecret({ title: "New access code", value: r.code });
        reload();
      },
    });
  }
  return (
    <>
      <section className="plain-section">
        <div className="section-heading">
          <h2>Staff accounts</h2>
          <button
            className="primary"
            disabled={!active}
            onClick={() => setNewUser(true)}
          >
            Add staff account
          </button>
        </div>
        <Notice error={users.error} />
        {users.loading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Account</th>
                  <th>Event access</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data?.map((user) => {
                  const assigned = user.eventAssignments?.some(
                    (x) => x.eventId === event.id,
                  );
                  return (
                    <tr key={user.id}>
                      <th scope="row">{user.displayName}</th>
                      <td>{user.username}</td>
                      <td>{user.organizationUser.role.replaceAll("_", " ")}</td>
                      <td>{user.active ? "Active" : "Disabled"}</td>
                      <td>
                        {assigned
                          ? "Assigned"
                          : user.organizationUser.role === "super_admin"
                            ? "All events"
                            : "Unassigned"}
                      </td>
                      <td>
                        <div className="actions">
                          <button onClick={() => setEditUser(user)}>
                            Edit account
                          </button>
                          {active &&
                            user.organizationUser.role !== "super_admin" && (
                              <button
                                onClick={() =>
                                  setConfirm({
                                    title: assigned
                                      ? "Remove event assignment"
                                      : "Assign event",
                                    description: assigned
                                      ? "Remove event access and terminate this event scanner session?"
                                      : `Allow ${user.displayName} to access ${event.name}?`,
                                    act: async () => {
                                      await api.request(
                                        `users/${user.id}/events/${event.id}/assign`,
                                        assigned ? "DELETE" : "POST",
                                      );
                                      reload();
                                    },
                                  })
                                }
                              >
                                {assigned ? "Unassign" : "Assign"}
                              </button>
                            )}
                          {user.id !== identity.user.id && (
                            <>
                              <button
                                onClick={() =>
                                  setConfirm({
                                    title: user.active
                                      ? "Disable account"
                                      : "Enable account",
                                    description: user.active
                                      ? "Block new sign-ins? An existing scanner session continues until logout."
                                      : "Allow new sign-ins for this account?",
                                    act: async () => {
                                      await api.request(
                                        `users/${user.id}/${user.active ? "disable" : "enable"}`,
                                        "POST",
                                      );
                                      reload();
                                    },
                                  })
                                }
                              >
                                {user.active ? "Disable" : "Enable"}
                              </button>
                              <button
                                onClick={() =>
                                  setConfirm({
                                    title: "Reset password",
                                    description:
                                      "Create a temporary password? The next login must change it. Active scanner sessions are preserved.",
                                    act: async () => {
                                      const r = await api.request<{
                                        password: string;
                                      }>(
                                        `users/${user.id}/temp-password`,
                                        "POST",
                                      );
                                      setSecret({
                                        title: "Temporary password",
                                        value: r.password,
                                      });
                                    },
                                  })
                                }
                              >
                                Reset password
                              </button>
                            </>
                          )}
                          {user.organizationUser.role === "scanner" && (
                            <button
                              onClick={() =>
                                setConfirm({
                                  title: "Remote scanner logout",
                                  description: `Terminate the active scanner session for ${user.displayName}?`,
                                  act: async () => {
                                    await api.request(
                                      `scanner/users/${user.id}/remote-logout`,
                                      "POST",
                                    );
                                    reload();
                                  },
                                })
                              }
                            >
                              Log scanner out
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="plain-section">
        <div className="section-heading">
          <h2>Event access codes</h2>
          <button
            className="primary"
            disabled={!active}
            onClick={() => setCodeForm("new")}
          >
            Add access code
          </button>
        </div>
        <Notice error={codes.error} />
        {codes.loading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code name</th>
                  <th>Status</th>
                  <th>Active sessions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {codes.data?.map((code) => (
                  <tr key={code.id}>
                    <th scope="row">{code.name}</th>
                    <td>{code.active ? "Active" : "Inactive"}</td>
                    <td>{code._count.scannerSessions}</td>
                    <td>
                      <div className="actions">
                        {active && (
                          <>
                            <button onClick={() => setCodeForm(code)}>
                              Edit grants
                            </button>
                            <button
                              onClick={() => codeAction(code, "regenerate")}
                            >
                              Regenerate
                            </button>
                          </>
                        )}
                        {(active || code.active) && (
                          <button
                            onClick={() =>
                              codeAction(
                                code,
                                code.active ? "deactivate" : "activate",
                              )
                            }
                          >
                            {code.active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!codes.data?.length && (
              <Empty>
                No access codes yet. Assign scanner staff and create an active
                entrance first.
              </Empty>
            )}
          </div>
        )}
      </section>
      {editUser && (
        <EditStaff
          api={api}
          user={editUser}
          self={editUser.id === identity.user.id}
          close={() => setEditUser(undefined)}
          saved={reload}
        />
      )}
      {newUser && (
        <StaffForm
          api={api}
          event={event}
          close={() => setNewUser(false)}
          saved={reload}
        />
      )}
      {codeForm && (
        <CodeForm
          api={api}
          event={event}
          code={codeForm === "new" ? undefined : codeForm}
          staff={(users.data ?? []).filter(
            (u) =>
              u.organizationUser.role === "scanner" &&
              u.eventAssignments?.some((a) => a.eventId === event.id),
          )}
          entrances={entrances.filter((e) => e.active)}
          close={() => setCodeForm(undefined)}
          saved={(value) => {
            reload();
            if (value) setSecret({ title: "Access code", value });
          }}
        />
      )}
      {confirm && <Confirm {...confirm} close={() => setConfirm(undefined)} />}
      {secret && (
        <Dialog title={secret.title} close={() => setSecret(undefined)}>
          <p>
            Share this privately with the intended staff member. It is shown
            only here.
          </p>
          <code className="secret">{secret.value}</code>
          <footer>
            <button className="primary" onClick={() => setSecret(undefined)}>
              Done
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
function StaffForm({
  api,
  event,
  close,
  saved,
}: {
  api: Client;
  event: EventRecord;
  close: () => void;
  saved: () => void;
}) {
  const a = useAction();
  return (
    <Dialog
      title="Add staff account"
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void a.run(async () => {
            await api.request("users", "POST", {
              username: d.get("username"),
              displayName: d.get("displayName"),
              password: d.get("password"),
              orgRole: d.get("orgRole"),
              eventId: event.id,
            });
            saved();
            close();
          });
        }}
      >
        <Notice error={a.error} />
        <Field label="Username">
          <input
            name="username"
            pattern="[a-zA-Z0-9._-]+"
            maxLength={80}
            required
          />
        </Field>
        <Field label="Display name">
          <input name="displayName" maxLength={160} required />
        </Field>
        <Field label="Role">
          <select name="orgRole">
            <option value="scanner">Scanner staff</option>
            <option value="event_manager">Event manager</option>
            <option value="ticket_manager">Ticket manager</option>
            <option value="checkin_supervisor">Check-in supervisor</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </Field>
        <Field label="Initial password">
          <input
            type="password"
            name="password"
            minLength={12}
            maxLength={256}
            autoComplete="new-password"
            required
          />
        </Field>
        <p>Account creation and assignment to this event are saved together.</p>
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy}>
            Create and assign
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function CodeForm({
  api,
  event,
  code,
  staff,
  entrances,
  close,
  saved,
}: {
  api: Client;
  event: EventRecord;
  code?: AccessCode;
  staff: Staff[];
  entrances: Entrance[];
  close: () => void;
  saved: (value?: string) => void;
}) {
  const a = useAction();
  const [gates, setGates] = useState(
      code?.codeEntrances.map((e) => e.entranceId) ?? [],
    ),
    [users, setUsers] = useState(code?.codeStaff.map((e) => e.userId) ?? []);
  return (
    <Dialog
      title={code ? "Edit code grants" : "Add access code"}
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void a.run(async () => {
            const r = await api.request<{ code?: string }>(
              `events/${event.id}/access-codes` + (code ? "/" + code.id : ""),
              code ? "PATCH" : "POST",
              { name: d.get("name"), entranceIds: gates, staffIds: users },
            );
            saved(r.code);
            close();
          });
        }}
      >
        <Notice error={a.error} />
        <Field label="Code name">
          <input
            name="name"
            maxLength={120}
            defaultValue={code?.name}
            required
          />
        </Field>
        <Checks
          legend="Permitted entrances"
          items={entrances}
          chosen={gates}
          set={setGates}
        />
        <Checks
          legend="Assigned scanner staff"
          items={staff.map((s) => ({ id: s.id, name: s.displayName }))}
          chosen={users}
          set={setUsers}
        />
        {code && (
          <p>Saving grant changes terminates sessions using this code.</p>
        )}
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={a.busy || !gates.length || !users.length}
          >
            Save
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function EditStaff({
  api,
  user,
  self,
  close,
  saved,
}: {
  api: Client;
  user: Staff;
  self: boolean;
  close: () => void;
  saved: () => void;
}) {
  const a = useAction();
  return (
    <Dialog
      title="Edit account"
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          void a.run(async () => {
            const role = d.get("orgRole");
            if (
              !self &&
              role !== user.organizationUser.role &&
              !window.confirm(
                "Change this role and revoke its existing sessions?",
              )
            )
              return;
            await api.request(`users/${user.id}`, "PATCH", {
              displayName: d.get("displayName"),
              ...(!self ? { orgRole: role } : {}),
            });
            saved();
            close();
          });
        }}
      >
        <Notice error={a.error} />
        <p>Username: {user.username}</p>
        <Field label="Display name">
          <input
            name="displayName"
            maxLength={160}
            defaultValue={user.displayName}
            required
          />
        </Field>
        <Field label="Role">
          <select
            name="orgRole"
            defaultValue={user.organizationUser.role}
            disabled={self}
          >
            {[
              "super_admin",
              "event_manager",
              "ticket_manager",
              "checkin_supervisor",
              "scanner",
            ].map((role) => (
              <option value={role} key={role}>
                {role.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy}>
            Save account
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
