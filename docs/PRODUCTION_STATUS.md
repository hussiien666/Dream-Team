# Production preparation status - 13 November 2026

**Local implementation and the final development regressions below pass. Production readiness remains incomplete. No deployment approval is requested yet.** Both Google account confirmations remain mandatory, and additional environment/provider verification is explicitly outstanding.

Implementation checkpoint: `237d294`. No push or hosted release was performed.

## Delivered locally

- React/Vite administration includes independent attendee CRUD/search/cancellation, CSV/XLSX templates/imports with column matching and per-upload defaults, preview/atomic confirmation, preserved identifiers and exports. Linked student/guest flows, tickets/templates, private links/transfers, reports and staff/access remain operational.
- Native Firebase enrollment, verified email, login/logout, reset and fixed-UID linking preserve old IDs/hashes and existing MFA/permissions. Bound sessions check Firebase disable/reset/revocation. Interactive CLI includes native password verification and original MFA. Rollout flags remain off.
- Gmail API uses only `gmail.send`, private MIME/PDFs, server OAuth credentials, encrypted durable queue, distributed mailbox attempts, rate limits, retries and explicit Unknown outcomes. Invitations, registrations, transfers including cancellation/rejection, guest/ticket/event cancellation, announcements and verified-account security notices have producers. Firebase's own authentication mail stays separate.
- Announcements review recipient manifests and require confirmation. Global audit history uses immutable organization ownership and pagination/CSV; future historical ownership survives event removal. Old audit records are not rewritten or guessed into an organization.
- Cloud Run container/service/job and Cloud SQL proxy-socket/pooling/secrets preparation; migration/copy rollback and protection verification. No migrations execute at API startup. Optional transfer PDF-email failures recover to a savepoint and leave a recorded warning while preserving the private mobile-link transaction.

## Final development verification

All rows have zero failures. They are development tests, not the incomplete security-audit run.

| Check | Result | Evidence (ignored local logs) |
| --- | --- | --- |
| Backend + admin + independent scanner production builds | Passed | production-backend-build.log, production-admin-build.log, production-scanner-build.log |
| Real PostgreSQL/API/Chrome administration/scanner workflows | 95 passed, 3 emulator-only skips /98; 75.6150299 s | tmp/production-completion-regression.log |
| Separate Firebase emulator/API, bridge browser, native mobile browser and CLI REST helper | 4 passed, no skips; 28.4782101 s | tmp/production-firebase-final.log |
| Bootstrap, historical account removal, snapshot/restore/migration protections | 11 passed; 33.6910064 s | tmp/production-maintenance-final.log |
| Backend Gmail/SMTP/parser/upload/config/Turnstile unit checks | 15 passed; 11.4398301 s | tmp/production-unit-final.log |
| Retained backend Vitest | 1 passed; 2.53 s | tmp/production-vitest-final.log |
| Frontend API/cache/config unit checks | 6 passed; 0.3269983 s | tmp/production-admin-unit.log |
| Preserved regular Python 3.10 full regression | 55 passed; 98.53 s | tmp/production-python-regression.log |

The browser checks use real local APIs and disposable PostgreSQL; email transports are mocked and Firebase is emulated. Native mobile account screenshots and administrator mobile layouts were visually reviewed. No real attendee message, hosted verification/reset email, physical phone-camera trial or Linux container execution is claimed.

## Architecture and database state

Target: Vercel React admin/scanner -> NestJS Cloud Run -> Cloud SQL PostgreSQL; Firebase Authentication for identities, Workspace Gmail API for outbound application email, Cloudflare DNS. Nest/Prisma accesses PostgreSQL directly; no additional SQL Connect generated connector is required by the application.

The working application still uses Aiven at migration 11. The earlier authorized Cloud SQL development staging copy also has migration 11: 47 tables/279 rows, schema/protection fingerprints, canonical row hashes, microseconds, IDs, QR/encryption/history and backup round-trip verified. It is not failover or approved cutover. Migrations 12-15 exist only in disposable QA databases. Original Streamlit/SQLite and existing hosted frontends/API remain unchanged.

## Runtime values and secrets

Configure privately using [PRODUCTION_SETUP.md](PRODUCTION_SETUP.md) and the example files; never send secrets in chat or put them in VITE values.

| Purpose | Required preparation |
| --- | --- |
| API/database | NODE_ENV, PORT from platform, exact CORS_ORIGINS, PUBLIC_BASE_URL, reviewed TRUST_PROXY_HOPS, PG_POOL_MAX, CLOUD_SQL_CONNECTION_NAME; Secret Manager NODE_DATABASE_URL and preserved APP_ENCRYPTION_KEY |
| Firebase | FIREBASE_PROJECT_ID, approved native feature flag, least-privilege workload identity; public web API key/auth domain/project for Vite and FIREBASE_WEB_API_KEY for CLI |
| Gmail job | EMAIL_PROVIDER=gmail, EMAIL_FROM matching GMAIL_MAILBOX, optional EMAIL_REPLY_TO, GMAIL_MAX_PER_MINUTE and GMAIL_MAX_PER_DAY; Secret Manager GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN |
| Job bounds | EMAIL_JOB_MAX_MESSAGES/SECONDS if overriding safe defaults; one job task, no automatic platform retries; Scheduler/invoker setup for continuous delivery |
| Frontends | Public VITE_API_URL with /api/v1; native Firebase public web values only; scanner's independent API/base-path settings |
| Optional Turnstile | Public site key and allowed hostnames; secret stays server-side |

Keep EMAIL_ENABLED=false until live sending is authorized. Leave native/bridge flags false until hosted Auth policy/actions/domains are verified. Pin image digests and secret versions. Runtime database identity must not own schema; migration-owner access is separate.

## Domain and Workspace account setup

No domain purchase is assumed. DOMAIN, ADMIN_DOMAIN, SCANNER_DOMAIN and API_DOMAIN remain placeholders. Prepare Vercel domain verification/CNAMEs and the exact supported Cloud Run mapping records; use run.app until verified. Workspace requires ownership TXT, a real custom-domain mailbox, Gmail API enabled and consent for only the send scope with offline access. Prepare one merged SPF record, Workspace-generated DKIM and reviewed DMARC; normal Workspace MX does not introduce application inbox processing. Exact account-generated records and consent are still unavailable. See the setup guide for the record matrix and primary documentation.

Firebase verification/reset messages use supported Firebase Auth email actions/templates, not Gmail API. Enable the password provider, configure approved frontend domains and minimum 12-character policy, and verify actual hosted action behavior during authorized deployment. No such hosted settings were changed here.

## Cost and trial assumptions

[Sourced planning worksheet](PRODUCTION_COSTS.md): approximately **$120-190/month ($1,440-2,280/year)** for a small dedicated single-zone setup, excluding the domain, tax and AI Pro membership. A provisional HA budget is **$210-330/month ($2,520-3,960/year)**. Region/tier and peak load need a real quote; no subscription or paid upgrade was made. Micro/trial SQL is development capacity, not certified event-scale production.

Read-only trial metadata showed creation 13 November 2026 at 01:18:03UTC, db-f1-micro and 10 GB; no expiry field. **11 February 2027 ~01:18UTC** is inferred from 90 days after creation, not a provider-confirmed deadline. Spark trial archival/unavailability and later deletion are documented in the worksheet; confirm the console deadline and export well before it. Paid conversion can start billing; do not change it now.

The official Developer Program FAQ currently describes up to $10/month for eligible AI Pro developer benefits. Membership, redemption, service eligibility, consumed balance and expected remaining credit are **unknown**. No balance is assumed; Workspace/Vercel/domain bills are separate. The two account confirmations must include actual availability, not merely an intended subscription.

## Outstanding validation and retained components

1. Full security audit is **incomplete**. Four source reconnaissance passes and a 97-unit plan were prepared. Both mandatory validators reject this Windows platform (`OS no-follow and nonblocking input protection is unavailable`), and the required isolated execution environment is absent. No hunting/critic/independent verification pass ran; zero findings is not a clean assessment. External report: `C:/Users/original/security-audit-skill/Events_Ticketing/run-1/REPORT.md`. Resume safely in a compatible isolated environment, refresh source hashes and complete the workflow before approval.
2. Docker/Podman/usable Linux runtime is unavailable. Build, start and scan the non-root image, verify the managed SQL socket and service/job startup, then measure representative import/PDF/check-in load with isolated data. Local builds and tiny database concurrency tests do not certify production capacity.
3. Domain, Workspace OAuth/mailbox/custom sender and hosted Firebase policies/actions require real account setup. Live sending/integration checks remain unverified and unauthorized now. The full hosted interactive native CLI workflow also needs an operator check.
4. Review old-provider jobs/history and verify real Gmail replacement before removing Resend/SMTP. Never retag Sent/Unknown/in-flight jobs or blindly resend them. Keep Streamlit/SQLite until every still-required workflow and safe historical-data exposure has a verified replacement. The independent scanner deliberately retains its specified camera-only flow; no image-upload/manual-admission shortcut was added to it. Unsupported historical organization ownership stays unexposed.
5. Actual deployment IAM/ingress, secrets, TLS/proxy/origins/headers, backup/PITR/recovery, physical phone behavior and provider quotas must be verified during authorized deployment. No new paid service is assumed to solve these gaps.

The requested app floorplan remains queued after implementation/review, as instructed. Current account/environment facts prevent an honest claim that only two confirmations remain. No routine permission question or secret request is pending.

## Deployment hold

Do not deploy Vercel, Cloud Run or production database resources, switch application connections, change DNS/billing or send real mail now. Earlier deployment authorization is superseded. Only after the outstanding work is closed should the owner explicitly confirm both **active AI Pro/developer credits** and **updated billing address/account readiness**, followed by the authorized final deployment and live verification. This status report is not that final approval request.
