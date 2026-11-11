# Dream Events - React admin parity

The current instruction is [REACT_ADMIN_SPEC.md](REACT_ADMIN_SPEC.md). React/Vite in `admin-web/` is the final admin frontend; Streamlit remains operational until verified parity and approved removal. Nest/Prisma/PostgreSQL remain authoritative. Resend supersedes Gmail for the final backend; legacy Gmail is preserved in the Python app. No technical database/QR identifier was renamed.

This maps the existing Streamlit screens and product requirements without restarting the earlier requirements audit. API availability is based on source inspection and real PostgreSQL tests. A working page must use real API data; missing backend modules must not be represented with mock production pages.

| Existing source / product feature | Node API / backend gap | Permission | React replacement / state |
| --- | --- | --- | --- |
| `auth.py`, `security.py`, `admin/main.py`: password sign-in | `auth/login`, `auth/me` | Active admin membership | Implemented; session hydration enforces server factor/password gates |
| Existing TOTP enrollment, verification, recovery | `auth/totp/begin`, `finish`, `factor/verify`, `recovery/regenerate` | Super Admin | Implemented with setup QR, recovery acknowledgement and password-change flow |
| Email 2FA / self-service reset | Provider queue now exists; auth flow endpoints still missing | Account security | Pending; no fake reset or email-factor buttons |
| Password change / logout | `auth/change-password`, `auth/logout` | Own admin session | Implemented; all admin sessions revoked after password change |
| `overview.py`: event dashboard | `events/:id/dashboard` | `events.view` + assigned event | Implemented event-scoped counts and details; no global statistics |
| `events.py`: create/edit | `events`, `events/:id` | `events.create/manage` | Implemented forms, date/zone handling, partial editing, loading/errors |
| Event list/search/status/sort/card/table | `events` returns accessible events | `events.view` | Implemented; filtering/sorting returned authorized events |
| Event duplication | `events/:id/duplicate` | `events.create` | Implemented confirmation; credentials/activity excluded |
| Complete/cancel/reopen/archive/restore/delete | Existing event lifecycle APIs | Manage; reopen/restore Super only | Implemented confirmations; archived/closed editing disabled, backend-enforced |
| Event settings/default category/colors | `events/:id/settings` | `events.manage` | Implemented supported preferences. Invitation limits are enforced by registration APIs; delivery consumers remain pending |
| `access.py`: categories | `events/:id/categories` | `access.manage` | Implemented create/edit/deactivate, allocations and color |
| `access.py`: entrances/category permissions | `events/:id/entrances` | `access.manage` | Implemented create/edit/grants; no categories means no admission |
| `settings.py`: users and event assignments | `users`, enable/disable/temp-password/assignment APIs | Super Admin | Implemented create+assign atomically, display-name/role editing, enable/disable, temporary password and event assignments; role changes revoke old sessions |
| `admin/main.py`: scanner access codes | `events/:id/access-codes` + activate/deactivate/regenerate/grant APIs | Super Admin | Implemented code lifecycle, one-time credential display, grants and active session counts |
| Scanner remote logout | `scanner/users/:id/remote-logout` | Super Admin | Implemented confirmation |
| `attendees.py`: manual attendee management/search/export | Existing attendee scaffold lacks full DTO/transaction parity and exports | `attendees.manage` | Pending backend hardening before React page |
| `attendees.py`: Excel/CSV template/preview/atomic import | Existing Python implementation; Node import endpoints missing | `attendees.manage` | Pending; preserve template/import compatibility |
| Students/guests/custom fields/invitation limits/two-sheet import | Additive migration and strict event-scoped transactional APIs implemented | `attendees.manage`; limits/overrides also `events.manage` | Implemented searchable tables, linked counts, CRUD/cancellation dialogs, seven field types, limits, template and confirmed atomic/idempotent Excel import; legacy attendees remain independent |
| Ticket issue/batch/replace/revoke | Event-locked atomic issuance, immutable idempotency receipts, encrypted credentials, opt-in automatic guest issuance and idempotent group issuance | `tickets.manage` | Implemented Tickets page with student/group filtering, selection/review and lifecycle actions. Automatic manual/Excel guest issuance respects published/open event settings; transfers remain pending |
| PDF/HTML/ZIP and same-QR recovery | PDF/mobile HTML recover from encrypted credentials; original-QR adoption supports historical hash-only tickets | `tickets.manage` | Individual downloads, same-QR refresh/recovery, bounded ZIP and Arabic/Latin Unicode rendering implemented. Hosted mobile links remain pending |
| Ticket email / delivery history / retries | Transactional ticket producer, private recipient routing/PDF attachments, current-ticket preflight, immutable dispatch/operation evidence, durable retries/webhooks/notices | `tickets.manage`; event recipient/automatic settings also `events.manage` | Implemented recipient review, reasoned resend, template editing, delivery history and issue panel. Provider mocked in tests; live sending still disabled/unverified |
| Ticket templates | Organization-scoped CRUD/duplicate/apply/preview APIs; event design snapshots retain stable applied settings | `tickets.manage` | Implemented editor with three layouts, colors/text/fields/PNG-JPEG images, PDF and sandboxed mobile previews; no QR mutation |
| Personal invitation links | Hashed student-scoped capabilities, rotation/revocation, event-locked registration/cancellation and immutable retry receipts | Admin `attendees.manage`; public access restricted to one student | Implemented real admin link dialog and mobile invitation page; link email/notifications remain pending |
| Guest mobile ticket links and transfers | Guest capability, approval/deadline and transfer-history APIs still missing | Product role rules | Next checkpoint; no mock equivalents |
| `checkin.py`: check-in | Independent React scanner and Node scanner API already working | Scanner account + code | Preserved, branded Dream Events, separate deployment/API URL supported; legacy scanner retained |
| `reports.py`: summaries/category/entrance/timeline/no-shows/exports | Node report/export APIs missing | `reports.view`, `exports.create` | Pending backend before React reports |
| `settings.py`: audit history/export | DB audit retained; admin listing/export API missing | Super Admin | Pending |
| `settings.py`: Gmail configuration | Legacy-only; final provider is Resend via server environment | Super Admin | Intentionally not migrated as Gmail settings |
| Wallet status / passes | Disabled legacy provider boundary; signed integration absent | Ticket management | Pending optional integration; no fake passes |
| Monitoring, announcements, emergencies, scheduled reports | Missing Node APIs/WebSockets/jobs | Product role rules | Pending; scanner statistics still poll every 5 seconds |
| System settings/maintenance/health | Public bounded DB health exists; operational control APIs missing | Super Admin | Runtime validation prepared; control screens pending |

Deployment configuration is preparation only. Follow [DEPLOYMENT.md](DEPLOYMENT.md). Physical scanner, deployed TLS/Aiven, verified Resend sender, production load and provider-account checks are not certified by local tests. Keep Streamlit, its original SQLite file and protected backup/key copies.
