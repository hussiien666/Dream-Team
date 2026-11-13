import React, { useEffect, useRef, useState, useCallback } from "react";
import { ApiError, SupersededRequest, type Client } from "./api";
export const message = (e: unknown) =>
  e instanceof Error ? e.message : "The action could not be completed.";
export function useResource<T>(api: Client, path: string) {
  const [state, set] = useState<{
    api: Client; key: string; data?: T; error?: string; refreshing: boolean;
  }>();
  const [version, bump] = useState(0);
  const lastLoad=useRef<{path:string;version:number}|undefined>(undefined);
  const denied=useRef(false);
  const retainPrevious=useRef(false);
  const key = path + "@" + version;
  useEffect(()=>api.subscribe(reason=>{
    retainPrevious.current=reason==='mutation';
    if(reason==='denied'||reason==='logout'){denied.current=true;set({api,key,error:reason==='denied'?'Access changed. Refresh your permissions before continuing.':undefined,refreshing:false});return;}
    denied.current=false;
    if(reason!=='mutation')set(undefined);
    bump(v=>v+1);
  }),[api,key]);
  useEffect(()=>{
    if(path.startsWith('auth/')||path.startsWith('public/'))return;
    const check=()=>{if(!document.hidden&&!denied.current&&!api.peekResource(path)?.fresh)bump(v=>v+1);};
    const timer=setInterval(check,5000);window.addEventListener('focus',check);
    return()=>{clearInterval(timer);window.removeEventListener('focus',check);};
  },[api,path]);
  useEffect(() => {
    let active = true;
    const cached = api.peekResource<T>(path);
    const force=lastLoad.current?.path===path&&lastLoad.current.version!==version;lastLoad.current={path,version};
    set(previous=>({ api, key, data:cached?.data??(previous?.api===api&&previous.key.startsWith(path+'@')?previous.data:undefined), refreshing: !cached?.fresh || force }));
    if (cached?.fresh && !force) return () => { active = false; };
    api
      .resource<T>(path, force)
      .then((data) => {
        if (active) set({ api, key, data, refreshing: false });
      })
      .catch((e) => {
        if(e instanceof SupersededRequest)return;
        const denied = e instanceof ApiError && [401, 403].includes(e.status);
        if (active) set(previous=>({ api, key, data: denied ? undefined : cached?.data??previous?.data, error: message(e), refreshing: false }));
      });
    return () => {
      active = false;
    };
  }, [api, key, path, version]);
  const cached = api.peekResource<T>(path);
  const current = state?.api === api && state.key === key ? state : undefined;
  const previous = retainPrevious.current && state?.api===api && state.key.startsWith(path+'@') ? state.data : undefined;
  const data = current ? current.data : cached?.data ?? previous;
  return {
    data,
    error: current?.error,
    loading: data === undefined && current?.refreshing !== false,
    refreshing: current?.refreshing ?? !cached?.fresh,
    reload: useCallback(() => {denied.current=false;bump((v) => v + 1);}, []),
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
export function RefreshState({refreshing,error,hasData}:{refreshing:boolean;error?:string;hasData:boolean}) {
  return <>{refreshing&&hasData&&<p role="status">Showing saved data while refreshing…</p>}{error&&hasData&&<p role="status">Refresh failed. Showing previously loaded data; retry before relying on current availability.</p>}</>;
}
export function useDebounced<T>(value:T){const [current,set]=useState(value);useEffect(()=>{const timer=setTimeout(()=>set(value),250);return()=>clearTimeout(timer);},[value]);return current;}
export function usePage(key:string){
  const [state,set]=useState<{key:string;after:number;previous:number[]}>({key,after:0,previous:[]});
  const page=state.key===key?state:{key,after:0,previous:[]};
  return {...page,next:(id:number)=>set({key,after:id,previous:[...page.previous,page.after]}),back:()=>set({key,after:page.previous.at(-1)??0,previous:page.previous.slice(0,-1)})};
}
export function PageControls({page,next,busy=false}:{page:ReturnType<typeof usePage>;next:number|null|undefined;busy?:boolean}){
  return <nav className="page-controls" aria-label="Table pages"><button disabled={busy||!page.previous.length} onClick={page.back}>Previous page</button>
    <span>Page {page.previous.length+1}</span><button disabled={busy||!next} onClick={()=>next&&page.next(next)}>Next page</button></nav>;
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
