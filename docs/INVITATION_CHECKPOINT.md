# Personal invitation checkpoint — 11 November 2026

Continues the existing registration, atomic ticket and delivery services. This is a limited invitation page, without student accounts or a student dashboard.

## Implemented

- Admins with event-scoped attendee-management permission can create/rotate and revoke personal student links. Creating a replacement invalidates earlier links atomically. Actions require confirmation and an audited reason. The URL is shown once; lost URLs require rotation.
- Links use independent `DEI1.` random 256-bit capabilities. Only their SHA-256 hashes are stored. They are not admin sessions or ticket QR credentials. Secrets are in URL fragments, transmitted to the API only in the Authorization header, and excluded from API list responses and audit details.
- The `/invitation` React page loads independently of admin authentication/storage. It shows the event and only the linked student's guests. It supports confirmed guest registration, cancellation and adding a different replacement guest while registration remains open. Forms retain input after rejected requests.
- Existing server validation enforces student/event/category quotas, required custom fields, category ownership and registration deadlines. Links cannot select another sender, override limits, edit student records, access imports or authenticate to admin APIs.
- Event-row locks serialize public operations with admin changes, issuance and scanner admission. Confirmed operations have immutable, content-checked idempotency receipts. Guest registration and opt-in automatic tickets/delivery jobs commit together or roll back together.
- Public actions have a null admin actor and explicit link ID in audit details. System-issued ticket receipts now permit a null actor; existing actors are not changed or impersonated.
- Cancellation invalidates unused tickets immediately, restores the registration slot and retains ticket IDs/numbers/hashes. Used tickets and immutable admissions remain intact. A replacement registration receives its own ticket/QR when automatic issuance is enabled.
- Links expire at the original event end and also respect the current event end/status/archive and student cancellation on each request. Earlier rescheduling closes access immediately; extending an event does not silently extend old links. Rotate links when necessary. Public endpoints are rate limited.

Migration `202611110010_public_invitations` adds two tables with a composite student/event foreign key and immutable operation receipts. It makes ticket-issuance actor IDs nullable without rewriting evidence.

## Verification

Focused disposable-PostgreSQL API run: **8 passed, zero failures in 34.4870128 seconds**. Covers capability/admin isolation, cross-event/organization denial, strict fields, concurrent quotas and retries, atomic ticket rollback, cancellation/replacement, original QR retention, used admissions, deadlines, revocation/rotation, expiry, closed events and database constraints.

**Final combined run: 78 passed, zero failures in 110.4982888 seconds** (77 PostgreSQL/API cases plus Chrome), including nine invitation API cases and mobile UI coverage. Frontend contracts: **4 passed in 478.0136 ms**. Mobile screenshot visually checked.

The user subsequently authorized applying this checkpoint and stopping. Migration 10 is now applied to the Aiven test database after a verified encrypted 42-table backup. Existing data tables were unchanged and both new tables empty. The verified local API was restarted; API/proxy/database/scanner health passed, and the public endpoint rejects missing capabilities with 401. No real email was sent. Stopped at this checkpoint; no next feature was started.

## Boundaries and next task

Share links privately using the admin dialog's Copy/Open controls. Invitation-link emails and cancellation notifications are not connected yet; no real mail was sent. Ticket email delivery remains the previously implemented separate feature.

Next: expiring guest mobile ticket links, guest-initiated cancellation, transfer approval/deadlines/history, and link-email/notification producers with stale-recipient/link checks. Reporting, operational controls and security-email/reset workflows remain later checkpoints. No production deployment/cutover, DNS changes, SQLite replacement or Streamlit removal is authorized by this checkpoint.
