Upgrade the existing Dream Events project using its README, AGENTS.md, session handoff, and migration documents as context. Inspect the actual code before making changes. Implement and test the work; do not stop at a plan.

1. Firebase backend and Vercel frontend
- Migrate the backend to Firebase and connect it to the React/TypeScript/Vite frontend deployed on Vercel.
- Use Firebase Authentication, Firestore, Storage, and server functions where appropriate.
- Configure development, preview, and production environments, authorized domains, CORS, and Vercel SPA route rewrites.
- Keep server secrets out of frontend code and VITE variables.
- Preserve roles, organization/event isolation, audit history, existing QR identities, ticket states, and scanner compatibility.
- Prepare migration, verification, backup, and rollback tooling. Keep existing applications operational until parity is verified.
- Verify existing password and MFA compatibility; document and implement a secure transition where direct migration is impossible.
- Prepare deployment configuration, but do not migrate production data, change live DNS, send real email, or retire the old backend without explicit authorization.

2. Performance and caching
- Investigate why users repeatedly wait for the server and address the actual causes.
- Add client caching, deduplicated requests, appropriate freshness settings, pagination, prefetching, and route code splitting.
- Display cached data during background refresh with clear loading/error states.
- Scope caches to the signed-in user and event; clear private data on logout or permission changes.
- Never use cached availability to authorize issuance or admission. Enforce quotas, issuance, and check-in atomically on the server.
- Configure CDN caching for versioned static assets; never publicly cache private attendee, authentication, or ticket responses.
- Measure improvements and document any remaining cold-start limitations and costs.

3. UI, routing, and responsiveness
- Upgrade the existing UI while preserving the white/light-grey, navy, and small gold accent branding.
- Add consistent navigation, protected routes, event routes, deep links, refresh support, and useful 404/error pages.
- Apply responsive Flexbox layouts and CSS safe areas using env(safe-area-inset-*), with suitable viewport settings and dynamic viewport heights.
- Ensure forms, dialogs, tables, navigation, and scanner controls work on phones, tablets, and desktops.
- Include accessible labels, keyboard navigation, focus states, validation, and loading/empty/success states.

4. Student and guest registration forms
- Make a shareable event registration form the primary alternative to Excel imports; retain imports for compatibility.
- Let each eligible student enter their details, choose a permitted ticket quantity, and enter details for each guest.
- Inspect existing invitation-link functionality and reuse or extend it where appropriate.
- Verify student eligibility through a secure invitation or verified identity; knowing a student ID alone must not grant access.
- Enforce event capacity, category allocation, per-student quotas, deadlines, and registration status on the server.
- Define clearly whether the student's own ticket counts toward the selected quantity.
- Prevent concurrent submissions and retries from causing duplicates or exceeding capacity using transactions and idempotency.
- Allow students to view or amend only their own registrations under event rules.
- Provide administrators with registration management and configurable form fields.

5. SMTP and no-reply email
- Add secure SMTP delivery configured through server-side secrets.
- Send using a verified address such as “Dream Events <no-reply@yourdomain.com>” so the personal SMTP login is not exposed.
- Explain that the sender address remains visible; no-reply does not technically prevent replies.
- Document SPF, DKIM, DMARC, and optional Reply-To configuration.
- Preserve or implement durable delivery jobs, retries, deduplication, delivery history, and failure handling.
- Keep ticket issuance independent from email delivery.
- Do not send real attendee email during development or testing.

6. Firebase and Cloudflare security
- Use applicable Cloudflare skills/tools if available; report unavailable integrations honestly and continue preparing code/configuration.
- Add Cloudflare Turnstile to public registration forms and verify tokens server-side.
- Prepare HTTPS, WAF, bot protection, and endpoint-specific rate limits for traffic routed through Cloudflare.
- Account for Vercel/Firebase compatibility and document which endpoints Cloudflare actually protects.
- Prevent direct-origin bypass from defeating protections; enforce authentication, authorization, input validation, and application rate limits at the backend.
- Use restrictive Firestore/Storage rules, Firebase App Check where appropriate, and role/event checks in privileged server functions.
- Preserve administrator MFA and secure session behavior.
- Keep personal data, QR credentials, SMTP credentials, and invitation tokens out of logs and public caches.

7. Validation and handoff
- Test authorization boundaries, registration ownership, quota concurrency, duplicate submissions, ticket compatibility, check-in replay prevention, email retries, and cache isolation.
- Use Firebase emulators and test email delivery where possible.
- Run browser checks for responsive layouts, safe areas, deep links, and form workflows.
- Update README, migration/parity documents, environment examples, and deployment instructions.
- Finish with a concise report of changes, checks run, remaining gaps, and exact Firebase/Vercel/Cloudflare setup steps.

Ask only for information that cannot be established from the repository or available tools. Never request secret values in chat. Do not claim a feature is complete unless it is implemented and verified.