# Dream Events Node backend

NestJS/TypeScript and Prisma/PostgreSQL migration in progress. The API prefix is `/api/v1`, Swagger is `/api/docs`, and a built React scanner is served at `/scan/`. This backend is not yet a complete production replacement for the legacy application.

Read [the active migration record](../docs/NODE_MIGRATION.md), [the specification](../docs/NODE_PRODUCT_SPEC.md), and [the next-session handoff](../SESSION_HANDOFF.md).

## Local setup

Use Node 24 (validated: 24.15.0), npm, PostgreSQL, and regular Python 3.10 for the Streamlit frontend. No venv. From this directory:

```powershell
npm ci
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

Copy only when `.env` does not already exist. Privately configure `NODE_DATABASE_URL` and the original legacy encryption key through `APP_ENCRYPTION_KEY` or an absolute `APP_KEY_FILE`. Do not paste secrets into documentation or overwrite the root legacy `.env`.

```powershell
npm run prisma:generate
npm run db:migrate
npm run build
npm run start:prod
```

`npm run start:dev` is available during development. Production requires HTTPS routing and configured hosting. Build the scanner first (`npm --prefix ../scanner ci`, then `npm --prefix ../scanner run build`) to serve it from this API host. For Vite development run `npm --prefix ../scanner run dev`; it proxies `/api` to the local backend.

## Create an application administrator

After configuring and migrating a new PostgreSQL test database, run from the project root:

```powershell
npm --prefix backend run db:check
npm --prefix backend run create-admin
```

The command asks for organization (when needed), username, display name, password and confirmation. Passwords are hidden and must contain 12-256 characters. The first account becomes Super Admin only when the entire users table is empty. Creation and its audit are atomic; concurrent attempts cannot create two first accounts. Existing accounts are never overwritten. If accounts already exist, an existing Super Admin password and authenticator/recovery verification are required. Finish authenticator enrollment in React on first sign-in.

Aiven's database login is separate from the application username. Creating an account does not import SQLite events or attendees. Keep the original database and key; legacy import remains a separate reviewed operation requiring an empty target.

See [Aiven testing setup](../docs/AIVEN_LOCAL_TESTING.md). The read-only `db:check` command reports connection/TLS/table readiness without displaying connection strings.

## Data migration

Migration tooling lives in [migration/legacy.mjs](../migration/legacy.mjs). From the repository root, export a consistent SQLite revision-04 snapshot to a new private file:

```powershell
node migration/legacy.mjs export data/aast.db tmp/legacy-export.json
```

Set `NODE_DATABASE_URL` privately in the shell for the PostgreSQL target, apply the Prisma migrations, then:

```powershell
node migration/legacy.mjs import tmp/legacy-export.json tmp/migration-dry-run.json
```

The default performs actual transactional inserts, verifies every row, and rolls back. The target must be empty. After reviewing the report, a controlled import uses a new report filename:

```powershell
node migration/legacy.mjs import tmp/legacy-export.json tmp/migration-import.json --commit
```

Keep the original SQLite database and encryption key. During final cutover, stop writers and make a fresh snapshot; do not run old and new backends as writers against independent databases. An existing target is refused, not overwritten or merged. Failed imports roll back. Exports contain personal data and credential hashes/encrypted security data; protect them as database backups. Windows files need appropriate account/directory access controls.

The Prisma baseline deliberately retains original legacy statuses and check-in uniqueness. Manual SQL migration 002 adds composite ownership constraints and immutable-history triggers. Future Prisma changes must preserve these manually maintained invariants; do not delete them to silence schema drift.

## Validation

```powershell
npm run build
npm test
```

For the populated-data and real-PostgreSQL integration suite, configure `TEST_DATABASE_URL` to a disposable PostgreSQL server whose account can create a database, then run `npm run test:integration`. Each run creates its own database named `aast_migration_test_*`; it does not reset or overwrite the named source database. Remove test databases only after reviewing their names.

The checked-in fixture contains synthetic test credentials and records, never real attendee data. Integration tests use compiled Nest code, real HTTP requests and real PostgreSQL transactions. The starter unit test is not evidence of product completion.

## Implemented versus pending

Implemented and tested: import/export safety, Argon2 compatibility, required TOTP/recovery, revocable opaque admin sessions, idle/absolute expiry, event/organization boundaries, scanner account+code authorization, entrance switching, one-device scanner sessions, temporary-password flow, code activation/deactivation/regeneration and grant edits, transactional event duplication/lifecycle/rescheduling, typed event settings, remote logout, concurrent QR consumption, own ten-scan privacy, and React camera/result/offline flow.

Students/Guests registration, custom fields, quotas and confirmed two-sheet Excel import are implemented in Node and React. The Resend provider/worker exists; invitation/ticket/auth email producers remain pending. Other gaps include atomic ticket issuance, templates/recoverable artifacts, public invitation links, transfers/reactivation/reversal, reporting/exports, monitoring/announcements/emergencies and production/load/physical-device verification. The Students/Guests checkpoint passed 45 API/PostgreSQL cases plus Chrome; the provisioning/removal suite has 9 tests; the combined PostgreSQL run passed 54 tests. See the handoff for exact results and limitations.

Rate limiting is currently per-process plus database user lockout. Distributed API limits, hardened production headers and deployment verification remain part of the production gate. No production telemetry service has been connected.


## React admin and deployment preparation

React administration is `../admin-web/`; Streamlit is retained temporarily. The current provider plan is Vercel admin, Render API, Aiven PostgreSQL, Resend email and Cloudflare DNS. See [deployment preparation](../docs/DEPLOYMENT.md) and [parity checklist](../docs/REACT_ADMIN_PARITY.md). `render.yaml` is preparation only and does not run migrations on startup.

`npm run worker:email` starts the durable Resend worker only when explicitly enabled/configured. `EMAIL_ENABLED=false` is the default. The signed callback is `/api/v1/email/resend/webhook`. Tests mock provider sends; no real emails are sent. The provider foundation does not yet wire invitation/ticket/auth email workflows.

`npm run test:browser:admin` runs the real PostgreSQL suite plus Chrome end-to-end React tests. Requires `TEST_DATABASE_URL`, installed `../admin-web` dependencies and Chrome (or `CHROME_EXECUTABLE`).


## Permanent account removal

Disabling blocks access but keeps the login account. Permanent removal is currently a trusted local maintenance operation in `src/users/account-removal.ts`; there is no React Delete button or public bootstrap/deletion shortcut. It validates exact account IDs/names, preserves another active Super Admin, deletes credentials and login rows atomically, and records the operator request. Audit/check-in/scan/import evidence retains its original IDs through anonymized immutable account identities. Back up privately before maintenance; do not delete historical identity rows or immutable evidence to remove a login.
