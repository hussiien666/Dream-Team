import { useState } from "react";
import type { Client } from "./api";
import type { EventRecord } from "./types";
import { DeliveryPanel, SendTickets } from "./delivery";
import {
  Dialog,
  Empty,
  Field,
  Loading,
  Notice,
  useAction,
  useResource,
} from "./ui";
type Ticket = {
  id: number;
  number: string;
  status: string;
  attendeeId: number;
  recoverable: boolean;
  attendee: { fullName: string };
  category: { name: string };
};
type Candidate = {
  id: number;
  fullName: string;
  category: { name: string; active: boolean };
  tickets: { id: number }[];
  guestInvitation: null | {
    active: boolean;
    invitationGroup: string;
    studentId: number;
    student: { fullName: string; active: boolean };
  };
};
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TicketsPage({
  api,
  event,
  isSuperAdmin = false,
}: {
  api: Client;
  event: EventRecord;
  isSuperAdmin?: boolean;
}) {
  const base = `events/${event.id}/tickets`,
    rows = useResource<Ticket[]>(api, base),
    candidates = useResource<Candidate[]>(api, base + "/candidates");
  const a = useAction(),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [downloads, setDownloads] = useState<number[]>([]),
    [key, setKey] = useState(() => crypto.randomUUID());
  const [delivery, setDelivery] = useState(false),
    [transfers, setTransfers] = useState(false),
    [mobileLinkTicket, setMobileLinkTicket] = useState<Ticket>(),
    [transferTicket, setTransferTicket] = useState<Ticket>(),
    [send, setSend] = useState(false),
    [student, setStudent] = useState(""),
    [group, setGroup] = useState("");
  const [preview, setPreview] = useState(false),
    [result, setResult] = useState(""),
    [operation, setOperation] = useState<{ ticket: Ticket; action: string }>();
  const closed =
      event.archived || ["Cancelled", "Completed"].includes(event.status),
    issuable =
      !closed &&
      ["Published", "Ongoing", "Upcoming", "Active"].includes(event.status);
  const eligible = (candidates.data ?? []).filter(
    (c) =>
      (!student || c.guestInvitation?.studentId === Number(student)) &&
      (!group || c.guestInvitation?.invitationGroup === group) &&
      !c.tickets.length &&
      c.category.active &&
      (!c.guestInvitation ||
        (c.guestInvitation.active && c.guestInvitation.student.active)),
  );
  const refresh = () => {
    rows.reload();
    candidates.reload();
  };
  const choose = (ids: number[]) => {
    setSelected(ids);
    setKey(crypto.randomUUID());
  };
  if (delivery)
    return (
      <DeliveryPanel
        api={api}
        base={base}
        readOnly={event.archived}
        back={() => setDelivery(false)}
      />
    );
  if (transfers)
    return (
      <TransfersPanel
        api={api}
        event={event}
        isSuperAdmin={isSuperAdmin}
        back={() => {
          setTransfers(false);
          refresh();
        }}
      />
    );
  return (
    <>
      <h1>Tickets</h1>
      <p>
        Generate tickets, download updated files with the same QR, and manage
        unused tickets.
      </p>
      <Notice error={rows.error || candidates.error || a.error} />
      {result && <p role="status">{result}</p>}
      <div className="toolbar">
        <Field label="Search tickets">
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <button onClick={refresh}>Refresh tickets</button>
        <button onClick={() => setDelivery(true)}>Email delivery</button>
        <button onClick={() => setTransfers(true)}>Transfers</button>
        {!event.archived && (
          <button disabled={!downloads.length} onClick={() => setSend(true)}>
            Email selected tickets
          </button>
        )}
        <button
          disabled={a.busy || !downloads.length}
          onClick={() =>
            void a.run(async () =>
              save(
                await api.request<Blob>(
                  base + "/download-zip",
                  "POST",
                  { ticketIds: downloads },
                  undefined,
                  true,
                ),
                "tickets.zip",
              ),
            )
          }
        >
          Download selected ZIP ({downloads.length})
        </button>
      </div>
      {rows.loading ? (
        <Loading />
      ) : !rows.data?.length ? (
        <Empty>No tickets issued for this event.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Attendee</th>
                <th>Ticket number</th>
                <th>Category</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.data
                .filter((t) =>
                  `${t.attendee.fullName} ${t.number} ${t.category.name}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((t) => (
                  <tr key={t.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ticket ${t.number}`}
                        checked={downloads.includes(t.id)}
                        disabled={
                          !t.recoverable ||
                          (!downloads.includes(t.id) && downloads.length >= 50)
                        }
                        onChange={(e) =>
                          setDownloads(
                            e.target.checked
                              ? [...downloads, t.id]
                              : downloads.filter((id) => id !== t.id),
                          )
                        }
                      />
                    </td>
                    <td>{t.attendee.fullName}</td>
                    <td>{t.number}</td>
                    <td>{t.category.name}</td>
                    <td>{t.status}</td>
                    <td>
                      {t.recoverable ? (
                        <>
                          {(["pdf", "html"] as const).map((f) => (
                            <button
                              key={f}
                              disabled={a.busy}
                              onClick={() =>
                                void a.run(async () =>
                                  save(
                                    await api.request<Blob>(
                                      `${base}/${t.id}/${f}`,
                                      "GET",
                                      undefined,
                                      undefined,
                                      true,
                                    ),
                                    `${t.number}.${f}`,
                                  ),
                                )
                              }
                            >
                              Download {f.toUpperCase()}
                            </button>
                          ))}
                        </>
                      ) : (
                        <span>Original QR required to recover files. </span>
                      )}
                      {!event.archived && (
                        <>
                          {!t.recoverable && (
                            <button
                              onClick={() =>
                                setOperation({ ticket: t, action: "adopt" })
                              }
                            >
                              Recover original QR
                            </button>
                          )}
                          {t.recoverable && (
                            <button
                              disabled={a.busy}
                              onClick={() =>
                                void a.run(async () => {
                                  await api.request(
                                    `${base}/${t.id}/regenerate`,
                                    "POST",
                                    {},
                                  );
                                  setResult(
                                    "Ticket files refreshed. Its QR is unchanged.",
                                  );
                                  refresh();
                                })
                              }
                            >
                              Refresh printed details
                            </button>
                          )}
                          {!["Used", "Revoked"].includes(t.status) && (
                            <>
                              {t.status !== "Cancelled" && (
                                <button
                                  onClick={() =>
                                    setOperation({
                                      ticket: t,
                                      action: "cancel",
                                    })
                                  }
                                >
                                  Cancel ticket
                                </button>
                              )}
                              {!closed &&
                                ["Cancelled", "Expired"].includes(t.status) && (
                                  <button
                                    onClick={() =>
                                      setOperation({
                                        ticket: t,
                                        action: "reactivate",
                                      })
                                    }
                                  >
                                    Reactivate ticket
                                  </button>
                                )}
                              {!closed && t.status === "Active" && (
                                <button
                                  onClick={() =>
                                    setOperation({
                                      ticket: t,
                                      action: "replace",
                                    })
                                  }
                                >
                                  Replace QR
                                </button>
                              )}
                              <button
                                onClick={() =>
                                  setOperation({ ticket: t, action: "revoke" })
                                }
                              >
                                Permanently revoke
                              </button>
                              <button
                                type="button"
                                onClick={() => setMobileLinkTicket(t)}
                              >
                                Mobile link
                              </button>
                              {t.status === "Active" && (
                                <button
                                  type="button"
                                  onClick={() => setTransferTicket(t)}
                                >
                                  Transfer
                                </button>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {issuable && (
        <section className="plain-section">
          <h2>Generate tickets</h2>
          <div className="toolbar">
            <Field label="Inviting student">
              <select
                aria-label="Inviting student"
                value={student}
                onChange={(e) => {
                  setStudent(e.target.value);
                  choose([]);
                }}
              >
                <option value="">All students / independent attendees</option>
                {[
                  ...new Map(
                    (candidates.data ?? [])
                      .filter((c) => c.guestInvitation)
                      .map((c) => [
                        c.guestInvitation!.studentId,
                        c.guestInvitation!,
                      ]),
                  ).values(),
                ].map((g) => (
                  <option key={g.studentId} value={g.studentId}>
                    {g.student.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Invitation group">
              <select
                aria-label="Invitation group"
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  choose([]);
                }}
              >
                <option value="">All invitation groups</option>
                {[
                  ...new Set(
                    (candidates.data ?? [])
                      .map((c) => c.guestInvitation?.invitationGroup)
                      .filter(Boolean),
                  ),
                ].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p>
            Choose up to 500 registrations without a live ticket. The complete
            selection is saved together.
          </p>
          {candidates.loading ? (
            <Loading />
          ) : !eligible.length ? (
            <Empty>No eligible registrations without tickets.</Empty>
          ) : (
            <>
              <button
                disabled={a.busy}
                onClick={() => choose(eligible.slice(0, 500).map((c) => c.id))}
              >
                Select first {Math.min(eligible.length, 500)}
              </button>
              <button onClick={() => choose([])}>Clear selection</button>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Attendee</th>
                      <th>Category</th>
                      <th>Student / group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligible.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${c.fullName}`}
                            checked={selected.includes(c.id)}
                            disabled={
                              !selected.includes(c.id) && selected.length >= 500
                            }
                            onChange={(e) =>
                              choose(
                                e.target.checked
                                  ? [...selected, c.id]
                                  : selected.filter((id) => id !== c.id),
                              )
                            }
                          />
                        </td>
                        <td>{c.fullName}</td>
                        <td>{c.category.name}</td>
                        <td>
                          {c.guestInvitation
                            ? `${c.guestInvitation.student.fullName} / ${c.guestInvitation.invitationGroup}`
                            : "Independent attendee"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="primary"
                disabled={!selected.length}
                onClick={() => setPreview(true)}
              >
                Review selected tickets ({selected.length})
              </button>
            </>
          )}
        </section>
      )}
      {!issuable && (
        <p>
          Issuance is available for open, published events. Existing files
          remain available.
        </p>
      )}
      {preview && (
        <Dialog
          title="Review ticket generation"
          close={() => {
            if (!a.busy) setPreview(false);
          }}
        >
          <p>
            Generate {selected.length} tickets? Existing QR identities are never
            changed by generation. Configured email delivery jobs are queued
            automatically.
          </p>
          <ul>
            {eligible
              .filter((c) => selected.includes(c.id))
              .map((c) => (
                <li key={c.id}>
                  {c.fullName} — {c.category.name}
                </li>
              ))}
          </ul>
          <Notice error={a.error} />
          <footer>
            <button disabled={a.busy} onClick={() => setPreview(false)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  const r = await api.request<{ count: number }>(
                    base + "/batch-issue",
                    "POST",
                    { attendeeIds: selected, requestKey: key },
                  );
                  setResult(
                    `${r.count} tickets generated. Download files or review Email delivery for queued messages.`,
                  );
                  setPreview(false);
                  choose([]);
                  refresh();
                })
              }
            >
              {a.busy ? "Generating..." : "Confirm generation"}
            </button>
          </footer>
        </Dialog>
      )}
      {send && (
        <SendTickets
          api={api}
          base={base}
          ids={downloads}
          close={() => setSend(false)}
          done={(count) => {
            setSend(false);
            setResult(
              `${count} email jobs queued. Review Email delivery for progress.`,
            );
          }}
        />
      )}
      {operation && (
        <TicketOperation
          api={api}
          base={base}
          {...operation}
          close={() => setOperation(undefined)}
          done={() => {
            setOperation(undefined);
            refresh();
            setResult("Ticket operation completed.");
          }}
        />
      )}
      {mobileLinkTicket && (
        <MobileLinkDialog
          api={api}
          eventId={event.id}
          ticket={mobileLinkTicket}
          close={() => setMobileLinkTicket(undefined)}
        />
      )}
      {transferTicket && (
        <AdminTransferDialog
          api={api}
          eventId={event.id}
          ticket={transferTicket}
          isSuperAdmin={isSuperAdmin}
          close={() => setTransferTicket(undefined)}
          done={(msg) => {
            setTransferTicket(undefined);
            setResult(msg);
            refresh();
          }}
        />
      )}
    </>
  );
}
function TicketOperation({
  api,
  base,
  ticket,
  action,
  close,
  done,
}: {
  api: Client;
  base: string;
  ticket: Ticket;
  action: string;
  close: () => void;
  done: () => void;
}) {
  const a = useAction(),
    [reason, setReason] = useState(""),
    [qr, setQr] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const title: Record<string, string> = {
    adopt: "Recover original QR",
    cancel: "Cancel ticket",
    reactivate: "Reactivate ticket",
    replace: "Replace QR",
    revoke: "Permanently revoke",
  };
  return (
    <Dialog
      title={title[action]}
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api.request(
              `${base}/${ticket.id}/${action}`,
              "POST",
              action === "adopt" ? { confirmed, qr } : { confirmed, reason },
            );
            done();
          });
        }}
      >
        <p>
          {ticket.attendee.fullName} — {ticket.number}
        </p>
        {action === "replace" && (
          <p>
            The previous QR will stop working. Ticket number and history are
            retained.
          </p>
        )}
        {action === "revoke" && <p>Permanent revocation cannot be undone.</p>}
        {action === "adopt" ? (
          <Field label="Original QR text">
            <input
              type="password"
              autoComplete="off"
              value={qr}
              onChange={(e) => setQr(e.target.value.trim())}
              required
              pattern={"AAST1\\.[A-Za-z0-9_\\-]{43}"}
            />
          </Field>
        ) : (
          <Field label="Reason">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={1000}
              required
            />
          </Field>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            required
          />
          I confirm this ticket operation
        </label>
        <Notice error={a.error} />
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy || !confirmed}>
            {a.busy ? "Saving..." : "Confirm ticket operation"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

export function MobileLinkDialog({
  api,
  eventId,
  ticket,
  close,
}: {
  api: Client;
  eventId: number;
  ticket: Ticket;
  close: () => void;
}) {
  const base = `events/${eventId}/tickets/${ticket.id}/mobile-link`;
  const data = useResource<{ id: number; expiresAt: string; revokedAt: string | null }[]>(
    api,
    base,
  );
  const a = useAction();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");

  return (
    <Dialog title="Mobile ticket link" close={close}>
      <p>
        {ticket.attendee.fullName} · {ticket.number}
      </p>
      <Notice error={a.error || data.error} />
      {message && <p role="status">{message}</p>}
      <p>
        This link allows the guest to view their mobile ticket, present entry QR, download PDF, or initiate a transfer.
      </p>
      <p>
        {data.data?.filter((l) => !l.revokedAt && new Date(l.expiresAt) > new Date()).length ?? 0} active links.
      </p>
      <Field label="Action reason">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={1000}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I confirm that previous mobile ticket links for this ticket will stop working
      </label>
      <div className="actions">
        <button
          disabled={a.busy || !confirmed || reason.trim().length < 5}
          onClick={() =>
            void a.run(async () => {
              const r = await api.request<{ path: string }>(base, "POST", {
                confirmed: true,
                reason,
              });
              setUrl(new URL(r.path, location.origin).href);
              setMessage("Mobile ticket link created. Copy it now; it cannot be retrieved later.");
              data.reload();
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
              setMessage("All mobile links revoked.");
              data.reload();
            })
          }
        >
          Revoke all links
        </button>
      </div>
      {url && (
        <div className="link-result-box">
          <Field label="Private mobile ticket URL">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="actions">
            <button
              type="button"
              onClick={() =>
                void a.run(async () => {
                  await navigator.clipboard.writeText(url);
                  setMessage("Link copied to clipboard.");
                })
              }
            >
              Copy link
            </button>
            <a href={url} target="_blank" rel="noreferrer">
              Open mobile ticket
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function AdminTransferDialog({
  api,
  eventId,
  ticket,
  isSuperAdmin,
  close,
  done,
}: {
  api: Client;
  eventId: number;
  ticket: Ticket;
  isSuperAdmin: boolean;
  close: () => void;
  done: (msg: string) => void;
}) {
  const a = useAction();
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [reason, setReason] = useState("");
  const [approveImmediately, setApproveImmediately] = useState(true);
  const [superAdminOverride, setSuperAdminOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  return (
    <Dialog title="Transfer ticket" close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            const res = await api.request<{
              transferId: number;
              status: string;
              newTicketNumber?: string;
            }>(`events/${eventId}/tickets/${ticket.id}/transfers`, "POST", {
              recipientName: recipientName.trim(),
              recipientEmail: recipientEmail.trim() || null,
              recipientPhone: recipientPhone.trim(),
              reason: reason.trim(),
              approveImmediately,
              superAdminOverride,
              overrideReason: superAdminOverride ? overrideReason.trim() : undefined,
            });
            if (res.status === "Approved") {
              done(`Ticket successfully transferred. New ticket: ${res.newTicketNumber}`);
            } else {
              done("Transfer request created and pending approval.");
            }
          });
        }}
      >
        <p>
          Transferring ticket <strong>{ticket.number}</strong> (Current attendee:{" "}
          <strong>{ticket.attendee.fullName}</strong>).
        </p>
        <Notice error={a.error} />
        <Field label="Recipient full name">
          <input
            required
            minLength={2}
            maxLength={200}
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
          />
        </Field>
        <Field label="Recipient email (optional)">
          <input
            type="email"
            maxLength={254}
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
          />
        </Field>
        <Field label="Recipient phone (optional)">
          <input
            type="tel"
            maxLength={40}
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
          />
        </Field>
        <Field label="Reason / notes (optional)">
          <input
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={approveImmediately}
            onChange={(e) => setApproveImmediately(e.target.checked)}
          />
          Approve and issue new ticket immediately
        </label>
        {isSuperAdmin && (
          <fieldset>
            <legend>Super Admin Controls</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={superAdminOverride}
                onChange={(e) => setSuperAdminOverride(e.target.checked)}
              />
              Override transfer deadline if passed
            </label>
            {superAdminOverride && (
              <Field label="Override reason">
                <input
                  required
                  minLength={5}
                  maxLength={1000}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              </Field>
            )}
          </fieldset>
        )}
        <div className="actions">
          <button type="button" onClick={close} disabled={a.busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              a.busy ||
              (superAdminOverride && overrideReason.trim().length < 5)
            }
          >
            {a.busy ? "Transferring..." : "Confirm transfer"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type TransferItem = {
  id: number;
  eventId: number;
  ticketId: number;
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone: string;
  initiatedBy: string;
  status: string;
  deadline: string | null;
  superAdminOverride: boolean;
  createdAt: string;
  ticket: { number: string; status: string };
  fromAttendee: { id: number; fullName: string; email: string | null; phone: string };
  toAttendee: { id: number; fullName: string; email: string | null; phone: string } | null;
  resolver: { id: number; displayName: string; username: string } | null;
  requesterActor: { id: number; displayName: string; username: string } | null;
};

export function TransfersPanel({
  api,
  event,
  isSuperAdmin,
  back,
}: {
  api: Client;
  event: EventRecord;
  isSuperAdmin: boolean;
  back: () => void;
}) {
  const [filter, setFilter] = useState("All");
  const data = useResource<TransferItem[]>(
    api,
    `events/${event.id}/transfers${filter !== "All" ? `?status=${filter}` : ""}`,
  );
  const a = useAction();
  const [approveTransfer, setApproveTransfer] = useState<TransferItem>();
  const [rejectTransfer, setRejectTransfer] = useState<TransferItem>();
  const [overrideReason, setOverrideReason] = useState("");
  const [superAdminOverride, setSuperAdminOverride] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <>
      <div className="toolbar">
        <button onClick={back}>← Back to tickets</button>
        <h2>Transfers · {event.name}</h2>
      </div>
      <Notice error={data.error || a.error} />
      <div className="toolbar">
        <Field label="Status filter">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="All">All statuses</option>
            <option value="Pending">Pending approval</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </Field>
        <button onClick={() => data.reload()}>Refresh transfers</button>
      </div>

      {data.loading ? (
        <Loading />
      ) : !data.data?.length ? (
        <Empty>No transfers found.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Ticket #</th>
                <th>From Guest</th>
                <th>To Recipient</th>
                <th>Initiated By</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((tr) => (
                <tr key={tr.id}>
                  <td>{new Date(tr.createdAt).toLocaleDateString()}</td>
                  <td>{tr.ticket?.number ?? `Ticket #${tr.ticketId}`}</td>
                  <td>{tr.fromAttendee.fullName}</td>
                  <td>
                    <strong>{tr.recipientName}</strong>
                    {tr.recipientEmail && <div>{tr.recipientEmail}</div>}
                    {tr.recipientPhone && <div>{tr.recipientPhone}</div>}
                  </td>
                  <td>
                    {tr.initiatedBy === "guest"
                      ? "Guest (Mobile link)"
                      : tr.requesterActor
                        ? `Admin (${tr.requesterActor.displayName})`
                        : "Admin"}
                  </td>
                  <td>
                    <span className={`status-badge ${tr.status.toLowerCase()}`}>
                      {tr.status}
                    </span>
                    {tr.superAdminOverride && (
                      <span title="Super Admin Override"> (Override)</span>
                    )}
                  </td>
                  <td>
                    {tr.status === "Pending" && (
                      <div className="actions">
                        <button
                          className="primary"
                          disabled={a.busy}
                          onClick={() => {
                            setApproveTransfer(tr);
                            setSuperAdminOverride(false);
                            setOverrideReason("");
                          }}
                        >
                          Approve
                        </button>
                        <button
                          className="danger"
                          disabled={a.busy}
                          onClick={() => {
                            setRejectTransfer(tr);
                            setRejectReason("");
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approveTransfer && (
        <Dialog
          title="Approve ticket transfer"
          close={() => setApproveTransfer(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await api.request(
                  `events/${event.id}/transfers/${approveTransfer.id}/approve`,
                  "POST",
                  {
                    confirmed: true,
                    superAdminOverride,
                    overrideReason: superAdminOverride
                      ? overrideReason.trim()
                      : undefined,
                  },
                );
                setApproveTransfer(undefined);
                data.reload();
              });
            }}
          >
            <p>
              Approve transfer of ticket{" "}
              <strong>{approveTransfer.ticket?.number}</strong> from{" "}
              <strong>{approveTransfer.fromAttendee.fullName}</strong> to{" "}
              <strong>{approveTransfer.recipientName}</strong>.
            </p>
            <p>
              The original ticket and QR will be invalidated immediately. A new
              valid ticket will be issued for {approveTransfer.recipientName}.
            </p>
            {isSuperAdmin && (
              <fieldset>
                <legend>Super Admin Controls</legend>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={superAdminOverride}
                    onChange={(e) => setSuperAdminOverride(e.target.checked)}
                  />
                  Override transfer deadline if passed
                </label>
                {superAdminOverride && (
                  <Field label="Override reason">
                    <input
                      required
                      minLength={5}
                      maxLength={1000}
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                    />
                  </Field>
                )}
              </fieldset>
            )}
            <Notice error={a.error} />
            <div className="actions">
              <button
                type="button"
                onClick={() => setApproveTransfer(undefined)}
                disabled={a.busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={
                  a.busy ||
                  (superAdminOverride && overrideReason.trim().length < 5)
                }
              >
                Confirm Approval
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {rejectTransfer && (
        <Dialog
          title="Reject ticket transfer"
          close={() => setRejectTransfer(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await api.request(
                  `events/${event.id}/transfers/${rejectTransfer.id}/reject`,
                  "POST",
                  { reason: rejectReason.trim() },
                );
                setRejectTransfer(undefined);
                data.reload();
              });
            }}
          >
            <p>
              Reject transfer request for ticket{" "}
              <strong>{rejectTransfer.ticket?.number}</strong> to{" "}
              <strong>{rejectTransfer.recipientName}</strong>.
            </p>
            <p>
              The original ticket will remain active for{" "}
              {rejectTransfer.fromAttendee.fullName}.
            </p>
            <Field label="Rejection reason">
              <input
                required
                minLength={5}
                maxLength={1000}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </Field>
            <Notice error={a.error} />
            <div className="actions">
              <button
                type="button"
                onClick={() => setRejectTransfer(undefined)}
                disabled={a.busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="danger"
                disabled={a.busy || rejectReason.trim().length < 5}
              >
                Confirm Rejection
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
