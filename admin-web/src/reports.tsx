import { useState } from "react";
import type { Client } from "./api";
import type { EventRecord, Identity } from "./types";
import { Empty, Loading, Notice, useAction, useResource } from "./ui";

type Report = {
  event: { name: string; timezone: string };
  summary: {
    registered: number; cancelled: number; issued: number; used: number;
    checkedIn: number; checkedAttendees: number; remaining: number;
    ticketCapacityRemaining: number; students: number; invitations: number;
    rejectedScans: number; transfers: Record<string, number>;
    delivery: Record<string, number>;
  };
  categories: { id: number; name: string; code: string; allocation: number; issued: number; used: number }[];
  entrances: { id: number; name: string; code: string; checkedIn: number }[];
  timeline: { checkedAt: string; ticketNumber: string; attendee: string; category: string; entrance: string; staff: string }[];
  noShows: { id: number; name: string; email: string | null; category: string; tickets: string }[];
  noShowLabel: string;
  truncated: { timeline: boolean; noShows: boolean };
};

export function ReportsPage({ api, event, identity }: { api: Client; event: EventRecord; identity: Identity }) {
  const report = useResource<Report>(api, `events/${event.id}/reports`);
  const action = useAction();
  const [section, setSection] = useState("Summary");
  const download = (format: "csv" | "xlsx") => void action.run(async () => {
    const file = await api.request<Blob>(`events/${event.id}/reports/export?format=${format}`, "GET", undefined, undefined, true);
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `event-${event.id}-report.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  const sections = ["Summary", "Categories", "Entrances", "Recent check-ins", report.data?.noShowLabel ?? "Not yet checked in",
    ...(["super_admin", "checkin_supervisor"].includes(identity.role) ? ["Scanner staff"] : []),
    ...(identity.permissions.includes("system.manage") ? ["Audit history"] : [])];
  const time = (value: string) => new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: report.data?.event.timezone ?? "UTC",
  }).format(new Date(value));
  return <>
    <h1>Reports</h1>
    <p>{event.name}</p>
    <div className="actions">
      <button onClick={report.reload}>Refresh reports</button>
      {identity.permissions.includes("exports.create") && <>
        <button disabled={action.busy || report.loading} onClick={() => download("xlsx")}>Download Excel report</button>
        <button disabled={action.busy || report.loading} onClick={() => download("csv")}>Download summary CSV</button>
      </>}
    </div>
    <Notice error={report.error || action.error} />
    {report.loading ? <Loading /> : report.data ? <>
      <label>View table <select value={section} onChange={(e) => setSection(e.target.value)}>
        {sections.map((name) => <option key={name}>{name}</option>)}
      </select></label>
      {section === "Summary" && <table><tbody>
        {([
          ["Registered attendees", report.data.summary.registered],
          ["Tickets issued", report.data.summary.issued],
          ["Attendees checked in", report.data.summary.checkedAttendees],
          ["Accepted entries", report.data.summary.checkedIn],
          ["Remaining attendees", report.data.summary.remaining],
          ["Ticket capacity remaining", report.data.summary.ticketCapacityRemaining],
          ["Active students", report.data.summary.students],
          ["Active invitations", report.data.summary.invitations],
          ["Cancelled attendees", report.data.summary.cancelled],
          ["Rejected scans", report.data.summary.rejectedScans],
          ...Object.entries(report.data.summary.transfers).map(([name, count]) => [`Transfers: ${name}`, count] as const),
          ...Object.entries(report.data.summary.delivery).map(([name, count]) => [`Email jobs: ${name}`, count] as const),
        ] as (readonly [string, number])[]).map(([name, count]) => <tr key={name}><th scope="row">{name}</th><td>{count}</td></tr>)}
      </tbody></table>}
      {section === "Categories" && <div className="table-wrap"><table><thead><tr><th>Category</th><th>Code</th><th>Allocation</th><th>Issued</th><th>Checked in</th></tr></thead><tbody>
        {report.data.categories.map((row) => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.code}</td><td>{row.allocation}</td><td>{row.issued}</td><td>{row.used}</td></tr>)}
      </tbody></table></div>}
      {section === "Entrances" && <div className="table-wrap"><table><thead><tr><th>Entrance</th><th>Code</th><th>Accepted entries</th></tr></thead><tbody>
        {report.data.entrances.map((row) => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.code}</td><td>{row.checkedIn}</td></tr>)}
      </tbody></table></div>}
      {section === "Recent check-ins" && <><p>Showing the latest 200 entries. Download Excel for the full list.</p>{report.data.timeline.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Ticket</th><th>Attendee</th><th>Category</th><th>Entrance</th><th>Staff</th></tr></thead><tbody>
        {report.data.timeline.map((row) => <tr key={row.ticketNumber}><td>{time(row.checkedAt)}</td><td>{row.ticketNumber}</td><td>{row.attendee}</td><td>{row.category}</td><td>{row.entrance}</td><td>{row.staff}</td></tr>)}
      </tbody></table></div> : <Empty>No check-ins yet.</Empty>}</>}
      {section === report.data.noShowLabel && <><p>{report.data.truncated.noShows ? "Showing the first 500 attendees. Download Excel for the full list." : `${report.data.summary.remaining} attendees.`}</p>{report.data.noShows.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Category</th><th>Tickets</th></tr></thead><tbody>
        {report.data.noShows.map((row) => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.email || "—"}</td><td>{row.category}</td><td>{row.tickets || "—"}</td></tr>)}
      </tbody></table></div> : <Empty>Everyone has checked in.</Empty>}</>}
      {section === "Audit history" && identity.permissions.includes("system.manage") && <AuditHistory api={api} eventId={event.id} canExport={identity.permissions.includes("exports.create")} />}
      {section === "Scanner staff" && ["super_admin", "checkin_supervisor"].includes(identity.role) && <ScannerStaff api={api} eventId={event.id} />}
    </> : <Empty>Report unavailable.</Empty>}
  </>;
}

function ScannerStaff({ api, eventId }: { api: Client; eventId: number }) {
  const monitor = useResource<{ staff: { id: number; username: string; name: string; active: boolean; connected: boolean; lastSeen: string | null; entrance: string | null; accepted: number; rejected: number }[]; truncated: boolean }>(api, `events/${eventId}/reports/scanners`);
  return <section className="plain-section">
    <h2>Scanner staff</h2>
    <button onClick={monitor.reload}>Refresh scanner activity</button>
    <Notice error={monitor.error} />
    {monitor.loading ? <Loading /> : monitor.data?.staff.length ? <>
      {monitor.data.truncated && <p>Showing the first 200 assigned staff.</p>}
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Status</th><th>Entrance</th><th>Last seen</th><th>Accepted</th><th>Rejected</th></tr></thead><tbody>
        {monitor.data.staff.map((row) => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.username}</td><td>{!row.active ? "Disabled" : row.connected ? "Connected" : "Not connected"}</td><td>{row.entrance || "—"}</td><td>{row.lastSeen ? new Date(row.lastSeen).toLocaleString() : "—"}</td><td>{row.accepted}</td><td>{row.rejected}</td></tr>)}
      </tbody></table></div>
    </> : <Empty>No scanner staff assigned to this event.</Empty>}
  </section>;
}

function AuditHistory({ api, eventId, canExport }: { api: Client; eventId: number; canExport: boolean }) {
  const audit = useResource<{ rows: { id: number; createdAt: string; action: string; actor: string; details: string }[]; hasMore: boolean }>(api, `events/${eventId}/reports/audit`);
  const action = useAction();
  const download = () => void action.run(async () => {
    const file = await api.request<Blob>(`events/${eventId}/reports/audit/export`, "GET", undefined, undefined, true);
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `event-${eventId}-audit.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  return <section className="plain-section">
    <h2>Event audit history</h2>
    <div className="actions"><button onClick={audit.reload}>Refresh history</button>
      {canExport && <button disabled={action.busy || audit.loading} onClick={download}>Download audit CSV</button>}
    </div>
    <Notice error={audit.error || action.error} />
    {audit.loading ? <Loading /> : audit.data?.rows.length ? <>
      {audit.data.hasMore && <p>Showing the latest 200 entries. Download CSV for up to 5,000 entries.</p>}
      <div className="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead><tbody>
        {audit.data.rows.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString()}</td><td>{row.action}</td><td>{row.actor}</td><td>{row.details || "—"}</td></tr>)}
      </tbody></table></div>
    </> : <Empty>No audit entries for this event.</Empty>}
  </section>;
}
