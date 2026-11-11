import React, { useEffect, useRef, useState, useCallback } from "react";
import type { Client } from "./api";
export const message = (e: unknown) =>
  e instanceof Error ? e.message : "The action could not be completed.";
export function useResource<T>(api: Client, path: string) {
  const [state, set] = useState<{ key: string; data?: T; error?: string }>({
    key: "",
  });
  const [version, bump] = useState(0);
  const key = path + "@" + version;
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    api
      .request<T>(path, "GET", undefined, abort.signal)
      .then((data) => {
        if (active) set({ key, data });
      })
      .catch((e) => {
        if (active) set({ key, error: message(e) });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [api, key, path]);
  return {
    ...(state.key === key ? state : {}),
    loading: state.key !== key,
    reload: useCallback(() => bump((v) => v + 1), []),
  };
}
export function Notice({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="notice error">
      {error}
    </p>
  ) : null;
}
export function Loading() {
  return <p role="status">Loading...</p>;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const running = useRef(false);
  const run = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" aria-label="Close dialog" onClick={close}>
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  description,
  act,
  close,
}: {
  title: string;
  description: string;
  act: () => Promise<void>;
  close: () => void;
}) {
  const a = useAction();
  return (
    <Dialog
      title={title}
      close={() => {
        if (!a.busy) close();
      }}
    >
      <p>{description}</p>
      <Notice error={a.error} />
      <footer>
        <button disabled={a.busy} onClick={close}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={a.busy}
          onClick={() =>
            a.run(async () => {
              await act();
              close();
            })
          }
        >
          {a.busy ? "Working..." : "Confirm"}
        </button>
      </footer>
    </Dialog>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Checks({
  legend,
  items,
  chosen,
  set,
}: {
  legend: string;
  items: { id: number; name: string }[];
  chosen: number[];
  set: (v: number[]) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {items.map((item) => (
        <label className="check" key={item.id}>
          <input
            type="checkbox"
            checked={chosen.includes(item.id)}
            onChange={(e) =>
              set(
                e.target.checked
                  ? [...chosen, item.id]
                  : chosen.filter((x) => x !== item.id),
              )
            }
          />
          {item.name}
        </label>
      ))}
      {!items.length && <p>No options available.</p>}
    </fieldset>
  );
}
export function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function Link({
  to,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        if (
          e.button === 0 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey
        ) {
          e.preventDefault();
          navigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}
export function isoLocal(value: string, zone = "Africa/Cairo") {
  // Form presents an explicit numeric offset; backend remains the authority.
  if (!value) return "";
  return value.replace(".000Z", "Z");
}
