import { useEffect, useRef, useState } from 'react';

type Widget = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Widget } }
let script: Promise<Widget> | undefined;
function loadWidget() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!script) script = new Promise<Widget>((resolve, reject) => {
    const tag = document.createElement('script');
    const fail = () => { clearTimeout(timer); tag.remove(); reject(new Error('Security check could not load. Check your connection and retry.')); };
    const timer = window.setTimeout(fail, 15000);
    tag.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    tag.async = true;
    tag.onload = () => {
      if (!window.turnstile) { fail(); return; }
      clearTimeout(timer); resolve(window.turnstile);
    };
    tag.onerror = fail;
    document.head.append(tag);
  }).catch(error => { script = undefined; throw error; });
  return script;
}

/** Tokens live only in the open form. Remount after every submission or expiry. */
export function TurnstileChallenge({ siteKey, onToken }: {
  siteKey?: string; onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    onToken('');
    if (!siteKey) return;
    let active = true, widget: { api: Widget; id: string } | undefined;
    setError('');
    void loadWidget().then(api => {
      if (!active || !container.current) return;
      const id = api.render(container.current, {
        sitekey: siteKey, action: 'public-invitation', size: 'flexible', 'response-field': false,
        callback: (token: string) => { if (active) { setError(''); onToken(token); } },
        'expired-callback': () => { if (active) { onToken(''); setError('Security check expired. Retry the check.'); } },
        'error-callback': () => { if (active) { onToken(''); setError('Security check failed. Retry the check.'); } },
      });
      widget = { api, id };
    }).catch(() => { if (active) setError('Security check could not load. Check your connection and retry.'); });
    return () => { active = false; if (widget) widget.api.remove(widget.id); };
  }, [siteKey, onToken, attempt]);
  if (!siteKey) return null;
  return <div aria-label="Security check">
    <div ref={container} />
    {error && <><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>Retry security check</button></>}
  </div>;
}
