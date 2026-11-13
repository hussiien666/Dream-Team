import { useState } from "react";
import type { Client } from "./api";
import type { EventRecord } from "./types";
import { Field, Notice, useAction, useResource } from "./ui";
type Preview = { count: number; recipients: string[]; digest: string };
export function Announcements({ api, event }: { api: Client; event: EventRecord }) {
  const base = `events/${event.id}/announcements`, a = useAction();
  const history = useResource<{id:number;createdAt:string;recipients:number;states:Record<string,number>}[]>(api, base);
  const [subject, setSubject] = useState(""), [text, setText] = useState(""), [audience, setAudience] = useState("students");
  const [preview, setPreview] = useState<Preview>(), [confirmed, setConfirmed] = useState(false), [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const changed = () => { setPreview(undefined); setConfirmed(false); };
  return <><h1>Event announcements</h1><p>{event.name}</p><Notice error={a.error || history.error} />
    {message && <p role="status">{message}</p>}
    <form className="settings-form" onSubmit={e => { e.preventDefault(); void a.run(async () => {
      setPreview(await api.request<Preview>(base + "/preview", "POST", { subject, text, audience }));
      setKey(crypto.randomUUID()); setConfirmed(false); setMessage("");
    }); }}>
      <Field label="Recipients"><select value={audience} onChange={e => { changed(); setAudience(e.target.value); }}>
        <option value="students">Active students</option><option value="guests">Active guests and independent attendees</option><option value="all">All active registrations</option>
      </select></Field>
      <Field label="Subject"><input value={subject} onChange={e => { changed(); setSubject(e.target.value); }} required maxLength={200} /></Field>
      <Field label="Message"><textarea value={text} onChange={e => { changed(); setText(e.target.value); }} required maxLength={10000} rows={7} /></Field>
      <button disabled={a.busy || event.archived}>Review recipients</button>
    </form>
    {preview && <section className="plain-section"><h2>Review announcement</h2>
      <p>{preview.count} unique recipients. Each receives a separate private email. Sending follows mailbox limits.</p>
      <details><summary>Recipient addresses</summary><ul>{preview.recipients.map(email => <li key={email}>{email}</li>)}</ul></details>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed the message and recipients</label>
      <button className="primary" disabled={a.busy || !confirmed || !preview.count || event.archived} onClick={() => void a.run(async () => {
        const result = await api.request<{queued:number}>(base, "POST", { subject, text, audience, digest: preview.digest, requestKey: key, confirmed: true });
        setMessage(`${result.queued} emails queued. Provider acceptance and any failures appear below; queued is not sent.`);
        setPreview(undefined); setConfirmed(false); history.reload();
      })}>Queue reviewed announcement</button>
    </section>}
    <section className="plain-section"><h2>Recent announcements</h2><button onClick={history.reload}>Refresh delivery status</button>
      {!history.data?.length ? <p>No announcements queued.</p> : <div className="table-wrap"><table><thead><tr><th>Queued</th><th>Recipients</th><th>Delivery states</th></tr></thead>
        <tbody>{history.data.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString()}</td><td>{row.recipients}</td><td>{Object.entries(row.states).map(([state,count]) => `${state}: ${count}`).join(", ")}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
