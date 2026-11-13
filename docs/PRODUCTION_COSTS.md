# Production budget worksheet - 13 November 2026

Planning estimates in USD before tax, local-currency conversion and domain purchase. No account balance, credit grant, trial deadline or bill has been assumed verified. Do not attach billing or buy a subscription based on this worksheet. Reprice the chosen region/tier in the official calculator before deployment.

Assumptions: one administrator deployment seat, one Workspace mailbox, under 10,000 active admin identities, 100,000 API requests/month, about one second of billed API work per request, 512 MiB/1 vCPU, minimum instances zero, modest ticket/download traffic, conservative 400 email attempts/day, and a small PostgreSQL dataset. Other projects sharing a billing account consume the same free allowances. Peak event throughput must be measured separately.

| Component | Monthly planning allowance | Basis |
| --- | --- | --- |
| Vercel | $20 for professional use, plus overage | Hobby is limited to personal/non-commercial use; do not assume event operations qualify |
| Cloud Run API + bounded email job | $0-10 at assumed low usage | Free allowance may cover compute; regional pricing, job executions, cold starts and egress affect the result |
| Cloud SQL dedicated single-zone | $90-140 | Planning range for a small dedicated production instance, storage/backups included provisionally; exact tier/region quote required |
| Workspace single mailbox | $8.40 flexible, or $7 with annual commitment | Separate subscription; do not purchase an annual commitment without approval |
| Artifact Registry/builds/secrets/logs/scheduler | $0-10 | Retention, build frequency, scheduler allowance and actual usage determine charges |
| Firebase email/password Auth | $0 at assumed usage under applicable allowance | Confirm whether the project uses base Auth or Identity Platform; their limits differ |
| Cloudflare DNS | $0 on eligible free plan | Registrar/domain and optional paid services excluded |

Conservative dedicated single-zone total: **about $120-190/month, $1,440-2,280/year**, excluding Google AI Pro membership and the domain. A zonal outage can interrupt this configuration. A regional HA database budget can raise the total to roughly **$210-330/month, $2,520-3,960/year**; obtain a real HA quote before using this range for purchasing. These are engineering planning ranges, not provider quotes or a promise of an SLA.

For development only, a trial/micro database can reduce the immediate bill. SQL Connect documents a starting Cloud SQL cost of $9.37/month, varying by configuration/region. Shared-core micro/small instances are not covered by the Cloud SQL SLA and should not be treated as certified event-scale production capacity. The trial is temporary. [Cloud SQL pricing](https://cloud.google.com/sql/pricing), [SQL Connect pricing/trial](https://firebase.google.com/docs/sql-connect/pricing).

Request-billed Cloud Run publishes free allowances of 180,000 vCPU-seconds, 360,000 GiB-seconds and two million requests/month using Tier 1 equivalents. Other services, network transfer, artifact storage, builds and jobs may still incur costs. Keeping zero warm instances avoids idle API compute but permits cold starts. Maximum instances is a capacity control, not a complete spending cap. Budgets alert; they do not automatically stop spending. [Cloud Run pricing](https://cloud.google.com/run/pricing).

Workspace's published US reference is $8.40/user/month flexible ($100.80/year at that rate), or $7/user/month on an annual commitment ($84/year); local offers/taxes vary. Google Cloud credits must not be assumed to pay Workspace, Vercel or registrar bills. [Workspace billing](https://knowledge.workspace.google.com/admin/billing/understand-google-workspace-bills-and-charges), [Vercel plans](https://vercel.com/pricing), [Cloudflare DNS FAQ](https://developers.cloudflare.com/dns/faq/), [Identity Platform pricing](https://cloud.google.com/identity-platform/pricing).

## Trial and developer credits

The current Spark SQL Connect trial lasts 90 days. Without an upgrade the instance is archived and unavailable; it can be deleted 90 days after archival. Upgrading to Blaze moves the instance to paid Cloud SQL under the published terms. Do not assume upgrading starts another free period. Paid-plan trial configuration changes can end the trial early. Read-only metadata confirms creation at **13 November 2026, 01:18:03 UTC**, `db-f1-micro`, 10 GB. No trial-expiry field was returned. If its 90 days start at creation, the inferred end is **11 February 2027, about 01:18 UTC** (03:18 Cairo); this is a calculated planning date, not a confirmed provider deadline. Confirm the console deadline and complete an export/restore rehearsal at least a week earlier.

Google's current Developer Program FAQ lists **$10/month** of eligible developer credits for Google AI Pro; membership activation, redemption to the intended billing account, service eligibility, other spending and grant expiry must be checked privately. Monthly grants expire one year after being granted under the published FAQ. Do not confuse this with discontinued standalone Premium credit benefits. Expected remaining credit is **unknown** until the account shows the grant and consumed balance. With a verified $10 eligible grant and at least $10 eligible Cloud usage, the illustrative $120-190 budget could reduce by up to $10 for that month; non-Google subscriptions remain payable. [Official benefits FAQ](https://developers.google.com/profile/help/benefits).

No billing account, subscription, regional tier, domain extension or credit has been selected/changed by this preparation. Final approval still requires both confirmations from the user, and all independently completable work must be finished first.
