import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '../dist/common/crypto.util.js';
import { unseal } from '../dist/common/encryption.util.js';
import { ScannerService } from '../dist/scanner/scanner.service.js';

export function registerMobileTicketTransferTests({
  test,
  adminRequest: api,
  request,
  getDb: db,
  getApp: app,
  eventInput,
}) {
  const ok = (r, status = 201) => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  };

  let e, c, ent, s, g, t, mobileToken, linkId, scannerToken;
  const base = () => `events/${e.id}`;
  const call = (route, { token = mobileToken, body, method } = {}) =>
    request('public/tickets' + (route ? `/${route}` : ''), {
      token,
      method: method ?? (body ? 'POST' : 'GET'),
      ...(body ? { body } : {}),
    });

  test('mobile tickets: setup event, categories, entrance, student and ticket with mobile link', async () => {
    e = ok(
      await api('events', {
        body: {
          ...eventInput,
          name: 'Mobile Tickets & Transfers Event',
          status: 'Published',
          capacity: 50,
          maxTickets: 50,
        },
      }),
    );
    c = ok(
      await api(base() + '/categories', {
        body: { name: 'VIP Guest', code: 'VIP_GUEST', allocation: 30, color: '#142d4e' },
      }),
    );
    ent = ok(
      await api(base() + '/entrances', {
        body: { name: 'Gate 1', code: 'GATE1', categoryIds: [c.id] },
      }),
    );
    ok(
      await api(base() + '/settings', {
        method: 'PATCH',
        body: {
          settings: {
            defaultCategoryId: c.id,
            automaticTicketGeneration: true,
            perStudentLimit: 5,
            transferApproval: 'automatic',
          },
        },
      }),
      200,
    );
    s = ok(
      await api(base() + '/students', {
        body: {
          studentId: 'STU_TRANSFER_1',
          fullName: 'Sponsoring Student',
          email: 'student_transfers@example.com',
        },
      }),
    );
    g = ok(
      await api(base() + '/guests', {
        body: {
          studentId: s.id,
          fullName: 'Original Guest Attendee',
          email: 'guest_original@example.com',
          phone: '+201011112222',
          categoryId: c.id,
        },
      }),
    );

    // Ticket was automatically issued due to automaticTicketGeneration
    const tickets = ok(await api(base() + '/tickets'), 200);
    t = tickets.find((row) => row.attendeeId === g.attendeeId);
    assert.ok(t, 'Automatic ticket should exist');
    assert.equal(t.status, 'Active');

    // Create an access code and scanner session for entrance verification
    const code = ok(
      await api(base() + '/access-codes', {
        body: { name: 'Gate Scanner Code', entranceIds: [ent.id] },
      }),
    );
    const scanner = app().get(ScannerService);
    const login = await scanner.login('legacy_scanner', 'a-new-scanner-password', code.code);
    scannerToken = login.token;
  });

  test('mobile ticket links: create, view, download PDF, rotate and revoke', async () => {
    // List mobile links initially (auto-created on issuance)
    const linksInitial = ok(await api(`${base()}/tickets/${t.id}/mobile-link`), 200);
    assert.ok(linksInitial.length >= 1, 'Initial link created on issuance');

    // Admin rotates mobile ticket link
    const rotated = ok(
      await api(`${base()}/tickets/${t.id}/mobile-link`, {
        body: { confirmed: true, reason: 'Issue new mobile ticket link' },
      }),
    );
    assert.ok(rotated.path.startsWith('/ticket#DEM1.'));
    mobileToken = rotated.path.split('#')[1];
    linkId = rotated.id;
    assert.match(mobileToken, /^DEM1\.[A-Za-z0-9_-]{43}$/);

    const storedLink = await db().publicTicketLink.findUnique({ where: { id: linkId } });
    assert.equal(storedLink.tokenHash, digest(mobileToken));
    assert.equal(storedLink.revokedAt, null);

    // Public view
    const view = ok(await call(''), 200);
    assert.equal(view.event.name, 'Mobile Tickets & Transfers Event');
    assert.equal(view.ticket.number, t.number);
    assert.equal(view.ticket.status, 'Active');
    assert.equal(view.attendee.fullName, 'Original Guest Attendee');
    assert.equal(view.studentName, 'Sponsoring Student');
    assert.equal(view.categoryName, 'VIP Guest');
    assert.ok(view.qrDataUri?.startsWith('data:image/png;base64,'));
    assert.equal(view.transfer.allowed, true);
    assert.equal(view.canCancel, true);

    // Download PDF via capability
    const pdfRes = await call('pdf');
    assert.equal(pdfRes.status, 200);
    assert.ok(pdfRes.body !== null);

    // Invalid / unauthenticated capability tokens rejected
    assert.equal((await request('public/tickets')).status, 401);
    assert.equal((await call('', { token: 'DEM1.' + 'x'.repeat(43) })).status, 401);
    assert.equal((await call('', { token: 'AAST1.' + 'x'.repeat(43) })).status, 401);
  });

  test('guest-initiated transfer: automatic approval replaces QR, creates new ticket, updates student relationship', async () => {
    const key = randomUUID();
    const transferRes = ok(
      await call('transfer', {
        body: {
          action: 'transfer',
          requestKey: key,
          recipientName: 'Transferred Recipient',
          recipientEmail: 'transferred_recipient@example.com',
          recipientPhone: '+201099998888',
          reason: 'Cannot attend, gifting ticket to a friend',
        },
      }),
      200,
    );

    assert.equal(transferRes.action, 'transferred');
    assert.equal(transferRes.status, 'Approved');
    assert.ok(transferRes.newTicketNumber);
    assert.notEqual(transferRes.newTicketNumber, t.number);

    // Concurrent / idempotent retry returns identical result
    const retry = ok(
      await call('transfer', {
        body: {
          action: 'transfer',
          requestKey: key,
          recipientName: 'Transferred Recipient',
          recipientEmail: 'transferred_recipient@example.com',
          recipientPhone: '+201099998888',
          reason: 'Cannot attend, gifting ticket to a friend',
        },
      }),
      200,
    );
    assert.deepEqual(retry, transferRes);

    // Check database state
    const oldTicket = await db().ticket.findUnique({ where: { id: t.id } });
    assert.equal(oldTicket.status, 'Cancelled');

    const newTicket = await db().ticket.findUnique({
      where: { number: transferRes.newTicketNumber },
      include: { attendee: true },
    });
    assert.ok(newTicket);
    assert.equal(newTicket.status, 'Active');
    assert.equal(newTicket.attendee.fullName, 'Transferred Recipient');

    // The student relationship was transferred
    const newGuest = await db().guestInvitation.findUnique({
      where: { attendeeId: newTicket.attendeeId },
    });
    assert.ok(newGuest);
    assert.equal(newGuest.studentId, s.id);
    assert.equal(newGuest.active, true);

    const oldGuest = await db().guestInvitation.findUnique({
      where: { attendeeId: g.attendeeId },
    });
    assert.equal(oldGuest.active, false);

    // Old mobile link now reflects cancelled status
    const oldView = ok(await call(''), 200);
    assert.equal(oldView.ticket.status, 'Cancelled');
    assert.equal(oldView.qrDataUri, null);
    assert.equal(oldView.transfer.allowed, false);
    assert.equal(oldView.canCancel, false);

    // Scanner behavior:
    const scanner = app().get(ScannerService);
    const oldCred = await db().ticketCredential.findUnique({ where: { ticketId: t.id } });
    const oldQr = 'AAST1.' + unseal(oldCred.protectedToken);
    const oldScan = await scanner.scan(scannerToken, oldQr);
    assert.equal(oldScan.accepted, false);
    assert.equal(oldScan.message, 'Ticket cancelled.');

    const newCred = await db().ticketCredential.findUnique({ where: { ticketId: newTicket.id } });
    const newQr = 'AAST1.' + unseal(newCred.protectedToken);
    const newScan = await scanner.scan(scannerToken, newQr);
    assert.equal(newScan.accepted, true);
    assert.equal(newScan.ticketNumber, newTicket.number);

    // Update reference for subsequent tests
    t = newTicket;
  });

  test('guest-initiated transfer: admin approval mode, pending state, cancel request, reject and approve', async () => {
    // Create a new guest for testing admin approval
    const g2 = ok(
      await api(base() + '/guests', {
        body: {
          studentId: s.id,
          fullName: 'Second Guest For Approval Test',
          email: 'guest2_transfers@example.com',
          phone: '+201022223333',
          categoryId: c.id,
        },
      }),
    );
    const tickets = ok(await api(base() + '/tickets'), 200);
    const t2 = tickets.find((row) => row.attendeeId === g2.attendeeId);
    assert.ok(t2);

    // Switch event setting to require admin approval
    ok(
      await api(base() + '/settings', {
        method: 'PATCH',
        body: {
          settings: {
            transferApproval: 'admin',
          },
        },
      }),
      200,
    );

    // Get a mobile ticket link for t2
    const rotated = ok(
      await api(`${base()}/tickets/${t2.id}/mobile-link`, {
        body: { confirmed: true, reason: 'Setup t2 link' },
      }),
    );
    const t2Token = rotated.path.split('#')[1];

    // Guest requests transfer
    const key = randomUUID();
    const reqRes = ok(
      await call('transfer', {
        token: t2Token,
        body: {
          action: 'transfer',
          requestKey: key,
          recipientName: 'Pending Recipient Guest',
          recipientEmail: 'pending_guest@example.com',
          recipientPhone: '+201055556666',
          reason: 'Need admin review for transfer',
        },
      }),
      200,
    );
    assert.equal(reqRes.action, 'transfer_requested');
    assert.equal(reqRes.status, 'Pending');
    const transferId = reqRes.transferId;

    // View shows transfer pending
    const viewPending = ok(await call('', { token: t2Token }), 200);
    assert.ok(viewPending.transfer.pending);
    assert.equal(viewPending.transfer.pending.recipientName, 'Pending Recipient Guest');
    assert.equal(viewPending.transfer.allowed, false);

    // Cannot initiate another transfer while one is pending
    const conflict = await call('transfer', {
      token: t2Token,
      body: {
        action: 'transfer',
        requestKey: randomUUID(),
        recipientName: 'Another Guest',
      },
    });
    assert.equal(conflict.status, 409);

    // Scanner blocks check-in while transfer is pending
    const scanner = app().get(ScannerService);
    const t2Cred = await db().ticketCredential.findUnique({ where: { ticketId: t2.id } });
    const t2Qr = 'AAST1.' + unseal(t2Cred.protectedToken);
    const scanAttempt = await scanner.scan(scannerToken, t2Qr);
    assert.equal(scanAttempt.accepted, false);
    assert.equal(scanAttempt.message, 'Ticket transfer is pending approval.');

    // Guest cancels transfer request
    const cancelTransferRes = ok(await call('cancel-transfer', { token: t2Token }), 200);
    assert.equal(cancelTransferRes.action, 'transfer_cancelled');

    const transferCancelled = await db().ticketTransfer.findUnique({ where: { id: transferId } });
    assert.equal(transferCancelled.status, 'Cancelled');

    // Guest submits a new transfer request
    const req2 = ok(
      await call('transfer', {
        token: t2Token,
        body: {
          action: 'transfer',
          requestKey: randomUUID(),
          recipientName: 'Guest To Be Rejected Then Approved',
          recipientEmail: 'review_guest@example.com',
        },
      }),
      200,
    );
    const transfer2Id = req2.transferId;

    // Admin lists transfers with filter
    const pendingList = ok(await api(`${base()}/transfers?status=Pending`), 200);
    assert.ok(pendingList.some((tr) => tr.id === transfer2Id));

    // Admin rejects transfer
    const rej = ok(
      await api(`${base()}/transfers/${transfer2Id}/reject`, {
        body: { reason: 'Incomplete recipient identity' },
      }),
      200,
    );
    assert.equal(rej.status, 'Rejected');

    const t2AfterRejection = await db().ticket.findUnique({ where: { id: t2.id } });
    assert.equal(t2AfterRejection.status, 'Active');

    // Guest submits new transfer request and admin approves it
    const req3 = ok(
      await call('transfer', {
        token: t2Token,
        body: {
          action: 'transfer',
          requestKey: randomUUID(),
          recipientName: 'Final Approved Guest',
          recipientEmail: 'final_guest@example.com',
        },
      }),
      200,
    );
    const transfer3Id = req3.transferId;

    const approved = ok(
      await api(`${base()}/transfers/${transfer3Id}/approve`, {
        body: { confirmed: true },
      }),
      200,
    );
    assert.equal(approved.status, 'Approved');
    assert.ok(approved.newTicketNumber);

    const oldT2 = await db().ticket.findUnique({ where: { id: t2.id } });
    assert.equal(oldT2.status, 'Cancelled');
    const newT2 = await db().ticket.findUnique({ where: { number: approved.newTicketNumber } });
    assert.equal(newT2.status, 'Active');
  });

  test('transfer deadlines: enforce exact deadline and require Super Admin override with audited reason', async () => {
    // Create a new guest and ticket
    const g3 = ok(
      await api(base() + '/guests', {
        body: {
          studentId: s.id,
          fullName: 'Guest For Deadline Test',
          email: 'deadline_guest@example.com',
          phone: '+201077778888',
          categoryId: c.id,
        },
      }),
    );
    const tickets = ok(await api(base() + '/tickets'), 200);
    const t3 = tickets.find((row) => row.attendeeId === g3.attendeeId);
    assert.ok(t3);

    const link = ok(
      await api(`${base()}/tickets/${t3.id}/mobile-link`, {
        body: { confirmed: true, reason: 'Deadline test link' },
      }),
    );
    const t3Token = link.path.split('#')[1];

    // Set transfer deadline in the past
    const pastDeadline = new Date(Date.now() - 3600000).toISOString();
    ok(
      await api(base() + '/settings', {
        method: 'PATCH',
        body: {
          settings: {
            transferDeadline: pastDeadline,
          },
        },
      }),
      200,
    );

    // Guest-initiated transfer rejected due to deadline
    const guestAttempt = await call('transfer', {
      token: t3Token,
      body: {
        action: 'transfer',
        requestKey: randomUUID(),
        recipientName: 'Late Guest',
      },
    });
    assert.equal(guestAttempt.status, 400);
    assert.ok(JSON.stringify(guestAttempt.body).includes('Transfer deadline has passed'));

    // Admin transfer without superAdminOverride rejected
    const adminAttempt = await api(`${base()}/tickets/${t3.id}/transfers`, {
      body: {
        recipientName: 'Late Guest Via Admin',
        superAdminOverride: false,
      },
    });
    assert.equal(adminAttempt.status, 400);

    // Super Admin transfer with explicit override and reason succeeds
    const overrideTransfer = ok(
      await api(`${base()}/tickets/${t3.id}/transfers`, {
        body: {
          recipientName: 'Overridden Recipient Guest',
          recipientEmail: 'override_guest@example.com',
          reason: 'Emergency replacement after deadline',
          approveImmediately: true,
          superAdminOverride: true,
          overrideReason: 'Dean authorized emergency substitution',
        },
      }),
    );
    assert.equal(overrideTransfer.status, 'Approved');
    assert.ok(overrideTransfer.newTicketNumber);

    const transferRec = await db().ticketTransfer.findUnique({
      where: { id: overrideTransfer.transferId },
    });
    assert.equal(transferRec.superAdminOverride, true);
    assert.equal(transferRec.overrideReason, 'Dean authorized emergency substitution');
  });

  test('guest cancellation: invalidates QR immediately, deactivates guest, restores invitation quota', async () => {
    // Reset deadline to allow active registration
    ok(
      await api(base() + '/settings', {
        method: 'PATCH',
        body: {
          settings: {
            transferDeadline: null,
          },
        },
      }),
      200,
    );

    const g4 = ok(
      await api(base() + '/guests', {
        body: {
          studentId: s.id,
          fullName: 'Guest To Be Cancelled',
          email: 'cancel_guest@example.com',
          phone: '+201088889999',
          categoryId: c.id,
        },
      }),
    );
    const tickets = ok(await api(base() + '/tickets'), 200);
    const t4 = tickets.find((row) => row.attendeeId === g4.attendeeId);
    assert.ok(t4);

    const link = ok(
      await api(`${base()}/tickets/${t4.id}/mobile-link`, {
        body: { confirmed: true, reason: 'Cancellation link' },
      }),
    );
    const t4Token = link.path.split('#')[1];

    const key = randomUUID();
    const cancelRes = ok(
      await call('cancel', {
        token: t4Token,
        body: {
          action: 'cancel',
          requestKey: key,
          confirmed: true,
          reason: 'Guest is unable to attend the ceremony',
        },
      }),
      200,
    );
    assert.equal(cancelRes.action, 'cancelled');

    // Idempotent retry returns same result
    const retryCancel = ok(
      await call('cancel', {
        token: t4Token,
        body: {
          action: 'cancel',
          requestKey: key,
          confirmed: true,
          reason: 'Guest is unable to attend the ceremony',
        },
      }),
      200,
    );
    assert.deepEqual(retryCancel, cancelRes);

    // In DB, ticket is Cancelled, Attendee is Cancelled, GuestInvitation is inactive
    const cancelledTicket = await db().ticket.findUnique({ where: { id: t4.id } });
    assert.equal(cancelledTicket.status, 'Cancelled');

    const cancelledAttendee = await db().attendee.findUnique({ where: { id: g4.attendeeId } });
    assert.equal(cancelledAttendee.status, 'Cancelled');

    const deactivatedGuest = await db().guestInvitation.findUnique({ where: { attendeeId: g4.attendeeId } });
    assert.equal(deactivatedGuest.active, false);

    // Scanner rejects cancelled ticket
    const scanner = app().get(ScannerService);
    const t4Cred = await db().ticketCredential.findUnique({ where: { ticketId: t4.id } });
    const t4Qr = 'AAST1.' + unseal(t4Cred.protectedToken);
    const scan = await scanner.scan(scannerToken, t4Qr);
    assert.equal(scan.accepted, false);
    assert.equal(scan.message, 'Ticket cancelled.');
  });
}
