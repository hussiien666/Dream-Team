import { useState, useEffect } from "react";
import type { Client } from "./api";
import {
  Dialog,
  Field,
  Loading,
  Empty,
  Notice,
  useAction,
  useResource,
} from "./ui";
type Template = {
  subject: string;
  greeting: string;
  body: string;
  signature: string;
  contact: string;
};
type Settings = { enabled: boolean; template: Template };
type History = {
  enabled: boolean;
  deliveries: {
    jobId: number;
    recipient: string;
    ticket: { number: string; attendee: { fullName: string } };
    job: {
      status: string;
      attempts: number;
      availableAt: string;
      lastError: string;
      mailDelivery: { status: string };
    };
  }[];
  notices: { jobId: number; message: string }[];
};
export function DeliveryPanel({
  api,
  base,
  readOnly,
  back,
}: {
  api: Client;
  base: string;
  readOnly: boolean;
  back: () => void;
}) {
  const history = useResource<History>(api, base + "/deliveries"),
    settings = useResource<Settings>(api, base + "/delivery-settings"),
    [edit, setEdit] = useState(false);
  return (
    <>
      <h1>Ticket email delivery</h1>
      <div className="toolbar">
        <button onClick={back}>Back to tickets</button>
        <button onClick={history.reload}>Refresh delivery status</button>
        {!readOnly && settings.data && (
          <button onClick={() => setEdit(true)}>
            Edit ticket email template
          </button>
        )}
      </div>
      <Notice error={history.error || settings.error} />
      {history.data && !history.data.enabled && (
        <p role="status">
          Email is disabled. Tickets are still downloadable. Configure the
          server provider and start its email worker before expecting delivery.
        </p>
      )}
      <p>
        Select tickets on the Tickets table to review recipients and queue
        delivery. Sending runs in the background. Sent means provider
        acceptance; Delivered means a provider callback, not a read receipt.
        Check Unknown results with the provider before resending.
      </p>
      {!!history.data?.notices.length && (
        <section className="plain-section">
          <h2>Delivery issues</h2>
          <ul>
            {history.data.notices.map((n) => (
              <li key={n.jobId}>
                Job {n.jobId}: {n.message.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        </section>
      )}
      {history.loading ? (
        <Loading />
      ) : !history.data?.deliveries.length ? (
        <Empty>No ticket email has been queued.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Attendee / ticket</th>
                <th>Recipient</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Next attempt / issue</th>
              </tr>
            </thead>
            <tbody>
              {history.data.deliveries.map((d) => (
                <tr key={d.jobId}>
                  <td>
                    {d.ticket.attendee.fullName}
                    <br />
                    {d.ticket.number}
                  </td>
                  <td>{d.recipient}</td>
                  <td>
                    {d.job.status === "Pending"
                      ? "Pending"
                      : d.job.status === "Running"
                        ? "Sending"
                        : d.job.mailDelivery.status}
                  </td>
                  <td>{d.job.attempts}</td>
                  <td>
                    {d.job.lastError.replaceAll("_", " ")}
                    {d.job.status === "Pending" && (
                      <>
                        <br />
                        {new Date(d.job.availableAt).toLocaleString()}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>Showing the latest 200 deliveries and 50 notices.</p>
      {edit && settings.data && (
        <TemplateForm
          api={api}
          base={base}
          template={settings.data.template}
          close={() => setEdit(false)}
          done={() => {
            setEdit(false);
            settings.reload();
          }}
        />
      )}
    </>
  );
}
function TemplateForm({
  api,
  base,
  template,
  close,
  done,
}: {
  api: Client;
  base: string;
  template: Template;
  close: () => void;
  done: () => void;
}) {
  const [value, setValue] = useState(template),
    a = useAction();
  return (
    <Dialog
      title="Ticket email template"
      close={() => {
        if (!a.busy) close();
      }}
    >
      <p>
        Placeholders:{" "}
        {"{guest_name}, {student_name}, {event_name}, {event_date}"}. Use plain
        text; ticket branding is applied automatically. Messages include PDF
        attachments.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api.request(base + "/delivery-settings", "PATCH", value);
            done();
          });
        }}
      >
        {(Object.keys(value) as (keyof Template)[]).map((key) => (
          <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
            {key === "subject" ? (
              <input
                value={value[key]}
                required
                maxLength={300}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            ) : (
              <textarea
                value={value[key]}
                maxLength={6000}
                required={key === "body"}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            )}
          </Field>
        ))}
        <Notice error={a.error} />
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={a.busy}>
            Save email template
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export function SendTickets({
  api,
  base,
  ids,
  close,
  done,
}: {
  api: Client;
  base: string;
  ids: number[];
  close: () => void;
  done: (count: number) => void;
}) {
  const [preview, setPreview] = useState<{
      enabled: boolean;
      rows: {
        ticketId: number;
        number: string;
        attendee: string;
        recipients: string[];
        eligible: boolean;
      }[];
    }>(),
    [resend, setResend] = useState(false),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [key] = useState(() => crypto.randomUUID()),
    a = useAction();
  useEffect(() => {
    void a.run(async () =>
      setPreview(
        await api.request(base + "/delivery-preview", "POST", {
          ticketIds: ids,
        }),
      ),
    );
  }, []);
  return (
    <Dialog
      title="Review ticket email recipients"
      close={() => {
        if (!a.busy) close();
      }}
    >
      <Notice error={a.error} />
      {!preview ? (
        <Loading />
      ) : (
        <>
          <p>
            Recipients receive separate private messages with the same ticket
            QR. Student copies follow event settings.
          </p>
          {!preview.enabled && (
            <p>Email delivery is disabled on this server.</p>
          )}
          <ul>
            {preview.rows.map((row) => (
              <li key={row.ticketId}>
                {row.attendee} ({row.number}):{" "}
                {row.recipients.join(", ") || "No recipient configured"}
                {!row.eligible ? " - ticket is not eligible for email" : ""}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                const result = await api.request<{ queued: number }>(
                  base + "/send-email",
                  "POST",
                  {
                    ticketIds: ids,
                    requestKey: key,
                    confirmed,
                    resend,
                    ...(resend ? { reason } : {}),
                  },
                );
                done(result.queued);
              });
            }}
          >
            <label className="check">
              <input
                type="checkbox"
                checked={resend}
                onChange={(e) => setResend(e.target.checked)}
              />
              Intentionally resend or retry a completed attempt
            </label>
            <p>
              Pending/sending jobs are skipped. For Unknown results, check the
              provider before deliberately sending another copy.
            </p>
            {resend && (
              <Field label="Resend reason">
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
              I reviewed the recipients and confirm sending
            </label>
            <footer>
              <button type="button" disabled={a.busy} onClick={close}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  a.busy ||
                  !confirmed ||
                  !preview.enabled ||
                  preview.rows.some((row) => !row.eligible)
                }
              >
                Queue ticket emails
              </button>
            </footer>
          </form>
        </>
      )}
    </Dialog>
  );
}
