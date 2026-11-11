# Tickets checkpoint — 11 November 2026

Completed the first ticket stage in the existing Node backend and React admin. Stop here at the user's instruction; wait for “continue” before beginning the next stage.

## Implemented

- Real React **Tickets** section, restricted by `tickets.manage`, with attendee selection, issuance review/confirmation, searchable issued-ticket table, PDF/mobile HTML downloads and lifecycle dialogs. Forms retain input on error; issuance retries retain their request key.
- Strict server payloads and organization/event permissions. Issuance locks the event, validates every registration/category/entrance and event/category allocation, renders before commit and writes tickets/credentials/audits/receipt atomically. Concurrent batches cannot overfill allocations or issue another live ticket for the same guest. Maximum 500 selected registrations; full-size throughput is not certified.
- Immutable, actor-scoped issuance receipts make repeated/concurrent commits return the original result; conflicting key reuse is rejected. Receipt responses contain ticket IDs/numbers, not QR credentials or hashes.
- Additive Prisma migration `202611110007_ticket_credentials`: encrypted recoverable credentials and immutable issuance receipts. Existing hash-only tickets are not modified or assigned invented credentials.
- PDF/mobile HTML are reconstructed from the stored encrypted credential and current printed details after an app restart. **Refresh printed details** retains ticket ID/number/QR. Event time formatting uses the event's IANA zone; linked student names are included. Download responses are private/no-store attachments.
- Historical same-QR adoption requires the matching original `AAST1.` credential and confirmation. Wrong/foreign QR adoption is rejected. Losing the Node installation encryption key prevents decryption; restore that key rather than silently replacing credentials.
- Cancellation and eligible reactivation preserve QR identity; permanent revocation cannot be undone. **Replace QR** is a separately confirmed, reason-recorded operation invalidating the old QR. Used tickets/admissions cannot be changed by these actions. Archived events reject mutations.
- Chrome tests now use a dedicated ephemeral frontend port, never the user's running Aiven preview. Scanner core was preserved and its regressions passed.

## Exact validation

- Baseline: 54 PostgreSQL integration tests passed, 0 failed, 49.8628122 seconds.
- Final `npm --prefix backend run test:browser:admin`: **55 passed, 0 failed, 55.730906 seconds** (54 API/PostgreSQL + 1 Chrome desktop/mobile case). Includes 9 new ticket cases, existing migration/auth/event/registration/scanner cases and UI generation/download/refresh/cancel/reactivate coverage.
- Additional `node --test test/admin-bootstrap.integration.mjs`, from `backend/` with disposable connection variables: **9 passed, 0 failed, 21.4493998 seconds**.
- Backend unit: **1 passed**, 3.94 seconds. Frontend contracts: **4 passed**, 415.455 ms.
- Prisma generation and backend/admin/scanner production builds passed. Desktop/mobile screenshots were inspected; mobile page does not overflow the viewport (tables scroll horizontally).
- An initial direct test invocation used the wrong working directory; reran from `backend/`. An initial browser assertion contained a shell-encoding replacement character; corrected the selector and reran successfully. No unresolved test failures.
- Legacy Python unchanged; historical 55-pass result was not rerun.

All automated PostgreSQL tests used isolated synthetic databases on the disposable local server. Never point `TEST_DATABASE_URL` at Aiven. Set `NODE_DATABASE_URL` and `PRISMA_MIGRATION_DATABASE_URL` to the disposable connection and clear hosted TLS overrides for these tests.

## Hosted test application

- Saved and decrypted/verified an encrypted safety snapshot of **36 public tables** before upgrading. Its private filename is recorded in ignored `tmp/ticket-checkpoint-backup-path.txt`; it needs the existing Node key. No secrets printed.
- Applied only the seventh additive migration to the existing authorized Aiven **test** service. Compared every pre-existing data table to the snapshot: unchanged. New credential/receipt tables were empty; no real tickets or emails were generated.
- Restarted only the positively identified local project API. API health, React API proxy and scanner portal returned HTTP 200; both health checks reported the database connected.
- Original SQLite, Streamlit, account identities/history, encryption key, production infrastructure and real mail are unchanged.

## Next checkpoint

After explicit resume: configurable ticket templates, Unicode-capable PDF fonts and ZIP downloads, then automatic/group generation and ticket/invitation delivery producers using the existing Resend queue. The current PDF renderer still uses standard Helvetica; names outside that font's character set cause rendering/issuance to fail atomically rather than saving partial tickets. Do not call multilingual ticket output complete.

Public invitation/mobile links, transfers, reporting/exports, audit UI, monitoring/announcements/emergencies/system controls and email-factor/reset flows remain unfinished. No production deployment, cutover, DNS changes, Streamlit removal or live email without separate approval.
