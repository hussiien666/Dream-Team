# MASTER CODEX IMPLEMENTATION PROMPT
## AAST Event Manager — Complete Product Upgrade & Implementation Specification

You are acting as a senior full-stack software architect, backend engineer, frontend engineer, database engineer, cybersecurity engineer, QA engineer, and UI/UX designer.

Your task is to upgrade my **existing AAST Event Manager application** into a complete, production-oriented event management and ticketing platform.

This is an existing project. Do NOT rebuild it from scratch, replace working functionality unnecessarily, or discard existing data.

You must first inspect the complete repository, understand its architecture, identify existing features, and implement the requirements below incrementally while preserving backward compatibility.

---

# PART 1 — PROJECT CONTEXT

## 1. Existing application

The application is an event management system built using Python and Streamlit.

The existing project already includes functionality documented in its README, including:

- Multiple-event administration.
- Admin dashboard and management sections.
- User roles and permissions.
- SQLite database.
- Alembic database migrations.
- Attendee and ticket management.
- QR code generation.
- PDF ticket generation.
- Mobile HTML tickets.
- Gmail-based PDF delivery.
- Browser-camera QR check-in.
- Reports and exports.
- Audit history.
- Security controls.

The README documents an existing test suite and Windows/Python 3.10 compatibility.

Existing commands documented in the project include:

Run the application:

```bash
py -3.10 -m streamlit run app/dashboard/main.py --server.address 127.0.0.1
```

Create an administrator:

```bash
py -3.10 -m app.backend.main create-admin
```

Run database migrations:

```bash
alembic upgrade head
```

These commands are references from the existing documentation. Verify the actual project before relying on them.

## 2. Primary objectives

Upgrade the system to support:

1. A professional event administration portal.
2. A separate mobile-first QR scanner portal.
3. Student-based guest invitations.
4. Flexible ticket generation and delivery.
5. Reusable ticket templates and visual customization.
6. Apple Wallet and Google Wallet support where technically available.
7. Advanced staff and administrator permissions.
8. Complete event operations monitoring.
9. Secure multi-user and multi-device access.
10. Cloud deployment with HTTPS and free-tier-friendly architecture.
11. Comprehensive event reporting.
12. Event lifecycle management.
13. Emergency controls and system monitoring.

The system should initially serve AAST events but be architected so multiple organizations can be supported in the future.

---

# PART 2 — ARCHITECTURE AND DEVELOPMENT RULES

## 3. Inspect before modifying

Before writing code:

1. Inspect the repository structure.
2. Read the README.
3. Inspect all existing Python modules.
4. Inspect the database schema and ORM models.
5. Inspect Alembic migrations.
6. Inspect authentication and permission logic.
7. Inspect existing ticket generation.
8. Inspect existing email delivery.
9. Inspect existing QR scanning and validation.
10. Inspect all tests.

Create an implementation plan based on the real code.

Identify:

- Existing functionality that can be reused.
- Missing functionality.
- Existing architectural limitations.
- Potential security vulnerabilities.
- Database migration requirements.
- Dependencies that must be added.
- Features that could introduce regressions.

Do not assume that documented features are implemented correctly. Verify them.

## 4. Architecture principles

Maintain a modular architecture.

Separate:

- Frontend/UI.
- Backend/business logic.
- Authentication and authorization.
- Database models and repositories.
- Ticket generation.
- QR validation.
- Email delivery.
- Scanner operations.
- Event management.
- Reporting.
- Notifications.
- Audit logging.
- System administration.

The admin portal and scanner portal must use the same backend and central database.

Do not create a second independent database for the scanner.

The system must support concurrent administrators and multiple scanner devices.

Use database transactions, appropriate constraints, and concurrency-safe check-in operations.

The architecture must be organization-ready, with future isolation between organizations, events, users, settings, and data.

## 5. Preserve existing functionality

Do not remove existing working features.

Do not break:

- Existing administrator accounts.
- Existing events.
- Existing attendees.
- Existing tickets.
- Existing QR codes.
- Existing check-in history.
- Existing email integrations.
- Existing reports.
- Existing migrations.

Use Alembic migrations for schema changes.

Avoid destructive database migrations.

When an old feature is replaced, preserve its functionality or provide a compatible migration path.

Do not silently delete or overwrite existing records.

## 6. Development workflow

Work incrementally.

For every implementation phase:

1. Inspect relevant files.
2. Explain the planned changes.
3. Implement the changes.
4. Run relevant tests.
5. Fix regressions.
6. Verify database compatibility.
7. Update documentation.
8. Report completed and incomplete functionality.

Do not claim a feature is complete unless it is implemented and tested.

Do not create decorative UI controls that have no backend functionality.

Every button, menu, action, filter, and setting must work.

---

# PART 3 — USER INTERFACE AND DESIGN

## 7. Overall UI

Create a professional, clean, modern interface.

The application should feel like a reliable event-management product, not a complicated internal database tool.

Design requirements:

- English only.
- Responsive layouts.
- Device system theme: follow light/dark preference.
- Clear typography.
- Consistent spacing.
- Simple navigation.
- Useful empty states.
- Helpful validation messages.
- Clear confirmation dialogs.
- Loading indicators.
- Success and error feedback.
- Tooltips where useful.
- Accessible contrast and controls.

Avoid excessive animations, unnecessary decoration, and overly complicated dashboards.

The UI must be easy to operate during a busy event.

## 8. Application portals

Separate the system into two primary portals:

### Admin portal

Example:

```text
/admin
```

Responsible for:

- Event management.
- Student and guest registration.
- Tickets.
- Ticket templates.
- Staff.
- Access codes.
- Event configuration.
- Reports.
- Notifications.
- Monitoring.
- Security.
- System administration.

### Scanner portal

Example:

```text
/scan
```

Responsible for:

- Scanner staff authentication.
- Event access-code verification.
- Entrance selection.
- Camera scanning.
- Check-in results.
- Personal scan statistics.
- Announcements.
- Emergency reporting.
- Scanner settings.

The scanner portal must be independent of the admin interface.

It must be optimized for smartphones.

It should work as a mobile-responsive web application and be PWA-ready.

No native mobile application installation should be required.

Both portals must communicate with the same backend and database.

IMPORTANT:

The current project uses Streamlit. Inspect whether the existing framework can support the required separation and mobile workflows cleanly.

If Streamlit alone is insufficient, propose and implement a compatible architecture using a separate frontend/backend component while preserving the existing application and database.

Do not introduce a complex framework without explaining why it is necessary.

---

# PART 4 — ADMINISTRATOR ACCOUNTS AND RBAC

## 9. Administrator roles

Implement multiple administrator accounts with role-based permissions.

Required roles:

### Super Admin

Full system access.

Can:

- Create administrator accounts.
- Assign and change roles.
- Change permissions.
- Disable and reactivate accounts.
- Reset user passwords.
- Manage all events.
- Manage system configuration.
- Access security settings.
- Manage emergency controls.
- Monitor system health.
- Restore archived events.
- Reopen cancelled events.

### Event Manager

Can manage assigned events.

### Ticket Manager

Can manage:

- Tickets.
- Ticket templates.
- Ticket delivery.
- Ticket cancellations.
- Ticket transfers.

### Check-in Supervisor

Can:

- Monitor check-ins.
- Monitor scanner staff.
- View event check-in performance.
- Monitor entrance operations.

Enforce permissions on the backend, not only by hiding UI elements.

## 10. Administrator account management

Only Super Admin can:

- Create administrator accounts.
- Assign or change roles.
- Change permissions.
- Disable/reactivate administrator accounts.
- Reset other users' access.

Support self-service password resets through email.

Password reset links must:

- Be single-use.
- Expire.
- Be securely generated.
- Avoid account enumeration.
- Invalidate existing sessions after password reset.

Do not force periodic password changes.

## 11. Super Admin two-factor authentication

Require 2FA for Super Admin accounts only.

Support:

- Authenticator application TOTP.
- Email verification codes.

Treat these as supported verification methods; do not require both methods simultaneously unless explicitly configured.

Generate backup recovery codes.

Recovery codes must:

- Be displayed once.
- Be stored hashed.
- Be single-use.
- Support regeneration.
- Invalidate previous codes after regeneration.
- Be recorded in audit logs when used.

## 12. Session management

Implement configurable administrator inactivity timeout.

Enforce session expiration on the server.

Scanner staff sessions have separate behavior:

- No automatic scanner logout due to inactivity.
- Manual logout requires confirmation.
- Only one active device per scanner account.
- Logging in on a second device terminates the first session automatically.
- Do not notify the old device when displaced.
- Super Admin can remotely terminate scanner sessions.
- Remote logout must be audited.

Provide active-session visibility to Super Admin.

Super Admin sees:

- Staff name.
- Assigned event.
- Selected entrance.
- Online/offline status.

Do not require device details or login timestamps in this active-session list.

## 13. Login security

Track basic login history:

- Successful login attempts.
- Failed login attempts.
- Timestamps.

Lock an account after five consecutive failed login attempts for 15 minutes.

Implement secure password hashing.

Protect authentication endpoints against brute force and enumeration.

## 14. Password management

Scanner staff can change their own passwords.

Super Admin can reset a scanner staff password.

When Super Admin resets a scanner password:

- Generate a temporary password.
- Require password change at next login.
- Keep the existing active scanner session active.
- Apply the temporary password to subsequent logins.
- Audit the reset.

Do not expose temporary passwords in ordinary application logs.

## 15. Scanner staff profiles

Scanner staff can edit:

- Display name.
- Profile photo.

They can also change their own password.

They cannot change:

- Username.
- Role.
- Permissions.
- Assigned events.

Only Super Admin controls those fields.

---

# PART 5 — EVENT MANAGEMENT

## 16. Events page

Create a dedicated Events page.

Administrators select an event before entering its event-specific dashboard.

Support:

- Cards view.
- Table view.
- Toggle between both views.
- Search by event name.
- Filter by event status.

Status filters:

- Active.
- Upcoming.
- Completed.

Event cards should display:

- Event name.
- Date.
- Status.
- Useful quick actions.

The table should support sorting and searching.

## 17. Event duplication

Allow authorized administrators to duplicate an existing event.

Duplicate:

- Event configuration.
- Categories.
- Entrances.
- Invitation limits.
- Access-code configurations.
- Scanner settings.
- Notification preferences.
- Ticket templates and assigned settings.

Create a new event ID.

Do not copy:

- Attendees.
- Students.
- Guests.
- Tickets.
- QR codes.
- Check-in history.
- Previous event activity records.

The new event must be independent.

## 18. Event archiving

Allow completed events to be archived.

Preserve:

- Students.
- Guests.
- Tickets.
- Ticket history.
- Check-ins.
- Reports.
- Staff activity.
- Audit records.
- Event configuration.
- Templates.

Archived events are read-only by default.

Super Admin can restore an archived event to active management without losing history.

## 19. Event export

Allow complete event exports in:

- Excel.
- PDF.

Include:

- Students.
- Guests.
- Invitations.
- Categories.
- Tickets.
- QR status.
- Check-ins.
- Entrances.
- Staff statistics.
- Email delivery status.
- Reports.
- Audit history.

Enforce export permissions.

## 20. Event-specific dashboards

Provide an event-specific dashboard after the administrator selects an event.

Do not build a global cross-event statistics dashboard.

Dashboard should show relevant event statistics and operational information.

Super Admin can access all events according to permissions.

## 21. Event lifecycle

Support:

- Upcoming.
- Active.
- Completed.
- Postponed.
- Cancelled.
- Archived.

### Postponement

Administrators can change event date/time.

Notify students and guests by email.

Existing tickets and QR codes remain valid.

Mobile tickets display the updated date/time.

Administrators can resend updated PDF tickets.

Preserve ticket identities and history.

### Cancellation

Administrators can cancel an event.

When cancelled:

- Cancel all tickets.
- Invalidate all QR codes immediately.
- Mark tickets as Cancelled.
- Notify students and guests.
- Prevent further check-ins.
- Preserve all historical data.

### Reopening a cancelled event

Only Super Admin can reopen a cancelled event.

Use a simple confirmation click.

A mandatory reason is not required.

Preserve the cancellation history.

Old cancelled tickets remain cancelled.

Issue new valid tickets under the reopened event.

Apply the new event date and details.

Audit the reopening.

---

# PART 6 — STUDENTS AND INVITATIONS

## 22. Student-based invitation system

Create a dedicated **Students & Invitations** section.

Do not mix student registration into the existing Attendees & Tickets section.

A student is the invitation sender.

A guest is the actual attendee.

Relationship:

```text
Event
  └── Student
        ├── Guest 1
        ├── Guest 2
        └── Guest 3
```

Each student can invite multiple guests.

The student may also be an attendee, depending on event configuration.

Do not assume every student must receive an attendee ticket.

## 23. Student ticket configuration

For every event, administrators can configure whether students receive their own tickets.

Student invitation-sender status and student attendee-ticket status must be separate concepts.

## 24. Registration methods

Support both:

1. Manual registration.
2. Excel import.

Provide a dedicated Students & Invitations section.

Keep the existing Attendees & Tickets functionality where appropriate.

## 25. Excel import

Create an Excel template with two sheets:

### Students

Contains student records.

### Guests

Contains guest records linked using Student ID.

The import process must:

1. Download a template.
2. Upload the completed file.
3. Validate both sheets.
4. Validate Student IDs.
5. Validate email addresses.
6. Detect duplicates.
7. Validate invitation limits.
8. Show a preview.
9. Show errors and warnings.
10. Allow corrections.
11. Commit only validated records.

Do not partially import invalid records without clearly explaining the outcome.

## 26. Student information

Student email is mandatory.

Validate its format during manual registration and Excel import.

Student email is used for delivery of their invited guests' ticket copies.

## 27. Guest information

Guest email is optional.

Allow the administrator to configure guest delivery behavior.

If the guest has an email and guest delivery is enabled, send the ticket to the guest.

The student receives copies of invited guests' tickets according to delivery settings.

If the guest does not have an email, send the ticket to the student.

Do not expose guest email or phone number to scanner staff.

## 28. Custom fields

Support event-specific custom fields.

Provide separate field configuration for:

- Students.
- Guests.

Administrators can define:

- Field label.
- Field type.
- Required/optional.
- Validation rules where applicable.

Keep standard fields available.

Do not force student and guest custom fields to share the same configuration.

## 29. Editing student and guest records

Administrators can edit student and guest records at any time.

Editing must:

- Update the database immediately.
- Preserve the existing ticket identity.
- Preserve QR validity.
- Preserve check-in history.
- Preserve relationships.
- Not automatically cancel or invalidate a ticket.

After editing a guest, allow administrators to manually regenerate or resend the updated ticket.

Keep the same ticket identity and QR code unless the administrator explicitly revokes or replaces the ticket.

An already-delivered PDF cannot update itself.

## 30. Student deletion

When an administrator deletes a student:

- Show a confirmation dialog.
- Show the number of affected guests.
- Remove the student from active records.
- Remove linked guests from active invitations.
- Cancel linked tickets.
- Immediately invalidate their QR codes.
- Preserve historical check-ins and audit records.

Do not permanently erase historical operational evidence.

## 31. Duplicate student import

Identify students using unique Student ID.

If an imported Student ID already exists:

- Update the existing student.
- Do not create another student.
- Preserve existing guests.
- Preserve existing invitations.
- Preserve ticket relationships.

Preview which records are:

- New.
- Updated.

## 32. Duplicate guest detection

Use flexible matching.

Primary matching:

```text
Student ID + Guest Email
```

If no guest email exists:

```text
Student ID + Guest Name + Guest Phone
```

The same guest under the same student should be detected as a duplicate.

The same guest under two different students represents two separate invitations and must not automatically be merged.

Show duplicate results before committing imports.

## 33. Invitation limits

Support all of the following:

- Event-wide guest limit.
- Individual student invitation limit.
- Category-specific invitation limits.
- Administrator overrides.

Example:

```text
Family: 2 guests
VIP: 1 guest
```

Validate all applicable limits before accepting an invitation.

Prevent race conditions when multiple users register guests simultaneously.

## 34. Default guest category

Administrators configure a default guest ticket category per event.

New guests receive the default automatically.

Administrators can override the category for individual guests.

Validate the assigned category against all applicable limits.

## 35. Student invitation self-service

Do not create a student dashboard or student login accounts.

Students can use a limited personal invitation link to manage their invitation allowance.

Support:

- Adding replacement guests after cancellation.
- Validating remaining invitation slots.
- Recording invitation changes.

This is a limited personal invitation workflow, not a student portal.

---

# PART 7 — TICKET GENERATION AND MANAGEMENT

## 36. Ticket generation

Support:

- Automatic ticket generation after individual registration.
- Manual ticket generation for selected guests.
- Batch generation for eligible guests.
- Batch generation for selected groups.

Show preview results and failures.

Prevent duplicate tickets.

Each guest receives a unique QR code linked to that guest's ticket.

Never use a student's QR code as the guest's QR code.

Cancelled or permanently revoked invitations must not receive valid tickets.

## 37. Ticket delivery

Support automatic email delivery when tickets are generated.

Delivery logic:

- Guest receives their own ticket when they have an email and guest delivery is enabled.
- Student receives copies of invited guests' tickets according to configured delivery settings.
- If a guest has no email, deliver the ticket to the student.
- Keep guest and student delivery settings separate.

Display delivery status:

- Pending.
- Sent.
- Failed.

Retrying an email must not create a new ticket or QR code.

## 38. Gmail failure handling

Implement automatic email retry.

Initial attempt: immediately.

Retry schedule:

1. After 1 minute.
2. After 5 minutes.
3. After 15 minutes.

After three automatic retries fail:

- Mark delivery Failed.
- Notify administrators.
- Allow manual resend.
- Reuse the same ticket and QR code.

Use reliable background-job scheduling.

Do not rely on a browser page remaining open to execute retries.

## 39. Email templates

Provide:

- Professional default email template.
- Event-specific email customization.

Allow administrators to configure:

- Subject.
- Greeting.
- Body.
- Event branding.
- Signature.
- Contact information.

Support placeholders:

```text
{guest_name}
{student_name}
{event_name}
{event_date}
```

Validate placeholders and provide previews.

## 40. Ticket previews

Support:

- Individual ticket preview.
- Batch sample preview.
- Optional approval before generation.

Preview both:

- PDF ticket.
- Mobile ticket.

Show selected information fields, QR placement, branding, and formatting.

## 41. Ticket templates

Support multiple reusable templates.

Administrators can:

- Create.
- Edit.
- Duplicate.
- Rename.
- Delete.
- Save for future events.
- Assign a template to an event.

Allow administrators to choose which ticket fields appear.

## 42. Ticket visual editor

Provide both:

- Professionally designed ready-made layouts.
- Simple visual customization editor.

Allow customization of:

- AAST logo.
- Event branding.
- Guest name.
- Student/invitation sender name.
- QR code.
- Ticket number.
- Event date.
- Entrance.
- Background.
- Colors.
- Images.
- Text.

Keep the editor simple and user-friendly.

Do not require graphic-design experience.

## 43. Ticket formats

Support:

1. PDF.
2. Mobile HTML.
3. Apple Wallet where supported.
4. Google Wallet where supported.

Always provide PDF and mobile HTML.

Wallet generation must be optional.

Apple Wallet requires appropriate signing credentials and may involve developer-account costs.

Google Wallet requires appropriate issuer configuration and credentials.

Missing wallet configuration must never block ordinary ticket generation or delivery.

## 44. Mobile ticket expiration

Mobile ticket links expire at the event end time.

After expiration:

- The mobile link cannot access the ticket.
- The QR code cannot be accepted after the event's validity period.
- Historical ticket records remain in the database.

A downloaded PDF may remain on the user's device, but its QR must still be rejected after expiration.

## 45. Ticket lifecycle

Administrators can:

- Cancel a ticket.
- Reactivate an eligible cancelled ticket.
- Permanently revoke a ticket.

Cancelled and revoked QR codes must be rejected immediately.

Audit:

- Administrator.
- Timestamp.
- Reason.

A permanently revoked ticket cannot be reactivated.

## 46. Ticket transfers

Support both:

- Administrator-initiated transfer.
- Guest-initiated transfer through the mobile ticket link.

When transferred:

- Record the new guest information.
- Invalidate the original QR.
- Generate a new unique QR.
- Preserve transfer history.
- Preserve relevant event and entrance restrictions.

Make transfer approval configurable per event:

- Admin approval required.
- Automatic approval.

Administrators configure an exact transfer deadline date/time for each event.

Enforce the configured deadline for guest and administrator transfers.

Do not silently bypass it.

## 47. Guest cancellation

Allow guests to cancel their own invitations through the mobile ticket link.

Cancellation is permitted at any time until the event ends, including after the event has started.

When cancelled:

- Immediately invalidate the QR.
- Mark invitation status Cancelled.
- Notify the student and administrators as configured.
- Record cancellation in audit history.
- Preserve historical records.

Cancellation restores the student's available invitation slot.

## 48. Replacement guests

Support replacement guest registration through:

- Student personal invitation link.
- Administrator manual management.

The replacement must:

- Use the freed invitation slot.
- Pass all invitation limits.
- Receive a new unique QR code.
- Be recorded in audit history.

---

# PART 8 — MOBILE SCANNER PORTAL

## 49. Scanner design

Create a separate mobile-first scanner portal.

The scanner portal is intended for smartphones, not dedicated scanning devices.

It must be:

- Responsive.
- Fast.
- Easy to use with one hand.
- Clear under event-day conditions.
- Compatible with supported mobile browsers.

Camera access requires HTTPS when hosted remotely.

## 50. Scanner authentication

Require:

1. Individual scanner staff username/password.
2. Event access code.

The event code is an additional authorization layer.

It must not replace individual authentication.

Hash or otherwise securely protect event access codes.

Rate-limit code guessing.

## 51. Event access codes

An event can have multiple access codes.

Administrators can:

- Create codes.
- Deactivate codes.
- Regenerate codes.
- Assign codes to entrances.
- Assign codes to staff groups.
- Track which code a staff member used.

Event code identifies and loads the event automatically.

Do not show an event list to scanner staff.

## 52. Entrance restrictions

Each access code grants access only to assigned entrance(s).

After entering a valid code, staff select an allowed entrance.

Staff can switch between permitted entrances without logging in again.

Show a confirmation dialog before switching entrances.

Every entrance change must be validated on the backend.

Every check-in must be validated against:

- Staff account.
- Event.
- Active access code.
- Permitted entrance.
- Ticket category.
- Event rules.

Changing an entrance manually must never bypass restrictions.

## 53. Code deactivation

When an event access code is deactivated:

- Immediately terminate all active scanner sessions using that code.
- Block subsequent scans.
- Require staff to authenticate again with a valid active code.
- Record the action and terminated sessions in the audit log.

## 54. Scanner account disablement

If a scanner staff account is disabled:

- Block new logins immediately.
- Existing active sessions may continue until logout.
- The account remains available for future reactivation.

Do not automatically terminate an already active session merely because the account is disabled.

## 55. Scanner session management

Support:

- One active device per staff account.
- New login terminates the previous device session.
- No notification to the old device.
- No automatic logout due to inactivity.
- Manual logout with confirmation.
- Super Admin remote logout.

Remote logout must immediately revoke the active session and be audited.

## 56. Scanner camera

Use camera scanning only.

Do not provide image-upload scanning.

Use the rear camera only.

Do not provide front/rear camera switching.

Provide a manual flashlight toggle where supported.

Camera must be paused when:

- Camera access is lost.
- Connectivity is lost.

Resume automatically when camera and internet connectivity are restored.

Do not provide manual pause/resume controls.

## 57. Offline behavior

Support a hybrid availability model.

When offline:

- Show a prominent Offline Mode warning.
- Camera may remain available.
- Do not accept tickets.
- Do not perform check-ins.
- Do not create offline check-in records.

When connectivity returns, scanning resumes automatically.

Never accept a ticket based on unverified offline information.

## 58. Scanner connection status

Display:

- Online.
- Offline.

Do not display connection-quality indicators.

## 59. Battery warning

When the browser/device exposes battery information, show a low-battery warning below 20%.

If battery information is unavailable, gracefully omit this feature.

Do not make the scanner dependent on battery API support.

## 60. Scanner screen behavior

After every scan result:

- Stop processing additional QR reads.
- Display the result.
- Wait for the configured result duration.
- Show a Scan Next Ticket button.

Do not automatically restart the camera after a result.

The camera resumes only after the user presses Scan Next Ticket.

Prevent repeated processing of the same QR while the result screen is displayed.

## 61. Scanner result screen

Use a full-screen result interface.

The camera disappears while the result is displayed.

### Successful result

Green screen.

Display:

- Guest name.
- Ticket number.
- Event name.
- Event date.
- Invitation sender/student name prominently.
- Ticket category.
- Invitation group.
- Entrance.

Do not display guest email or phone.

### Rejected result

Red screen.

Show a clear rejection reason.

Possible reasons:

- Invalid QR.
- Already used.
- Wrong event.
- Wrong entrance.
- Wrong category.
- Cancelled.
- Revoked.
- Expired.
- Event cancelled.
- Event not active.
- Invalid authorization.
- Connectivity failure.

### Duplicate result

Show:

- Original successful check-in time.
- Original entrance.

Do not show the complete historical check-in record.

## 62. Result duration

Display the result for three seconds.

After three seconds, show the Scan Next Ticket button.

Do not automatically resume scanning.

## 63. Scanner feedback

Provide configurable:

- Success sound.
- Rejection sound.
- Success vibration.
- Rejection vibration.

Staff can enable/disable sound and vibration.

Save preferences for future sessions.

Gracefully handle browser/device limitations and permission restrictions.

## 64. Scanner dashboard

Display:

- Camera interface.
- Selected event.
- Selected entrance.
- Successful scan count.
- Rejected scan count.
- Remaining guests.
- Recent scan activity.

## 65. Scanner statistics and privacy

Each scanner staff member sees only their own scan statistics.

Show:

- Personal successful scans.
- Personal rejected scans.
- Personal recent activity.

Do not show other staff members' scan histories.

Event-wide statistics are visible to authorized administrators.

## 66. Shared remaining-guest count

Scanner staff can see the event-wide remaining-guest count.

This number must update across devices.

Also show event-wide:

- Total registered guests.
- Total checked-in guests.

Do not expose guest lists or category breakdowns to scanner staff.

## 67. Scanner recent activity

Show only the last 10 scans for the currently authenticated staff member.

Each entry includes:

- Guest name.
- Ticket number.
- Result.
- Timestamp.

Do not expose another staff member's recent activity.

Do not provide scanner staff with export functionality.

Do not provide scanner guest search.

Admin-side guest search remains available.

## 68. Scanner event information

Show assigned event details:

- Event name.
- Event date.
- Event location.
- Event status.
- Selected entrance.

Do not show events outside the staff member's authorization.

## 69. Scanner announcements

Use the existing announcement system.

Do not create a separate event instructions page.

## 70. Scanner emergency reports

Add a Report Emergency button.

Only critical issues may be submitted:

- Urgent technical failure.
- Security concern.
- Emergency incident.

Do not provide a general-purpose feedback form.

Automatically attach basic context:

- Staff name.
- Event.
- Timestamp.
- Issue type.
- Description.

Send reports to administrators.

Associate each report with the relevant staff account and event.

---

# PART 9 — CHECK-IN ENGINE

## 71. Automatic check-in

The first valid scan immediately checks in the guest.

The backend must validate:

- Ticket exists.
- Ticket is active.
- QR is valid.
- Event is active.
- Event matches the scanner session.
- Ticket has not expired.
- Ticket is not cancelled.
- Ticket is not revoked.
- Ticket has not already been used.
- Entrance is authorized.
- Category and entrance rules are satisfied.
- Scanner staff account is authorized.
- Access code is active.

Record:

- Guest/ticket.
- Event.
- Entrance.
- Staff account.
- Check-in timestamp.
- Scanner/session reference where appropriate.

## 72. Duplicate protection

Use database transactions and concurrency-safe operations.

Two devices scanning the same ticket simultaneously must not create two successful check-ins.

Exactly one valid check-in may succeed.

All other attempts must be rejected as duplicates.

Return the original successful check-in timestamp and entrance.

## 73. Check-in reversal

Only authorized administrators can reverse an incorrect check-in.

Scanner staff cannot undo check-ins.

Require:

- Mandatory reversal reason.
- Administrator identity.
- Reversal timestamp.

Preserve the original check-in.

After reversal, the ticket can become eligible for another valid check-in if its status and event rules permit.

Audit the entire operation.

---

# PART 10 — STAFF MANAGEMENT AND MONITORING

## 74. Scanner staff management

Administrators can manage scanner staff accounts and permissions.

Support:

- Account creation.
- Assignment.
- Disablement.
- Reactivation.
- Permission management.
- Password resets.
- Event assignment.
- Access-code assignment.

Only Super Admin can control scanner staff roles and permissions.

## 75. Staff notifications

Notify scanner staff in-app whenever:

- Their permissions change.
- Their event assignments change.

Explain the change and when it becomes effective.

## 76. Live staff monitoring

Provide full event-wide staff monitoring in the admin portal.

Show:

- Staff name.
- Account status.
- Selected event.
- Selected entrance.
- Online/offline status.
- Successful scan count.
- Rejected scan count.
- Last activity timestamp.

Updates must be synchronized across devices.

## 77. Staff statistics privacy

Scanner staff see only their own statistics.

Authorized administrators can see event-wide statistics.

## 78. Staff login history

Super Admin can view basic scanner login history:

- Successful logins.
- Failed logins.
- Timestamps.

Do not include device, event, or entrance details in this login-history view.

## 79. Staff performance history

Scanner staff cannot view historical performance across previous events.

Only current event/session statistics and the last 10 recent scans are available to them.

Administrators retain access to authorized reporting.

## 80. Remote logout and password controls

Super Admin can remotely terminate an active scanner session.

Super Admin can reset a scanner password.

Password reset must not terminate an existing active scanner session.

All actions must be audited.

---

# PART 11 — NOTIFICATIONS AND ANNOUNCEMENTS

## 81. Admin activity alerts

Administrators receive alerts for important activity:

- Guest additions.
- Guest cancellations.
- Transfers.
- Transfer requests.
- Failed ticket emails.
- Invalid/problematic tickets.
- Important check-in activity.
- System errors.

## 82. Notification channels

Allow administrators to configure:

- In-app notification center.
- Email.
- Both.

## 83. Announcements

Support event-specific announcements.

Target:

- All users.
- Administrators only.
- Scanner staff only.

Display announcements in real time.

Record:

- Sender.
- Timestamp.
- Event.

Do not require read acknowledgments.

---

# PART 12 — EVENT BRANDING

## 84. Branding

Support full event-specific branding.

Allow configuration of:

- Event logo.
- Colors.
- Images.
- Visual identity.

Apply branding consistently to:

- Admin portal.
- Scanner portal.
- PDF tickets.
- Mobile tickets.
- Email templates.

Support reusable templates.

---

# PART 13 — EVENT READINESS AND OPERATIONS

## 85. Pre-event readiness checklist

Create a comprehensive event readiness checklist.

Include:

- Event configuration.
- Event dates and location.
- Student registration.
- Guest registration.
- Invitation limits.
- Ticket generation.
- Ticket delivery.
- Scanner staff assignment.
- Entrance configuration.
- Access-code configuration.
- Scanner connectivity.
- Email service.
- Server health.
- Database health.

Checklist items generate warnings only.

They must not block event activation.

## 86. Event-day live operations dashboard

Create an event-day operations dashboard.

Show live:

- Entrance activity.
- Scanner staff status.
- Check-in counts.
- Rejected tickets.
- Remaining guests.
- Email delivery issues.
- Emergency status.

Use real-time synchronization where appropriate.

## 87. Post-event reporting

Generate a full post-event summary.

Include:

- Total attendance.
- No-shows.
- Entrance statistics.
- Student invitations.
- Guest categories.
- Transfers.
- Cancellations.
- Email delivery.
- Staff performance.
- Incidents.
- Rejected scans.
- Check-in activity.

Support Excel and PDF exports.

Integrate with scheduled reports.

## 88. Scheduled reports

Allow administrators to configure:

- Daily reports.
- Weekly reports.
- Custom frequency.
- Report content.
- Selected statistics.
- Excel/PDF format.
- Email recipients.
- Enable/disable per event.

Generate a final report after the event ends.

Use reliable background scheduling.

---

# PART 14 — SYSTEM ADMINISTRATION

## 89. Data retention

Keep all event records and history indefinitely.

Do not automatically delete:

- Events.
- Students.
- Guests.
- Tickets.
- Check-ins.
- Transfers.
- Cancellations.
- Audit records.
- Staff activity.
- Reports.

Ticket expiration is separate from data retention.

## 90. Backup policy

Do not implement an internal backup scheduler or restore interface.

Backups are handled externally.

Keep the database architecture compatible with external backup procedures.

Document how to back up the database and required files safely.

## 91. System monitoring

Provide a basic system monitoring section for Super Admin.

Display:

- Server status.
- Database connection status.
- Recent system errors.
- Recent error logs.

Do not expose sensitive secrets or credentials.

## 92. Maintenance mode

Super Admin can enable or disable maintenance mode.

During maintenance:

- Normal users cannot access the application.
- Scanner users cannot scan.
- Only Super Admin can access maintenance functionality.
- Display a clear maintenance message.

## 93. Emergency controls

Provide complete emergency controls for Super Admin.

Allow:

- Stop all scanning.
- Pause check-ins.
- Configure emergency message for scanner screens.
- Resume operations.

Require:

- Confirmation dialog.
- Mandatory reason.
- Audit logging.

Do not provide a one-click action that can accidentally stop all operations without confirmation.

When scanning is paused, reject check-ins at the backend, not merely in the frontend.

---

# PART 15 — HOSTING AND DEPLOYMENT

## 94. Cloud hosting

The system must be accessible over the internet.

Use a shared central database.

Require HTTPS for remote mobile camera access.

Prioritize free-tier hosting options.

Design the application to be portable between hosting providers.

## 95. Free-tier requirements

Prioritize:

- Free hosting tiers.
- Free database options.
- HTTPS.
- Low operational cost.

Explain limitations such as:

- Sleeping applications.
- Storage limits.
- Bandwidth limits.
- Database limitations.
- Concurrent connection limits.
- Background worker limitations.

Do not claim that a free tier is guaranteed to support a large graduation event or production workload.

Make the system deployable to a paid provider later without architectural redesign.

## 96. Domain

Start with the hosting provider's free subdomain.

Keep the architecture compatible with adding a custom domain later.

## 97. Production requirements

Document:

- Environment variables.
- Database configuration.
- Secrets management.
- HTTPS configuration.
- Email configuration.
- Wallet credentials.
- Background workers.
- Deployment steps.
- Database migrations.
- External backup procedure.

Never commit production secrets.

---

# PART 16 — SECURITY AND AUDITABILITY

## 98. Backend authorization

Every protected operation must verify authorization on the backend.

Never trust frontend-only checks.

Protect:

- Event access.
- Staff assignments.
- Entrance selection.
- Ticket validation.
- Check-in.
- Ticket cancellation.
- Ticket transfers.
- Check-in reversals.
- Account management.
- Exports.
- Administrative operations.

## 99. QR security

QR codes must use secure, unguessable identifiers or signed tokens.

Do not expose sensitive guest information directly inside the QR payload.

The backend remains the source of truth.

A screenshot or copied QR must not bypass:

- Ticket cancellation.
- Revocation.
- Transfer.
- Expiration.
- Duplicate check-in.
- Event cancellation.

## 100. Audit logging

Create reliable audit records for important actions.

Include where applicable:

- Actor.
- Action.
- Target.
- Event.
- Timestamp.
- Reason.
- Relevant before/after values.

Audit:

- Login/security actions.
- Account changes.
- Password resets.
- Remote logout.
- Permission changes.
- Access-code changes.
- Ticket generation.
- Ticket cancellation.
- Ticket reactivation.
- Ticket revocation.
- Ticket transfer.
- Guest cancellation.
- Invitation replacement.
- Check-in.
- Check-in reversal.
- Event postponement.
- Event cancellation.
- Event reopening.
- Archiving/restoration.
- Emergency controls.
- Maintenance mode.
- System administration changes.

Preserve audit history.

## 101. Privacy

Scanner staff must not access:

- Guest email addresses.
- Guest phone numbers.
- Guest lists.
- Other staff scan histories.
- Cross-event performance history.

Scanner staff can see only the operational information needed for their job.

---

# PART 17 — DATABASE DESIGN

## 102. Review and extend the existing schema

Inspect the current database before proposing new tables.

Extend existing models where possible.

Do not create duplicate entities for functionality that already exists.

The final schema should support the following logical entities, adapting names to the existing architecture:

- Organization.
- User.
- Role.
- Permission.
- UserRole.
- Event.
- EventSettings.
- EventBranding.
- Entrance.
- EventAccessCode.
- StaffEventAssignment.
- StaffEntrancePermission.
- ScannerSession.
- ScannerPreference.
- Student.
- Guest.
- Invitation.
- InvitationLimit.
- CustomFieldDefinition.
- CustomFieldValue.
- Ticket.
- TicketTemplate.
- TicketTemplateVersion.
- TicketDelivery.
- EmailTemplate.
- TicketTransfer.
- TicketCancellation.
- CheckIn.
- CheckInReversal.
- Announcement.
- Notification.
- EmergencyReport.
- ScheduledReport.
- AuditLog.
- SystemSetting.
- SystemError.

This is a logical reference, not an instruction to create every table blindly.

Use normalized relational structures where appropriate.

Use foreign keys, indexes, unique constraints, and transactions.

Define appropriate deletion behavior.

Preserve historical records even when active records are removed.

Use explicit status fields rather than ambiguous Boolean flags where a lifecycle is needed.

---

# PART 18 — TESTING REQUIREMENTS

## 103. Existing tests

Run the existing test suite before making changes.

Record the baseline result.

Do not remove existing tests just to make the suite pass.

## 104. New tests

Add tests for all major workflows.

### Authentication

- Valid login.
- Invalid login.
- Account lockout.
- Password reset.
- Temporary password.
- Forced password change.
- 2FA.
- Recovery codes.
- Session expiration.

### Roles

- Super Admin access.
- Event Manager access.
- Ticket Manager access.
- Check-in Supervisor access.
- Unauthorized operations rejected.

### Scanner

- Valid staff login.
- Invalid event code.
- Access code restricted to correct entrance.
- Deactivated code immediately terminates sessions.
- Disabled account blocks new login.
- Existing session remains active after account disablement.
- One-device session enforcement.
- Remote logout.
- Password reset preserves active scanner session.
- Offline check-in rejected.
- Camera permission failure.
- Emergency reporting.
- Entrance switching.

### Student and guest registration

- Manual registration.
- Excel import.
- Student ID matching.
- Duplicate students.
- Duplicate guests.
- Invalid email.
- Missing student ID.
- Custom fields.
- Invitation limits.
- Default category.
- Student deletion.
- Replacement invitations.

### Tickets

- Automatic generation.
- Manual generation.
- Batch generation.
- Unique QR.
- PDF.
- Mobile HTML.
- Wallet fallback.
- Email delivery.
- Retry schedule.
- Manual resend.
- Template preview.
- Cancellation.
- Revocation.
- Reactivation.
- Transfer.
- Expiration.

### Check-in

- Valid first scan.
- Duplicate scan.
- Concurrent scans from two devices.
- Wrong event.
- Wrong entrance.
- Wrong category.
- Cancelled ticket.
- Revoked ticket.
- Expired ticket.
- Event cancellation.
- Emergency stop.
- Check-in reversal.

### Events

- Creation.
- Duplication.
- Archiving.
- Restoration.
- Postponement.
- Cancellation.
- Reopening.
- Export.

### Monitoring

- Live staff state.
- Live counts.
- Personal scanner statistics.
- Recent 10 scans.
- Admin event-wide monitoring.
- Notifications.
- Scheduled reports.

## 105. Concurrency tests

Test multiple scanners checking in simultaneously.

Verify that the same ticket cannot be successfully checked in twice.

Test concurrent invitation registration against student and event limits.

Test simultaneous administrator changes where relevant.

## 106. Security tests

Test authorization bypass attempts.

Test access-code guessing protection.

Test session revocation.

Test expired and replayed tokens.

Test QR manipulation.

Test unauthorized event access.

Test scanner data isolation.

Test cross-organization isolation in the future-ready architecture.

---

# PART 19 — IMPLEMENTATION PRIORITIES

Do not attempt to implement everything in one unstructured code change.

Divide development into phases.

## Phase 1 — Repository audit and architecture

- Inspect current code.
- Record baseline tests.
- Identify gaps.
- Design the target architecture.
- Plan migrations.
- Preserve current behavior.

Deliver an architecture report and implementation roadmap.

## Phase 2 — Core database and permissions

- Database models.
- Alembic migrations.
- Organization-ready structure.
- Administrator RBAC.
- Scanner staff accounts.
- Authentication.
- Session management.
- Audit logging.

## Phase 3 — Event management

- Events page.
- Cards/table view.
- Search and filters.
- Event duplication.
- Archiving/restoration.
- Event lifecycle.
- Event settings.

## Phase 4 — Students and invitations

- Students & Invitations section.
- Manual registration.
- Excel import.
- Student/guest relationships.
- Invitation limits.
- Custom fields.
- Duplicate detection.
- Editing/deletion.
- Replacement guests.

## Phase 5 — Ticketing

- Ticket generation.
- Templates.
- Visual editor.
- Preview.
- PDF.
- Mobile HTML.
- Email templates.
- Gmail delivery.
- Retry jobs.
- Ticket lifecycle.
- Transfers.
- Guest cancellation.
- Wallet integration where configured.

## Phase 6 — Mobile scanner portal

- Separate scanner frontend.
- Staff authentication.
- Event access codes.
- Entrance permissions.
- Mobile camera.
- Full-screen result screens.
- Manual Scan Next Ticket.
- Feedback.
- Offline protection.
- Personal dashboard.
- Scanner settings.

## Phase 7 — Live operations and monitoring

- Real-time updates.
- Staff monitoring.
- Active sessions.
- Shared remaining count.
- Announcements.
- Emergency reports.
- Check-in reversal.
- Emergency controls.

## Phase 8 — Reporting and administration

- Event exports.
- Scheduled reports.
- Readiness checklist.
- Post-event report.
- System monitoring.
- Maintenance mode.

## Phase 9 — Deployment and validation

- Cloud deployment.
- HTTPS.
- Shared database.
- Background workers.
- Email configuration.
- External backup documentation.
- Security review.
- Full regression testing.

---

# PART 20 — IMPORTANT BUSINESS RULES AND CONFLICT RESOLUTION

These rules must be treated as authoritative.

1. Scanner staff authenticate using individual accounts AND event access codes.
2. Event access code identifies the event.
3. Access codes restrict entrances.
4. Access-code deactivation immediately terminates sessions using that code.
5. Disabling a scanner account blocks new logins but does not terminate its existing active session.
6. Password reset does not terminate an existing scanner session.
7. One active scanner device per account.
8. No automatic scanner logout due to inactivity.
9. Super Admin can remotely log out scanner staff.
10. Scanner staff cannot search guests.
11. Scanner staff cannot export data.
12. Scanner staff see only their own scan history and statistics.
13. Scanner staff see event-wide registration counts and remaining guests.
14. Scanner staff see only the last 10 of their own scans.
15. Scanner result duration is three seconds.
16. After a result, the staff member must press Scan Next Ticket.
17. No offline check-ins are accepted.
18. The scanner uses the rear camera only.
19. The flashlight is optional when supported.
20. The camera is the only QR scanning method.
21. Student is the invitation sender; guest is the attendee.
22. Student tickets are configurable per event.
23. Guest tickets have unique QR codes.
24. Student email is mandatory; guest email is optional.
25. A student receives guest ticket copies according to delivery settings.
26. Student invitations can be managed through limited personal links, not student accounts or dashboards.
27. Guest cancellation restores the invitation slot.
28. Ticket edits do not automatically invalidate existing QR codes.
29. Ticket transfers invalidate the original QR and issue a new one.
30. Cancelled/revoked tickets cannot be checked in.
31. Check-in reversal is administrator-only and requires a reason.
32. Archived event data is preserved.
33. Cancelled events preserve history but cannot accept check-ins.
34. Reopened events require new valid tickets; old cancelled tickets stay cancelled.
35. All event data is retained indefinitely.
36. No built-in backup scheduler or restore UI.
37. English only.
38. Device system theme.
39. No public event information page.
40. No built-in help center.
41. No built-in support/contact form.
42. Announcements replace a separate scanner instructions page.
43. Emergency reports are restricted to critical issues and include basic context.
44. Event readiness checklist produces warnings but does not block activation.
45. The application initially serves AAST but must be organization-ready.
46. Free hosting is the priority, but production limitations must be explained honestly.

---

# PART 21 — REQUIRED DELIVERABLES

At the end of implementation, provide:

1. Updated project architecture.
2. Updated database schema.
3. Alembic migrations.
4. Updated admin portal.
5. Separate mobile scanner portal.
6. Student and guest management.
7. Excel import template.
8. Ticket generation system.
9. Reusable ticket templates.
10. Email delivery and retry system.
11. QR check-in engine.
12. Scanner staff management.
13. RBAC and security controls.
14. Event monitoring dashboard.
15. Notification and announcement system.
16. Event reports and exports.
17. System administration.
18. Automated tests.
19. Deployment instructions.
20. Environment variable example file.
21. Database migration instructions.
22. External backup instructions.
23. Updated README.
24. Known limitations and future improvements.

## Final acceptance criteria

The application must:

- Continue working with existing project data.
- Preserve existing features.
- Have separate admin and scanner portals.
- Use a shared backend/database.
- Support multiple simultaneous scanner devices.
- Prevent duplicate check-ins under concurrency.
- Enforce entrance and event access restrictions on the backend.
- Support student-based invitations and guest ticketing.
- Support PDF and mobile tickets without requiring wallet configuration.
- Support event-specific ticket branding.
- Provide complete administrative controls.
- Preserve audit history.
- Work on mobile browsers over HTTPS.
- Pass the existing and newly added test suites.

Do not mark a phase complete based on UI appearance alone.

A feature is complete only when its UI, backend, database behavior, authorization, error handling, and relevant tests are implemented.

---

# FINAL INSTRUCTIONS TO CODEX

Start by auditing the existing repository.

Do not immediately start rewriting files.

First produce:

1. Repository architecture summary.
2. Existing feature inventory.
3. Missing-feature analysis against this specification.
4. Database migration plan.
5. Security and compatibility risks.
6. Phased implementation roadmap.

Then begin implementing Phase 1 and continue in controlled, testable stages.

If a decision is not explicitly defined here, choose the simplest secure implementation that fits the existing architecture. Do not invent major business rules or remove existing functionality.

If a technical limitation prevents a requirement from being implemented exactly, explain the limitation and propose the closest reliable solution before proceeding.

**The objective is to evolve the existing AAST Event Manager into a complete, secure, mobile-friendly event operations platform without losing the work already completed.**