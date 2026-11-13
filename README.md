# Dream Events

An event administration application with React/TypeScript/Vite administration, a working NestJS/Prisma/PostgreSQL backend and an independent mobile scanner. The latest production target is **Vercel, NestJS on Cloud Run, Cloud SQL PostgreSQL, Firebase Authentication and Workspace/Gmail API**. Existing applications remain operational until verified parity and approved cutover.

The interface keeps the established white/light-grey, navy and small gold accents. Regular Python 3.10 remains supported; **no virtual environment** is required.

## Active migration

The controlling request is [production migration and deployment preparation](docs/PRODUCTION_MIGRATION_SPEC.md). Start with the [session handoff](SESSION_HANDOFF.md) and [feature/API parity checklist](docs/REACT_ADMIN_PARITY.md). The earlier [Firebase upgrade](docs/FIREBASE_UPGRADE_SPEC.md) remains a behavior reference; its Firestore/Functions final architecture is superseded.

The optional Firebase sign-in bridge preserves existing password/MFA verification and checks the original live session on every API request. It defaults off. Opt-in native Firebase enrollment, verified-email login/reset and account linking now pass local API/mobile emulator checks; hosted rollout remains unverified and disabled. In development project `dream-team-bed27`, a verified Cloud SQL trial copy now contains 47 tables and 279 rows. Aiven remains the application database.

- `admin-web/`: React admin with real API sign-in, TOTP/recovery, password changes, event overview/CRUD/lifecycle/settings, categories/entrances, staff/access-code management, Students & Invitations, independent attendees with CSV/XLSX import/matching/export, Tickets, reusable Ticket Templates, Announcements, event Reports and organization-wide Super Admin audit history.
- `backend/`: Node authority with strict configuration/TLS/CORS validation, atomic ticket issuance and a durable email queue with Gmail API send-only transport, private notifications/PDFs, mailbox limits, retries and uncertainty handling. Retained Resend/SMTP jobs remain compatible until retirement is verified. Personal invitation links support private sharing and scoped guest registration/cancellation. Guest mobile ticket links and transfers are implemented, and the hosted Aiven test schema was confirmed at migration 11; their deployed behavior remains unverified. Invitation-link/registration/transfer/cancellation/announcement and verified-account security notifications queue locally. Firebase handles its own verification/reset mail; live Workspace/Firebase setup remains unverified.
- `scanner/`: preserved independent camera scanner, now branded Dream Events; legacy QR identities and session storage keys remain compatible.
- `admin/` and `app/dashboard/`: retained Streamlit applications. Backend gaps and unfinished React modules are explicitly tracked; full parity is **not complete**.

The production target is **Vercel admin/scanner + Cloud Run API + Cloud SQL**, with Firebase Authentication, Cloudflare DNS and Workspace/Gmail API outbound email. Resend and legacy applications remain until verified replacements permit removal. No hosted backend switch or automatic database failover has occurred.

**Current checkpoint: development continues; deployment held.** Do not deploy Vercel, Cloud Run or production database resources until the user explicitly confirms both Google AI Pro/developer-credit availability and updated Google Cloud billing address/account readiness. This supersedes earlier hosting authorization. No billing upgrade, DNS change or live email is authorized now. The Aiven schema and trial copy have migration 11; new local migrations 12-16 remain unapplied to those hosts. Application cutover, provider/legacy retirement, Linux/container/load checks and the requested security audit are unfinished. See [production status](docs/PRODUCTION_STATUS.md), [setup](docs/PRODUCTION_SETUP.md), [costs](docs/PRODUCTION_COSTS.md) and [SESSION_HANDOFF.md](SESSION_HANDOFF.md). Local invitation forms support optional server-verified Turnstile after [provider setup](docs/FIREBASE_MIGRATION.md#optional-turnstile-for-personal-invitations).

### Prepare the Firebase API

Historical Functions packaging instructions follow; Cloud Run now replaces Functions as the production API host. Do not deploy this bundle under the current deployment hold.

Firebase CLI 15.36.0 is installed globally in this workspace. The user linked Firebase Hosting site `dream-team-bed27`; the admin stays on Vercel. Build the existing API into an isolated deployment bundle:

```powershell
npm --prefix firebase ci
npm --prefix firebase run build:functions
```

This creates ignored `firebase/functions/` from compiled code, assets and Prisma schema, excluding the backend's local `.env`, key and certificate files. Runtime secrets belong in Firebase Secret Manager. Follow [Firebase setup and validation](docs/FIREBASE_MIGRATION.md) before deployment or changing Vercel's API address. Firestore migration is separate from moving the API host.

### Personal invitation links

The [performance/UI/registration checkpoint](docs/PERFORMANCE_REGISTRATION.md) documents cursor paging, private caching, mobile forms, measured transfer reduction and the remaining hosted cold-start checks.

Open **Students & Invitations**, select **Invitation link** beside an active student, enter a reason and confirm rotation. Copy the new private URL, or review the student recipient and opt into a queued private-link email when the provider is enabled. The student chooses **Open registration form**, updates their own details, selects the permitted number of new guests and fills each guest's details. For example, a limit of 3 with 2 existing guests allows 1 more. Quantity excludes the student's own ticket; 0 updates only their details. Students can view/amend/cancel only their own registrations under event rules. The server checks quotas, capacity, categories, custom fields, deadlines and retry receipts atomically. Tickets are distributed separately. Excel remains available. See the [current form checkpoint](docs/PERFORMANCE_REGISTRATION.md).

### Run React administration locally

Configure the existing backend privately, preserve the legacy encryption key and use a separate PostgreSQL target. See [backend setup](backend/README.md). Then:

```powershell
npm --prefix backend ci
npm --prefix backend run prisma:generate
npm --prefix backend run build
npm --prefix backend run start:prod
```

In another terminal:

```powershell
npm --prefix admin-web ci
npm --prefix admin-web run dev
```

For a fresh installation, [configure hosted PostgreSQL](docs/AIVEN_LOCAL_TESTING.md), migrate the empty test database, then run `npm --prefix backend run create-admin` in an interactive terminal. Password entry is hidden; first sign-in requires authenticator enrollment. Existing installations require an existing Super Admin login and second factor before adding another administrator.

Open **http://127.0.0.1:5174**. The Vite development proxy sends `/api` to port 3000. There are no default/sample production credentials; imported accounts retain their existing credentials. Optional browser-visible API configuration is documented in [admin-web/.env.example](admin-web/.env.example). Never place secrets in VITE variables.

For React registrations, open an event and choose **Students & Invitations**. Add students first, then linked guests, or download the event-specific Students/Guests Excel template. Use **Import Excel**, review errors/new records/updates, and confirm. IDs and phones must be Text. Limits apply on the server; only event managers can override them with a recorded reason. Category edits preserve existing QR identities and used-ticket history. See [registration implementation notes](docs/NODE_MIGRATION.md#students-and-guests-checkpoint---10-november-2026).

Open **Tickets** for a published/open event, filter by inviting student/group if needed, select registrations without a live ticket, review and confirm generation. Batches save completely or roll back completely. Download PDF/mobile HTML again after restarting the app: QR credentials are encrypted in PostgreSQL using the existing Node installation key. **Refresh printed details** keeps the QR; **Replace QR** explicitly invalidates the old one. Lifecycle actions require confirmation and a reason. Historical hash-only tickets require their original QR for same-QR recovery. Select up to 50 recoverable tickets for a PDF/HTML ZIP download (30 MB maximum) or recipient-reviewed email delivery.

Open **Ticket templates** to create, duplicate, rename, edit, preview or delete reusable designs. Choose Classic, Compact or Banner; configure colors, text, displayed fields, logo/background images (PNG/JPEG, up to 256 KB and 2048 pixels each), then apply the design to an event. Applying saves a copy: later template changes/deletion do not alter other events. PDF and mobile HTML use the same configuration; PDF embeds a locally bundled font with Arabic/Latin text shaping and wrapping. Unsupported scripts are rejected explicitly. Preview QR codes cannot admit guests.

In **Event settings**, opt into automatic tickets for new manual/Excel guests in published/open events and choose direct guest delivery/student copies. Automatic imports are limited to 500 new guests. Draft/existing registrations use manual/group generation. When configured, generation queues private PDF emails; the separate Node worker sends with retries after 1, 5 and 15 minutes. **Tickets → Email delivery** shows status/issues and edits event email wording. Intentional resends require recipient review and a reason and reuse the QR. Guests without email fall back to their inviting student; Pending/Sending jobs are skipped. Sent means provider acceptance, not an inbox/read receipt. Check Unknown results before resending.

Email remains disabled in the current local setup; no real attendee messages have been sent. Configure Resend or the optional TLS SMTP transport privately and explicitly authorize live sending before starting `npm --prefix backend run worker:email`. SMTP uses `EMAIL_PROVIDER=smtp`, verified `EMAIL_FROM`, server-only SMTP credentials and optional `EMAIL_REPLY_TO`; interrupted or ambiguous sends require review under Unknown. See [SMTP setup](docs/FIREBASE_MIGRATION.md#smtp-and-sender-setup) and the [delivery checkpoint](docs/DELIVERY_CHECKPOINT.md). Personal invitation/mobile links, transfers, announcements, cancellation and verified-account security notifications are implemented locally; hosted sending and provider retirement remain unverified. Use EMAIL_PROVIDER=gmail and the server-only OAuth setup in [production instructions](docs/PRODUCTION_SETUP.md#workspace-and-gmail-api); Firebase authentication mail is separate.

The remaining sections below document the working **legacy Python application**. Its Gmail settings, seven-section interface and test commands are retained until parity and approved removal. They do not describe completed React replacements. Historical plans remain in `docs/UPGRADE_PLAN.md` and `docs/CHECKPOINT.md`.

## Contents

- [Product upgrade progress](#product-upgrade-progress)
- [Installation and startup](#installation-and-startup)
- [Updating an existing installation](#updating-an-existing-installation)
- [Navigation and permissions](#navigation-and-permissions)
- [Administrator workflow](#administrator-workflow)
- [Excel and CSV imports](#excel-and-csv-imports)
- [Tickets, replacements, and privacy](#tickets-replacements-and-privacy)
- [Gmail ticket delivery](#gmail-ticket-delivery)
- [QR check-in](#qr-check-in)
- [Reports and exports](#reports-and-exports)
- [Settings and environment variables](#settings-and-environment-variables)
- [Database, backups, and deployment](#database-backups-and-deployment)
- [Security and audit history](#security-and-audit-history)
- [Tests and validation](#tests-and-validation)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Current limits and future integrations](#current-limits-and-future-integrations)

## Installation and startup

### Requirements

- Windows with Python 3.10 and the py launcher: this is the validated setup.
- A browser and a writable project/data directory.
- Internet access to install dependencies and connect to Gmail when enabled.
- A Gmail account that permits Google app passwords for email delivery.
- HTTPS and browser camera permission when scanning from a remote phone.

Node.js is optional for one browser-decoder test. It is not required to run the app. The scanner's JavaScript is bundled locally; no frontend build or runtime CDN is needed.

### First installation

Open PowerShell in the project directory. For the current workspace:

~~~powershell
Set-Location -LiteralPath "C:\Users\original\OneDrive\Desktop\Events_Ticketing"
py -3.10 --version
~~~

Use the new project path if you move the folder. Then run:

~~~powershell
py -3.10 -m pip install --user -r requirements-lock.txt

if (-not (Test-Path -LiteralPath ".env")) {
    Copy-Item -LiteralPath ".env.example" -Destination ".env"
}

py -3.10 -m alembic upgrade head
py -3.10 -m app.backend.main create-admin
py -3.10 -m streamlit run app/dashboard/main.py --server.address 127.0.0.1
~~~

Open **http://localhost:8501** and sign in.

Super Admin accounts must enroll an authenticator at their next sign-in: scan the setup QR with an authenticator app, enter its six-digit code, and save the once-displayed recovery codes privately. Later sign-ins accept an authenticator code or an unused recovery code. **Settings → Recovery codes** can replace all recovery codes. A code cannot be replayed, and five failed verification attempts lock further attempts for 15 minutes.

The app creates an encryption key in `data/secret.key` when authenticator enrollment first needs it, unless `APP_ENCRYPTION_KEY` or `APP_KEY_FILE` is configured. Keep the matching key in a protected backup alongside the database backup. Losing the key prevents opening enrolled authenticator secrets. No existing account password or ticket QR is changed by enrollment.

The administrator command asks for a username, display name, password, and confirmation. Passwords must contain 12–256 characters and are not echoed in the terminal. There are no default credentials or automatically inserted sample events.

[requirements-lock.txt](requirements-lock.txt) contains the validated Python 3.10/Windows dependency versions. [requirements.txt](requirements.txt) describes supported ranges. The current set uses Streamlit 1.60, NumPy 1.26, and Protobuf 3.20, and avoids requiring an OpenCV upgrade for scanning. Packages are installed for your Windows user and run through normal Python.

### Normal startup

~~~powershell
py -3.10 -m streamlit run app/dashboard/main.py --server.address 127.0.0.1
~~~

Keep the terminal open while using the app. Press **Ctrl+C** in that terminal to stop it. A restart or browser refresh can require signing in again.

To use another local port:

~~~powershell
py -3.10 -m streamlit run app/dashboard/main.py --server.address 127.0.0.1 --server.port 8502
~~~

## Updating an existing installation

Keep the existing .env and database. Do not overwrite saved configuration or Gmail credentials with .env.example.

1. Stop the app with Ctrl+C.
2. Back up the database and keep a protected copy of .env; see [backups](#backups-and-restore).
3. Run the following from the project root:

~~~powershell
py -3.10 -m pip install --user -r requirements-lock.txt
py -3.10 -m alembic upgrade head
py -3.10 -m alembic check
py -3.10 -m streamlit run app/dashboard/main.py --server.address 127.0.0.1
~~~

Use your existing account. Run create-admin only if you need another administrator; once users exist, that command requires an existing administrator login.

Startup checks the migration revision and requests an upgrade if needed. It does not silently change the schema. Migration `02_email_delivery` adds email history; `03_organization_access` adds organization ownership, administrative roles, and event assignments without changing existing QR hashes or historical records. Back up before upgrading.

## Navigation and permissions

| Section | Purpose |
| --- | --- |
| Dashboard | Select an authorized event and see its ticket/entry totals; create-event shortcut for Super Admin |
| Events | Create, edit, archive, restore, and safely delete events |
| Attendees & Tickets | Registration, spreadsheet imports, search/export, generation, downloads, and email |
| Entrances & Categories | Allocations, entrances, and category-to-entrance permissions |
| QR Check-in | Live camera, uploaded QR image, scanner text, and manual admission |
| Reports | Event totals, category/entrance attendance, timeline, and exports |
| Settings | Passwords, Gmail configuration, users, recent audit history, and wallet status |

Select the event in the sidebar when managing attendees, access, check-in, or reports. Confirm both the event and entrance before admitting guests.

| Role | Access |
| --- | --- |
| Super Admin | All seven sections within their organization; creates accounts, changes roles/assignments, restores archives, configures Gmail |
| Event Manager | Assigned events: event/access/attendee/ticket management and reports; own password settings |
| Ticket Manager | Assigned events: attendee registration, ticket generation/delivery, downloads/exports; own password settings |
| Check-in Supervisor | Assigned event reports and own password settings |
| Check-in Staff | Assigned events: legacy QR Check-in and own password settings; no attendee management, issuance, reports, Gmail settings, or user administration |

Permissions and organization/event boundaries are enforced in backend services as well as the UI. Only Super Admin can create events or manage accounts. Other roles cannot see unassigned events. Super Admin access is organization-scoped, not cross-organization access. Roles currently use a fixed permission matrix; individual permission overrides are not yet implemented.

In **Settings → Roles and event assignments**, select an account, review its role, confirm and save. Select an event and confirm its assignment or removal. Existing sessions use the updated permissions on their next operation. You cannot remove your own Super Admin role. The legacy `admin`/`staff` database field remains for compatibility; explicit organization membership determines privileges.

## Administrator workflow

### Step 1: Create an event

Open **Events → Add event**. Enter the name, date, start/end times, venue, and capacity. Add a description if needed, select a status, and click **Save**.

Optional details include subtitle, organization, event type, time zone, country/city, building/address, access instructions, logo/banner, a separate ticket limit, distribution dates, and a registration deadline.

- Statuses: Draft, Published, Ongoing, Completed, and Cancelled. They are chosen by the administrator; they do not advance automatically with time.
- Use Published or Ongoing before issuing tickets or admitting guests.
- End time must follow start time on the same date. Overnight events are not supported by the form.
- Leave Maximum tickets blank to use capacity. A separate limit cannot exceed capacity.
- Event times use the selected IANA time zone, default Africa/Cairo; timestamps are stored in UTC.
- End/distribution dates restrict ticket issuance. The registration deadline restricts new registrations.
- Archive finished events to retain history. Events with ticket history cannot be deleted.

### Step 2: Configure access

Open **Entrances & Categories** for the event.

1. Add categories, such as Student, Graduate, Guest, or Staff.
2. Set each category's unique name/code, allocation, and maximum tickets per attendee. Description, color, status, and a record-only price are also available.
3. Add entrances with a name, code, location, and optional instructions.
4. Select the categories allowed at each entrance and save.

An entrance with no allowed categories admits nobody. Each category needs an active, permitted entrance before tickets can be generated. Category allocations can overlap, but the overall event ticket limit is always enforced.

Categories with attendees and entrances with check-in history cannot be deleted; set them inactive instead.

### Step 3: Register attendees

Use **Attendees & Tickets → Manage attendees → Add attendee**, or upload a spreadsheet through **Import file**.

Enter a full name and an email address or Student / National ID, then choose an active category. Phone, organization, and notes are optional. **An email address is required to email a ticket.**

Search by name, email, ID, or ticket number; filter by category; edit registrations; and export the filtered table. Duplicate email/ID registrations are rejected within an event. A person can register for another event independently.

Cancelling registration revokes its active unused tickets. Attendees with ticket history cannot be deleted or moved to another category. Used-ticket history is retained.

### Step 4: Generate and distribute tickets

Open **Attendees & Tickets → Generate tickets**. Select attendees or all attendees without an active/used ticket, then click **Generate tickets**.

- Generate up to **500 tickets per batch**, subject to event, category, and per-attendee limits.
- Issuance is atomic: a validation/rendering failure rolls back the whole issuance batch.
- Download individual PDF/mobile HTML files or a ZIP containing both.
- With Gmail configured, enable **Email tickets to attendees after generation** for up to **50** attendees, or use the email buttons below the downloads.
- Issuance and email are separate operations. Email failure does not undo issuance; review the delivery status and retry appropriately.

Download/email artifacts during the signed-in session. They are held in session memory and are not permanently stored by the application.

### Step 5: Check in guests

Open **QR Check-in**, select the event and entrance, choose Camera, and tap **Start camera**. Show the complete QR to the camera. Scanning is automatic; no photo button is needed.

A successful scan records event, entrance, staff, and time, then marks the ticket Used. Repeated entry is rejected. Tap **Scan next ticket** to resume.

### Step 6: View reports

Open **Reports**, choose a table, and refresh for activity from other scanners. Export the complete Excel workbook or the selected CSV table. All values come from database records.

## Excel and CSV imports

### Use the event's Excel template

1. Create at least one active category.
2. Open **Attendees & Tickets → Import file → Download Excel template**.
3. Fill the **Attendees** sheet, one person per row. Keep its headings unchanged.
4. Choose categories from the dropdown, or leave cells blank to use the upload default.
5. Upload the completed .xlsx, review the automatic preview/errors, confirm the information, and click **Import attendees**.

The workbook also contains **Ticket categories** and **Instructions** sheets. Download a fresh event-specific template after changing categories.

| Template column | Requirement / use |
| --- | --- |
| Full name | Required; matches the manual attendee form |
| Email address | Required for emailing a ticket; otherwise provide an ID |
| Phone number | Optional; formatted as Text to preserve zeros and plus signs |
| Student / National ID | Required if email is absent; formatted as Text |
| Organization | Optional |
| Ticket category | Choose a category from this event, or leave blank for the upload default |
| Notes | Optional |

After success, the screen confirms the imported count and offers **Upload another file**. It does not immediately treat the completed upload as a new duplicate batch.

### Existing workbooks and CSV files

Common headings such as Name, Full Name, Email, E-mail, Mobile, StudentID, Category, and Category Code are recognized automatically. Older internal headings such as full_name, identity_number, and category_code also work.

Use **Change column matching** if a selected column is wrong. Category names/codes are accepted by the importer without case sensitivity. Use the unique code if a value is ambiguous. Blank cells use the category selected during upload.

Example UTF-8 CSV:

~~~csv
Full name,Email address,Phone number,Student / National ID,Organization,Ticket category,Notes
Example Student,student@example.com,01000000000,00123,AAST,Student,Example row only
~~~

Replace the example person and category with your actual data. This example is documentation only and is not automatically imported.

### Validation and limits

- Maximum **5,000 attendee rows**, **50 columns**, and **10 MB** uploaded size.
- XLSX contents must stay within **30 MB** expanded size; unreadable/oversized workbooks are rejected.
- Data begins at Excel row 2. Validation errors retain actual source row numbers, including gaps.
- Name plus email or ID is required. Email/phone values and active event categories are validated.
- Duplicate emails/IDs within the file or existing event registrations block the batch.
- Formulas are rejected. Paste their results as plain values before uploading.
- Validation runs again inside the save transaction. A batch with errors imports nothing.
- Imports register attendees only; they do not automatically generate or email tickets.

Keep IDs and phones as Text before entering them in Excel. The importer cannot recover leading zeros already removed from the file.

## Tickets, replacements, and privacy

Tickets include attendee name, event details, category, ticket number, allowed entrances/instructions, branding where supplied, and a QR. There are no seat or row numbers by default.

The QR contains AAST1. followed by an opaque random 256-bit credential. It contains no email, student ID, or other personal data. Only a SHA-256 token hash is stored in the ticket record.

| State | Meaning |
| --- | --- |
| Active | Issued and not yet used, revoked, or expired |
| Used | Admitted; another entry is rejected |
| Revoked | Administratively invalidated; entry is rejected |
| Expired | Past expiry/end-time checks; entry is rejected |

Reports can display an expired Active record as Expired before a scan updates its stored state. Capacity checks conservatively count stored Active and Used tickets.

### Replacement and revocation

Use **Select issued ticket → Replace or revoke a ticket**, choose the operation, and confirm.

- Regeneration replaces the credential on an active unused ticket while retaining its ticket number. The previous QR stops working.
- Used, revoked, or stored Expired tickets cannot be regenerated.
- Revoking an active unused ticket releases its issuance allocation. Cancelling registration revokes active unused tickets too.
- Old downloaded/emailed files cannot be remotely erased; invalidated QRs are rejected at entry.
- Editing event/attendee details does not rewrite PDFs. After changing printed details or rescheduling, regenerate eligible active unused tickets for updated artifacts/expiry.

### Files and session lifetime

PDFs can be printed or shown on a phone. Mobile tickets are self-contained HTML files that open in a browser and support browser printing. They are files, not hosted public ticket URLs. Printed status is a snapshot; admission uses the live database.

Ticket files contain a name and usable entry credential; distribute them privately. They exist in session memory and downloaded copies, not automatically in generated_tickets/. The database cannot recreate an original raw token. If session artifacts are lost, regenerate an eligible unused active ticket and distribute its new copy.

## Gmail ticket delivery

### Configure Gmail

1. Enable 2-Step Verification and create a dedicated Google app password. See [Google's instructions](https://support.google.com/accounts/answer/185833) and [App passwords](https://myaccount.google.com/apppasswords). Some managed/protected accounts restrict this option.
2. Open **Settings → Ticket email delivery · Gmail**.
3. Enter the sending Gmail address, sender name, and 16-character **Google app password**. Do not use your normal Gmail password.
4. Enable delivery and click **Save Gmail settings**.
5. Click **Test Gmail connection**; it checks secure sign-in without sending a message.

Credentials are stored in the server's git-ignored .env. The saved password is not displayed back. Leave the field blank to retain a saved password for the same address; changing the address requires that account's credentials. Uncheck Enable Gmail ticket delivery and save to disable sending.

The service uses smtp.gmail.com, port 587, and certificate-verified STARTTLS. The current UI supports Gmail, not arbitrary SMTP providers or Google OAuth sign-in.

### Send to the attendee

The recipient is the **Email address** entered by the administrator in Add/Edit attendee or the uploaded sheet.

- During generation: select **Email tickets to attendees after generation**, up to 50 attendees.
- After generation: choose an Individual ticket, review its displayed recipient, and click **Send selected ticket by email**.
- For a generated batch up to 50: confirm recipients and click **Send all generated tickets by email**.

Each email contains event details and the personalized **PDF attachment**. HTML remains available for download. Add an attendee address before emailing; attendees without email can still receive downloaded tickets.

Only current active unexpired tickets for registered attendees in Published/Ongoing, unarchived events can be emailed. Stale artifacts, revoked/used tickets, and expired tickets are rejected. For lost artifacts or files generated before the email update, regenerate an eligible unused ticket first.

### Delivery states and retries

The ticket table shows the current QR/recipient's email state. The download area shows results and recent delivery history.

| Status | Meaning / action |
| --- | --- |
| Not sent / No email address | No matching delivery, or an address must be added |
| Pending | Send started; wait for its result |
| Sent | Gmail accepted the message for delivery; this is not an inbox/read receipt |
| Already sent | Repeated action skipped a ticket already sent to that recipient with the same QR |
| Failed | Correct connection, authentication, address, or account restrictions, then retry |
| Unknown | Connection broke after sending began; check Gmail Sent before explicitly resending |

Repeated clicks normally skip duplicate copies. Use **Send another copy if already sent** for an intentional resend. An interrupted Pending attempt needs at least two minutes and an explicit resend. Connection/sign-in failures stop the remaining batch and report those rows as Not sent.

If Sent mail is not received, verify the saved attendee address and check spam and sender bounce messages. Inbox placement and Gmail account sending restrictions are outside the app's control.

SMTP runs outside database write transactions so sending does not hold up check-in. Delivery records store ticket hash, recipient, message ID, state, attempts, and timestamps—not attachments, raw QR tokens, or Gmail passwords. Email actions are audited.

## QR check-in

### Live camera

1. Select the event and active entrance; check the entrance name shown on screen.
2. Choose **Camera → Start camera** and allow browser permission.
3. Use the rear camera when available, or select another camera from the dropdown.
4. Hold the entire QR/white border steadily in view, approximately 15–30 cm away. Adjust distance/light if needed.
5. Wait for the result, then tap **Scan next ticket**.

Frames are decoded locally with bundled jsQR; only decoded text goes to the server. The scanner pauses after reading and shows the server result above its controls. Stop camera releases the stream; leaving/hiding the scanner also releases it.

| Result | Meaning |
| --- | --- |
| GREEN: Entry approved | Accepted and marked Used; history records event, entrance, staff, and time |
| RED: Entry rejected | Unknown/replaced QR, wrong event/entrance, closed event, inactive registration/category/entrance, duplicate, revoked, or expired ticket |

Wrong entrance does not consume an otherwise usable ticket. Transactions and a unique check-in constraint prevent two scanners accepting the same ticket simultaneously. Published/Ongoing events can admit guests before the scheduled start, but expiry/end-time checks still apply.

### Alternate inputs

- **QR image / scanner text:** upload a PNG/JPEG and click Check in from image, or paste hardware-scanner text and click Verify QR and check in. Images are processed in memory, corrected for EXIF orientation, and decoded with rotation/downscaling and an inverted-image fallback through ZXing.
- **Manual ticket number:** enter the number, verify identity, tick confirmation, and click Find ticket and check in. This attempts admission; it is not a read-only lookup. The same checks apply, and the action is audited separately.

### Phones and HTTPS

Phone camera use requires a reachable **HTTPS** app address and a certificate the phone trusts. HTTP localhost is an exception on the computer hosting the browser; localhost on a phone refers to that phone. The host-only startup command in this guide serves only the computer running the app.

For remote devices, deploy behind an HTTPS reverse proxy or equivalent setup. All scanners must connect to the same application/database. Test the intended phone's permissions, camera focus, lighting, and network before the event.

## Reports and exports

Select an event in **Reports**. Tables include Summary, By category, By entrance, Check-in timeline, and Not yet checked in; the last becomes No-shows after the event ends.

Measures include category allocations, event ticket limit, all-time tickets issued, active/expired/revoked tickets, accepted entries, unique checked-in attendees, remaining attendees, attendance percentage, and remaining ticket capacity.

- Attendees count once even with multiple tickets. Accepted entries count admitted tickets.
- Regeneration retains the same ticket record; it does not increase issued totals. Revoked tickets remain in historical totals.
- Previously checked-in attendees remain represented after cancellation to preserve attendance history.
- Combined category allocations cannot override the overall event limit.
- Timeline display uses the event time zone; explicitly labeled audit/issuance timestamps elsewhere use UTC.
- Click **Refresh reports** for changes from other devices.

Export the full Excel report or the selected CSV table. Attendee management exports its filtered table to CSV/Excel, and the ticket list has a CSV export. Potential spreadsheet formulas are escaped in exports.

## Settings and environment variables

Super Admin can create accounts with the roles listed above, change roles/event assignments, enable/disable other accounts, configure Gmail, inspect/export the last 200 organization audit actions, and view wallet status. Every user can change their own password. You cannot disable your own account. Non-Super settings are limited to their own password.

Disabling an account revokes its sessions. Password changes revoke that user's sessions and require sign-in. Create an additional CLI administrator with:

~~~powershell
py -3.10 -m app.backend.main create-admin
~~~

Once users exist, the CLI requires an existing Super Admin login plus an authenticator or recovery code. Enroll through the application before using an existing account in the CLI. There is no default password or public password-reset/recovery endpoint at this checkpoint.

### Configuration reference

Use the project-root .env. Do not put credentials in .env.example, source code, screenshots, or this guide.

| Variable | Default | Purpose |
| --- | --- | --- |
| DATABASE_URL | sqlite:///data/aast.db | SQLAlchemy URL; relative SQLite paths resolve from the project root |
| APP_TIMEZONE | Africa/Cairo | Default new-event time zone; use a valid IANA name |
| SESSION_HOURS | 8 | Absolute session lifetime; integer values are clamped to 1–24 hours |
| ADMIN_IDLE_MINUTES | 30 | Server-side inactivity limit for current Streamlit sessions; clamped to 5–240 minutes |
| APP_ENCRYPTION_KEY | Empty | Optional private Fernet key for encrypted security/job data; never commit it |
| APP_KEY_FILE | data/secret.key | Private key file used/created when no environment key is supplied; an absolute path is recommended when overriding |
| GMAIL_ENABLED | false | Enable/disable Gmail delivery |
| GMAIL_USERNAME | Empty | Sending Gmail address |
| GMAIL_APP_PASSWORD | Empty | Google app password; enter privately in Settings |
| GMAIL_SENDER_NAME | Dream Events | Sender display name |

Restart after editing database/session/time-zone settings. Gmail configuration is read when used, and Settings saves apply without a full restart. Gmail-specific .env values take precedence over environment fallbacks.

.streamlit/config.toml controls theme, the 10 MB upload limit, CORS/XSRF protections, and disabled usage statistics.

## Database, backups, and deployment

SQLAlchemy models use keys, unique constraints, indexes, timestamps, and event-scoped relationships. SQLite enforces foreign keys and uses WAL, a busy timeout, and serialized writes. Services enforce permissions, capacity, and event isolation.

| Tables | Purpose |
| --- | --- |
| users, auth_sessions | Accounts, password hashes, roles, hashed expiring sessions |
| organizations, organization_users | Organization membership and explicit administrative/scanner role |
| organization_events, event_assignments | Event ownership and user-to-event access, with composite foreign keys preventing cross-organization assignments |
| events, event_settings | Event details and an event-settings extension table |
| ticket_categories, entrances, entrance_category_permissions | Allocations and allowed-category access |
| attendees, tickets | Registrations, ticket state, token hashes, expiry |
| check_ins, audit_logs | Admissions and audit history |
| email_deliveries | Gmail attempts/results |
| alembic_version | Applied migration |

event_settings is an extension table without a separate editor. Migration-installed triggers protect check-in/audit records from UPDATE/DELETE. Audit rows retain event IDs even when an event without ticket history is safely deleted.

### Migrations

~~~powershell
py -3.10 -m alembic current
py -3.10 -m alembic upgrade head
py -3.10 -m alembic check
~~~

Current revisions: initial schema `de85c4478630`, immutable history `01_immutable_history`, email delivery `02_email_delivery`, and organization access `03_organization_access`. The new migration seeds AAST, maps existing Admin accounts to Super Admin and staff to Check-in Staff, and assigns existing staff to existing events. It does not alter legacy records. Back up before future upgrades. Organization ownership cannot be discarded through a downgrade; use a verified backup for rollback.

Revision `04_security_sessions` adds security profiles/sessions, hashed recovery/action tokens, and foundation tables for scanner access, permission overrides and durable jobs. These are additive tables; scanner services, overrides and the worker remain unfinished and are not exposed as working features. Security-record downgrades are blocked to avoid discarding enrolled credentials/history.

Developers should create/review new revisions rather than edit applied migrations:

~~~powershell
py -3.10 -m alembic revision --autogenerate -m "describe_the_change"
~~~

Review generated operations and trigger requirements before upgrading. Do not use downgrades or database deletion as routine troubleshooting.

### Backups and restore

Deploy the live SQLite file on a local disk outside active cloud sync, even if source code is in OneDrive. An absolute URL can be sqlite:///C:/AASTData/aast.db. Changing the URL does not transfer existing data; migrate/copy deliberately before starting against the new location.

Use SQLite's online backup API for a consistent backup. From the project root in PowerShell:

~~~powershell
@'
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from app.backend.database import engine

if engine.dialect.name != "sqlite":
    raise SystemExit("Use your database server's backup procedure for non-SQLite databases.")
source = Path(engine.url.database).resolve()
if not source.is_file():
    raise SystemExit("The configured database file does not exist.")
backup = source.parent / "backups" / (
    "aast_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f") + ".db"
)
backup.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(str(source)) as original, sqlite3.connect(str(backup)) as destination:
    original.backup(destination)
print("Backup created:", backup)
'@ | py -3.10 -
~~~

Do not copy only the main .db file during WAL writes. Also protect backups of .env and saved ticket files: database backups do not recover original QR credentials/PDF attachments.

To restore, stop every application process, preserve the current database for rollback, and restore a verified backup with SQLite's backup API into the configured database. Check integrity and migration revision, upgrade if necessary, and verify event/attendee totals before reopening access. Restore-test backups before an event. No scheduled backup or one-click restore UI is implemented.

### Hosting and PostgreSQL

Use one application host for SQLite. Scanners connect to that host rather than copying/opening the database independently. Protect the host, exports, and backups because they contain personal information.

Port 8501 is the default. The local health endpoint is http://localhost:8501/_stcore/health; a healthy server does not certify Gmail or phone-camera access.

SQLAlchemy/Alembic provide a PostgreSQL path: install the appropriate driver, configure a URL such as postgresql+psycopg://..., and apply migrations to the target database. Data transfer is separate. PostgreSQL, multi-host deployment, production HTTPS, and event-scale load testing are not certified by the current SQLite tests.

## Security and audit history

- Argon2id password hashing; random session/QR tokens with database hashes.
- Five failed password attempts lock the account for 15 minutes; sessions expire after the configured lifetime.
- Service-level role checks and authenticated access to attendee information.
- Transactional duplicate-entry prevention, including concurrent scanners.
- Bounded/validated uploads processed in memory rather than copied to uploads/.
- Local camera-frame processing; uploaded-image alternatives are decoded on the server.
- Private ticket files; no public attendee/ticket URL.
- Gmail secrets in .env, outside delivery records/version control; temporary Gmail configuration files are ignored too.
- Check-in/audit history protected by database triggers; no silent edits/deletes or implemented attendance-correction workflow.
- Confirmation and history restrictions for destructive UI operations.

Protect .env, the database, exports, tickets, and backups. Encryption at rest, external identity providers, password recovery, and production hosting/security assessment are not included.

## Tests and validation

~~~powershell
py -3.10 -m pytest -q
~~~

**Latest Python regression on 10 November 2026: 55 tests passed in 96.43 seconds**, including three tests for the thin API-client preview. The earlier Python security checkpoint had 52 tests. The pre-upgrade baseline was 37 tests; the organization stage had 47 tests. Tests use temporary databases and fake credentials; they do not change real event records or send real attendee email. Without Node.js, the optional bundled-JavaScript decoder test is skipped. Live organization and security migrations were separately checked against consistent pre-upgrade backups: all existing rows remained unchanged, database integrity and foreign keys passed, and `alembic check` reported no schema differences. Node/PostgreSQL and React validation is recorded separately in [the migration record](docs/NODE_MIGRATION.md).

| Coverage | Test file |
| --- | --- |
| Passwords, sessions, lockout, roles | tests/test_auth.py |
| Authenticator enrollment, replay prevention, recovery rotation/single use, factor lockout, idle expiry, backend reset tokens, RFC 6238 vectors | tests/test_security_upgrade.py |
| Role/service boundaries, assignments, live permission changes, cross-organization access and foreign keys | tests/test_permissions.py |
| Event creation/editing, validation, archive/delete | tests/test_events.py |
| Categories, entrances, registration, isolation, atomic imports | tests/test_access_attendees.py |
| Downloaded-template round trip, familiar headings, zeros, source row numbers | tests/test_import_template.py |
| QR/PDF/HTML/ZIP, token rotation, capacity, gates, concurrent scans, reports, disabled wallet | tests/test_tickets_checkin.py |
| Rotated/inverted photos and bundled JavaScript decoder | tests/test_scanner.py |
| Gmail settings, PDF attachments, TLS/login calls, failures/retries, permissions, deduplication, check-in during sending | tests/test_email.py |
| Fresh migrations, immutable history, populated legacy upgrade with unchanged records/session/QR | tests/test_migrations.py |
| Actual Streamlit forms, end-to-end administration, import preview/confirmation/success, assigned-event navigation/privacy | tests/test_ui.py |

Focused checks:

~~~powershell
py -3.10 -m pytest tests/test_import_template.py tests/test_ui.py -q
py -3.10 -m pytest tests/test_scanner.py tests/test_tickets_checkin.py -q
py -3.10 -m pytest tests/test_email.py tests/test_migrations.py -q
py -3.10 -m alembic check
~~~

The live scanner was also checked in Chrome at a phone-sized viewport with a simulated camera stream: automatic decoding, next-ticket scanning, and green/red server feedback worked. Real phone permissions/camera behavior still need device testing. Gmail tests mock SMTP; real Gmail delivery awaits a configured account and recipient check.

For a disposable PDF layout sample without event database records:

~~~powershell
py -3.10 scripts/preview_ticket.py
~~~

The output is tmp/pdfs/ticket-preview.pdf. It is an example for visual review, not a ticket registered in the real database.

## Troubleshooting

| Problem | Action |
| --- | --- |
| python/streamlit command not recognized | Use py -3.10 -m commands above; confirm Python and install locked dependencies. No activation is needed. |
| Port 8501 is occupied | The app may already be running. Open it, stop the old terminal, or choose another port. |
| Startup requests a schema upgrade | Run py -3.10 -m alembic upgrade head from the project root; check DATABASE_URL if the wrong database is selected. |
| No administrator | Run the create-admin command. The first account is created locally. |
| Correct credentials fail after wrong attempts | Wait 15 minutes for lockout; check whether the account was disabled. |
| Expired session / password changed | Sign in again. Password changes revoke existing sessions. |
| Categories/entrances missing | Select the correct event and create active categories/entrances with permissions. Staff need a Published/Ongoing unarchived event. |
| Sheet columns do not match | Download a fresh event template or use Change column matching. Review the mapped preview. |
| Import missing fields / duplicates | Correct listed rows. Supply a name plus email or ID and remove duplicate identifiers. A blocked batch imports nothing. |
| Category not recognized | Use this event's active category dropdown/default, or an unambiguous name/code in an existing sheet. |
| IDs/phones lost zeros | Re-enter as Text in Excel. Digits already removed cannot be recovered. |
| Ticket issuance rejected | Check event/distribution dates, status, active registration/category, allowed entrance, and event/category/per-attendee limits. |
| Ticket already issued | Use the session download or regenerate an eligible active unused ticket. Used tickets cannot be reset for re-entry. |
| Camera opens but cannot read | Click Start camera, select the correct camera, show the whole QR/white border, adjust light/distance, or upload a QR image. |
| Phone camera will not open | Use reachable HTTPS, allow camera permission, and close other camera apps. Phone localhost is not the computer's address. |
| Wrong entrance / duplicate / expired | Confirm event/entrance. Wrong entrance does not consume a ticket. Invalid credentials must not be admitted through a fallback. |
| Gmail controls disabled | Configure/enable Gmail in Settings and save. Recipients need attendee email addresses. |
| Gmail rejects sign-in | Use a Google app password, confirm 2-Step Verification/account eligibility, and check the sending address. |
| Saved Gmail password appears blank | Saved credentials are not displayed; blank retains the password for the same address. Use Test Gmail connection. |
| Sent email not received | Check the saved recipient, spam folder, and sender bounce messages. Sent means SMTP acceptance, not inbox arrival. |
| Unknown / interrupted Pending email | Check Gmail Sent before resending. Pending needs two minutes and explicit Send another copy for an interrupted attempt. |
| Lost downloads after restart | Regenerate an eligible active unused ticket for fresh downloadable/email artifacts. |
| Delete blocked | Archive the event, deactivate access records, or cancel registration as appropriate to retain history. |
| Database locked | Check for other writers, use one host, and keep the live file off active cloud sync. Do not remove database/WAL files as a workaround. |

## Project structure

~~~text
Events_Ticketing/
├── app/
│   ├── backend/
│   │   ├── authentication.py       # Passwords, roles, sessions, audit helpers
│   │   ├── config.py               # Environment and project-relative paths
│   │   ├── database.py             # SQLAlchemy engine and transactions
│   │   ├── main.py                 # Local create-admin CLI
│   │   ├── models.py               # ORM models and event-scoped constraints
│   │   ├── permissions.py          # Organization roles and event authorization
│   │   ├── schema.py               # Migration revision check
│   │   └── services/               # Events, access, attendees, imports,
│   │                               # tickets, Gmail delivery, reports
│   ├── dashboard/                  # Seven-section UI and sign-in
│   ├── scanner/
│   │   ├── decoder.py              # Uploaded-image ZXing decoder
│   │   ├── live.py                 # Live Streamlit camera component
│   │   └── frontend/               # JS/CSS, bundled jsQR, license/notices
│   ├── ticket_engine/              # QR, PDF/HTML, transactional admission
│   └── wallet/                     # Disabled signed-wallet provider boundary
├── migrations/                     # Schema revisions and history triggers
├── scripts/preview_ticket.py       # Disposable PDF sample
├── tests/                          # Services, UI, migrations, concurrency
├── docs/UPGRADE_PLAN.md            # Audit, target architecture, gaps, phased status
├── data/                           # Default SQLite database; ignored
├── generated_tickets/              # Reserved; no automatic artifact persistence
├── uploads/                        # Reserved; files are processed in memory
├── tmp/                            # Ignored local QA artifacts when generated
├── .streamlit/config.toml          # Theme, upload/server/browser options
├── .env.example                    # Empty/default configuration
├── .gitignore                      # Secrets, databases, exports, temp exclusions
├── alembic.ini
├── requirements.txt                # Supported dependency ranges
├── requirements-lock.txt           # Validated pinned dependencies
└── README.md
~~~

Initially empty Python paths were retained and implemented. Startup does not seed fake statistics or sample attendees.

The scanner bundles unmodified jsQR 1.4.0 under Apache-2.0. Its license and third-party notices are in app/scanner/frontend/.

## Current limits and future integrations

Implemented: authenticated multi-event administration, entrance/category access, manual/spreadsheet registration, QR/PDF/mobile-file tickets, Gmail PDF delivery, transactional check-in, attendance reports, exports, audit history, and migrations.

Not currently implemented:

- Payments, seat/row assignment, public self-service registration, or a hosted ticket portal.
- Apple/Google Wallet passes. The provider interface remains disabled without a configured implementation; no fake or unsigned .pkpass is generated. Official signing credentials/provider work are required.
- Generic SMTP setup, Gmail OAuth sign-in, scheduled/background mail queues, or email open/bounce tracking.
- Automatic event status transitions, overnight forms, offline check-in/sync, or an audited attendance-correction UI.
- Automatic backup/restore, password recovery, or external identity integration.
- Certified PostgreSQL/multi-host/production HTTPS deployment or event-scale load-test results.

Future events are supported subject to database, storage, and hosting capacity. Preserve the simple administration workflow when extending the platform.
