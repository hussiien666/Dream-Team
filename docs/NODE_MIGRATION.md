# Dream Events - Node.js migration — active implementation record

**Current direction (13 November 2026):** read `FIREBASE_UPGRADE_SPEC.md` and `FIREBASE_MIGRATION.md` first. Firebase is now the backend target; the Node/PostgreSQL record below describes the preserved working baseline. The API is being packaged for Firebase Cloud Functions while Firestore data and business parity remain pending. Earlier final-provider decisions below are historical.

11 November 2026 Excel import fix: the Students/Guests importer now accepts Excel-generated `mailto:` hyperlinks only when the email column's displayed address matches the link, converting them to plain text. It continues to reject formulas and other external links. The generated template plus Excel-style email links passed 2 focused tests; backend build and restarted local API health passed. No database migration was needed.

The latest [React admin/deployment instruction](REACT_ADMIN_SPEC.md) makes React/Vite the final admin and Resend the final email provider. The earlier Node specification remains the backend/product reference. The [Node.js specification](NODE_PRODUCT_SPEC.md) supersedes the earlier Python-backend architecture. Preserve the established business rules. The supplied attachment ends partway through Maintenance Mode; retain the earlier complete specification for omitted operations/security details unless the user changes them.

## Architecture decision

NestJS/TypeScript, REST `/api/v1`, Prisma/PostgreSQL, Node background jobs and WebSockets are the target backend. React/TypeScript/Vite in `admin-web/` is now the final admin target; Streamlit is retained temporarily, and the independent scanner remains in `scanner/`. No venv is required. Do not create a parallel permanent Python business-logic service or scanner database.

The existing Python application remains operational during migration. It is explicitly a temporary legacy implementation. Do not point it at PostgreSQL or claim Streamlit is already a thin client. Cutover requires implemented API equivalents and verified data migration; it has not happened yet.

## Repository findings

The Python checkpoint is migration `04_security_sessions`, with 52 tests passing. The initial Node scaffold was present when this instruction arrived: auth/users/events/categories/entrances/attendees/tickets source files and Prisma models, but no Prisma migrations, no data-transfer scripts, no scanner frontend, and no working API client admin.

The Node baseline build failed with 338 TypeScript errors. Most were ESM import/type issues; missing module imports and mismatched Prisma CLI/client versions also prevented startup. The auth guard accepted a JWT without checking session revocation, idle expiry, or 2FA. User APIs returned password hashes; several delete endpoints did not scope the target record to the authorized event. These are implementation defects, not finalized functionality to preserve.

## Implemented migration foundation

- Repair existing ESM source layout and use matching Prisma CLI/client/adapter 7.10.1, avoiding the previously mixed Prisma 8 release candidate and Prisma 7 client.
- Preserve snake_case legacy columns through Prisma field mappings, all primary keys and timestamp microseconds. Retain orphan historical audit event IDs deliberately; they must not become mandatory event foreign keys.
- Version-controlled PostgreSQL baseline and a second migration for checks, organization/event composite foreign keys and immutable history triggers.
- Offline Node export/import tooling in `migration/legacy.mjs`. Explicit table/column mapping; read-only consistent SQLite snapshot; bounded supported revision; checksums/counts for every row; default dry-run with rollback; empty-target-only import; transactions; report; sequence repair only on commit. Original SQLite is never deleted or overwritten.
- Node administration uses opaque, database-backed revocable sessions. Password login remains compatible with existing Argon2id hashes. Mandatory Super Admin TOTP/recovery is checked before business APIs; server idle expiry, absolute expiry, password-change gate, committed failure counters and factor replay checks apply.
- Existing Python Fernet secrets remain readable with the matching legacy key; new Node protected values use versioned authenticated AES-GCM. Do not replace or print the original key.
- Scanner logins are excluded from the admin API. A separate account + event-code scanner workflow remains to be implemented.
- Subsequently implemented: Node scanner account + event-code login with explicit staff/event/entrance grants; account/code attempt limits and lockout; one-device sessions; temporary-password challenge before displacing an existing device; immediate code deactivation/remote logout; backend entrance switching; transactional check-in of legacy-format QRs; original duplicate context; own current-session counts and last ten scans. Disablement and password reset preserve existing scanner sessions; scanner sessions have no inactivity expiry.
- Subsequently implemented: React/Vite `/scan/` frontend, rear-camera-only constraints, optional torch, local jsQR decode, screen-wake request, optional battery warning, sound/vibration preferences, online/offline handling, server-only check-in, three-second result with manual next action. PWA manifest and icon are present; no offline admissions/queue or public event page exists.
- Streamlit API-client preview is `admin/main.py`: API-owned sign-in/TOTP/recovery, event view/dashboard, scanner staff/code creation/assignment/deactivation and remote logout. It has no database imports or backend business rules. It does not yet replace all legacy management pages.
- Existing user responses omit password hashes; role changes revoke old sessions; event assignment and legacy delete paths now validate ownership of the target. Event/access lifecycle and DTO coverage have subsequently been completed as described below. Attendee/ticket transaction and DTO parity still require work before production cutover.

## Verification gates and next work

1. Compile, schema validate/generate, apply Prisma migrations to a disposable PostgreSQL instance.
2. Test SQLite dry-run and committed round-trip with a populated synthetic legacy fixture. Verify rows, IDs, QR lookups, orphan historical audit IDs, timestamps, immutable history, source preservation, target refusal, sessions/2FA, API validation and organization boundaries.
3. Finish event/access/attendee/ticket services: strict DTOs, transaction/audit coupling, all-or-nothing issuance, durable recoverable ticket artifacts, correct lifecycle, duplication, limits, safe exports. Current scaffold implementations are not yet certified equivalents.
4. Implement Node mail worker/retries, email-factor verification and reset endpoints. The earlier Python email/reset scaffolding is reference only; do not finish it as a second backend.
5. Implement Node scanner authorization/check-in and React scanner, then API-client Streamlit pages. No offline check-in and no frontend authorization authority.
6. Port students/invitations/templates/transfers/notifications/reporting/emergency/monitoring and other requirements from the active specification in controlled stages.
7. Full parity/security/concurrency tests, dry-run on a consistent real-data copy, explicit deployment/cutover procedure, external backups and key retention. Keep the SQLite source as rollback evidence.

The scanner core and first API-client pages above were implemented after the initial roadmap. Remaining scanner work includes profile/self-password screens, admin UI for the now-implemented code regeneration/activation APIs, staff monitoring, announcements/emergency reports, WebSocket updates, and student/sender/group details once invitation models exist. The core currently polls the backend every five seconds. Legacy students are still ordinary attendee records; do not invent invitation senders from them.

## Results recorded on 10 November 2026

- Node baseline repaired from 338 build errors; current TypeScript build and Prisma schema/client generation pass.
- Three Prisma migrations applied to disposable real PostgreSQL databases, including additive event/ticket lifecycle enum values. No original migration or legacy row was rewritten.
- Dry-run of the actual configured legacy SQLite file: **28 tables, 43 rows**, every imported row matched, target rolled back to empty. Source not modified and no live cutover performed.
- Populated fixture integration suite: **24 passed in 23.6108408 seconds**, plus **1 retained Node unit test passed**. Includes committed round-trip, microseconds, orphan historical audit event IDs, history immutability, legacy Argon2/Fernet/QR compatibility, pre-2FA API denial, validation, token rotation/replay, idle/organization boundaries, scanner code/entrance restrictions, concurrent admission, session semantics, private own-last-ten activity, live database health, and generated OpenAPI metadata.
- React production build passed. Chrome mobile viewport QA used a simulated rear-camera stream containing a real generated legacy QR. Account/code login, entrance confirmation, local decode, real PostgreSQL green admission, camera removal, three-second wait/manual next, red duplicate with original time/entrance, and offline blocking all passed. Physical-phone rear camera/permissions and deployed HTTPS remain device/deployment checks.
- Thin-client contract/UI tests: **3 passed**. They check HTTP-only data access, bearer/error behavior, absence of DB/business imports, and server-factor gate before event loading.
- Full Python regression including the client tests: **55 passed in 96.43 seconds**. Original live database remains revision `04_security_sessions`.
- Dependency audits after removing an unused deployment tool, updating Vite, and overriding ExcelJS's vulnerable UUID transitive dependency: **zero reported vulnerabilities** in backend and scanner at the last check. This is an npm advisory result, not a production-security certification.
- ExcelJS XLSX write/read round-trip passed with the UUID override. Schema and ownership/history constraints are deployed only to disposable QA databases, not a live PostgreSQL target.


## Event and access API checkpoint - 10 November 2026

Implemented and verified through the real HTTP API and PostgreSQL:

- Strict event/category/entrance DTOs, explicit timestamp offsets, IANA time zones, date/distribution validation, default ticket limits, organization ownership and assigned-event permissions. Production request validation now matches tests: strings cannot silently become numbers/booleans.
- Event mutation transactions lock the event row, recheck authorization and commit audit records with the change. Scanner admission uses the same event lock. Editing rejects reductions below active/used ticket totals; category reductions also respect per-attendee issued counts.
- Event duplication is atomic and copies metadata, existing logo/banner bytes, categories, entrances/permissions, settings and event/staff assignments. IDs and category references are remapped. Access-code grant configurations copy as disabled codes with independent credentials; regenerate the copied code to obtain its new credential, then activate it. Students/attendees, tickets, admissions, delivery records, sessions and staff activity are not copied. Template copying will apply when template entities exist.
- Upcoming/Active statuses are additive; legacy Draft/Published/Ongoing/Completed/Cancelled remain compatible. Status changes are administrator-driven. Cancellation uses a separate Cancelled ticket state, retains QR hashes and Used/Revoked history, and rejects admission immediately. Only Super Admin can reopen a cancelled event; it becomes Upcoming or Active and old cancelled tickets remain invalid.
- Rescheduling preserves ticket numbers, IDs and QR hashes. Event-bound unused ticket expiries move with the end time, including imported microsecond-precision expiries; eligible event-expired unused tickets can become active again. Explicit independent expiry dates remain unchanged. Existing downloaded PDFs are snapshots; updated artifact rendering/resending and notification delivery still depend on later ticket/mail stages.
- Completed events can be archived; only Super Admin can restore. Restoration retains Completed status. Event/access mutations and existing attendee/ticket mutation entry points reject closed/archived events. Ticket-free deletion retains records by removing the event from active use. Emergency code deactivation/remote logout remain available.
- Typed, event-scoped configuration lives under `event_settings/product.v1`: branding colors, default category, invitation limits, delivery/transfer/notification preferences. Unknown fields, inactive/foreign default categories and invalid transfer deadlines are rejected. Future invitation/delivery/transfer modules must consume these settings; saving them does not claim those modules already exist. No arbitrary credential-setting endpoint was added.
- Category/entrance changes validate the final event-scoped grants before writing. Invalid permission edits roll back; duplicate creates serialize. Default categories cannot be deactivated without changing the default first.
- Access-code create, activate, deactivate, regenerate and assignment APIs are implemented. Credentials are returned once and stored hashed; regeneration and grant edits terminate affected sessions atomically. Code lists expose active session counts, never raw credentials/hashes. Detailed historical usage/monitoring remains a later operations feature. Staff assignment changes now serialize with event mutations and audit atomically.

Current verification: **24 PostgreSQL integration tests passed, 0 failed (23.6108408 seconds)**, including the original 14 and 10 event/access tests; **1 Node unit test passed**; backend and scanner production builds passed; focused thin-client tests **3 passed in 17.58 seconds**. The new tests cover validation/ownership, concurrent duplicate creation, cross-event grant rollback, typed settings, code transitions, complete configuration duplication, injected audit-failure rollback, rescheduling with microseconds, reopening restrictions, cancellation/check-in concurrency and archive protections. Baseline before changes was independently rerun: 14/14 passed. The full Python 55-test result above is historical and was not rerun because no legacy Python code changed. Physical-camera browser QA and dependency audits were not repeated this checkpoint.

No source SQLite changes, production PostgreSQL cutover or real email sends occurred. The QA PostgreSQL instance is disposable. Repository-scoped Git checks found these project files untracked under an existing ancestor repository; there is no tracked project diff/commit baseline.

Next: **Priority 2 - students, guests and invitations**, beginning with additive Prisma entities/constraints, preserving ordinary legacy attendee/ticket identities and adding strict, transactional CRUD before the two-sheet import. Existing attendee/ticket scaffold atomicity and durable artifact gaps remain pending; this checkpoint does not certify those services or the full migration for production.

API reference uses Nest's [official framework documentation](https://docs.nestjs.com/first-steps), Prisma's [PostgreSQL adapter documentation](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql), and [OWASP reset guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) for the pending recovery workflow.

Do not label the entire Node migration or the full product upgrade complete based on scaffold files or unit tests alone. Record actual results and remaining work in `SESSION_HANDOFF.md` at each checkpoint.


## Dream Events React admin/deployment checkpoint - 10 November 2026

Latest instructions: [REACT_ADMIN_SPEC.md](REACT_ADMIN_SPEC.md). Current parity is mapped in [REACT_ADMIN_PARITY.md](REACT_ADMIN_PARITY.md), with production preparation in [DEPLOYMENT.md](DEPLOYMENT.md). Preserve the earlier implementation rather than rebuilding it.

Implemented:

- New `admin-web/` React/TypeScript/Vite app. Its real API client uses bounded requests, exact API URL validation, bearer auth without cookies, no-store/error handling, tab-scoped tokens and safe session expiry. Backend `auth/me` returns current password/factor gates for reload/deep-link protection. No data API loads before factor completion; stale session responses cannot restore an old identity.
- Password login, existing TOTP enrollment/verification, one-time recovery-code acknowledgement/regeneration, forced password change, own password change and confirmed logout. No fake email-factor/reset buttons were added.
- Event list/table/card views, search/status/sort, create/partial edit, event dashboard/settings and confirmed lifecycle actions. Device-time form values convert to UTC; unchanged timestamps are omitted from edits to preserve imported precision. Dashboard displays the event time zone.
- Categories/entrances and allowed-category grants; staff account creation+event assignment atomically, account editing/role changes, enable/disable, temporary passwords, assignments, remote logout; access-code create/edit/activate/deactivate/regenerate with one-time secret display. Server permissions remain authoritative. Staff role edits now couple writes/session revocation/audit in one transaction; PATCH success is HTTP 204.
- Dream Events display names across active admin/scanner titles, metadata, new authenticator enrollment issuer, default email sender and newly generated ticket/template author metadata. Existing organization data, passwords, existing authenticator secrets, QR `AAST1.` namespace, ticket IDs, scanner storage keys and historical migrations/audits were not renamed.
- Resend central provider, encrypted database outbox, deduplication/content checks, SKIP LOCKED leases, bounded transient retries, safe errors, 23-hour idempotency window protection, provider message IDs and signed raw-body webhooks with immutable replay-deduplicated history. Early callbacks and lost send-result persistence are reconciled. API startup does not send emails; a separately started, explicitly enabled worker handles sending. No live mail was sent. Ticket/invitation/auth producers, templates, manual resend and failure notifications remain pending.
- Additive PostgreSQL migration `202611100004_resend_delivery` creates Node-only delivery/webhook tracking. Legacy delivery rows remain intact. Only disposable QA databases received this migration.
- Production configuration validation, verified pg TLS/CA/pool settings, explicit HTTPS CORS, bounded trusted-proxy hops and existing shutdown hooks. Vercel SPA/security configuration and Render API blueprint are prepared and passed official provider JSON schemas. No build/start automatically runs migrations. Worker/provider/DNS setup is documented; nothing is deployed.
- Scanner display branding and public API/base-path configuration support independent hosting while preserving the existing backend `/scan/` default. Both default and root-hosted static scanner builds were checked.

Known remaining work: React students/guests/invitations, legacy attendee/import/ticket parity, durable artifacts, template/delivery producers, reporting/export, monitoring/announcements/emergencies/system controls and remaining security-email/reset flows. The parity checklist identifies which backend contracts are missing; no production page uses mock substitutes. No actual domain/provider account configuration is known. TLS/Aiven/Resend/domain/physical-camera/load checks require the approved real environment. Preserve Streamlit until verified parity and explicit removal approval.


## Students and guests checkpoint - 10 November 2026

Implemented the approved registration stage incrementally in the existing Node and React applications:

- Additive migration `202611100005_students_guests`: event-scoped students, guest invitations linked to new attendee rows, custom-field definitions and immutable import receipts. Student IDs are unique within an event. Ordinary legacy attendees are not converted into senders. Guest email is stored on the invitation, allowing the same address under different students while preserving legacy attendee uniqueness.
- Ticket foreign keys now enforce attendee/event and category/event separately. Current registration category edits update only unused Active/Expired tickets without admissions; ticket IDs, numbers, QR hashes and status remain intact. Used, revoked/cancelled tickets and original check-ins retain their categories/history. Existing printed/downloaded artifacts remain snapshots; rendering/delivery follows in the next stage.
- Authenticated event-scoped student/guest CRUD, cancellation-impact/confirmation, custom-field, invitation-limit, template, preview and commit APIs. Authorization requires `attendees.manage`, organization membership and event access. Limits/overrides additionally require `events.manage`; exceptions require an audited reason. Event locks serialize quota changes, registrations, category edits, cancellations and scanner admission. Generic legacy attendee mutations cannot bypass linked invitation management.
- Event-wide, per-student (including individual overrides) and category-per-student limits; active-category/default validation; separate invitation groups. Seven field types validate manual and Excel values. Field keys/types/options stay fixed to preserve answers; label/required/active can be edited, and deactivation retains values.
- Two-sheet Students/Guests XLSX templates with text IDs/phones, active category choices, field metadata and dropdowns. Imports reject formulas, external references, invalid/ambiguous categories, unknown students, duplicates, numeric IDs/phones, files over 10 MB, expansion over 30 MB, more than 5,000 combined rows/50 columns or unsupported archive members. Compressed members are checked with bounded inflation before ExcelJS reads them.
- Preview distinguishes new records and updates with source sheet/row errors. Confirmed commits revalidate against a state fingerprint, roll back as a whole and store an event/actor-scoped idempotent result. Match students by Student ID; guests by sender plus email, otherwise normalized name/phone. Cancelled matches are rejected; imports do not reactivate them.
- Student deletion is a confirmed soft cancellation with a checked linked-guest count. Linked registrations and unused tickets are cancelled; used tickets/admissions/audits remain. Archived events reject writes. Existing contact/custom/category edits can be made on non-archived completed/cancelled events, but new registrations remain closed and registration deadlines apply to new records.
- React **Students & Invitations** uses real APIs: search/status filters, linked counts, add/edit/cancel dialogs, custom-field and limit controls, template download, upload/preview/confirmation and import result. Forms retain input after errors. No ticket issuance, email or public invitation-link controls were added.
- Event duplication copies custom-field definitions and remaps category invitation limits; registrations/import receipts/activity are excluded.

Verification: **46 passed, zero failures in 61.8574532 seconds**, comprising 45 real-PostgreSQL/API cases plus the extended Chrome desktop/mobile administration flow, including existing scanner regressions. Frontend contracts **4 passed in 386.9804 ms**; retained backend unit **1 passed**; Prisma validation/generation and backend/admin/scanner production builds passed. Manual and Excel category-edit checks preserve QR hashes and used-ticket category history. Python was unchanged; its prior 55-pass result was not rerun. Exact commands and resume point are in SESSION_HANDOFF.md. Only disposable PostgreSQL databases received the new migration. Source SQLite, Streamlit, production infrastructure and real email delivery remain unchanged. Full-capacity production import/load and physical-phone checks remain deployment validations.

Next: atomic ticket issuance, recoverable same-QR artifacts, ticket templates and invitation/ticket delivery using the existing Resend queue; then public invitation links/transfers/reporting and operations. The overall migration is still incomplete.


## Permanent account removal checkpoint - 11 November 2026

User-authorized removal of two named hosted test administrator accounts required preserving immutable history. Additive migration `202611110006_account_identities` moves actor/staff foreign-key targets to an independent historical identity ledger; original evidence IDs/rows are not rewritten. New/renamed logins synchronize active labels, while physical deletion anonymizes and freezes the retained identity. Usernames can be reused under new IDs without reattributing evidence.

The trusted local `removeAdminAccounts` helper validates exact IDs/names, requires another active Super Admin, removes operational credentials/grants, physically deletes login rows and appends an additive local-operator audit. No unauthenticated HTTP endpoint or UI delete control was added. Test coverage proves rollback, last-admin protection and retained check-ins/scans/import receipts. **54 PostgreSQL integration tests passed, zero failed, in 88.5222815 seconds**; Prisma generation/backend build passed.

After an encrypted verified pre-change backup, the sixth migration and explicitly requested removals were applied only to the configured Aiven test service. All 53 existing audit rows remained byte-equivalent as JSON evidence; historical labels were anonymized, and other Super Admin access remains. SQLite/production cutover/live email were untouched. See SESSION_HANDOFF.md for exact account disposition and resume point.

## Tickets checkpoint — 11 November 2026

Implemented manual/selected ticket issuance and the real React Tickets page. Event-row locks serialize batches, reactivation/replacement and scanner admission. Entire issuance batches (up to 500 registrations) validate/render/save/audit atomically; immutable actor-scoped receipts make concurrent retries idempotent. Event/category limits, cancelled registrations and duplicate live tickets are enforced server-side.

Migration `202611110007_ticket_credentials` adds separately encrypted recoverable credentials and immutable issuance receipts. PDF/mobile HTML downloads recover after restart; ordinary refresh preserves QR/number/ID. Hash-only historical tickets require matching original QR adoption or an explicitly confirmed replacement of an eligible unused ticket. Cancel/reactivate/permanent revoke/replace actions require confirmation and an audited reason. Used tickets and original admission evidence remain protected.

Verification: **55 real-PostgreSQL/browser tests passed, 0 failed, 55.730906 seconds**, plus **9 provisioning/removal tests**, **4 frontend tests** and **1 backend unit**. Prisma generation and backend/admin/scanner production builds passed. Chrome now uses an isolated ephemeral port and covers ticket generation/download/same-QR refresh/cancel/reactivate; scanner and migration regressions passed. See [detailed checkpoint](TICKET_CHECKPOINT.md) for exact commands/results and limitations.

After a verified encrypted 36-table snapshot, the seventh migration was applied to the authorized Aiven **test** service. All pre-existing data tables remained unchanged; new ticket tables were empty. Local API/proxy/database/scanner health passed after restarting only the verified API process. No production deployment/cutover, real ticket issuance, live email, original SQLite or Streamlit change.

**User requested a stop at every checkpoint; this stage is stopped pending explicit resume.** Next: templates/Unicode PDF fonts/ZIP, automatic/group issuance and Resend delivery producers, followed by public links/transfers/reports/operations/security email. Current Helvetica rendering cannot handle every Unicode name; such rendering errors roll back the entire issuance. Full-size batch throughput and physical-phone production checks remain unverified.

## Template/rendering/ZIP checkpoint - 11 November 2026

The next checkpoint is complete: organization-scoped reusable ticket templates and real React editor/previews; applied event design snapshots; shared PDF/mobile settings; bundled Arabic/Latin font shaping/bidi/wrapping; bounded ZIP downloads for 50 tickets/30 MB. Template creation/editing/application/deletion preserve QR identities and applied designs. Existing event duplication copies the applied setting. Images are bounded PNG/JPEG, preview QRs are deliberately unusable, and ZIPs are checked with an independent reader. See [details and limitations](TEMPLATE_CHECKPOINT.md).

Migration `202611110008_ticket_templates` adds one organization-scoped table. After a verified encrypted 38-table snapshot it was applied to the authorized Aiven test service; all existing data tables remained unchanged. No production/SQLite/cutover/email changes. Final changed-backend validation: **61 PostgreSQL/API/browser tests passed, zero failures, 78.2879685 seconds**; **4 frontend contracts passed**, backend/admin builds passed. Existing scanner/migration regressions are included. UTF-8 test database creation fixes Windows locale behavior; original database encodings were not rewritten.

Stopped at the user's checkpoint boundary. On explicit resume continue automatic/group issuance and ticket/invitation delivery through the existing Resend worker, then public links/transfers/reporting/operations/security-email workflows. Font coverage is explicitly bounded; unsupported scripts fail safely. No foundation rebuild or repeat audit is needed.

## Automatic/group issuance and ticket delivery checkpoint - 11 November 2026

Implemented opt-in automatic tickets inside manual/Excel guest registration transactions, event-scoped idempotent group issuance, automatic transactional ticket email jobs and private guest/student recipient routing. Email-disabled mode still creates downloadable tickets; enabled jobs run through the existing Resend worker, never an HTTP-bound send. Manual/confirmed recipient review, reasoned idempotent resend, editable plain-text templates, PDF attachments with unchanged QR credentials, status/history/issues and current-ticket preflight are implemented. Failure/bounce/complaint notifications are durable and deduplicated. See [delivery checkpoint](DELIVERY_CHECKPOINT.md) for scope and limits.

Migration `202611110009_ticket_delivery` adds immutable dispatch/operation/notice evidence with event/job/ticket isolation. Applied only to the authorized Aiven test service after a verified encrypted 39-table snapshot; existing data tables were unchanged and new tables empty. No real worker/email, production migration, source SQLite change or Streamlit removal.

Final changed-backend/browser run: **69 passed, zero failures, 74.3438125 seconds**, including 8 new API cases and extended real-API Chrome flows; **4 frontend tests passed in 442.046 ms**. Backend/admin builds and Prisma generation passed. Scanner/history/auth/registration/template regressions are included. No repeated baseline or foundation audit; unchanged suites remain historical.

Stop at this checkpoint pending explicit resume. Next: personal invitation and expiring mobile ticket links, guest cancellation/replacement/transfers, then remaining reporting/operations/security-email modules. Live delivery certification needs a verified Resend sender/domain/webhook and explicit send authorization; it does not block local development.


## Personal invitation checkpoint - 11 November 2026

Implemented limited student-scoped personal links and the independent mobile React invitation page, with admin rotation/revocation, hash-only capabilities, strict existing registration validation, confirmed guest cancellation/replacement registration, atomic optional tickets/outbox and immutable retry receipts. Public operations have explicit link attribution without a fabricated admin actor. Original QR identities/admissions remain intact. See [checkpoint details](INVITATION_CHECKPOINT.md).

Final combined validation: **78 passed, zero failures, 110.4982888 seconds** (77 PostgreSQL/API cases and Chrome), including 9 added API cases, mobile link/registration/cancellation/revocation and existing scanner regressions. Frontend contracts: **4 passed in 478.0136 ms**. No real email was sent.

After testing, the user explicitly requested applying this checkpoint and stopping. Migration `202611110010_public_invitations` is now applied to the configured Aiven test service after an encrypted verified 42-table snapshot. All pre-existing data tables remained unchanged and both new tables were empty. The verified local API was restarted: API/proxy health 200 with database connected, scanner 200, public invitation endpoint 401 without a capability as expected. No worker/live email, production, SQLite or Streamlit change. Stopped; next on explicit resume is guest mobile tickets/transfers/link email/notifications, followed by remaining reporting/operations/security-email modules.


## Scanner login feedback correction - 11 November 2026

Fixed frontend HTTP-401 handling that silently returned to sign-in without showing the backend rejection. Expired temporary-password challenges now return to normal sign-in; successful login clears old errors. Authentication and scanner access rules are unchanged. Scanner production build passed; 4 isolated Chrome login/session-feedback tests passed (7.62501 seconds), using intercepted synthetic responses. Updated assets are served by the existing backend. No schema change, account reset or real email. Details in SESSION_HANDOFF.md.

## Mobile ticket and transfer verification - 12 November 2026

Antigravity added migration 11, public mobile ticket capabilities, guest/admin transfers with approval and deadline controls, guest cancellation and React pages. The first verification found six failing tests. Corrected test setup and a real Nest route collision; partial event-settings updates now retain omitted values, and matching retries return committed receipts after a transfer/cancellation revokes the link. **83 disposable-PostgreSQL integration tests passed, zero failures**; backend/admin builds passed. Migration 11 is **not applied to the hosted Aiven database** in this session. Live email and deployed Vercel behavior remain unverified. Continue with reports/exports, then remaining operations and security-email flows; inspect Antigravity additions before implementing each module.

## Supabase-primary request - 12 November 2026

The user added a database migration stage before the final security audit: move the Node primary from Aiven to Supabase and maintain Aiven as a recoverable backup. The Supabase MCP connection is authenticated, but no application database configuration, data, or hosted deployment has been changed. Before cutover, verify the existing Aiven and Supabase states, prepare and restore-test a consistent protected backup, compare migrated records and immutable history, test application/worker/scanner behavior, and define Aiven refresh plus a fenced failover/rollback procedure. A static Aiven copy is not a current backup, and failover is not automatic by default. Production migration/configuration changes require a reviewed cutover and explicit authorization. Preserve SQLite and Streamlit.

## Reports checkpoint - 12 November 2026

Added authenticated event-scoped report snapshot and CSV/Excel export APIs plus the React Reports page. The snapshot includes registration/ticket/admission totals, capacity remaining using the same Active+Used allocation rule as issuance, category/entrance counts, rejected scans, students/invitations, transfer/delivery status, recent check-ins and remaining attendees. Exports require `exports.create`, escape spreadsheet formulas and limit detail to 20,000 rows per list. Fixed the Reports module's auth import after the first integration startup failed. **85 disposable-PostgreSQL/API/Chrome tests passed, zero failures in 116.703 seconds**, including report API/export and real React report navigation/download; backend/admin production builds passed. No schema migration, hosted deployment, live email or Aiven/Supabase data change. PDF/scheduled reports and broader operational exports remain pending.

The report permission case was subsequently extended to verify a check-in supervisor can view only their assigned event and cannot export; the focused rerun passed **1/1**. No application code changed after the full run. Next: event audit history and operational monitoring/announcements/incidents, followed by account-email flows. Supabase-primary/Aiven-backup migration and recovery validation precede the final security audit.

## Event audit history - 12 November 2026

Added Super Admin-only event audit listing in React Reports and a bounded CSV export. Server authorization checks the current event's organization and `system.manage`; export also requires `exports.create`. The UI shows the latest 200 entries and export allows up to 5,000. This does not yet expose organization-wide or deleted-event history, which lacks durable organization attribution in the legacy audit table. **85 disposable-PostgreSQL/API/Chrome tests passed, zero failures in 91.377 seconds** after this change; backend/admin builds passed. No migration or hosted database change. Next: operational monitoring, announcements and critical scanner reports.

## Scanner staff activity - 13 November 2026

Added a read-only event-scoped scanner-staff table for Super Admins and Check-in Supervisors in Reports. It lists assigned scanner accounts, active status, current entrance, last-seen time, and accepted/rejected attempts. The server checks organization/event assignment and role; a session counts as connected only when its access code is active and it was seen within two minutes. Manual refresh is available; WebSocket push, announcements and critical incident reporting remain pending. **85 disposable-PostgreSQL/API/Chrome tests passed, zero failures in 84.549 seconds**; backend/admin builds passed. No migration or hosted configuration change.
# Latest direction — 13 November 2026

The user now targets Firebase Authentication/Firestore/Storage/server functions. See `FIREBASE_UPGRADE_SPEC.md` and `FIREBASE_MIGRATION.md`. The existing Node/PostgreSQL functionality remains working and authoritative during transition; it is the regression/parity baseline. An opt-in session-bound Firebase identity bridge, frontend caching/splitting, SMTP transport, Functions adapter/package and optional invitation Turnstile checks are implemented locally without a hosted data cutover. Earlier final-provider/Supabase plans are superseded by the latest prompt.

**Paused at the user's request before deployment.** The user authorized switching the Firebase API and both existing Vercel clients and confirmed Aiven contains test data; that work is deferred until resume. Firebase reauthentication/project access succeeded, but read-only Functions listing failed and API/billing/IAM readiness remains unresolved. No Secret Manager upload, database migration, traffic switch, DNS edit or live mail occurred. See the handoff's current checkpoint for test results and the exact next step. Firestore business parity/migration, expanded registration forms, App Check, serverless worker, security-email/operations and the requested comprehensive security audit remain unfinished.
