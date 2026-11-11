okay hi 
# MASTER CODEX PROMPT
# AAST EVENT MANAGER — COMPLETE MIGRATION TO NODE.JS BACKEND

## Project Objective

I have an existing project called **AAST Event Manager**.

I want to transform it into a complete, professional, multi-event management and ticketing platform.

There is one major architectural change:

**I want the entire backend migrated from Python to Node.js.**

The new backend must be built using Node.js and TypeScript.

This is not a request to simply create a Node.js API alongside the existing Python backend. The final architecture must make Node.js the single source of truth for all server-side business logic.

The existing Python backend must be progressively replaced.

Preserve the existing application functionality, data, and business requirements while performing the migration.

This prompt supersedes the previous implementation instructions.

---

# PART 1 — MANDATORY ARCHITECTURE

## 1. Technology Stack

Use the following architecture.

### Backend

- Node.js.
- TypeScript.
- NestJS as the backend framework.
- REST API.
- WebSocket support for live updates.
- Prisma ORM.
- PostgreSQL database.
- Redis only where genuinely needed, such as distributed caching or job processing.
- A database-backed job queue where practical to reduce hosting dependencies.
- OpenAPI/Swagger API documentation.
- Zod or class-validator for request validation.
- Structured logging.

Use a modular, maintainable architecture.

### Frontend

**Admin Portal:**

Keep the existing Streamlit interface initially.

However, Streamlit must become a frontend/API client only.

It must:
- Display information returned by the Node.js API.
- Send requests to the Node.js API.
- Handle UI state.
- Display API errors.
- Display loading states.
- Render charts, tables, and forms.

It must NOT:
- Connect directly to PostgreSQL.
- Execute SQL queries.
- Implement authentication business logic.
- Implement ticket-generation business logic.
- Implement QR validation.
- Implement check-in rules.
- Implement authorization decisions.
- Implement email delivery.
- Implement invitation-limit calculations.
- Maintain a separate business-logic database.

All these responsibilities belong to the Node.js backend.

Do not rebuild the admin frontend unnecessarily during the initial backend migration.

**Mobile Scanner Portal:**

Build a separate modern mobile-first frontend using:

- React.
- TypeScript.
- Vite.
- Responsive CSS.
- PWA-ready architecture.
- Browser camera APIs.
- WebSocket communication where useful.

The scanner frontend must communicate exclusively with the Node.js backend.

Do not implement ticket validation or check-in authorization in React.

### Database

Use PostgreSQL as the primary database.

Use:
- Prisma ORM.
- Version-controlled Prisma migrations.
- Foreign keys.
- Unique constraints.
- Database indexes.
- Transactions.
- Appropriate deletion policies.

The application must be able to run locally and deploy to cloud hosting.

### Suggested repository structure

Adapt this structure to the actual existing repository rather than blindly recreating it.

```text
aast-event-manager/
│
├── backend/
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   │
│   │   ├── common/
│   │   ├── config/
│   │   ├── database/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── organizations/
│   │   ├── events/
│   │   ├── students/
│   │   ├── guests/
│   │   ├── invitations/
│   │   ├── categories/
│   │   ├── entrances/
│   │   ├── tickets/
│   │   ├── ticket-templates/
│   │   ├── ticket-delivery/
│   │   ├── email/
│   │   ├── scanner/
│   │   ├── checkins/
│   │   ├── transfers/
│   │   ├── notifications/
│   │   ├── announcements/
│   │   ├── reports/
│   │   ├── audit/
│   │   ├── monitoring/
│   │   ├── maintenance/
│   │   └── emergency/
│   │
│   ├── prisma/
│   ├── test/
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── admin/
│   └── existing Streamlit frontend
│
├── scanner/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
│
├── migration/
│   └── legacy database migration scripts
│
├── docs/
│
├── docker-compose.yml
├── README.md
└── .gitignore
```

The exact structure may change if the existing repository has a better organization.

---

# PART 2 — MIGRATING THE EXISTING PROJECT

## 2. Inspect Before Changing Anything

Start by examining the entire existing repository.

Inspect:
- Python files.
- Streamlit pages.
- Existing backend modules.
- SQLAlchemy models.
- Alembic migrations.
- SQLite database.
- Authentication.
- User permissions.
- Ticket generation.
- QR generation.
- Scanner functionality.
- Email delivery.
- Reports.
- Existing tests.
- README.
- Dependencies.
- Configuration.

Create a detailed inventory of the existing functionality.

Classify features as:
1. Working.
2. Partially working.
3. Missing.
4. Requires architectural replacement.

Do not assume that the README accurately represents the implementation.

Inspect actual code.

## 3. Replace the Python Backend

All backend responsibilities must be implemented in Node.js.

Migrate:
- Database access.
- Business logic.
- Authentication.
- Authorization.
- Password handling.
- Session management.
- Ticket generation.
- QR generation.
- QR validation.
- Check-in processing.
- Invitation management.
- Student management.
- Guest management.
- Excel import/export processing.
- PDF generation.
- Mobile ticket generation.
- Email sending.
- Email retries.
- Notifications.
- Reports.
- Audit logs.
- Scheduled tasks.
- System monitoring.
- Emergency controls.

The final Python Streamlit code must not contain duplicated backend business logic.

During migration, temporary compatibility code is allowed, but it must be clearly isolated and eventually removed.

## 4. Preserve Existing Data

The existing project uses SQLite and Alembic.

Create a safe migration path from the existing database into PostgreSQL.

The migration must preserve:
- Users.
- Roles.
- Permissions.
- Organizations if present.
- Events.
- Students.
- Guests.
- Invitations.
- Categories.
- Entrances.
- Tickets.
- Existing QR identities.
- Check-in history.
- Email delivery records.
- Templates.
- Scanner assignments.
- Access codes where safely migratable.
- Audit logs.
- Historical records.

Important:

Do not generate new ticket identities or QR codes unnecessarily during migration.

Preserve existing ticket identifiers and QR validation compatibility.

If the existing QR format cannot safely be preserved, create a controlled compatibility strategy and document it before changing the format.

Migration requirements:
1. Create an export script for SQLite.
2. Create an import script for PostgreSQL.
3. Preserve primary keys and relationships.
4. Handle foreign keys correctly.
5. Validate record counts.
6. Validate important relationships.
7. Validate ticket identities.
8. Validate check-in history.
9. Validate audit records.
10. Produce a migration report.
11. Support dry-run mode.
12. Never delete the original database automatically.

Test the migration on a copy before using it on the original database.

Do not destroy or overwrite the existing database.

---

# PART 3 — BACKEND API DESIGN

## 5. API Architecture

The Node.js backend must expose a well-structured API.

Suggested API prefix:

`/api/v1`

Organize endpoints by module.

Examples:

```text
/api/v1/auth
/api/v1/users
/api/v1/organizations
/api/v1/events
/api/v1/students
/api/v1/guests
/api/v1/invitations
/api/v1/categories
/api/v1/entrances
/api/v1/tickets
/api/v1/ticket-templates
/api/v1/ticket-delivery
/api/v1/scanner
/api/v1/checkins
/api/v1/transfers
/api/v1/notifications
/api/v1/announcements
/api/v1/reports
/api/v1/audit
/api/v1/system
```

Use:
- Consistent HTTP status codes.
- Standardized API responses.
- Request validation.
- Pagination.
- Filtering.
- Sorting.
- Error handling.
- Authentication middleware/guards.
- Role-based authorization.
- Event-level authorization.

Document APIs using Swagger/OpenAPI.

## 6. API Security

The backend must be the authority for all sensitive operations.

Never trust frontend permissions.

Never trust frontend event selection.

Never trust frontend entrance selection.

Never trust frontend ticket validation.

Every sensitive operation must be validated server-side.

Use secure authentication and session handling.

Implement:
- Password hashing using Argon2id or an appropriate secure alternative.
- Short-lived access tokens or secure sessions.
- Secure refresh-token rotation where applicable.
- Secure cookie settings when using cookies.
- CSRF protection where required.
- Rate limiting.
- Input validation.
- Output sanitization.
- Secure CORS configuration.
- Audit logging.
- Environment-based secrets.
- No hardcoded credentials.

Never expose password hashes, secrets, private access codes, recovery codes, or sensitive user data through APIs.

---

# PART 4 — ADMIN AND SCANNER INTERFACES

## 7. Admin Portal

Keep the existing Streamlit interface during the first migration phase.

The Streamlit application must become a thin API client.

Every page should retrieve and update data through the Node.js API.

Required sections:

1. Events.
2. Event Dashboard.
3. Students & Invitations.
4. Attendees & Tickets.
5. Ticket Templates.
6. Ticket Delivery.
7. QR Check-in Monitoring.
8. Scanner Staff & Access.
9. Reports & Exports.
10. Notifications.
11. System Settings.

Do not create duplicate sections if equivalent functionality already exists.

Use professional, simple, consistent UI design.

## 8. Mobile Scanner Portal

Build a separate React + TypeScript scanner application.

It must:
- Be mobile-first.
- Support smartphones.
- Be PWA-ready.
- Use the rear camera only.
- Support manual flashlight control when available.
- Require HTTPS for remote camera access.
- Communicate with the Node.js API.
- Never access the database directly.
- Never validate tickets independently.
- Never create check-ins locally.

Suggested URL:

`/scan`

Admin URL:

`/admin`

Both interfaces use the same backend.

---

# PART 5 — COMPLETE PRODUCT REQUIREMENTS

All the following requirements are mandatory unless a technical limitation is documented.

## 9. Events Management

Create a dedicated Events page.

Support:
- Card view.
- Table view.
- Toggle between views.
- Search by event name.
- Status filters: Active, Upcoming, Completed.
- Cancelled and Archived status handling.
- Sorting.
- Quick actions.

Each event includes:
- Name.
- Description.
- Start date/time.
- End date/time.
- Location.
- Status.
- Logo.
- Branding colors.
- Images.
- Categories.
- Entrances.
- Invitation limits.
- Ticket settings.
- Scanner settings.
- Email settings.
- Notification settings.
- Transfer settings.
- Custom fields.

### Event duplication

Allow event duplication.

Duplicate:
- Event configuration.
- Categories.
- Entrances.
- Invitation limits.
- Templates and assignments.
- Scanner settings.
- Access-code configurations.
- Notification preferences.

Do not duplicate:
- Students.
- Guests.
- Tickets.
- Check-ins.
- Historical reports.
- Staff activity.

Generate a new event ID.

### Archiving

Completed events can be archived.

Preserve all historical data.

Archived events are read-only by default.

Only Super Admin can restore archived events.

---

## 10. Event Postponement and Cancellation

### Postponement

When an event is postponed:
- Update event date/time.
- Keep existing tickets valid.
- Keep existing QR codes valid.
- Preserve ticket identities.
- Update mobile ticket information.
- Allow updated PDF tickets to be resent.
- Notify students and guests by email.

### Cancellation

When cancelled:
- Set event status to Cancelled.
- Cancel all tickets.
- Invalidate all QR codes immediately.
- Reject all check-ins.
- Notify students and guests.
- Preserve historical data.

### Reopening

Only Super Admin can reopen a cancelled event.

Require simple confirmation.

Do not require a reason.

Preserve cancellation history.

Old tickets remain cancelled.

Issue new valid tickets.

Record the reopening in the audit log.

---

## 11. Students and Guests

Create a dedicated Students & Invitations section.

A student is the invitation sender.

A guest is the actual attendee.

Relationship:

`Student → Multiple Guests`

Students may optionally receive their own ticket depending on event configuration.

### Registration methods

Support:
- Manual registration.
- Excel import.

### Excel format

Create a downloadable Excel template with two sheets.

**Students sheet:**
- Student ID.
- Student name.
- Email.
- Custom fields.

Student email is mandatory and must be valid.

**Guests sheet:**
- Guest name.
- Student ID.
- Guest email, optional.
- Guest phone, optional.
- Category.
- Invitation group.
- Custom fields.

Use Student ID to link guests.

### Excel validation

Before committing:
- Validate sheet structure.
- Validate required fields.
- Validate student references.
- Validate email addresses.
- Validate duplicates.
- Validate invitation limits.
- Show preview.
- Show updated and new records separately.
- Show errors.

### Duplicate students

Student ID is unique.

If an existing student is imported:
- Update the existing record.
- Do not duplicate.
- Preserve guests.
- Preserve invitations.
- Preserve tickets.
- Preserve history.

### Duplicate guests

Use:
- Same Student ID + same email.
- If email is missing, same Student ID + guest name + phone.

Same guest under different students represents separate invitations.

---

## 12. Invitation Limits and Categories

Support:
- Event-wide guest limit.
- Individual student limit.
- Category-specific limits.
- Admin overrides.

Example:

2 Family + 1 VIP per student.

Validate all applicable limits before registration.

### Default category

Each event has a default guest category.

New guests automatically receive it.

Administrators may override it individually.

Validate limits against the final assigned category.

### Invitation group

Keep invitation group separate from ticket category.

Example:
- Category: VIP.
- Group: Friends.

---

## 13. Custom Registration Fields

Administrators can create separate custom fields for students and guests.

Support:
- Text.
- Number.
- Email.
- Phone.
- Date.
- Dropdown.
- Checkbox.

Each field has:
- Label.
- Type.
- Required/optional.
- Event association.

Support manual registration, Excel imports, editing, and exports.

---

## 14. Editing and Deletion

Administrators can edit students and guests at any time.

Editing must preserve:
- Ticket identity.
- QR validity.
- Check-in history.
- Relationships.

After guest editing, allow administrators to manually regenerate/resend an updated ticket.

Do not automatically invalidate the existing QR.

### Student deletion

When deleting a student:
- Show confirmation.
- Show affected guest count.
- Remove linked records from active invitations.
- Cancel linked tickets.
- Invalidate QR codes.
- Preserve historical check-ins.
- Preserve audit history.

---

## 15. Ticket Generation

Support:
- Automatic individual generation.
- Manual selected-ticket generation.
- Batch generation.
- Group generation.

Requirements:
- Unique QR per guest.
- No duplicate tickets.
- Exclude cancelled/revoked invitations.
- Show preview.
- Show success/failure results.
- Preserve existing ticket identity during normal updates.

---

## 16. Ticket Templates and Design

Create a dedicated Ticket Templates section.

Support:
- Multiple templates.
- Professional ready-made layouts.
- Visual editor.
- Duplicate.
- Rename.
- Edit.
- Delete.
- Reuse across events.

The editor should be simple.

Customize:
- AAST logo.
- Event logo.
- Guest name.
- Student name.
- Event name.
- Event date.
- Ticket number.
- QR code.
- Entrance.
- Category.
- Colors.
- Backgrounds.
- Images.
- Text.

Allow per-event configuration of displayed ticket fields.

PDF and mobile HTML must use consistent configuration.

### Preview

Support:
- Individual preview.
- Batch sample preview.
- Optional approval before generation.
- PDF preview.
- Mobile preview.
- QR placement preview.
- Branding preview.

---

## 17. Ticket Formats

Support:
- PDF.
- Mobile HTML.
- Apple Wallet where supported.
- Google Wallet where supported.

PDF and mobile HTML must always work.

Wallet support is optional and must not block ticket generation.

Account for required platform credentials and signing arrangements.

Mobile ticket links expire at the event end time.

Historical ticket and check-in records remain preserved.

Downloaded PDFs may remain on devices, but the backend must reject expired tickets.

---

## 18. Ticket Email Delivery

Automatically send tickets when generated.

If the guest has an email and direct delivery is enabled, send the guest their ticket.

Students receive copies of their invited guests' tickets according to event delivery settings.

If a guest has no email, send the ticket to the student.

Email statuses:
- Pending.
- Sent.
- Failed.

### Automatic retries

- Initial attempt immediately.
- Retry after 1 minute.
- Retry after 5 minutes.
- Retry after 15 minutes.

After failure:
- Mark Failed.
- Notify administrators.
- Allow manual resend.
- Reuse the same ticket and QR.

Implement email retries using reliable Node.js background processing.

Do not rely on an HTTP request staying open.

### Email templates

Support default professional templates and event-specific customization.

Customizable:
- Subject.
- Greeting.
- Body.
- Branding.
- Signature.
- Contact information.

Placeholders:

`{guest_name}`  
`{student_name}`  
`{event_name}`  
`{event_date}`

---

## 19. Ticket Lifecycle and Transfers

Administrators can:
- Cancel.
- Reactivate eligible tickets.
- Permanently revoke tickets.

Record administrator, timestamp, reason, and status changes.

### Transfers

Transfers can be initiated by:
- Admin.
- Guest through mobile ticket link.

On transfer:
- Record new guest.
- Invalidate old QR.
- Generate new QR.
- Preserve transfer history.

Configure per event:
- Admin approval.
- Automatic approval.

Configure an exact transfer deadline.

Apply it to both guest and admin transfers unless a separately authorized Super Admin override is explicitly implemented and audited.

---

## 20. Guest Cancellation and Replacement

Guests can cancel through their mobile ticket link.

Allow cancellation until event end, including after the event starts.

On cancellation:
- Cancel invitation.
- Invalidate QR immediately.
- Record cancellation.
- Notify student/admin where configured.
- Restore invitation slot.
- Preserve history.

Replacement guests can be added by:
- Student through personal invitation link.
- Administrator.

Validate invitation limits and issue a new unique QR.

Do not build a full student dashboard or student account portal.

Students receive ticket copies and a limited personal invitation link.

---

# PART 6 — SCANNER BACKEND AND FRONTEND

## 21. Scanner Authentication

Scanner staff must use:
1. Individual staff account.
2. Event access code.

The code identifies the event automatically.

After authentication:
- Load the event.
- Display event name.
- Allow selection of permitted entrance.

Support multiple codes per event.

Codes may be assigned to entrances or groups of entrances.

Administrators can:
- Create.
- Activate.
- Deactivate.
- Regenerate.
- Assign.
- Review code usage.

Store access codes securely.

Rate-limit attempts.

Validate staff, event, code, and entrance permissions on every check-in.

### Entrance changes

Staff can switch between permitted entrances without logging in again.

Show a confirmation dialog.

Validate the new entrance on the backend.

Record the entrance used for every check-in.

### Access-code deactivation

Deactivating a code immediately:
- Terminates sessions using that code.
- Blocks further scanning.
- Requires a new valid code.
- Creates audit records.

---

## 22. Scanner Staff Accounts

Scanner staff can:
- Log in.
- Change their password.
- Change display name.
- Change profile photo.
- Manually log out.

They cannot change:
- Username.
- Role.
- Permissions.
- Event assignments.

Notify staff in-app whenever permissions or assignments change.

### Disabled account behavior

Disabling a staff account:
- Blocks new logins.
- Does not terminate an existing active session.
- Allows that session to continue until logout.
- Allows later reactivation.

### Admin password reset

Super Admin can reset staff passwords.

Generate temporary password.

Require password change at next login.

Do not terminate the existing active scanner session when resetting the password.

---

## 23. Scanner Sessions

Allow only one active device per scanner account.

A new login on another phone terminates the old session.

Do not notify the old device.

Do not automatically log scanner staff out due to inactivity.

Provide manual logout with confirmation.

Super Admin can remotely terminate a scanner session.

### Active-session monitoring

Super Admin sees:
- Staff name.
- Event.
- Entrance.
- Online/offline status.

No device details or login timestamps are needed in this list.

### Login history

Super Admin can view:
- Successful logins.
- Failed logins.
- Timestamps.

---

## 24. Scanner Interface

Use React + TypeScript.

Build a mobile-first interface.

Show:
- Event name.
- Event date.
- Event location.
- Event status.
- Selected entrance.
- Camera.
- Flashlight when supported.
- Online/offline status.
- Personal successful scans.
- Personal rejected scans.
- Total registered guests.
- Checked-in guests.
- Remaining guests.
- Recent scans.

### Camera

- Rear camera only.
- No front/rear switch.
- No image-upload scanning.
- Manual flashlight toggle.
- No screen lock.
- No manual pause/resume control.
- Low-battery warning below 20% only if device/browser supports it.

Automatically pause when camera or internet connection is lost.

Automatically resume when both are available.

Connection indicator only:
- Online.
- Offline.

---

## 25. Check-in Processing

The Node.js backend must perform every validation.

The frontend only sends the QR payload and receives the result.

Backend sequence:

1. Authenticate staff.
2. Validate session.
3. Validate event authorization.
4. Validate access code.
5. Validate entrance.
6. Validate event status.
7. Validate ticket.
8. Validate ticket status.
9. Validate event/category/entrance rules.
10. Verify no previous successful check-in.
11. Record check-in atomically.
12. Return confirmed result.

Use PostgreSQL transactions and appropriate constraints to prevent simultaneous duplicate check-ins.

### Successful result

Full-screen green.

Show:
- Guest name.
- Ticket number.
- Event name.
- Event date.
- Student/invitation sender name prominently.
- Ticket category.
- Invitation group.
- Entrance.

Do not show guest email or phone.

### Rejected result

Full-screen red.

Show clear reason:
- Invalid QR.
- Wrong event.
- Wrong entrance.
- Wrong category.
- Cancelled.
- Revoked.
- Expired.
- Event inactive.
- Already checked in.
- Offline/backend unavailable.

### Duplicate result

Show:
- Original successful check-in time.
- Original entrance.
- Duplicate warning.

Do not display full check-in history.

### Result behavior

Display results for 3 seconds.

Then show a **Scan Next Ticket** button.

Do not automatically restart the camera.

Prevent repeated processing of the same QR while a result is displayed.

### Feedback

Support configurable:
- Sound.
- Vibration.
- Different success/rejection feedback.

Save staff preferences.

Respect browser support and permissions.

---

## 26. Scanner Statistics and Privacy

Scanner staff see their own statistics only.

Show:
- Own successful scans.
- Own rejected scans.
- Last 10 scans.

Recent entries show:
- Guest name.
- Ticket number.
- Result.
- Timestamp.

Do not show:
- Other staff activity.
- Historical performance across previous events.
- Guest contact information.
- Full guest list.
- Guest search.
- Export functionality.

All scanner staff can see event-wide:
- Total registered guests.
- Total checked-in guests.
- Remaining guests.

These counts update live across devices.

---

## 27. Offline Behavior

The scanner may keep its camera available while offline.

However:
- No offline ticket acceptance.
- No offline check-in records.
- No queued check-ins.
- No simulated success.

Show Offline Mode prominently.

Resume normal operation automatically when connectivity returns.

Refresh authorization before scanning resumes.

---

## 28. Check-in Reversal

Scanner staff cannot reverse check-ins.

Authorized administrators can reverse incorrect check-ins.

Require:
- Confirmation.
- Mandatory reason.
- Admin identity.
- Timestamp.

Preserve original check-in and reversal history.

The ticket becomes eligible for another check-in after authorized reversal.

---

## 29. Live Scanner Monitoring

Admin portal must display:
- Staff name.
- Account status.
- Event.
- Entrance.
- Online/offline.
- Successful scans.
- Rejected scans.
- Last activity timestamp.

Update in near real time.

Use WebSockets or a suitable real-time mechanism.

---

# PART 7 — ADMIN SECURITY

## 30. Roles and Permissions

Support:

### Super Admin
Full system access.

### Event Manager
Assigned-event management.

### Ticket Manager
Ticket/template/delivery/cancellation/transfer management.

### Check-in Supervisor
Check-in monitoring and scanner staff monitoring.

Only Super Admin can:
- Create administrator accounts.
- Assign/change roles.
- Assign/change permissions.
- Disable/reactivate administrator accounts.
- Reset other administrators' access.

Enforce permissions in the Node.js backend.

---

## 31. Super Admin Two-Factor Authentication

Required for Super Admin only.

Support:
- Authenticator app (TOTP).
- Email verification codes.

Treat them as available methods.

Generate backup recovery codes.

Recovery codes:
- Display once.
- Store hashed.
- Single-use.
- Regeneration invalidates previous codes.
- Audit their use.

---

## 32. Authentication and Account Security

Support:
- Configurable administrator inactivity timeout.
- Server-side session enforcement.
- Successful/failed login history with timestamps.
- Lockout after 5 failed login attempts for 15 minutes.
- Self-service password reset by email.
- Single-use expiring password reset tokens.
- No account enumeration.
- Secure password hashing.
- No forced periodic password changes.
- No new-device notifications.

Do not apply inactivity-based automatic logout to scanner staff.

---

# PART 8 — DASHBOARDS AND OPERATIONS

## 33. Event Dashboard

Each event has its own dashboard.

No global cross-event statistics dashboard.

Show:
- Attendance.
- Remaining guests.
- Entrance activity.
- Scanner staff.
- Rejected tickets.
- Email issues.
- Emergency status.
- Operational alerts.

## 34. Event Readiness Checklist

Provide warnings for:
- Event settings.
- Registration.
- Tickets.
- Staff.
- Entrance codes.
- Scanner connectivity.
- Email service.
- Server/database health.

Warnings do not block event activation.

## 35. Post-Event Reports

Include:
- Attendance.
- No-shows.
- Entrance statistics.
- Student invitations.
- Categories.
- Transfers.
- Cancellations.
- Email delivery.
- Staff performance.
- Incidents.
- Rejected scans.
- Check-in history.

---

# PART 9 — REPORTING AND NOTIFICATIONS

## 36. Exports

Support Excel and PDF exports.

Include:
- Students.
- Guests.
- Invitations.
- Categories.
- Tickets.
- QR status.
- Check-ins.
- Entrances.
- Scanner statistics.
- Email delivery.
- Reports.
- Audit history.

Respect permissions.

## 37. Scheduled Reports

Support:
- Daily.
- Weekly.
- Custom frequency.
- Selected content/statistics.
- Excel/PDF.
- Email recipients.
- Per-event enable/disable.
- Final report after event end.

Use Node.js background processing.

## 38. Notifications

Admin notification channels:
- In-app.
- Email.
- Both.

Notify about:
- Guest additions.
- Guest cancellations.
- Transfers.
- Transfer requests.
- Failed emails.
- Invalid/problematic tickets.
- Important check-ins.
- System errors.
- Critical scanner reports.

## 39. Announcements

Allow event-specific announcements.

Target:
- All admins and scanner staff.
- Admins only.
- Scanner staff only.

Display near real time.

Record sender, timestamp, event, audience, and message.

No read acknowledgments.

## 40. Critical Scanner Reports

Scanner staff can report critical problems only.

Examples:
- Camera/scanner failures.
- Connectivity failures affecting check-in.
- Security incidents.
- Emergency situations.

Include:
- Issue type.
- Description.
- Staff identity.
- Event.
- Timestamp.

Send using the existing configurable notification channels.

Do not build a general support/contact form.

---

# PART 10 — SYSTEM ADMINISTRATION

## 41. System Monitoring

Super Admin sees:
- Server status.
- Database status.
- System errors.
- Recent error logs.

Never expose secrets.

## 42. Maintenance Mode

Super Admin can enable/disable maintenance mode.

When active:
- Normal application access is blocked.
- Only Super Admin can access maintenance functionality.
- Other

i was running this prompt on codex andd he done some of them so check the finalized and continue 