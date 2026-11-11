# Dream Events — React Admin Migration & Deployment

Continue the existing project; do not rebuild it. Complete the React admin migration and prepare production deployment while preserving existing functionality and data.

## 1. Inspect first
Read applicable `AGENTS.md`, `SESSION_HANDOFF.md`, `docs/NODE_MIGRATION.md`, and `docs/NODE_PRODUCT_SPEC.md`. Flag missing files and continue with available evidence.

Inspect Git changes, frontend apps, Streamlit pages, backend APIs, scanner, database migrations, tests, and deployment configuration. Preserve unrelated work. Establish baseline build/test results and distinguish existing failures from regressions.

## 2. Rename
Use **Dream Events** as the project and site display name. Update relevant titles, navigation, metadata, documentation, and user-facing branding.

Use `dream-events` for new technical slugs where needed. Rename existing packages, service identifiers, database objects, or deployment resources only after checking dependencies and compatibility. Preserve historical migrations and audit records. Do not invent domains or recreate infrastructure merely to rename it.

## 3. Required architecture
- Admin: React + TypeScript + Vite, hosted on Vercel.
- Backend: Node.js + TypeScript + NestJS, hosted on Render; REST under `/api/v1`, WebSockets where required.
- Database: PostgreSQL on Aiven, accessed through Prisma.
- Email: Resend for transactional messages, invitations, tickets, and authentication.
- DNS/domain management: Cloudflare; enable proxying and security features only where compatible with the actual services and account.

Frontends access the backend, never the database directly. Preserve the independent scanner and completed backend functionality. Keep Streamlit operational until React reaches feature parity and removal is approved.

Use real API integration. Mocks are acceptable for isolated tests, never as substitutes for working production features.

## 4. Migration
Map every existing Streamlit feature to the product specification, API endpoints, permissions, and React replacement. Identify backend gaps before building dependent pages; implement missing functionality without duplicating existing work.

Migrate in order:
1. Login and existing 2FA flows.
2. Dashboard and event overview.
3. Events and settings.
4. Scanner staff and access management.
5. Students and guests.
6. Invitations and tickets.
7. QR generation and ticket delivery.
8. Reports, monitoring, and system settings.

Build reusable components, protected routes, role-aware controls, consistent API handling, validation, and loading/error/empty states. Enforce authorization and event isolation on the backend; frontend route protection alone is insufficient.

## 5. Deployment preparation
Prepare configurations and documentation for:

**Vercel**
- Correct project root, build command, output directory, and SPA fallback.
- Environment-specific API/WebSocket URLs.
- Preview/production configuration; no secrets in browser-exposed variables.
- Ensure fallback rules do not intercept assets or API proxy routes.

**Render**
- Production build/start commands, health checks, runtime validation, graceful shutdown, and compatible WebSocket handling.
- Explicit approved CORS origins; credential settings consistent with authentication.
- If jobs are required, use durable processing and document any additional worker/queue infrastructure.

**Aiven / Prisma**
- TLS with certificate validation, appropriate connection limits/pooling, and compatible Prisma configuration.
- Preserve existing data and migration history.
- Document reviewed production migration and recovery procedures; never run destructive changes automatically.

**Resend**
- Central backend email service; secrets stored server-side.
- Verified sender/domain, templates, provider message IDs, and delivery tracking through authenticated webhooks where needed.
- Bounded retries for transient failures, idempotency to avoid duplicate sends, and safe failure logging.
- Automated tests must not send real emails.

**Cloudflare**
- Document provider-required DNS records and SSL/TLS settings.
- Preserve API/WebSocket compatibility and email verification records.
- Do not assume proxying is required or supported for every record.

Proposed hostnames:
- `admin.<domain>` → Vercel admin
- `api.<domain>` → Render API
- `scan.<domain>` → existing scanner deployment

These are placeholders. Request the actual domain before configuring DNS.

## 6. Security
- Preserve secure authentication, 2FA, audit logs, and check-in history.
- Validate backend inputs, permissions, event boundaries, and environment variables.
- Configure trusted origins, rate limits, and security headers appropriately.
- Handle database outages and email failures safely.
- Never commit secrets or secret-bearing environment files; provide placeholder examples.
- Never expose database credentials or Resend keys to the frontend.

## 7. Execution and validation
Work incrementally: baseline inspection → feature/API mapping → admin foundation → Login/Dashboard/Events → remaining modules → deployment readiness.

For each completed module, verify real API integration and relevant authorization/error paths. Run appropriate builds and tests, including scanner regression checks. Keep a concise parity checklist and update handoff/deployment documentation.

Prepare all reviewable changes before requesting approvals. Do not delete Streamlit, deploy to production, run production migrations, modify production DNS, or send live emails without explicit authorization. Continue independent work when credentials or approvals block a step.

## 8. Final report
Report concisely:
- Features and branding completed.
- Files changed.
- Build/test results and unresolved failures.
- Deployment configuration prepared versus actually deployed.
- Required user actions, blockers, and next task.

Start with repository inspection, then implement. Avoid unrelated refactoring, repeated audits, and lengthy narration. Do not claim completion without supporting verification.