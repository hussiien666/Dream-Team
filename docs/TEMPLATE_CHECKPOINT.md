# Ticket templates and rendering checkpoint - 11 November 2026

This follows the atomic ticket checkpoint. Work resumed directly from that checkpoint; completed foundations were not rebuilt or re-audited. The user still requests a stop at each checkpoint.

## Implemented

- Organization-scoped reusable templates with authenticated event-scoped CRUD, duplication, rename, apply and preview endpoints. Requires `tickets.manage` and organization/event access. Archived events reject mutations.
- Additive migration `202611110008_ticket_templates`. Templates are organization resources; applying copies the configuration into `event_settings/ticket-design.v1`. Editing/deleting a library template cannot silently alter an applied event design. Existing event duplication already copies the setting, preserving the applied configuration.
- React **Ticket templates** section with Classic, Compact and Banner layouts; colors, heading/footer text, optional displayed fields and PNG/JPEG logo/background images. Forms retain values after rejection. Mobile preview is sandboxed; PDF preview downloads privately. Preview credentials are deliberately invalid for admission.
- PDF/mobile HTML use the same field/configuration model. Existing QR identities are reused. PDF uses bundled Noto Sans Arabic (SIL OFL), fontkit shaping and bidi run ordering for Arabic/Latin/mixed text. Long text wraps and continues onto another page when needed; QR quiet zones remain white and unsplit. Missing script coverage produces an explicit error and atomic issuance rollback, never silent missing-glyph output. This is not a claim of universal Unicode coverage.
- Image limits: 256 KB and 2048 pixels per image, PNG/JPEG only. JSON requests are bounded at 1 MB for two base64 images. Invalid/oversized images and unknown configuration fields are rejected; template text is escaped in HTML. Existing PNG/JPEG event logos remain supported.
- ZIP download for up to 50 selected recoverable tickets, PDF+HTML for each; 30 MB maximum before compression. Generated filenames only, valid ZIP32 headers/CRCs, private no-store response and no disk persistence. Partial archives are not returned when a ticket is foreign, missing or hash-only.
- New dependencies: `@pdf-lib/fontkit`, `bidi-js`; explicit JSZip dev dependency validates generated archives independently. Font source/license/checksum are retained in `backend/assets/fonts/`. Font bytes are loaded locally in both source and compiled deployments; no CDN or runtime font download.

## Validation notes

Final changed-backend run: **61 tests passed, zero failures in 78.2879685 seconds** (60 API/PostgreSQL + 1 Chrome). Frontend contracts: **4 passed in 814.6101 ms**. Backend/admin builds and Prisma generation passed. Dependencies reported zero vulnerabilities. New API tests cover organization/role denial, strict designs/images, CRUD/duplicate/apply snapshots, unchanged QR identities, event duplication, deletion preserving applied designs, preview privacy/XSS/unusable QRs, Arabic registration, ZIP decoding/CRCs and archived-event behavior. Chrome covers editor preview/save/apply plus ZIP download and existing administration flows. Scanner API regressions passed; unchanged scanner frontend/Python/provisioning suites were not repeated.

Disposable PostgreSQL databases now explicitly use UTF-8 from template0 with C locale; Windows' WIN1252 default could not store Arabic. This changes test setup only. The hosted database/source SQLite encoding is not rewritten. A shared synthetic hash collision and an exact accessibility label were corrected during validation.

A synthetic Arabic/mixed-language PDF was rendered and visually inspected; its QR was decoded successfully from the rendered page. PyMuPDF was installed for local QA under regular Python 3.10, without a venv; it is not a permanent backend dependency or worker. Unchanged Python/account-maintenance/scanner frontend suites are historical; relevant scanner API regressions are part of the changed-backend integration run.

## Next checkpoint

Applied the eighth additive migration only to the authorized Aiven test service after verifying an encrypted 38-table safety snapshot. Every pre-existing data table stayed unchanged; the new template table was empty. The private snapshot pointer is tmp/template-checkpoint-backup-path.txt. Local API restart/health results are recorded in SESSION_HANDOFF.md. No production deployment/cutover, DNS changes, SQLite replacement, real tickets or emails were created for QA.

Automatic and group generation plus ticket/invitation delivery through the existing Resend queue: event delivery settings, guest/student recipients, attachments, durable delivery history/manual retries and failure notifications. Public invitation/mobile links, transfers, reporting/exports, operations and security email/reset flows remain later stages. No real attendee email or production actions without separate approval.
