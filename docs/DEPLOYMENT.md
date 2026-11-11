# Dream Events - deployment preparation

Nothing has been deployed, no provider resources/DNS have been created, and no production migrations or emails have run. These files are reviewable preparation. The application still has parity gaps listed in [REACT_ADMIN_PARITY.md](REACT_ADMIN_PARITY.md); do not remove Streamlit or cut over production yet.

## Targets and required information

- Admin: React/TypeScript/Vite in `admin-web/`, Vercel.
- API: NestJS in `backend/`, Render, `/api/v1`.
- Scanner: existing independent `scanner/`; retain backend-served `/scan/` or prepare a separate static host.
- Database: existing/new approved Aiven PostgreSQL service, Prisma; preserve all migrations/IDs/history/key compatibility.
- Email: Resend with a verified sender and server-side credentials.
- DNS: the user's Cloudflare zone. `admin.<domain>`, `api.<domain>` and `scan.<domain>` below are placeholders, not configured records.

Before account configuration, obtain the actual domain, existing provider projects/services, Aiven service/CA and connection allowance, Resend sender/domain and webhook credentials. Enter secrets privately in provider settings. Deployment, production migration, DNS edits, Streamlit removal and live emails each require explicit authorization. No approval is needed to continue local implementation/testing.

## Local validation

Use Node 24.15.0 and regular Python 3.10, no venv. From the repository root:

```powershell
npm --prefix backend ci
npm --prefix backend run prisma:generate
npm --prefix backend run build
npm --prefix admin-web ci
npm --prefix admin-web test
npm --prefix admin-web run build
npm --prefix scanner ci
npm --prefix scanner run build
```

Start the separately configured Node API on port 3000; `npm --prefix admin-web run dev` serves port 5174 and proxies `/api`. `admin/main.py` and `app/dashboard/main.py` remain available. The React API client uses bearer authorization, no cookies, and tab-scoped session storage. Pending 2FA/temporary-password state is loaded from the server after refresh; protected data is never loaded before server verification. No background admin session polling defeats idle expiry.

Disposable PostgreSQL tests require `TEST_DATABASE_URL`; they create separate synthetic databases. `npm --prefix backend run test:integration` runs the API/migration/scanner/mail suite. `npm --prefix backend run test:browser:admin` additionally needs installed `admin-web` dependencies and Chrome; set `CHROME_EXECUTABLE` if it is not at the Windows default. Real mail is mocked in tests.

## Vercel admin

Project root: **admin-web**. Install: `npm ci`. Build: `npm run build`. Output: **dist**. Node: 24.15.0. `admin-web/vercel.json` contains SPA routing/security headers. Filesystem assets are resolved before SPA fallback; `/api` and missing `/assets` are real 404s, never index.html. There is no production API proxy: the browser calls the configured Render API directly.

Set `VITE_API_URL=https://api.<actual-domain>/api/v1` separately for preview and production. It must be HTTPS, contain no credentials/query/hash, and end in `/api/v1`. `VITE_WS_URL` is reserved for later monitoring; no WebSocket endpoint is implemented yet. Every `VITE_*` value is public. Never place a database URL, encryption key, Resend key or webhook secret there.

Use a separate staging API/database for previews. Add only individually approved preview origins to CORS; do not allow wildcard Vercel subdomains. Do not enable production secrets on arbitrary previews. CSP currently permits HTTPS/WSS connections because no actual API domain is supplied; before production replace the broad connect-src entries with the exact approved API/WebSocket origins and verify in browser. Keep the other CSP/security restrictions.

## Render API

`render.yaml` describes a new service only; do not import/apply it over existing infrastructure without reviewing current resource names/dependencies. Root: **backend**. Build: `npm ci && npm run prisma:generate && npm run build`. Start: `npm run start:prod`. Health: **/api/v1/health**. Autodeploy is off. Neither build nor startup runs migrations.

Server environment:

| Variable | Required value |
| --- | --- |
| NODE_ENV / HOST | production / 0.0.0.0 |
| PORT | Render-provided port |
| NODE_DATABASE_URL | Aiven connection URL, server-only |
| PG_SSL / PG_CA_CERT | true / exact Aiven CA PEM; alternatively mount PG_CA_FILE privately |
| PG_POOL_MAX | Start at 5 per process, below the Aiven service limit after reserving maintenance connections |
| APP_ENCRYPTION_KEY | Original legacy Fernet-compatible 32-byte key; never replace during migration |
| CORS_ORIGINS | Exact approved admin and scanner HTTPS origins, comma-separated; no wildcard/trailing slash |
| TRUST_PROXY_HOPS | 1 for the reviewed Render-only path; reassess if adding Cloudflare proxying |
| SESSION_HOURS / ADMIN_IDLE_MINUTES | 1-24 / 5-240; default 8 / 30 |
| THROTTLE_TTL / THROTTLE_LIMIT | Review against aggregate scanner traffic; current limiter is per process/IP |
| EMAIL_ENABLED | false until Resend/live sending is explicitly authorized |
| RESEND_API_KEY / EMAIL_FROM | Server-only key / verified sender when email is enabled |
| RESEND_WEBHOOK_SECRET | Server-only webhook signing secret |

Startup rejects invalid database/CORS/pool/session settings; production requires verified TLS and the preserved key. Current REST clients do not use cookies, so CORS credentials are false. Server shutdown hooks disconnect Prisma. There is currently no WebSocket server to claim as deployed; when added, terminate TLS at Render and retain websocket upgrade/CORS support through the chosen DNS/proxy path.

## Aiven and reviewed migration

The runtime pg adapter uses certificate verification, the provided CA and bounded pooling. It strips URL ssl settings before applying the verified TLS object so query options cannot disable validation. Never use rejectUnauthorized=false. Sum pools across API instances and workers; five connections per process is a starting configuration, not a service capacity claim.

Prisma CLI uses a separately reviewed **PRISMA_MIGRATION_DATABASE_URL**, or falls back to NODE_DATABASE_URL. For the CLI supply a verified connection using `sslmode=verify-full` and `sslrootcert` pointing at the mounted Aiven CA. Runtime PG_CA_CERT/PG_CA_FILE are adapter settings, not a promise that Prisma CLI uses them. Validate both paths against staging/Aiven before production.

1. Preserve a consistent SQLite backup, original encryption key, configuration and original ticket files. Never overwrite the source SQLite.
2. Review every unapplied SQL migration and provider backups/recovery settings. Restore-test Aiven backups separately; source migration dry-run is not an Aiven disaster-recovery test.
3. Apply Prisma migrations **manually to an approved empty staging target**, not automatically during build/start. Export a consistent source snapshot into ignored storage and run the existing import in dry-run mode. Compare every row/ID/hash/history count, then perform a separately approved committed staging rehearsal.
4. Verify original passwords/2FA/QRs, API permissions, counts, concurrency, email-disabled behavior and source rollback. Do not connect the Python legacy app to the new database.
5. For production require an explicit reviewed change window/approval and a final consistent snapshot. Only then run approved migrations/import and smoke tests. Keep source SQLite and old application available as rollback evidence. Once new writes exist, reverting traffic to the old database requires reconciliation; do not silently diverge two authorities.

The new Resend tracking migration is additive and does not rewrite legacy email delivery/history. No migration edits or downgrades should be used as routine rollback. Prefer rolling back application traffic/code with a compatible schema and a reviewed data-recovery plan.

## Resend and durable worker

The central backend service queues encrypted message payloads in the existing database job system. PostgreSQL leases/SKIP LOCKED permit multiple workers. Stable idempotency keys survive retries; changed content under an existing operation key is rejected. Retry intervals after transient failures: 1, 5, then 15 minutes; permanent failures stop immediately. Ambiguous final connection failures become Unknown, and jobs outside the 23-hour safe idempotency window require investigation. Resend acceptance means Sent, not inbox receipt.

Start a **separate approved Render background worker** from the same backend build with `npm run worker:email`. It needs the same Aiven/key/Resend configuration and contributes its own database pool. It is not created by the API blueprint. SIGTERM stops new claims and finishes current work; a crashed worker's lease can be reclaimed. The API never depends on keeping an HTTP request open to send a message. Email is disabled by default; do not start/enable a production worker without live-send authorization.

Create a Resend webhook for `https://api.<actual-domain>/api/v1/email/resend/webhook` only after approving the domain/provider configuration. Configure its signing secret server-side. The controller verifies the **raw body** via the official SDK/Svix signatures; provider event IDs deduplicate replay. Event history is immutable, delivery timestamps prevent older events from overwriting newer state, and callbacks arriving before the send response are retained for reconciliation. Subscribe to sent/delivered/delivery_delayed/bounced/complained/failed events. No open tracking is implemented.

The queue/provider/webhooks are implemented; invitation/ticket/auth producer APIs, templates, manual resend UI and failure notifications still need integration. Do not claim email-based 2FA/password reset or ticket delivery parity merely because the provider works. Existing Python Gmail configuration remains intact.

## Scanner hosting and Cloudflare

Retain `/scan/` on an existing scanner/API host until an independent deployment is approved. For a separate static scanner host, build from `scanner/` with `SCANNER_BASE_PATH=/` and `VITE_API_URL=https://api.<actual-domain>/api/v1`; the relative manifest also supports the existing `/scan/` build. Add only its exact HTTPS origin to the API allowlist. Physical rear-camera permissions, HTTPS trust, focus and connectivity need real-phone checks. Do not put an HTTP-only localhost URL into a phone deployment.

Get the **actual domain before DNS configuration**. Register its exact hostname in the relevant provider dashboard and copy that provider's required CNAME/A/verification records. No target addresses are invented here. Start Render custom-domain verification with DNS-only records; consider proxying only after the provider confirms certificate validity and websocket/API behavior is checked. If proxying is approved, use validated end-to-end TLS/Full (strict), review trusted proxy/rate-limit handling, and bypass caching for `/api/*`, authentication and webhooks. Do not apply browser challenges to provider webhooks or websocket upgrades. Review AAAA conflicts only on the exact approved Render hostname; do not remove unrelated zone records.

Keep Resend SPF/DKIM/DMARC/verification records exactly as supplied; email records are DNS-only. Preserve existing MX/SPF/DKIM records for other mail providers. Do not assume every record should be proxied or that one generic DNS configuration fits all providers.

## Sources used for preparation

- [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain).
- [Render Blueprint](https://render.com/docs/blueprint-spec), [Cloudflare DNS setup](https://render.com/docs/configure-cloudflare-dns).
- [Aiven Node TLS configuration](https://aiven.io/docs/products/postgresql/howto/connect-node).
- [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [signed webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests).
- [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/).
