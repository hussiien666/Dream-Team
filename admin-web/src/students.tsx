import { useState, useEffect } from "react";
import { InvitationLinkDialog } from "./invitations";
import type { Client } from "./api";
import type { EventRecord, Identity } from "./types";
import {
  Dialog,
  Field,
  Notice,
  Loading,
  Empty,
  useAction,
  useResource,
  useDebounced,usePage,PageControls,RefreshState,
} from "./ui";
type Values = Record<string, string | number | boolean | null>;
type RegistrationField = {
  id: number;
  key: string;
  label: string;
  target: "student" | "guest";
  type: string;
  required: boolean;
  active: boolean;
  options: string[];
};
type Student = {
  id: number;
  studentId: string;
  fullName: string;
  email: string;
  phone: string;
  active: boolean;
  guestCount: number;
  guestLimit: number | null;
  customValues: Values;
  _count: { guests: number };
};
type Guest = {
  id: number;
  studentId: number;
  attendeeId: number;
  email: string | null;
  invitationGroup: string;
  active: boolean;
  customValues: Values;
  attendee: {
    fullName: string;
    phone: string;
    categoryId: number;
    category: { name: string };
    tickets: { status: string }[];
  };
};
type Limits = {
  guestLimit: number;
  perStudentLimit: number;
  defaultCategoryId: number | null;
  categoryLimits: { categoryId: number; limit: number }[];
};
type Overview = {
  students: Student[];
  guests: Guest[];
  fields: RegistrationField[];
  limits: Limits;
  categories: { id: number; name: string; code: string; active: boolean }[];
  nextAfter?:number|null;
};
type Preview = {
  previewHash: string;
  errors: { sheet: string; row: number; message: string }[];
  students: {
    row: number;
    studentId: string;
    fullName: string;
    action: string;
  }[];
  guests: {
    row: number;
    studentId: number | string;
    fullName: string;
    action: string;
  }[];
  counts: Record<string, number>;
};
const prefix = (id: number) => `events/${id}`;
export function StudentsPage({
  api,
  event,
  identity,
}: {
  api: Client;
  event: EventRecord;
  identity: Identity;
}) {
  const base = prefix(event.id);
  const [tab, setTab] = useState<"students" | "guests" | "fields">("students"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active"),
    [studentFilter, setStudentFilter] = useState<number>(),
    [edit, setEdit] = useState<{
      kind: "student" | "guest";
      record?: Student | Guest;
    }>(),
    [cancel, setCancel] = useState<{
      kind: "student" | "guest";
      record: Student | Guest;
    }>(),
    [field, setField] = useState<RegistrationField | null>(),
    [importing, setImporting] = useState(false),
    [limits, setLimits] = useState(false),
    [message, setMessage] = useState("");
  const [linkStudent, setLinkStudent] = useState<Student>();
  const debounced=useDebounced(search),query=`kind=${tab==='guests'?'guests':'students'}&status=${filter}&search=${encodeURIComponent(debounced)}${studentFilter&&tab==='guests'?'&studentId='+studentFilter:''}`;
  const page=usePage(query),pagePath=base+'/registrations/page?'+query,data=useResource<Overview>(api,pagePath+(page.after?'&after='+page.after:''));
  useEffect(()=>{if(data.data?.nextAfter)api.prefetch(pagePath+'&after='+data.data.nextAfter);},[api,pagePath,data.data?.nextAfter]);
  const a = useAction();
  const refresh = () => {
    data.reload();
  };
  const readonly = event.archived,
    canManage = identity.permissions.includes("events.manage");
  const download = () =>
    a.run(async () => {
      const blob = await api.request<Blob>(
        base + "/registration-template",
        "GET",
        undefined,
        undefined,
        true,
      );
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "students-guests.xlsx";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const show = (name: string, active: boolean) =>
    name.toLowerCase().includes(search.toLowerCase()) &&
    (filter === "all" || (filter === "active" ? active : !active));
  const d:Overview = data.data ?? {students:[],guests:[],fields:[],categories:[],limits:{guestLimit:0,perStudentLimit:0,defaultCategoryId:null,categoryLimits:[]}};
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Students & Invitations</h1>
          <p>{event.name}</p>
        </div>
        <button onClick={refresh}>Refresh</button>
      </div>
      {readonly && (
        <p className="notice">Archived event: registrations are read-only.</p>
      )}
      <p>
        Share each eligible student's private registration form so they can enter their details and guests. Excel import remains available for compatibility. Guest quantities follow the configured per-student allowance; student tickets are separate.
      </p>
      <Notice error={a.error||data.error} />{data.loading&&<Loading/>}<RefreshState refreshing={data.refreshing} error={data.error} hasData={!!data.data}/>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="toolbar">
        <button onClick={download} disabled={a.busy}>
          Download Excel template
        </button>
        <button onClick={() => setImporting(true)} disabled={readonly}>
          Import Excel
        </button>
        {canManage && (
          <button onClick={() => setLimits(true)} disabled={readonly||data.loading}>
            Invitation limits
          </button>
        )}
      </div>
      <div className="tabs" aria-label="Registrations">
        <button
          aria-pressed={tab === "students"}
          onClick={() => {
            setTab("students");
            setStudentFilter(undefined);
          }}
        >
          Students
        </button>
        <button
          aria-pressed={tab === "guests"}
          onClick={() => setTab("guests")}
        >
          Guests
        </button>
        <button
          aria-pressed={tab === "fields"}
          onClick={() => setTab("fields")}
        >
          Custom fields
        </button>
      </div>
      {linkStudent && <InvitationLinkDialog api={api} eventId={event.id} student={linkStudent} close={() => setLinkStudent(undefined)}/>}
      {tab !=='fields'&&<PageControls page={page} next={d.nextAfter} busy={data.loading}/>}
      {tab !== "fields" ? (
        <>
          <div className="toolbar">
            <Field label="Search registrations">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, ID, email or phone"
                maxLength={200}
              />
            </Field>
            <Field label="Registration status">
              <select
                aria-label="Registration status"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="active">Active</option>
                <option value="cancelled">Cancelled</option>
                <option value="all">All</option>
              </select>
            </Field>
            <button
              className="primary"
              disabled={readonly||data.loading}
              onClick={() =>
                setEdit({ kind: tab === "students" ? "student" : "guest" })
              }
            >
              {tab === "students" ? "Add student" : "Add guest"}
            </button>
            {studentFilter && (
              <button onClick={() => setStudentFilter(undefined)}>
                Show all guests
              </button>
            )}
          </div>
          {tab === "students" ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Email / phone</th>
                    <th>Guests</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {d.students
                    .filter((s) =>
                      show(
                        [s.fullName, s.studentId, s.email, s.phone].join(" "),
                        s.active,
                      ),
                    )
                    .map((s) => (
                      <tr key={s.id}>
                        <td>{s.studentId}</td>
                        <th>{s.fullName}</th>
                        <td>
                          {s.email}
                          <br />
                          {s.phone}
                        </td>
                        <td>
                          <button
                            onClick={() => {
                              setStudentFilter(s.id);
                              setTab("guests");
                              setSearch("");
                              setFilter("all");
                            }}
                          >
                            {s.guestCount} active / {s._count.guests} total
                          </button>
                        </td>
                        <td>{s.active ? "Active" : "Cancelled"}</td>
                        <td>
                          <div className="actions">
                            <button disabled={readonly || !s.active} onClick={() => setLinkStudent(s)}>Invitation link</button>
                            <button
                              disabled={readonly || !s.active}
                              onClick={() =>
                                setEdit({ kind: "student", record: s })
                              }
                            >
                              Edit
                            </button>
                            <button
                              disabled={readonly || !s.active}
                              onClick={() =>
                                setCancel({ kind: "student", record: s })
                              }
                            >
                              Delete student
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!d.students.some((s) =>
                show(
                  [s.fullName, s.studentId, s.email, s.phone].join(" "),
                  s.active,
                ),
              ) && <Empty>No students match this view.</Empty>}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Guest</th>
                    <th>Student</th>
                    <th>Email / phone</th>
                    <th>Category / group</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {d.guests
                    .filter(
                      (g) =>
                        (!studentFilter || g.studentId === studentFilter) &&
                        show(
                          [
                            g.attendee.fullName,
                            g.email,
                            g.attendee.phone,
                            d.students.find((s) => s.id === g.studentId)
                              ?.studentId,
                          ].join(" "),
                          g.active,
                        ),
                    )
                    .map((g) => (
                      <tr key={g.id}>
                        <th>{g.attendee.fullName}</th>
                        <td>
                          {
                            d.students.find((s) => s.id === g.studentId)
                              ?.fullName
                          }
                          <br />
                          {
                            d.students.find((s) => s.id === g.studentId)
                              ?.studentId
                          }
                        </td>
                        <td>
                          {g.email || "No guest email"}
                          <br />
                          {g.attendee.phone}
                        </td>
                        <td>
                          {g.attendee.category.name}
                          <br />
                          {g.invitationGroup}
                        </td>
                        <td>{g.active ? "Active" : "Cancelled"}</td>
                        <td>
                          <div className="actions">
                            <button
                              disabled={readonly || !g.active}
                              onClick={() =>
                                setEdit({ kind: "guest", record: g })
                              }
                            >
                              Edit
                            </button>
                            <button
                              disabled={readonly || !g.active}
                              onClick={() =>
                                setCancel({ kind: "guest", record: g })
                              }
                            >
                              Cancel guest
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!d.guests.some(
                (g) =>
                  (!studentFilter || g.studentId === studentFilter) &&
                  show(
                    [
                      g.attendee.fullName,
                      g.email,
                      g.attendee.phone,
                      d.students.find((s) => s.id === g.studentId)?.studentId,
                    ].join(" "),
                    g.active,
                  ),
              ) && <Empty>No guests match this view.</Empty>}
            </div>
          )}
        </>
      ) : (
        <>
          <button disabled={readonly} onClick={() => setField(null)}>
            Add custom field
          </button>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Label / key</th>
                  <th>For</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.fields.map((f) => (
                  <tr key={f.id}>
                    <th>
                      {f.label}
                      <br />
                      {f.key}
                    </th>
                    <td>{f.target}</td>
                    <td>{f.type}</td>
                    <td>{f.required ? "Yes" : "No"}</td>
                    <td>{f.active ? "Active" : "Inactive"}</td>
                    <td>
                      <button disabled={readonly} onClick={() => setField(f)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.fields.length && (
              <Empty>
                No custom fields. Add only the information needed for this
                event.
              </Empty>
            )}
          </div>
        </>
      )}
      {edit && (
        <RegistrationForm
          api={api}
          base={base}
          d={d}
          kind={edit.kind}
          record={edit.record}
          canManage={canManage}
          close={() => setEdit(undefined)}
          saved={() => {
            setEdit(undefined);
            refresh();
            setMessage(
              "Registration saved. Existing QR identities and admission history were preserved.",
            );
          }}
        />
      )}
      {cancel && (
        <CancelForm
          api={api}
          base={base}
          kind={cancel.kind}
          record={cancel.record}
          close={() => setCancel(undefined)}
          saved={() => {
            setCancel(undefined);
            refresh();
            setMessage(
              "Registration cancelled. Unused tickets are cancelled; admission history is retained.",
            );
          }}
        />
      )}
      {field !== undefined && (
        <FieldForm
          api={api}
          base={base}
          field={field}
          close={() => setField(undefined)}
          saved={() => {
            setField(undefined);
            refresh();
          }}
        />
      )}
      {limits && (
        <LimitsForm
          api={api}
          base={base}
          d={d}
          close={() => setLimits(false)}
          saved={() => {
            setLimits(false);
            refresh();
          }}
        />
      )}
      {importing && (
        <ImportForm
          api={api}
          base={base}
          canManage={canManage}
          close={() => {
            setImporting(false);
            refresh();
          }}
          saved={() => {
            setMessage("Excel import completed.");
          }}
        />
      )}
    </>
  );
}
function CustomFields({
  fields,
  values,
  set,
}: {
  fields: RegistrationField[];
  values: Values;
  set: (v: Values) => void;
}) {
  return (
    <>
      {fields
        .filter((f) => f.active)
        .map((f) => {
          const v = values[f.key],
            change = (value: string | number | boolean) =>
              set({ ...values, [f.key]: value });
          return (
            <Field key={f.key} label={f.label + (f.required ? " *" : "")}>
              {f.type === "dropdown" ? (
                <select
                  required={f.required}
                  value={String(v ?? "")}
                  onChange={(e) => change(e.target.value)}
                >
                  <option value="">Choose</option>
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === "checkbox" ? (
                <select
                  required={f.required}
                  value={v === undefined || v === null ? "" : String(v)}
                  onChange={(e) =>
                    set({
                      ...values,
                      [f.key]:
                        e.target.value === ""
                          ? null
                          : e.target.value === "true",
                    })
                  }
                >
                  <option value="">Choose</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  type={
                    f.type === "phone"
                      ? "tel"
                      : f.type === "text"
                        ? "text"
                        : f.type
                  }
                  step={f.type === "number" ? "any" : undefined}
                  required={f.required}
                  value={String(v ?? "")}
                  onChange={(e) =>
                    change(
                      f.type === "number" && e.target.value !== ""
                        ? Number(e.target.value)
                        : e.target.value,
                    )
                  }
                />
              )}
            </Field>
          );
        })}
    </>
  );
}
function RegistrationForm({
  api,
  base,
  d,
  kind,
  record,
  canManage,
  close,
  saved,
}: {
  api: Client;
  base: string;
  d: Overview;
  kind: "student" | "guest";
  record?: Student | Guest;
  canManage: boolean;
  close: () => void;
  saved: () => void;
}) {
  const s = kind === "student" ? (record as Student | undefined) : undefined,
    g = kind === "guest" ? (record as Guest | undefined) : undefined,
    a = useAction();
  const [customValues, setValues] = useState<Values>(
    record?.customValues ?? {},
  );
  const [studentSearch,setStudentSearch]=useState(''),term=useDebounced(studentSearch);
  const choices=useResource<Overview>(api,base+'/registrations/page?kind=students&status=active&search='+encodeURIComponent(term));
  const studentChoices=g?d.students:(choices.data?.students??d.students);
  return (
    <Dialog
      title={(record ? "Edit " : "Add ") + kind}
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(async () => {
            const common = {
              fullName: String(f.get("fullName")),
              phone: String(f.get("phone")),
              email: String(f.get("email")),
              customValues,
            };
            const body =
              kind === "student"
                ? {
                    ...common,
                    studentId: String(f.get("studentId")),
                    ...(canManage &&
                    String(f.get("guestLimit")) !== String(s?.guestLimit ?? "")
                      ? {
                          guestLimit:
                            f.get("guestLimit") === ""
                              ? null
                              : Number(f.get("guestLimit")),
                        }
                      : {}),
                  }
                : {
                    ...common,
                    studentId: Number(f.get("student")),
                    categoryId: Number(f.get("category")),
                    invitationGroup: String(f.get("group")),
                  };
            const reason = String(f.get("overrideReason") ?? "").trim();
            await api.request(
              base +
                "/" +
                (kind === "student" ? "students" : "guests") +
                (record ? "/" + record.id : ""),
              record ? "PATCH" : "POST",
              { ...body, ...(reason ? { overrideReason: reason } : {}) },
            );
            saved();
          });
        }}
      >
        <Notice error={a.error} />
        <div className="form-grid">
          {kind === "student" ? (
            <Field label="Student ID">
              <input
                name="studentId"
                required
                maxLength={100}
                defaultValue={s?.studentId}
              />
            </Field>
          ) : (
            <Field label="Student">
              {!g&&<input aria-label="Search inviting student" value={studentSearch} onChange={e=>setStudentSearch(e.target.value)} maxLength={200} placeholder="Search student name or ID"/>}
              <select
                aria-label="Student"
                name="student"
                required
                defaultValue={g?.studentId ?? ""}
                disabled={!!g}
              >
                <option value="">Choose student</option>
                {studentChoices
                  .filter((s) => s.active)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.fullName} ({s.studentId})
                    </option>
                  ))}
              </select>
              {g && <input type="hidden" name="student" value={g.studentId} />}
            </Field>
          )}
          <Field label={kind === "student" ? "Student name" : "Guest name"}>
            <input
              name="fullName"
              required
              maxLength={200}
              defaultValue={s?.fullName ?? g?.attendee.fullName}
            />
          </Field>
          <Field label={kind === "student" ? "Student email" : "Guest email"}>
            <input
              name="email"
              type="email"
              required={kind === "student"}
              maxLength={254}
              defaultValue={record?.email ?? ""}
            />
          </Field>
          <Field label="Phone">
            <input
              name="phone"
              type="tel"
              maxLength={40}
              defaultValue={s?.phone ?? g?.attendee.phone}
            />
          </Field>
          {kind === "guest" && (
            <>
              <Field label="Ticket category">
                <select
                  aria-label="Ticket category"
                  name="category"
                  required
                  defaultValue={
                    g?.attendee.categoryId ?? d.limits.defaultCategoryId ?? ""
                  }
                >
                  <option value="">Choose category</option>
                  {d.categories
                    .filter((c) => c.active)
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Invitation group">
                <input
                  name="group"
                  maxLength={200}
                  defaultValue={g?.invitationGroup}
                />
              </Field>
            </>
          )}
          {kind === "student" && canManage && (
            <Field label="Individual guest limit (blank uses event default)">
              <input
                type="number"
                name="guestLimit"
                min={0}
                step={1}
                defaultValue={s?.guestLimit ?? ""}
              />
            </Field>
          )}
          <CustomFields
            fields={d.fields.filter((f) => f.target === kind)}
            values={customValues}
            set={setValues}
          />
        </div>
        {canManage && (
          <Field label="Limit override reason (only when needed)">
            <textarea name="overrideReason" maxLength={1000} />
          </Field>
        )}
        {g && (
          <p>
            Category changes update unused tickets with the same QR. Used
            tickets keep their original category. Downloaded ticket files remain
            snapshots.
          </p>
        )}
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy}>
            {a.busy ? "Saving..." : "Save registration"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function CancelForm({
  api,
  base,
  kind,
  record,
  close,
  saved,
}: {
  api: Client;
  base: string;
  kind: "student" | "guest";
  record: Student | Guest;
  close: () => void;
  saved: () => void;
}) {
  const a = useAction(),
    impact = useResource<{ guestCount: number; activeGuestCount: number }>(
      api,
      base +
        (kind === "student"
          ? `/students/${record.id}/cancellation-impact`
          : `/guests/${record.id}`),
    );
  return (
    <Dialog
      title={kind === "student" ? "Delete student" : "Cancel guest"}
      close={() => {
        if (!a.busy) close();
      }}
    >
      {impact.loading ? (
        <Loading />
      ) : (
        <>
          <Notice error={impact.error} />
          {impact.data && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void a.run(async () => {
                  await api.request(
                    base +
                      `/${kind === "student" ? "students" : "guests"}/${record.id}/cancel`,
                    "POST",
                    {
                      confirmed: true,
                      reason: String(f.get("reason")),
                      ...(kind === "student"
                        ? { expectedGuestCount: impact.data!.guestCount }
                        : {}),
                    },
                  );
                  saved();
                });
              }}
            >
              <p>
                {kind === "student"
                  ? `This student has ${impact.data.guestCount} linked guests (${impact.data.activeGuestCount} active). All linked registrations and unused tickets will be cancelled.`
                  : "Cancel this guest registration and their unused tickets?"}
              </p>
              <p>
                Records, used tickets and admission history are retained. This
                action cannot be undone through import.
              </p>
              <Notice error={a.error} />
              <Field label="Cancellation reason">
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={1000}
                  required
                />
              </Field>
              <label className="check">
                <input type="checkbox" required />I confirm cancellation
              </label>
              <footer>
                <button type="button" onClick={close} disabled={a.busy}>
                  Keep registration
                </button>
                <button className="primary" disabled={a.busy}>
                  Confirm cancellation
                </button>
              </footer>
            </form>
          )}
        </>
      )}
    </Dialog>
  );
}
function FieldForm({
  api,
  base,
  field,
  close,
  saved,
}: {
  api: Client;
  base: string;
  field: RegistrationField | null;
  close: () => void;
  saved: () => void;
}) {
  const a = useAction(),
    [type, setType] = useState(field?.type ?? "text");
  return (
    <Dialog
      title={field ? "Edit custom field" : "Add custom field"}
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(async () => {
            const body = field
              ? {
                  label: String(f.get("label")),
                  required: f.has("required"),
                  active: f.has("active"),
                }
              : {
                  target: String(f.get("target")),
                  key: String(f.get("key")),
                  label: String(f.get("label")),
                  type,
                  required: f.has("required"),
                  active: true,
                  options:
                    type === "dropdown"
                      ? String(f.get("options"))
                          .split("\n")
                          .map((o) => o.trim())
                          .filter(Boolean)
                      : [],
                };
            await api.request(
              base + "/registration-fields" + (field ? "/" + field.id : ""),
              field ? "PATCH" : "POST",
              body,
            );
            saved();
          });
        }}
      >
        <Notice error={a.error} />
        <Field label="Label">
          <input
            name="label"
            required
            maxLength={100}
            defaultValue={field?.label}
          />
        </Field>
        {!field ? (
          <>
            <Field label="For">
              <select name="target">
                <option value="student">Students</option>
                <option value="guest">Guests</option>
              </select>
            </Field>
            <Field label="Field key">
              <input
                name="key"
                required
                pattern="[a-z][a-z0-9_]*"
                maxLength={60}
                placeholder="e.g. department"
              />
            </Field>
            <Field label="Field type">
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {[
                  "text",
                  "number",
                  "email",
                  "phone",
                  "date",
                  "dropdown",
                  "checkbox",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            {type === "dropdown" && (
              <Field label="Options (one per line)">
                <textarea name="options" required />
              </Field>
            )}
          </>
        ) : (
          <p>
            {field.target} / {field.key} / {field.type}. Key, type and options
            are fixed to preserve saved answers.
          </p>
        )}
        <label className="check">
          <input
            type="checkbox"
            name="required"
            defaultChecked={field?.required}
          />
          Required
        </label>
        {field && (
          <label className="check">
            <input
              type="checkbox"
              name="active"
              defaultChecked={field.active}
            />
            Active
          </label>
        )}
        <footer>
          <button type="button" onClick={close} disabled={a.busy}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy}>
            Save field
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function LimitsForm({
  api,
  base,
  d,
  close,
  saved,
}: {
  api: Client;
  base: string;
  d: Overview;
  close: () => void;
  saved: () => void;
}) {
  const a = useAction();
  return (
    <Dialog
      title="Invitation limits"
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void a.run(async () => {
            const overrideReason = String(f.get("reason")).trim();
            await api.request(base + "/invitation-limits", "PATCH", {
              guestLimit: Number(f.get("event")),
              perStudentLimit: Number(f.get("student")),
              defaultCategoryId: f.get("category")
                ? Number(f.get("category"))
                : null,
              categoryLimits: d.categories
                .filter((c) => c.active && f.get("cat" + c.id) !== "")
                .map((c) => ({
                  categoryId: c.id,
                  limit: Number(f.get("cat" + c.id)),
                })),
              ...(overrideReason ? { overrideReason } : {}),
            });
            saved();
          });
        }}
      >
        <Notice error={a.error} />
        <Field label="Event guest limit">
          <input
            name="event"
            type="number"
            required
            min={0}
            step={1}
            defaultValue={d.limits.guestLimit}
          />
        </Field>
        <Field label="Guests per student">
          <input
            name="student"
            type="number"
            required
            min={0}
            step={1}
            defaultValue={d.limits.perStudentLimit}
          />
        </Field>
        <Field label="Default guest category">
          <select
            aria-label="Default guest category"
            name="category"
            defaultValue={d.limits.defaultCategoryId ?? ""}
          >
            <option value="">No default</option>
            {d.categories
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <p>
          Category limits apply to each student. Blank means no separate
          category limit.
        </p>
        {d.categories
          .filter((c) => c.active)
          .map((c) => (
            <Field key={c.id} label={c.name + " per student"}>
              <input
                type="number"
                name={"cat" + c.id}
                min={0}
                step={1}
                defaultValue={
                  d.limits.categoryLimits.find((x) => x.categoryId === c.id)
                    ?.limit ?? ""
                }
              />
            </Field>
          ))}
        <Field label="Reason if below existing registrations">
          <textarea name="reason" maxLength={1000} />
        </Field>
        <footer>
          <button type="button" onClick={close} disabled={a.busy}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy}>
            Save limits
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
function ImportForm({
  api,
  base,
  canManage,
  close,
  saved,
}: {
  api: Client;
  base: string;
  canManage: boolean;
  close: () => void;
  saved: () => void;
}) {
  const a = useAction(),
    [file, setFile] = useState<File>(),
    [preview, setPreview] = useState<Preview>(),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [done, setDone] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID());
  const body = () => {
    if (!file) throw new Error("Choose the completed Excel workbook.");
    const f = new FormData();
    f.set("file", file);
    if (reason.trim()) f.set("overrideReason", reason.trim());
    return f;
  };
  return (
    <Dialog
      title="Import students and guests"
      close={() => {
        if (!a.busy) close();
      }}
    >
      {done ? (
        <>
          <p role="status">Import completed successfully.</p>
          <p>
            {preview?.counts.newStudents} new students,{" "}
            {preview?.counts.updatedStudents} updated students,{" "}
            {preview?.counts.newGuests} new guests,{" "}
            {preview?.counts.updatedGuests} updated guests.
          </p>
          <button onClick={close}>Done</button>
        </>
      ) : (
        <>
          <p>
            Use the event template with Students and Guests sheets. Existing IDs
            and guest matches are updated. Cancelled records are never
            reactivated. Maximum 5,000 combined rows and 10 MB.
          </p>
          <Notice error={a.error} />
          <Field label="Completed Excel workbook">
            <input
              type="file"
              accept=".xlsx"
              disabled={a.busy}
              onChange={(e) => {
                setFile(e.target.files?.[0]);
                setPreview(undefined);
                setConfirmed(false);
                setKey(crypto.randomUUID());
              }}
            />
          </Field>
          {canManage && (
            <Field label="Import limit override reason (only when needed)">
              <textarea
                disabled={a.busy}
                value={reason}
                maxLength={1000}
                onChange={(e) => {
                  setReason(e.target.value);
                  setPreview(undefined);
                  setConfirmed(false);
                  setKey(crypto.randomUUID());
                }}
              />
            </Field>
          )}
          <button
            disabled={a.busy || !file}
            onClick={() =>
              a.run(async () => {
                setConfirmed(false);
                setPreview(
                  await api.request<Preview>(
                    base + "/registration-import/preview",
                    "POST",
                    body(),
                  ),
                );
              })
            }
          >
            {a.busy ? "Working..." : "Preview import"}
          </button>
          {preview && (
            <>
              <h3>Import preview</h3>
              <p>
                {preview.counts.newStudents} new students;{" "}
                {preview.counts.updatedStudents} updates.{" "}
                {preview.counts.newGuests} new guests;{" "}
                {preview.counts.updatedGuests} updates.
              </p>
              {preview.errors.length > 0 && (
                <div role="alert">
                  <p>
                    Correct these errors, then upload and preview again. Nothing
                    has been imported.
                  </p>
                  <ul>
                    {preview.errors.map((e, i) => (
                      <li key={i}>
                        {e.sheet}
                        {e.row ? " row " + e.row : ""}: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sheet</th>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Student ID</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...preview.students.map((s) => ({
                        ...s,
                        sheet: "Students",
                      })),
                      ...preview.guests.map((g) => ({ ...g, sheet: "Guests" })),
                    ].map((r, i) => (
                      <tr key={i}>
                        <td>{r.sheet}</td>
                        <td>{r.row}</td>
                        <td>{r.fullName}</td>
                        <td>{r.studentId}</td>
                        <td>{r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={a.busy || !!preview.errors.length}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed the preview and confirm this import
              </label>
              <button
                className="primary"
                disabled={
                  a.busy ||
                  !confirmed ||
                  !!preview.errors.length ||
                  !(preview.students.length + preview.guests.length)
                }
                onClick={() =>
                  a.run(async () => {
                    const f = body();
                    f.set("previewHash", preview.previewHash);
                    f.set("requestKey", key);
                    f.set("confirmed", "true");
                    const result = await api.request<Preview>(
                      base + "/registration-import/commit",
                      "POST",
                      f,
                    );
                    setPreview(result);
                    setDone(true);
                    saved();
                  })
                }
              >
                Import confirmed records
              </button>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
