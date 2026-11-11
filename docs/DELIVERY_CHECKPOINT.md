# Automatic/group tickets and delivery checkpoint - 11 November 2026

Continued from the template checkpoint without a new foundation audit or baseline rerun. Stop at this checkpoint and wait for explicit resume.

## Completed

- Opt-in `automaticTicketGeneration` event preference. New linked guests registered manually or through confirmed Excel import receive tickets inside the existing event transaction. Registration/tickets/encrypted credentials/issuance receipts/outbox/audits commit together or roll back together. Email-disabled mode still issues downloadable tickets and reports Disabled; no false send result.
- Automatic generation applies to published/open events, not Draft registrations. Distribution/capacity/rendering errors block the registration transaction. Automatic imports support up to 500 new guests; larger open-event imports require splitting or disabling automatic generation. Preview fingerprints include the setting; cancelled matches do not reactivate. Existing registrations are not silently backfilled when the setting is enabled.
- Event-scoped idempotent group-issuance API supports inviting-student and invitation-group selectors; ordinary selected/bulk generation remains available. React filters/selects candidates by student/group before confirmation. Authorization and cross-event/active-registration checks stay server-side.
- Generated tickets automatically enqueue delivery when the server provider is enabled. Guest direct delivery and student copies follow event settings; a guest with no email falls back to the inviting student. Same-address recipients are deduplicated and each receives a separate message. Legacy attendees use their own email and are not converted into senders.
- Configurable per-event plain-text email templates: subject, greeting, body, signature, contact; the four specified placeholders are validated and HTML-escaped. Branding comes from the applied ticket design. PDF attachments are rebuilt with the existing encrypted QR credential; email/resend never rotates it.
- Durable ticket dispatch evidence, actor-scoped idempotent mail-operation receipts and failure notices through additive migration `202611110009_ticket_delivery`. Foreign keys independently enforce ticket/event and job/event scope; dispatch/operation/notice records are immutable. Original legacy delivery records stay intact.
- Existing Resend leases/retries/provider IDs/webhooks remain authoritative. Ticket jobs revalidate event/registration/category/entrance/status/expiry/current QR/current recipients and a printed-content fingerprint before transport. Changed/cancelled/replaced/used tickets and stale recipient/design/template copies fail safely. Network sending stays outside the event write transaction.
- Manual delivery requires confirmed recipient review. Resending/retrying completed attempts needs an explicit flag and reason; Pending/Running jobs are skipped. Unknown transport results require checking the provider before intentional duplication. A repeated request key returns its original result; inconsistent reuse is rejected.
- React **Email delivery** panel, recipient review, email-template dialog, status/attempt/next-attempt history and failure notices. Latest 200 deliveries/50 notices are shown; protected QR hashes, credentials and encrypted outbox payloads are not returned. A terminal failure/bounce/complaint records one notice and can queue a separate alert to active Super Admins with verified email when enabled. General configurable notification channels remain a later operations feature.

## Validation

Implementation pointers: backend/src/tickets/delivery.service.ts and delivery.controller.ts; tickets.service.ts/controller/module; ticket-engine/mail-context.ts; email/email.service.ts; students registration service/module; event configuration DTO; Prisma schema/ninth migration. React: admin-web/src/delivery.tsx, tickets.tsx, events.tsx and types.ts. Tests: backend/test/delivery.tests.mjs and existing API/Chrome harness. README, parity, migration notes and handoff are updated.

- Focused development run: **9 passed, zero failed, 26.7575261 seconds** (8 new cases plus the role fixture).
- Final `npm --prefix backend run test:browser:admin`: **69 passed, zero failed, 74.3438125 seconds** (68 API/PostgreSQL cases + Chrome desktop/mobile).
- Frontend contracts: **4 passed, zero failed, 442.046 ms**. Backend/admin production builds and Prisma generation passed. Unchanged scanner frontend/Python/provisioning suites were not repeated; scanner API/history/concurrency regressions are included above.
- New cases cover opt-in/disabled operation, atomic quota rejection, concurrent group retries, private recipient routing, PDF attachment serialization, template validation/escaping, permission denial, history privacy, reasoned idempotent resend, stale recipient suppression, durable retry keys/backoff, bounce deduplication/alerts, injected-outbox rollback, idempotent automatic Excel commits and cancellation-before-transport.
- Chrome covers student/group filtering, subject editing, recipient review, reasoned resend queueing and Pending history alongside existing authentication/registration/ticket/template/ZIP/mobile flows. Simulated completed failures are synthetic test fixtures only.
- All provider sends are mocked; real recipient delivery, verified sender/domain and inbox placement are not certified. Server email stays disabled and no real worker was started.

## Hosted test safety

Migration/restart results and the private encrypted backup pointer are recorded in SESSION_HANDOFF.md. No production deployment/cutover, DNS changes, source SQLite replacement, Streamlit removal, key replacement or real attendee email is authorized by this checkpoint.

Before the ninth additive migration, saved/decrypted/verified an encrypted **39-table** safety snapshot (private pointer: tmp/delivery-checkpoint-backup-path.txt). The migration was applied to the existing authorized Aiven test service; all pre-existing data tables stayed unchanged and new delivery tables were empty. Local API/proxy/scanner health after restart is recorded in the handoff.

## Next checkpoint

Public personal invitation links and expiring mobile ticket links, then guest cancellation/replacement/transfer workflows with preserved identities and additive history. Actual invitation-link messages need that producer; this checkpoint implements delivery of issued invitation/guest tickets, not a simulated public invitation portal. Security email/reset, reports/exports/audit UI, monitoring/announcements/emergencies/maintenance and optional signed wallet providers remain unfinished.

Before any future production delivery, configure the real Resend sender/domain/key/webhook privately and obtain live-send authorization. Pending local development is independent of those provider settings. Preserve the simple UI and the tested scanner/ticket/registration boundaries.
