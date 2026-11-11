import { useMemo, useState } from "react";
import { Client } from "./api";
import { Dialog, Field, Notice, Loading, useAction, useResource } from "./ui";

export type MobileTicketView = {
  event: {
    id: number;
    name: string;
    venue: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    instructions: string;
  };
  ticket: {
    id: number;
    number: string;
    status: string;
    categoryName: string;
    categoryColor: string;
    expiresAt: string;
    checkedIn: boolean;
  };
  attendee: {
    fullName: string;
    email: string | null;
    phone: string;
  };
  studentName: string | null;
  entrances: string[];
  qrDataUri: string | null;
  pdfAvailable: boolean;
  transfer: {
    allowed: boolean;
    deadline: string | null;
    pending: {
      id: number;
      recipientName: string;
      createdAt: string;
      status: string;
    } | null;
  };
  canCancel: boolean;
  design: {
    primaryColor: string;
    accentColor: string;
    backgroundColor: string;
    layout: string;
    heading: string;
    footer: string;
  };
};

export function MobileTicketPage() {
  const token = useMemo(() => location.hash.slice(1), []);
  const api = useMemo(
    () => new Client(import.meta.env.VITE_API_URL || "", token),
    [token],
  );
  const data = useResource<MobileTicketView>(api, "public/tickets"),
    a = useAction();

  const [transferring, setTransferring] = useState(false),
    [cancelling, setCancelling] = useState(false),
    [message, setMessage] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID());

  if (!token) {
    return (
      <main className="auth">
        <h1>Dream Events · Mobile Ticket</h1>
        <p role="alert" className="notice error">
          Ticket link capability is missing. Please open the link using the full private URL provided to you.
        </p>
      </main>
    );
  }

  const t = data.data;

  return (
    <main className="auth public-mobile-ticket">
      <h1>Dream Events · Mobile Ticket</h1>
      <Notice error={data.error || a.error} />
      {message && <p role="status" className="notice">{message}</p>}

      {data.loading ? (
        <Loading />
      ) : t ? (
        <div
          className="mobile-ticket-card"
          style={{
            borderColor: t.design.accentColor,
            background: t.design.backgroundColor,
            color: t.design.primaryColor,
          }}
        >
          {t.design.heading && <p className="ticket-heading">{t.design.heading}</p>}
          <h2>{t.event.name}</h2>
          <p className="ticket-venue">
            {t.event.venue} ·{" "}
            {new Date(t.event.startsAt).toLocaleString(undefined, {
              timeZone: t.event.timezone,
            })}
          </p>

          <div className="ticket-guest-info">
            <p className="ticket-guest-name">
              <strong>{t.attendee.fullName}</strong>
            </p>
            {t.studentName && (
              <p className="ticket-student">Invited by: {t.studentName}</p>
            )}
            <p className="ticket-badge" style={{ backgroundColor: t.ticket.categoryColor + "22", borderColor: t.ticket.categoryColor }}>
              Category: <strong>{t.ticket.categoryName}</strong>
            </p>
            {t.entrances.length > 0 && (
              <p className="ticket-entrances">
                Permitted Entrances: <strong>{t.entrances.join(", ")}</strong>
              </p>
            )}
          </div>

          <div className="ticket-status-box">
            <span className={`status-badge ${t.ticket.status.toLowerCase()}`}>
              {t.ticket.checkedIn ? "Checked In" : t.ticket.status}
            </span>
            <p className="ticket-number">Ticket #{t.ticket.number}</p>
          </div>

          {t.qrDataUri && t.ticket.status === "Active" && !t.ticket.checkedIn && (
            <div className="ticket-qr-section">
              <img
                src={t.qrDataUri}
                alt="Entry QR Code"
                className="ticket-qr-image"
                style={{ maxWidth: "260px", margin: "16px auto", display: "block" }}
              />
              <p className="ticket-qr-hint">Present this QR code at the entrance for verification.</p>
            </div>
          )}

          {t.ticket.checkedIn && (
            <p className="notice">This ticket has already been used for entry.</p>
          )}
          {t.ticket.status === "Cancelled" && (
            <p className="notice error">This ticket has been cancelled.</p>
          )}
          {t.ticket.status === "Revoked" && (
            <p className="notice error">This ticket has been revoked.</p>
          )}

          {t.pdfAvailable && (
            <button
              type="button"
              className="pdf-download-btn"
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  const res = await fetch(
                    (import.meta.env.VITE_API_URL || "") + "/api/v1/public/tickets/pdf",
                    {
                      headers: { Authorization: "Bearer " + token },
                    },
                  );
                  if (!res.ok) throw new Error("Could not download PDF ticket.");
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = `${t.ticket.number}.pdf`;
                  anchor.click();
                  URL.revokeObjectURL(url);
                })
              }
            >
              Download PDF Ticket
            </button>
          )}

          {t.transfer.pending && (
            <div className="pending-transfer-box" role="status">
              <p>
                <strong>Transfer pending approval</strong> to{" "}
                <strong>{t.transfer.pending.recipientName}</strong> (requested{" "}
                {new Date(t.transfer.pending.createdAt).toLocaleDateString()}).
              </p>
              <button
                type="button"
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    await api.request("public/tickets/cancel-transfer", "POST");
                    setMessage("Transfer request cancelled.");
                    data.reload();
                  })
                }
              >
                Cancel transfer request
              </button>
            </div>
          )}

          <div className="ticket-actions">
            {t.transfer.allowed && !t.transfer.pending && (
              <button
                type="button"
                disabled={a.busy}
                onClick={() => {
                  setTransferring(true);
                  setKey(crypto.randomUUID());
                }}
              >
                Transfer ticket
              </button>
            )}

            {t.canCancel && (
              <button
                type="button"
                className="danger"
                disabled={a.busy}
                onClick={() => {
                  setCancelling(true);
                  setKey(crypto.randomUUID());
                }}
              >
                Cancel ticket
              </button>
            )}
          </div>

          {t.design.footer && <footer className="ticket-footer">{t.design.footer}</footer>}

          {transferring && (
            <Dialog
              title="Transfer ticket to someone else"
              close={() => !a.busy && setTransferring(false)}
            >
              <Notice error={a.error} />
              <p>
                Transferring this ticket will assign it to a new guest. Once approved, your current QR code and ticket will be permanently invalidated.
              </p>
              {t.transfer.deadline && (
                <p>
                  Transfer deadline:{" "}
                  <strong>
                    {new Date(t.transfer.deadline).toLocaleString(undefined, {
                      timeZone: t.event.timezone,
                    })}
                  </strong>
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  void a.run(async () => {
                    const res = await api.request<{
                      action: string;
                      status: string;
                      newTicketNumber?: string;
                    }>("public/tickets/transfer", "POST", {
                      action: "transfer",
                      requestKey: key,
                      recipientName: String(fd.get("recipientName") || "").trim(),
                      recipientEmail: String(fd.get("recipientEmail") || "").trim() || null,
                      recipientPhone: String(fd.get("recipientPhone") || "").trim(),
                      reason: String(fd.get("reason") || "").trim(),
                    });
                    setTransferring(false);
                    if (res.status === "Approved") {
                      setMessage(
                        `Ticket successfully transferred to ${fd.get("recipientName")}. Your original ticket is now cancelled.`,
                      );
                    } else {
                      setMessage(
                        "Transfer request submitted. Awaiting administrator approval.",
                      );
                    }
                    data.reload();
                  });
                }}
              >
                <Field label="New guest full name">
                  <input name="recipientName" required minLength={2} maxLength={200} />
                </Field>
                <Field label="New guest email (optional)">
                  <input name="recipientEmail" type="email" maxLength={254} />
                </Field>
                <Field label="New guest phone (optional)">
                  <input name="recipientPhone" type="tel" maxLength={40} />
                </Field>
                <Field label="Reason / notes (optional)">
                  <input name="reason" maxLength={1000} />
                </Field>
                <label className="check">
                  <input type="checkbox" required /> I confirm that my ticket and QR code will be invalidated once the transfer takes effect
                </label>
                <div className="actions">
                  <button type="button" onClick={() => setTransferring(false)} disabled={a.busy}>
                    Cancel
                  </button>
                  <button type="submit" className="primary" disabled={a.busy}>
                    Submit transfer
                  </button>
                </div>
              </form>
            </Dialog>
          )}

          {cancelling && (
            <Dialog
              title="Cancel your ticket"
              close={() => !a.busy && setCancelling(false)}
            >
              <Notice error={a.error} />
              <p role="alert" className="notice error">
                Are you sure you want to cancel your ticket? Your entry QR code will be permanently invalidated immediately. This cannot be undone.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  void a.run(async () => {
                    await api.request("public/tickets/cancel", "POST", {
                      action: "cancel",
                      requestKey: key,
                      confirmed: true,
                      reason: String(fd.get("reason") || "").trim(),
                    });
                    setCancelling(false);
                    setMessage("Your ticket has been cancelled.");
                    data.reload();
                  });
                }}
              >
                <Field label="Reason for cancellation">
                  <input name="reason" required minLength={5} maxLength={1000} />
                </Field>
                <label className="check">
                  <input type="checkbox" required /> I confirm that I want to cancel my ticket and invalidate my QR code
                </label>
                <div className="actions">
                  <button type="button" onClick={() => setCancelling(false)} disabled={a.busy}>
                    Back
                  </button>
                  <button type="submit" className="danger" disabled={a.busy}>
                    Confirm cancellation
                  </button>
                </div>
              </form>
            </Dialog>
          )}
        </div>
      ) : null}
    </main>
  );
}
