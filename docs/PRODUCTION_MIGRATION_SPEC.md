# AAST Event Manager — Complete Production Migration and Deployment Preparation

## Main objective

Complete the remaining work required to migrate AAST Event Manager to the new production architecture, remove the old infrastructure and integrations where appropriate, and prepare the application for production deployment.

**Do not deploy the application until I explicitly confirm that:**
1. My Google AI Pro membership is active and its Google Cloud developer credits are available.
2. I have updated and confirmed the Google Cloud billing address and billing account details.

These two confirmations must be the final external prerequisites before deployment. Do not stop development while waiting for them. Complete all other work first.

---

## 1. Target production architecture

Use the following architecture:

| Component | Target service |
|---|---|
| Frontend | React + Vercel |
| Backend | NestJS + Google Cloud Run |
| Database | PostgreSQL using Google Cloud SQL / Firebase SQL Connect |
| Authentication | Firebase Authentication |
| Application email sending | Google Workspace + Gmail API |
| DNS and domain management | Cloudflare |
| AI development credits | Google AI Pro developer benefits, subject to my confirmation |

The application must use a clean separation between frontend, backend, database, authentication, and email services.

Do not introduce unnecessary services or paid subscriptions.

## 2. Frontend migration

Complete the migration from the existing frontend to React.

Requirements:
- Preserve all existing functionality and business rules.
- Preserve the existing UI/UX wherever possible unless changes are necessary for compatibility or usability.
- Connect the React frontend to the NestJS backend through properly configured API endpoints.
- Implement production-ready environment-variable handling.
- Configure the project for Vercel deployment.
- Verify routing, authentication, API communication, error handling, and responsive behavior.
- Remove obsolete frontend code only after confirming that its functionality has been migrated.

## 3. Backend and database

Prepare the NestJS backend for Google Cloud Run.

Requirements:
- Complete the PostgreSQL migration.
- Use Google Cloud SQL / Firebase SQL Connect as the target database architecture.
- Preserve all existing data models, relationships, constraints, indexes, and business rules.
- Verify migrations and schema consistency.
- Ensure database credentials are stored securely.
- Configure production environment variables.
- Implement appropriate database connection pooling and connection management for Cloud Run.
- Verify that the application can start and operate correctly in a production-like environment.

Do not delete the existing database or its data before the new database has been verified and a backup has been secured.

## 4. Authentication

Use Firebase Authentication.

Complete and verify:
- Registration.
- Login and logout.
- Email verification.
- Password reset.
- Session/token handling.
- Backend token verification.
- Role-based authorization.
- Existing admin and user permissions.

Preserve existing authentication behavior and security requirements.

Important: Firebase Authentication's own verification and password-reset emails must be handled separately from application-generated emails. Do not assume Gmail API automatically handles Firebase's authentication emails. Investigate and configure the appropriate supported solution, documenting any remaining limitations.

## 5. Email migration — remove Resend

The intended email architecture is:

**Google Workspace mailbox + Gmail API, sending only.**

I do not need the application to receive, read, or process incoming emails.

Use the least-privilege Gmail API sending permission:
`https://www.googleapis.com/auth/gmail.send`

Migrate all existing application email functionality, including:
- Invitation emails.
- Ticket emails and ticket links.
- Guest invitation and transfer notifications.
- Cancellation notifications.
- Event announcements.
- Security notifications.
- Any other existing application-generated emails.

Requirements:
- Preserve existing email templates and improve them only where necessary.
- Use a centralized email service in NestJS.
- Implement queueing, rate limiting, retries, and error handling.
- Avoid sending duplicate emails.
- Record email sending status for auditing and troubleshooting.
- Respect Google Workspace sending limits.
- Ensure the sender uses the verified custom domain.
- Document SPF, DKIM, and DMARC DNS configuration requirements for Cloudflare.
- Never expose OAuth credentials, refresh tokens, or API secrets to the frontend.

Remove Resend only after every email flow has been migrated and successfully tested.

Do not configure unnecessary incoming-email processing.

## 6. Cloudflare and domain preparation

Prepare the project for Cloudflare DNS management.

Requirements:
- Document the domain configuration required for Vercel and Google Cloud Run.
- Prepare the DNS records required for frontend and backend routing.
- Document Google Workspace domain verification.
- Prepare SPF, DKIM, and DMARC records.
- Do not assume that I have purchased a domain yet.
- Do not purchase a domain or commit to a paid domain extension without my approval.

Use placeholders for the domain until I confirm the domain name.

## 7. Vercel and Google Cloud Run preparation

Prepare both services for deployment.

Vercel:
- Configure the React production build.
- Configure environment variables.
- Verify the production build.
- Prepare frontend deployment settings.

Google Cloud Run:
- Configure the NestJS production build.
- Prepare the Dockerfile and deployment configuration if required.
- Configure runtime environment variables and secrets.
- Configure database connectivity.
- Configure health checks, logging, and error handling.
- Ensure the service can run securely and reliably.

Do not deploy either service yet.

## 8. Cost-conscious configuration

Use free tiers and eligible credits where appropriate, but do not compromise production reliability or security.

The intended cost strategy is:
- Use Google AI Pro developer credits only if my membership and credit eligibility are confirmed.
- Consider the available Cloud SQL trial and its expiration conditions.
- Use Cloud Run's free allowance where actual usage qualifies.
- Use Firebase Authentication's applicable no-cost allowance.
- Use Google Workspace for outbound application emails.
- Use Cloudflare's free DNS capabilities where sufficient.

Important:
- Do not treat temporary trials as permanent free services.
- Do not assume Google AI Pro credits cover every Google Cloud service or the Workspace subscription.
- Do not make paid upgrades or purchases without my approval.
- Document which resources will start generating charges and when.
- Provide a realistic monthly and annual cost estimate before deployment.

## 9. Testing and production audit

Before requesting my final confirmation, complete a full audit.

Test:
- Frontend production build.
- Backend production build.
- Database migrations.
- Database connectivity.
- Registration and login.
- Email verification and password reset.
- Invitation workflows.
- Ticket generation and ticket links.
- Guest transfers and approval workflows.
- Cancellation notifications.
- Announcements.
- Admin permissions.
- Reports and exports.
- Audit history.
- Security and error handling.
- Email sending limits and failure handling.
- Mobile and responsive behavior.

Fix all issues discovered.

Do not claim a feature is tested unless you have actually tested it. Clearly distinguish automated tests, manual tests, and unverified external integrations.

## 10. Remove obsolete components

After verifying replacement functionality:
- Remove Resend integration.
- Remove obsolete Streamlit components after confirming complete React parity.
- Remove obsolete frontend/backend code.
- Remove unused dependencies and environment variables.
- Update documentation and deployment instructions.

Do not remove anything that is still required by the working application.

## 11. Final deployment gate — WAIT FOR MY CONFIRMATION

This must be the last step.

Finish all development, migration, testing, cleanup, and deployment preparation before reaching this stage.

Then provide me with a final report containing:

1. Completed tasks.
2. Remaining issues, if any.
3. Test results.
4. Final architecture.
5. Required environment variables and secrets that I must configure.
6. Domain and Cloudflare DNS requirements.
7. Google Workspace setup requirements.
8. Expected monthly and annual production costs.
9. Trial expiration dates and what happens after expiration.
10. Google AI Pro credit assumptions and the expected remaining credit.
11. Any action that still requires my account access or approval.

At this stage, stop and wait for my explicit confirmation of:

- Google AI Pro membership and developer-credit availability.
- Updated Google Cloud billing address and billing account readiness.

**Do not deploy Vercel, Cloud Run, or production database resources before I provide that confirmation.**

Once I confirm both items, proceed with the final deployment, production DNS configuration, live integration testing, and deployment verification.

Do not ask me to confirm routine development decisions. Make technically sound decisions, follow the existing project specifications, and document important changes.

## Execution instructions

- First inspect the repository and read the existing handoff and project documentation.
- Continue from the current implementation; do not rebuild the project unnecessarily.
- Follow the existing product specifications and preserve working functionality.
- Work through the tasks systematically.
- Avoid unnecessary token consumption and repeated repository-wide inspections.
- Do not fabricate test results or mark incomplete work as complete.
- Keep documentation updated as implementation progresses.
- Commit changes in logical, reviewable units if Git is configured, but do not push secrets or credentials.

**Your goal is to finish everything possible independently and leave only the two Google account confirmations and the final deployment as pending steps.**