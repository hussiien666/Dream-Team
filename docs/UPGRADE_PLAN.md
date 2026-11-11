# AAST Event Manager upgrade: architecture and implementation record

**Historical Python-backend plan.** The user resumed and supplied a superseding [Node.js specification](NODE_PRODUCT_SPEC.md). The active migration record is [NODE_MIGRATION.md](NODE_MIGRATION.md); use [SESSION_HANDOFF.md](../SESSION_HANDOFF.md) to resume current work.

Specification: [complete product upgrade](PRODUCT_SPEC.md) supplied on 10 November 2026 (106 sections, authoritative conflict rules in Part 20). This is an incremental upgrade of the existing application. Requirements in this document are planned unless explicitly recorded as implemented and verified.

## 1. Repository architecture and baseline

Reviewed all application Python modules, dashboard pages, scanner JavaScript/CSS, dependency/configuration files, all three existing migrations, all nine test modules and fixtures, preview script, and README. Bundled jsQR is third-party code and should remain unmodified.

The current application is a Streamlit UI calling Python services directly. SQLAlchemy owns one central SQLite database; Alembic owns schema revisions. Writes use `BEGIN IMMEDIATE` on SQLite; ticket issuance/check-in also lock the event on databases supporting row locks. PDF/HTML/QR rendering is separate from services. Gmail SMTP runs outside write transactions. Scanner frames are decoded locally; decoded text is validated by the Python backend. Wallet generation is an intentionally disabled provider boundary.

Baseline on **10 November 2026**: `py -3.10 -m pytest -q` → **37 passed in 80.06 seconds**. Database revision: `02_email_delivery`; `alembic check` → no differences. Baseline testing used temporary databases, not real attendee data or live SMTP.

There is no virtual environment requirement. Preserve Python 3.10 and user-level installation, existing commands, `.env`, database IDs, password hashes, token hashes, and historical records.

## 2. Existing feature inventory

| Area | Verified implementation to reuse |
| --- | --- |
| Authentication | Argon2id, hashed random sessions, CLI bootstrap, admin/staff roles, five-attempt/15-minute lockout, explicit logout |
| Events/access | Event editing, timezone conversion, capacity, categories/allocations, entrances, category-to-entrance permissions, archive flag |
| Registration | Manual attendee registration, bounded CSV/XLSX imports, familiar column aliases, event-specific template, source-row errors, atomic commit |
| Tickets | Unique opaque 256-bit credentials, hash-only storage, PDF/mobile HTML/ZIP, batch issuance, explicit replacement/revocation, allocation checks |
| Admission | Database-backed validation, wrong-gate rejection without consumption, duplicate protection tested with simultaneous scanners, immutable check-in/audit history |
| Gmail | STARTTLS/app passwords, personalized PDF attachment, persisted delivery outcomes, deduplication, explicit uncertain-send retry, no network inside write transaction |
| Reporting | Real event/category/entrance totals, timeline/no-shows, Excel/CSV exports with formula escaping |
| Scanner | Bundled jsQR camera decoder, mobile-sized camera QA, server image decoder, legacy manual-number fallback |
| Operations | Alembic schema check, external SQLite backup instructions, backend role checks, upload limits, ignored secrets/data |

## 3. Missing features and requirement traceability

| Specification sections | Gap / planned work | Phase |
| --- | --- | --- |
| 7–8 | System theme, separate `/admin` and `/scan`, accessible mobile PWA shell | 3, 6 |
| 9–15 | Four admin roles, event assignments, Super-only account management, 2FA/recovery, email resets, idle expiry, dedicated scanner sessions/profiles | 2 |
| 16–21 | Event selector/dashboard, cards/table/filter, independent duplication, read-only archives, lifecycle notifications, complete exports | 3, 8 |
| 22–35 | Students/senders versus guests, two-sheet import/upsert, scoped duplicates, limits, custom fields, soft removal, personal invitation links | 4 |
| 36–48 | Durable same-QR artifacts, automatic generation, recipient routing, retries, reusable/versioned templates/editor/previews, live expiring links, lifecycle/transfer/cancellation/replacements | 5 |
| 49–70 | Account + protected code login, code/entrance authorization, one-device sessions, rear camera only, torch, connection recovery, three-second result, own last ten scans, preferences, emergencies | 2, 6, 7 |
| 71–80 | Expanded validation, original duplicate context, append-only reversal, scanner assignments/notifications/monitoring/login history/remote logout | 2, 6, 7 |
| 81–84 | In-app/email notifications, audience announcements, consistent event branding | 5, 7 |
| 85–93 | Warning-only readiness, live operations, complete summary, durable scheduled reports, system errors, maintenance/emergency controls | 7, 8 |
| 94–101 | Production routing/HTTPS/shared DB/worker documentation, provider limits, authorization and privacy review | Every phase, 9 |
| 102–106 | Incremental schema and migration preservation, new workflow/security/concurrency regression tests | Every phase |

Apple/Google Wallet support is conditional on real issuer/signing credentials. PDF and HTML remain available independently. No public event page, student account/dashboard, help center, support form, internal backup scheduler, or restore UI will be added.

## 4. Target architecture and migration plan

Keep Streamlit for existing administration and use shared Python services for every mutation. Add a small ASGI web component with ordinary HTML/CSS/JavaScript for `/scan` and limited personal ticket/invitation links. This avoids a Node build, frontend framework, duplicate backend, or second database. Streamlit's rerun/session model alone does not provide clean cookie-authenticated mobile endpoints, expiring ticket resources, or a reliable page-independent worker. Production reverse-proxy routing will put both portals behind one HTTPS origin. ASGI support already exists in the locked dependency set; inspect its supported APIs before using it.

Add a standalone Python worker backed by durable database jobs with claim/lease/idempotency/retry timestamps. Never schedule Gmail retries or reports through browser timers. SMTP cannot guarantee exactly-once delivery after a dropped connection; preserve an explicit uncertain state and stable message ID. Document the possible duplicate-message tradeoff before enabling automatic retries for uncertain sends.

Migrations will be small, explicit, and independently tested:

1. Organization membership, permission assignments, event assignments, security/session extensions. Backfill existing accounts/events into AAST without changing IDs or hashes. Preserve the legacy role field as a compatibility classification while deriving privileges from explicit roles. Existing administrators retain access through a documented enrollment path.
2. Access-code/entrance grants, scanner sessions, preferences, security challenges and recovery tokens. Distinguish scanner revocation rules from admin sessions. Disablement/reset preserves existing scanner sessions; code deactivation/remote logout revokes them.
3. Lifecycle and structured event settings; avoid converting historical status meaning silently. Cancellation preserves tickets and check-ins; reopening never reactivates cancelled tickets.
4. Students, invitations and guest links to existing attendees, custom fields and limits. Keep legacy registrations distinct. Guest matching belongs to the sender/invitation scope, not an event-wide email uniqueness assumption.
5. Ticket template/version, encrypted recoverable artifacts, delivery/jobs, transfer/cancellation records. Keep existing `AAST1.` payloads and hash lookup valid.
6. Append-only check-in reversals and active-admission state. Preserve original immutable check-ins and recreate protection triggers if a table must be rebuilt. Do not overwrite the original admission when reversing.
7. Announcements, notifications, emergency reports, scheduled reports, settings and sanitized system errors as their implementing phase requires them.

Before touching a live database: use SQLite's online backup API, test the migration on a consistent copy containing legacy records, compare stable IDs/hashes/history and run `foreign_key_check`/`integrity_check`. Do not use destructive downgrades for recovery. Production PostgreSQL needs its own migration/concurrency verification; SQLite success is not PostgreSQL certification.

## 5. Security and compatibility risks

| Finding | Consequence / required treatment |
| --- | --- |
| QR plaintext is intentionally unavailable after the generating session | Old hash-only tickets cannot be reconstructed with the same QR. Continue accepting existing QRs. For same-QR artifact adoption, require an authenticated import of the original artifact/credential verified against the stored hash; never rotate a legacy QR silently. New credentials may be encrypted at rest with a separately backed-up key. |
| Check-in is unique forever per ticket and history is immutable | A reversal requires an additive history model and revised active-admission uniqueness. Never remove original evidence to allow re-entry. |
| Every admin currently has global access; staff can choose any open event/gate | Scope reads and writes at the backend, not only navigation. Legacy staff admission must have an explicit migration path to code-authorized scanner sessions. |
| Disablement/password change currently deletes all ordinary sessions | Scanner and admin sessions need separate policies; temporary resets and disablement must preserve active scanner sessions. |
| Archives are only blocked by some services | Make archive protection consistent; Super restoration must be explicit. |
| No-ticket records can currently be hard-deleted | Replace active-record removal with retained history; do not change old migrations or erase evidence. |
| Partial event updates default clocks and reinterpret stored naive UTC dates | Preserve stored instants for omitted fields and test timezone/date changes. Postponement must update validity without rotating identities. |
| Login uses process-local UI and absolute lifetime only | Add server-side idle timeout, 2FA challenge throttling, hashed expiring single-use reset/recovery credentials, cookie/CSRF protections for web endpoints. |
| SQLite serializes writes and source lives in OneDrive | Keep live data outside cloud sync; load-test the intended event/device count, use one host or verified PostgreSQL for scale. |
| Camera/browser and SMTP tests use simulated devices/services | Physical rear-camera tests over trusted HTTPS and configured Gmail delivery remain deployment checks. |
| Free hosts may sleep or stop workers and may have ephemeral disks | Use durable central storage and an actually running worker; do not promise a free tier will support a large live event. |

No credentials, raw QR tokens, recovery codes, temporary passwords or sensitive error traces belong in ordinary audit/system logs. Never expose guest email/phone/lists or other staff history through scanner responses.

## 6. Controlled roadmap and acceptance gates

| Phase | Deliverable / test gate | Status |
| --- | --- | --- |
| 1 | Repository audit, baseline, architecture, gaps, migration and risk plan | Complete: this report |
| 2 | Organization/roles/permissions, safe account management, auth/2FA/reset/session policies, scanner authorization foundation | Partial checkpoint: ownership, fixed roles/assignments, authenticator/recovery and idle expiry; remaining work in CHECKPOINT.md |
| 3 | Event selection/dashboard, views/search/filter, duplicate/archive/lifecycle/configuration | Pending |
| 4 | Separate Students & Invitations UI, manual/two-sheet import, limits/custom fields/upsert/removal/replacements | Pending |
| 5 | Templates/editor/previews, durable tickets/mobile links, recipient routing, retries, cancellation/transfer/wallet fallback | Pending |
| 6 | Independent mobile scanner UI and protected backend, rear camera/torch/offline/results/preferences/privacy | Pending |
| 7 | Live staff/operations, announcements/alerts/emergencies, reversal and controls | Pending |
| 8 | Complete exports/readiness/scheduled reporting/system monitoring/maintenance | Pending |
| 9 | Portable deployment, HTTPS/worker/external backup docs, full regression and security/load/device validation | Pending |

Each stage must implement database behavior, backend authorization, working UI, error handling and tests before it is called complete. Existing tests remain; legitimate changed business rules require explicit updated assertions plus compatibility coverage, never deleting tests just to obtain a pass. Run targeted tests during development and the complete suite at a phase boundary. Record actual results and remaining limitations below.

## Implementation log

- 10 November 2026: completed baseline audit; no live schema or application behavior changed during Phase 1.
- 10 November 2026: implemented the first Phase 2 stage. Added `Organization`, `OrganizationUser`, `OrganizationEvent`, and `EventAssignment` with composite foreign keys. Added a shared permission resolver, organization-scoped event reads and backend authorization for existing event/access/attendee/import/ticket/email/report/check-in services. Settings provides working role/assignment controls; only Super Admin can manage accounts or Gmail configuration. Dashboard no longer exposes cross-event totals. Role changes and assignment removals apply on the next operation, including existing sessions.
- Compatibility: legacy `users.role` is retained, existing administrators map to AAST Super Admin, existing staff are assigned existing events, and new staff require explicit assignments. The staff admission regression test now explicitly assigns its new scanner account; it still tests successful staff admission and rejected issuance. Legacy staff sessions still use the old scanner/session policy; this is an explicit temporary compatibility stage, not completion of the access-code scanner requirement.
- Migration `03_organization_access` adds tables without rebuilding existing ones. A populated revision-02 test compares every legacy table before/after, checks the old session and QR still work, and verifies immutable triggers/integrity. A consistent backup of the actual workspace database was created at `data/backups/aast_before_organization_20261110_110753_798400.db`. Its trial upgrade and the subsequent live upgrade preserved all legacy rows exactly; `foreign_key_check`, `integrity_check`, membership backfill and `alembic check` passed. Current live revision is `03_organization_access`.
- Remaining Phase 2 work: mandatory Super Admin 2FA/enrollment/recovery, email reset links, temporary scanner passwords/forced change, idle-time enforcement, independent scanner session policies, access-code authorization/rate limits, profile controls, configurable permission overrides and their UI/tests. Phases 3–9 are not implemented by the ownership stage; removing global dashboard totals was necessary to enforce the new privacy boundary immediately.
- Validation after this stage: full suite **47 passed in 110.36 seconds** on 10 November 2026. New tests cover every role's allowed/denied actions, assignment removal during an existing session, cross-organization reads/writes/account management, direct foreign-key bypass attempts, role-change audit, populated legacy migration and old-QR admission, and manager UI/navigation privacy. Local Streamlit health returned HTTP 200. No live attendee email was sent.
- Next-turn baseline: **47 passed in 97.01 seconds** before the security implementation. At the user's explicit stop request, finalize only the security checkpoint documented in [CHECKPOINT.md](CHECKPOINT.md). Authenticator/recovery/idle-expiry code and UI are implemented; the full Phase 2 and Phases 3–9 remain incomplete. Email/reset/scanner/job models and backend helpers are scaffolding until their worker, endpoints, UI and workflow tests are finished.
- Security checkpoint finalized and development stopped at the user's request: **52 passed in 85.84 seconds**. Live revision `04_security_sessions`; existing rows unchanged against `data/backups/aast_before_security_20261110_112123_337676.db`; integrity, foreign-key and schema checks passed. Next sign-in requires Super Admin authenticator enrollment/verification. No later phase has been started.
