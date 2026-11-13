# Firebase transition — 13 November 2026

**Superseded architecture:** [PRODUCTION_MIGRATION_SPEC.md](PRODUCTION_MIGRATION_SPEC.md) now targets NestJS/Cloud Run and PostgreSQL/Cloud SQL with Firebase Authentication and Gmail API. Firestore business migration and Functions deployment are no longer the final path. Deployment is held until both explicit Google account confirmations; do not execute deployment commands below now. See the handoff for current state.

Cloud SQL trial development staging completed: 47 tables / 279 rows copied from a consistent read-only Aiven snapshot after an encrypted backup and successful rollback rehearsal. Schema, protection definitions, original migration records and canonical row hashes matched. Two disposable migration tests passed. The app still uses Aiven. `firebase/check-sql-trial.mjs` performs read-only metadata/SQL checks; on this Windows workspace run it with the portable Node 22 executable. `firebase/stage-sql-trial.mjs` defaults to rollback and `--commit` writes only to an empty target; the current trial target is populated, so do not rerun restore or delete it to bypass this guard. Backups/reports belong in ignored `migration/exports/`. Owner IAM login is operator access, not deployed application credentials. Runtime Cloud SQL identity, cutover/reconciliation and migrated application behavior remain unverified. Historical statements below about an untouched target precede this checkpoint.

The latest user prompt makes Firebase Authentication, Firestore, Storage and server functions the target backend, with the React/Vite admin on Vercel. This supersedes the previous PostgreSQL/Supabase target. The existing Nest/PostgreSQL system remains operational and authoritative until each Firebase replacement passes parity tests and cutover is approved. The original SQLite and Streamlit systems remain intact.

## Current implemented boundary

- Optional `POST /api/v1/auth/firebase-exchange`, protected by the existing authenticated-session and MFA/password gates. It returns a Firebase custom token for stable UID `legacy-<existing user ID>`.
- Firebase ID tokens can authenticate to existing admin APIs, but each request verifies the Firebase token, disabled-user state and its bound live database session. Existing organization/role/event checks still apply. Logout, session expiry, inactivity, source account disablement and session revocation therefore remain effective. No role supplied by the browser or a Firebase custom claim overrides database authorization.
- Existing Argon2 passwords and encrypted TOTP/recovery data remain in the working system. They are not overwritten or imported using a different hash algorithm. The bridge is a custom-auth transition, not a completed native email/password or MFA migration. Scanner login remains independent.
- The optional browser integration loads the Firebase Auth SDK only when `VITE_FIREBASE_AUTH_BRIDGE=true`. Firebase identity state uses in-memory persistence; API requests obtain refreshed ID tokens from the SDK. The original opaque session keeps its existing sessionStorage behavior. No token is put in a URL or a public cache.
- Firestore and Storage deny every direct browser read/write, including authenticated administrators. These rules are a deliberate starting boundary for server-only business APIs. Admin SDK operations bypass rules and must implement their own authorization; rules alone do not secure privileged functions.
- `firebase/` contains local Authentication, Firestore and Storage emulator configuration and tests. No function deployment or hosted data migration has occurred.
- The existing Nest API now has a Firebase Functions v2 HTTP adapter and a separate generated deployment bundle. The adapter initializes lazily, reuses a warm application, reads only an explicitly bound runtime secret, preserves raw webhook bodies and handles Firebase's pre-parsed multipart uploads. It retains the current PostgreSQL authority while Firestore parity is built.

## Firebase setup

The user supplied project ID and linked Hosting site **dream-team-bed27**, plus its public Web app configuration. The public values are saved in ignored `admin-web/.env.local`; the backend project ID is set privately with the bridge disabled. The project is recorded as the development CLI alias, not an approved production destination. Tests explicitly use `demo-dream-events`.

1. In that project's Firebase console, add a Web app under Project settings → General. Put its public `projectId`, `apiKey` and `authDomain` into ignored `admin-web/.env.local` using the `VITE_FIREBASE_*` names in the example. Do not put service-account JSON, private keys, SMTP passwords or application encryption keys in VITE variables.
2. Open Authentication and initialize the service. Add `dream-team-peach.vercel.app` as the admin authorized domain; add `dream-team-scanner.vercel.app` only if the scanner later uses Firebase Auth (its current login does not). Use exact approved domains for preview projects. Keep email/password, anonymous and other sign-in providers disabled until their transition is implemented; the current bridge uses custom tokens after existing login and MFA.
3. Configure server Application Default Credentials privately for the same project, with only the necessary Firebase Auth and signing permissions. A local service-account file, if used, belongs outside the checkout and is referenced by `GOOGLE_APPLICATION_CREDENTIALS`; never copy it into the frontend or commit it. Hosted identity/signing configuration needs separate review.
4. Set backend `FIREBASE_PROJECT_ID=dream-team-bed27`. Leave `FIREBASE_AUTH_BRIDGE_ENABLED=false` until credentials/project/domain checks and a synthetic account sign-in are verified. Backend and frontend flags must be enabled together for a reviewed test; no production flag was changed here.
5. Provision separate preview/production Firebase projects before production migration, choose Firestore/Storage regions close to the eventual functions, and apply the restrictive rules only as part of a reviewed deployment. Billing, IAM, retention and region choices are not yet configured by this code.

## Local tests

Install normal project dependencies and build the backend, then:

```powershell
npm --prefix firebase ci
npm --prefix backend run build
```

Authentication tests require `TEST_DATABASE_URL` pointing to a disposable loopback PostgreSQL server, never the configured hosted database. The test harness creates a separate synthetic database. From the repository root, after assigning that private test URL:

```powershell
npm --prefix firebase run test:auth
```

Firestore/Storage tests need Java 21 or later on PATH:

```powershell
npm --prefix firebase run test:rules
```

The CLI uses only the demo project and loopback emulators; it does not require Firebase login. Do not configure production emulator hosts. A portable Java 21 runtime was downloaded into ignored `tmp/firebase-java/` for this workspace, without changing the system Java installation. Keep its binary out of version control.

Run emulator suites sequentially; the launcher uses a lock to prevent hub/port collisions. It passes only an allowlisted environment to Firebase CLI, so provider credentials/database URIs are not included in CLI debug environment dumps. The test child reads its disposable database URI from a short-lived ignored file. The Functions suite prepares and destroys a separate synthetic PostgreSQL database and its local secret file:

```powershell
npm --prefix firebase run build:functions
npm --prefix firebase run test:functions
```

On this workspace, Functions tests used portable **Node 22.23.5**, matching the configured runtime major. Auth uses normal Node 24 and rules use Java 21. The Functions deployment-discovery timeout is 60 seconds in the local launcher to accommodate local Windows/OneDrive module loading; no business service is initialized during deployment discovery.

## Data migration and rollback work still required

Verified local checkpoint: full PostgreSQL/API/Chrome regression **88 passed, 0 failed, 2 skipped in 102.3817981 seconds** (90 cases); Firebase Auth/browser **3 passed in 25.0587325 seconds**; Node 22 Functions **5 passed in 30.8985166 seconds**; deny-all rules **3 passed in 14.2743631 seconds**. The skipped Firebase cases ran in the separate emulator suite. Focused backend configuration/SMTP/upload **5 passed** and frontend cache/API/routing **6 passed**. Backend, Functions/scanner bundle and admin builds with the bridge both enabled and disabled passed. These are local results, not hosted performance or security certification. Firebase QA tooling retains 14 moderate transitive advisories and zero high; the comprehensive requested security audit remains pending.

Implement and test a consistent PostgreSQL snapshot with table/schema checks, stable IDs, composite relationships, original QR hashes, ticket states, encrypted credentials and microsecond timestamps. Store encrypted backups and reports outside public Storage. Design the Firestore document model and indexes before importing; account for document/transaction limits, contention and immutable history. Historical audit actors and orphan deleted-event references must remain intact.

Stage imports into a separate project/namespace, verify counts and canonical row hashes plus application invariants, and test issuance/check-in concurrency, public invitations, transfer/idempotency receipts and encrypted artifacts against the migrated data. Freeze/fence old writes at approved cutover. Define a verified reverse restore/replay boundary before reopening writes; automatically switching to a stale Aiven copy would lose data. Aiven remains the current database, not an exercised failover service.

Firestore business repositories, App Check enforcement, data transfer/verification, serverless email-worker migration and the complete authentication authority transition remain pending. No production migration, DNS edit, live email or legacy retirement is authorized by this preparation.

## Cloud Functions deployment preparation

The global Firebase CLI is installed, version 15.36.0. The user completed private CLI reauthentication and project access was confirmed. Read-only Functions listing failed; billing/API/IAM readiness remains unresolved. No function or runtime secret was deployed. `node firebase/cli.mjs ...` from the repository root runs the local CLI with a restricted environment so application secrets are not inherited into diagnostic logs. On this Windows workspace, use Node 22 if Node 24 reports a libuv shutdown assertion after CLI output.

The user authorized changing the API and both Vercel frontends and confirmed Aiven contains only test data, then paused and subsequently resumed on 13 November. Deployment is currently blocked by the project's Spark plan: Secret Manager requires Blaze, and no secret/function was uploaded. The user must choose/enable billing privately. Cloud Functions listing returned HTTP 403 `SERVICE_DISABLED`; API enablement remains part of deployment. Vercel sign-in succeeded and both existing projects in team `huss9` are accessible; their environment/traffic settings have not been changed. A fresh read-only Aiven check found all 11 migrations through `202611110011_mobile_tickets_and_transfers` and 47 public tables; no schema update was necessary or performed. Hosting authorization does not make the incomplete Firestore replacement ready.

The user subsequently created SQL Connect service `dreamteam-66`, verified in `us-east4`, backed by Cloud SQL instance `dream-team-bed27-instance` and database `dream-team-bed27-2-database`. Service metadata lists no deployed connectors. This is a separate PostgreSQL service, not a deployed Functions API or Firestore migration; application database/schema contents were not inspected or changed. Existing Aiven remains authoritative. The next secret-upload attempt still required Blaze. If a future approved change uses this database, review its region, connectivity, schema ownership, migration/rollback and instance costs separately. [SQL Connect service/database reference](https://firebase.google.com/docs/sql-connect/manage-services-and-databases).

`npm --prefix firebase run build:functions` generates `firebase/functions/` with Node 22 runtime, compiled API, font assets, Prisma schema/lockfile and no local secrets. The local node_modules junction is excluded from upload. `gcp-build` generates the Prisma client during Cloud Build; no database migration runs during build or cold start. The existing API still uses Aiven, so moving hosts does not move data or replace IDs.

The prepared API function is in `europe-west1`, with 512 MiB memory, up to three instances, ten concurrent requests per instance and zero minimum instances. Review the region against the database location and load-test memory/connection limits before deployment. Runtime preparation uses `HOSTED_PG_POOL_MAX` (default 2), independently from the local pool, so three instances use at most six connections. Other running applications/workers still count against the database account limit. Zero warm instances permits cold starts; increasing minimum instances incurs idle cost. Cloud Functions deployment requires reviewed billing/Blaze setup.

1. Set exact HTTPS Vercel/scanner origins in private backend configuration. Preserve the installed encryption key and verified PostgreSQL CA. `npm --prefix firebase run prepare:runtime` creates ignored `tmp/firebase-runtime.json` from that configuration; it refuses a preexisting output and keeps email disabled. The resulting file contains secrets. Keep it private and do not upload it to Git, Hosting, public Storage or chat.
2. After deployment authorization, run from `firebase/`: `firebase functions:secrets:set DREAM_EVENTS_RUNTIME --project dream-team-bed27 --data-file ../tmp/firebase-runtime.json`. This writes a private Secret Manager value. The prepared JSON format is shown without secrets in `runtime.example.json`.
3. Review Firebase IAM and the function's public invocation endpoint: public HTTP reachability is required by clients, while admin/scanner operations continue to require application authentication. Firebase custom-token signing also needs the appropriate service-account signing permission. Do not grant broad owner access to fix IAM errors.
4. After deployment authorization, deploy only the reviewed API function using `firebase deploy --only functions:dream-events:api --project dream-team-bed27` from `firebase/`. The selector includes the configured `dream-events` codebase. Use the exact function URL reported by the CLI. Its API base normally adds `/api/v1` after the function name; the frontend now supports that path prefix. Hosting rewrites are separately prepared for `/api/**` and `/scan/**`, but are not deployed.
5. Set Vercel admin/scanner `VITE_API_URL` to the tested HTTPS function API base in the correct Vercel environment, rebuild, and verify login/MFA, event scope, import, downloads, scanner replay and webhooks before routing production use. Keep a recorded previous frontend API setting for rollback. Existing clients may keep their opaque sessions because the database/session authority remains unchanged.

The Firebase Hosting gateway has a 60-second request timeout even though the function permits 180 seconds. Large imports should use the direct function URL until asynchronous processing or measured limits are established. Functions v2 permits 32 MB request bodies and non-streamed responses, but only 10 MB streamed responses. Existing ZIP downloads allow 30 MB and require deployed response-behavior validation or private Storage download delivery before full parity can be certified. Local emulators do not certify those provider limits. References: [HTTP functions](https://firebase.google.com/docs/functions/http-events), [quotas](https://firebase.google.com/docs/functions/quotas), [Hosting timeouts](https://firebase.google.com/docs/hosting/functions).

The separate scanner is built into the generated API/static bundle and `firebase/public/scan/` with `/scan/` asset paths and same-origin `/api/v1`. Existing independent Vercel scanner settings are not overwritten. Use the Hosting gateway for that bundled scanner path; direct function API URLs include a function-name prefix and are not a substitute for the scanner's root asset path.

Latest Functions emulator verification: **5 passed, 0 failed**, covering source MFA/authorization/CORS/no-store, real template/XLSX preview/commit and retry receipt, raw signed webhooks, request bounds, original QR acceptance/replay rejection and packaged scanner HTML. Local first login took **25,091 ms**, warm authorized event read **140 ms**, and application initialization logged **13,480 ms**. These measurements include local Windows emulator/module-loading overhead and do not establish hosted Firebase latency or production-scale performance. The platform-managed `PORT` is no longer treated as a standalone-listener setting.

## SMTP and sender setup

Resend remains the default transport. To use SMTP, configure `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT` (465 or 587), private `SMTP_USERNAME`/`SMTP_PASSWORD`, and a provider-verified `EMAIL_FROM`, for example `Dream Events <no-reply@your-domain>`. Port 465 uses implicit TLS; 587 requires STARTTLS. Certificates are verified, protocol logging is disabled, and attachments cannot load files or URLs. `EMAIL_REPLY_TO` optionally supplies a separate support address. The visible From address remains visible; the words no-reply do not prevent recipients replying.

Use the sender domain's provider-supplied SPF and DKIM records and a reviewed DMARC policy/alignment. Copy the provider's exact DNS values; this code does not invent or edit them. A personal SMTP login stays in transport credentials, while the selected verified From appears in message headers. Some providers rewrite senders or require aliases/domain verification; verify actual headers using an explicitly authorized test recipient before attendee sending.

The existing encrypted durable queue pins new jobs to `smtp.email` or `resend.email`, preserves content-checked deduplication and delivery history, and keeps issuance independent. The worker processes only the currently selected transport; drain/review pending jobs before switching providers. A stable SMTP Message-ID assists reconciliation but is not server-side deduplication. Explicit temporary rejection/pre-delivery connection failure can retry; post-DATA uncertainty, partial acceptance and expired sending leases become Unknown for explicit review. No automatic replay occurs after ambiguous SMTP acceptance. The separate Node worker remains the operational worker until its serverless replacement is implemented and validated. Live email is still disabled.

## Frontend performance checkpoint

The old resource hook fetched on every mount, including separate Workspace/Events reads. The new per-Client memory cache deduplicates concurrent GETs, treats results as fresh for 10 seconds and can display cached data during refresh for up to 2 minutes. Cache keys include the full event API path; each signed-in Client owns its own cache. Mutations, access denial, logout and identity reload clear it. Auth/public capability responses and binary ticket downloads are never cached. Authorization and capacity checks always remain server-side.

Page modules now load as separate chunks. Before splitting, the main production JS was 314.82 KB (87.31 KB gzip); with the Firebase bridge disabled it is about 211 KB (66 KB gzip). The Firebase SDK is a separate optional lazy chunk. Unit and browser tests record request deduplication, not a claimed hosted latency improvement. Real host cold-start and database/network latency still require deployment measurements. Serverless warm instances or provisioned concurrency may reduce cold starts at additional cost; no paid capacity was enabled.

Vercel configuration keeps SPA deep links, API/missing-asset 404 responses and private HTML `no-store`; hashed `/assets/` files receive immutable one-year caching. Mobile CSS uses Flexbox, `100dvh`, viewport-fit and safe-area insets. Physical-device camera and deployed domain checks remain separate.

## Vercel and Cloudflare setup boundary

Use `admin-web/` as the Vercel root, `npm ci`, `npm run build`, output `dist`. Configure the matching environment-specific HTTPS `VITE_API_URL` and public Firebase web values; never reuse production backend credentials in previews. Add exact approved frontend origins to backend CORS. Existing API routes remain on the working backend until function parity is verified.

The existing remote projects already have repository-relative root directories `admin-web` and `scanner` and Node 26.x. When using CLI deployment with those project settings, send the repository root and select the corresponding existing project; do not send `admin-web/` and then apply `admin-web` again. Record the prior deployment and API configuration privately before switching. Vercel sign-in/team access is ready, but no local project link, env update or deployment has occurred in this continuation.

The user supplied admin `https://dream-team-peach.vercel.app` and scanner `https://dream-team-scanner.vercel.app`. Hosted CORS and public-link base settings are saved separately in private backend configuration; local CORS remains unchanged. `tmp/firebase-runtime.json` has been prepared and is ignored; it has not been uploaded to Secret Manager. Both public homepages returned HTTP 200; no deployed login/data operations were tested.

No Cloudflare MCP tool or applicable Cloudflare skill is connected. Cloudflare DNS-only records do not apply WAF/rate limits. Only traffic actually proxied through compatible Cloudflare endpoints receives those controls; provider-origin URLs remain directly reachable unless the origin independently restricts access. Firebase/Admin authorization and application rate limits must therefore work at direct origins too. App Check, endpoint-specific WAF/rate policies and compatible origin restrictions remain to implement/validate. Do not proxy Vercel/Firebase records or change DNS based only on this document.

### Optional Turnstile for personal invitations

Set server `TURNSTILE_ENABLED=true` only with the widget's public `TURNSTILE_SITE_KEY`, private `TURNSTILE_SECRET_KEY` and exact lowercase `TURNSTILE_HOSTNAMES=dream-team-peach.vercel.app`. Configure the same hostname in Cloudflare. Never put the secret in VITE variables. The capability-scoped invitation view supplies only the public key; existing local configuration remains disabled. Copy the new settings into a newly reviewed private runtime secret before enabling a hosted instance; the previously prepared runtime file does not update itself.

The dynamic React widget protects guest add/cancel submissions, supports retry/expiry and preserves entered form fields after errors. Every public mutation calls Siteverify on the server, even at direct provider origins, and checks success, action `public-invitation`, exact hostname and challenge age. Missing/invalid checks reject without saving; provider timeout/unreadable results fail closed. Tokens are single-attempt inputs, kept in form memory and excluded from business receipt hashes, logs and caches. A retry obtains a fresh challenge but retains the original business request key, so database receipts/quotas remain authoritative. Turnstile is bot mitigation; it does not replace the student capability or transactional authorization. [Cloudflare validation guidance](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

The Vercel policy allows the Cloudflare challenge script/frame host without allowing arbitrary scripts. Configure the actual provider widget separately; tests use a synthetic widget and mocked Siteverify, with no external registration submission or Cloudflare configuration change. Dummy keys are rejected in production. Other public endpoints are not covered by this integration.

Latest Turnstile checkpoint: **89 passed, 0 failed, 2 skipped in 98.5813681 seconds** in the PostgreSQL/API/Chrome suite; focused backend **7 passed in 2.352796 seconds**, frontend **6 passed in 0.7401925 seconds**, and backend/Functions/scanner/admin builds passed. Chrome verifies challenge gating, provider rejection, retained input, successful fresh-challenge retry and cancellation; the API tests verify direct-origin enforcement and idempotent receipts. The two Firebase-only skips were covered by the earlier separate Auth/browser emulator run. Tests do not certify a configured production widget. The emulator launcher now anchors its working directory, allowing invocation from the repository root as well as through the documented npm scripts.

Final Node 22 Functions emulator rerun: **5 passed, 0 failed in 27.4457186 seconds**, including cross-origin challenge-header preflight, API/MFA, Excel retry receipts, raw webhooks and legacy scanner compatibility. Temporary fixture configuration and emulators were cleaned up. Work is paused at this verified checkpoint; resume instructions are in `SESSION_HANDOFF.md`.

References: [Firebase custom authentication](https://firebase.google.com/docs/auth/admin/create-custom-tokens), [import compatibility](https://firebase.google.com/docs/auth/admin/import-users), [emulator setup](https://firebase.google.com/docs/emulator-suite/install_and_configure), [Firestore server rule bypass](https://firebase.google.com/docs/firestore/security/rules-conditions).
