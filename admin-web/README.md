# Dream Events administration

React + TypeScript + Vite, using the existing Nest API. No database or server secrets belong in this application.

From the repository root: `npm --prefix admin-web ci`, then `npm --prefix admin-web run dev`. The local URL is http://127.0.0.1:5174; `/api` is proxied to the separately started Nest API on port 3000. `VITE_API_URL` can select an approved HTTPS API ending in `/api/v1` (loopback HTTP is allowed only for local testing).

Build: `npm --prefix admin-web run build`. Contract/routing tests: `npm --prefix admin-web test`. Real PostgreSQL/Chrome tests: `npm --prefix backend run test:browser:admin`, with `TEST_DATABASE_URL` and Chrome configured.

Vercel root is this directory, install `npm ci`, build `npm run build`, output `dist`. `vercel.json` contains SPA fallback and security headers; API and missing asset routes are not rewritten to HTML. See [deployment instructions](../docs/DEPLOYMENT.md) before any provider changes. No deployment has been performed.

Implemented pages: password/TOTP/recovery, account security, Events, event dashboard/settings, categories/entrances, staff accounts/assignments and scanner access codes. Loading/error/empty states, confirmations and server-driven role/event boundaries apply. See [parity checklist](../docs/REACT_ADMIN_PARITY.md) for missing backend modules and remaining screens; this is not full Streamlit replacement yet.
