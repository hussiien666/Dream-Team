import { useState, useEffect } from "react";
import type { Client } from "./api";
import type { EventRecord } from "./types";
import {
  Dialog,
  Field,
  Notice,
  Loading,
  Empty,
  Confirm,
  useResource,
  useAction,
} from "./ui";
type Design = {
  layout: "classic" | "compact" | "banner";
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  heading: string;
  footer: string;
  fields: string[];
  showLogo: boolean;
  logo: string | null;
  background: string | null;
};
type Template = { id: number; name: string; config: Design };
type Library = { templates: Template[]; defaults: Design; applied: Design };
const fields = [
  "organization",
  "subtitle",
  "date",
  "venue",
  "student",
  "group",
  "category",
  "number",
  "entrances",
  "instructions",
  "status",
];
export function TemplatesPage({
  api,
  event,
}: {
  api: Client;
  event: EventRecord;
}) {
  const base = `events/${event.id}/ticket-templates`,
    data = useResource<Library>(api, base),
    a = useAction();
  const [edit, setEdit] = useState<
      Template | { config: Design; name: string }
    >(),
    [remove, setRemove] = useState<Template>(),
    [copy, setCopy] = useState<Template>(),
    [apply, setApply] = useState<Template | null | undefined>(),
    [message, setMessage] = useState("");
  return (
    <>
      <h1>Ticket templates</h1>
      <p>
        Templates are reusable within your organization. Applying one copies its
        current design to this event; later library edits do not silently change
        other events or QR codes.
      </p>
      <Notice error={data.error || a.error} />
      {message && <p role="status">{message}</p>}
      {data.loading ? (
        <Loading />
      ) : (
        data.data && (
          <>
            {!event.archived && (
              <div className="toolbar">
                <button
                  className="primary"
                  onClick={() =>
                    setEdit({ name: "", config: data.data!.defaults })
                  }
                >
                  Add ticket template
                </button>
                <button onClick={() => setApply(null)}>
                  Use default design
                </button>
              </div>
            )}
            {!data.data.templates.length ? (
              <Empty>
                No saved templates. Tickets currently use the event design or
                the built-in default.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Layout</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.templates.map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td>{t.config.layout}</td>
                        <td>
                          <button onClick={() => setEdit(t)}>
                            {event.archived ? "View" : "Edit / preview"}
                          </button>
                          {!event.archived && (
                            <>
                              <button onClick={() => setCopy(t)}>
                                Duplicate
                              </button>
                              <button onClick={() => setApply(t)}>
                                Apply to event
                              </button>
                              <button onClick={() => setRemove(t)}>
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p>
              Applied layout: {data.data.applied.layout}. Existing downloaded
              files are snapshots; download again to get the applied design with
              the same QR.
            </p>
          </>
        )
      )}
      {edit && (
        <TemplateEditor
          api={api}
          base={base}
          value={edit}
          readOnly={event.archived}
          close={() => setEdit(undefined)}
          saved={() => {
            setEdit(undefined);
            data.reload();
            setMessage("Template saved. Apply it to an event when ready.");
          }}
        />
      )}
      {remove && (
        <Confirm
          title="Delete ticket template"
          description={`Delete ${remove.name}? Previously applied event designs and ticket identities are retained.`}
          close={() => setRemove(undefined)}
          act={async () => {
            await api.request(`${base}/${remove.id}`, "DELETE", {
              confirmed: true,
            });
            data.reload();
          }}
        />
      )}
      {apply !== undefined && (
        <Confirm
          title="Apply ticket design"
          description={`Use ${apply?.name ?? "the default design"} for this event? Future downloads use this design. QR credentials stay unchanged.`}
          close={() => setApply(undefined)}
          act={async () => {
            await api.request(base + "/apply", "POST", {
              templateId: apply?.id ?? null,
            });
            data.reload();
            setMessage("Event ticket design updated. QR codes are unchanged.");
          }}
        />
      )}
      {copy && (
        <Duplicate
          api={api}
          base={base}
          template={copy}
          close={() => setCopy(undefined)}
          done={() => {
            setCopy(undefined);
            data.reload();
          }}
        />
      )}
    </>
  );
}
function Duplicate({
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
  const a = useAction();
  return (
    <Dialog title="Duplicate ticket template" close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get("name");
          void a.run(async () => {
            await api.request(`${base}/${template.id}/duplicate`, "POST", {
              name,
            });
            done();
          });
        }}
      >
        <Field label="Template name">
          <input
            name="name"
            defaultValue={`${template.name} copy`.slice(0, 100)}
            required
            maxLength={100}
          />
        </Field>
        <Notice error={a.error} />
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          <button disabled={a.busy}>Duplicate template</button>
        </footer>
      </form>
    </Dialog>
  );
}
function TemplateEditor({
  api,
  base,
  value,
  readOnly,
  close,
  saved,
}: {
  api: Client;
  base: string;
  value: Template | { name: string; config: Design };
  readOnly: boolean;
  close: () => void;
  saved: () => void;
}) {
  const [config, setConfig] = useState<Design>(value.config),
    [name, setName] = useState(value.name),
    [preview, setPreview] = useState(""),
    [stale, setStale] = useState(false),
    a = useAction();
  const change = (patch: Partial<Design>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setStale(true);
  };
  const show = async () => {
    const blob = await api.request<Blob>(
      base + "/preview/html",
      "POST",
      { config },
      undefined,
      true,
    );
    setPreview(await blob.text());
    setStale(false);
  };
  useEffect(() => {
    void a.run(show);
  }, []);
  async function image(file: File | undefined, key: "logo" | "background") {
    if (!file) return;
    if (file.size > 256 * 1024)
      throw new Error("Images must be at most 256 KB.");
    if (!["image/png", "image/jpeg"].includes(file.type))
      throw new Error("Choose PNG or JPEG.");
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Cannot read image."));
      r.readAsDataURL(file);
    });
    change({ [key]: data });
  }
  return (
    <Dialog
      title="Ticket template editor"
      close={() => {
        if (!a.busy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api.request(
              "id" in value ? `${base}/${value.id}` : base,
              "id" in value ? "PATCH" : "POST",
              { name, config },
            );
            saved();
          });
        }}
      >
        <fieldset disabled={readOnly || a.busy}>
          <Field label="Template name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </Field>
          <Field label="Layout">
            <select
              aria-label="Layout"
              value={config.layout}
              onChange={(e) =>
                change({ layout: e.target.value as Design["layout"] })
              }
            >
              <option value="classic">Classic</option>
              <option value="compact">Compact</option>
              <option value="banner">Banner</option>
            </select>
          </Field>
          {(["primaryColor", "accentColor", "backgroundColor"] as const).map(
            (k) => (
              <Field
                key={k}
                label={
                  {
                    primaryColor: "Text color",
                    accentColor: "Accent color",
                    backgroundColor: "Background color",
                  }[k]
                }
              >
                <input
                  type="color"
                  value={config[k]}
                  onChange={(e) => change({ [k]: e.target.value })}
                />
              </Field>
            ),
          )}
          <Field label="Ticket heading">
            <input
              value={config.heading}
              maxLength={120}
              onChange={(e) => change({ heading: e.target.value })}
            />
          </Field>
          <Field label="Ticket footer">
            <textarea
              value={config.footer}
              maxLength={400}
              onChange={(e) => change({ footer: e.target.value })}
            />
          </Field>
          <fieldset>
            <legend>Displayed fields</legend>
            {fields.map((f) => (
              <label className="check" key={f}>
                <input
                  type="checkbox"
                  checked={config.fields.includes(f)}
                  onChange={(e) =>
                    change({
                      fields: e.target.checked
                        ? [...config.fields, f]
                        : config.fields.filter((x) => x !== f),
                    })
                  }
                />
                {f[0].toUpperCase() + f.slice(1)}
              </label>
            ))}
          </fieldset>
          <label className="check">
            <input
              type="checkbox"
              checked={config.showLogo}
              onChange={(e) => change({ showLogo: e.target.checked })}
            />
            Show logo
          </label>
          {(["logo", "background"] as const).map((k) => (
            <div key={k}>
              <Field label={k === "logo" ? "Logo image" : "Background image"}>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) =>
                    void a.run(() => image(e.target.files?.[0], k))
                  }
                />
              </Field>
              {config[k] && (
                <button type="button" onClick={() => change({ [k]: null })}>
                  Remove {k}
                </button>
              )}
            </div>
          ))}
        </fieldset>
        <Notice error={a.error} />
        <div className="toolbar">
          <button
            type="button"
            disabled={a.busy}
            onClick={() => void a.run(show)}
          >
            Update preview
          </button>
          <button
            type="button"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                const blob = await api.request<Blob>(
                  base + "/preview/pdf",
                  "POST",
                  { config },
                  undefined,
                  true,
                );
                const url = URL.createObjectURL(blob),
                  link = document.createElement("a");
                link.href = url;
                link.download = "ticket-preview.pdf";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              })
            }
          >
            Download PDF preview
          </button>
        </div>
        {stale && <p>Preview needs updating.</p>}
        {preview && (
          <iframe
            title="Ticket design preview"
            sandbox=""
            srcDoc={preview}
            style={{ width: "100%", height: 450, border: "1px solid #ccd3dd" }}
          />
        )}
        <p>Preview QR codes are intentionally invalid for entry.</p>
        <footer>
          <button type="button" disabled={a.busy} onClick={close}>
            Cancel
          </button>
          {!readOnly && (
            <button className="primary" disabled={a.busy}>
              Save ticket template
            </button>
          )}
        </footer>
      </form>
    </Dialog>
  );
}
