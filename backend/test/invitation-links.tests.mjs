import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '../dist/common/crypto.util.js';
export function registerInvitationLinkTests({
  test,
  adminRequest: api,
  request,
  getDb: db,
  eventInput,
}) {
  const ok = (r, status = 201) => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  };
  let e, c, s, s2, token, linkId, guestId, ticket, savedEmail;
  const base = () => `events/${e.id}`;
  const links = (student = s) =>
    base() + `/students/${student.id}/invitation-links`;
  const confirm = {
    confirmed: true,
    reason: 'Confirmed synthetic invitation access',
  };
  const add = (fullName, extra = {}, key = randomUUID()) => ({
    action: 'add',
    requestKey: key,
    confirmed: true,
    guest: { fullName, customValues: { meal: 'Normal' }, ...extra },
  });
  const call = (body, t = token) =>
    request('public/invitations', { token: t, ...(body ? { body } : {}) });

  test('invitation links: create scoped capability without exposing stored credentials', async () => {
    savedEmail = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = 'false';
    e = ok(
      await api('events', {
        body: { ...eventInput, name: 'Public invitation event', capacity: 20 },
      }),
    );
    c = ok(
      await api(base() + '/categories', {
        body: { name: 'Public guests', code: 'PUBLIC', allocation: 20 },
      }),
    );
    ok(
      await api(base() + '/entrances', {
        body: { name: 'Public gate', code: 'PUBLIC', categoryIds: [c.id] },
      }),
    );
    ok(
      await api(base() + '/settings', {
        method: 'PATCH',
        body: {
          settings: {
            defaultCategoryId: c.id,
            automaticTicketGeneration: true,
            perStudentLimit: 2,
          },
        },
      }),
      200,
    );
    ok(
      await api(base() + '/registration-fields', {
        body: {
          target: 'guest',
          key: 'meal',
          label: 'Meal',
          type: 'dropdown',
          options: ['Normal', 'Vegetarian'],
          required: true,
        },
      }),
    );
    s = ok(
      await api(base() + '/students', {
        body: {
          studentId: 'PUBLIC1',
          fullName: 'Public sender',
          email: 'sender@example.com',
        },
      }),
    );
    s2 = ok(
      await api(base() + '/students', {
        body: {
          studentId: 'PUBLIC2',
          fullName: 'Private other sender',
          email: 'other@example.com',
        },
      }),
    );
    const link = ok(await api(links(), { body: confirm }));
    token = link.path.split('#')[1];
    linkId = link.id;
    assert.match(token, /^DEI1\.[A-Za-z0-9_-]{43}$/);
    const stored = await db().publicInvitationLink.findUnique({
      where: { id: linkId },
    });
    assert.equal(stored.tokenHash, digest(token));
    assert.equal(
      stored.expiresAt.toISOString(),
      (
        await db().event.findUnique({ where: { id: e.id } })
      ).endsAt.toISOString(),
    );
    let foreignOrg = await db().organizationEvent.findFirst({where: {organizationId: {not: 1}}});
    if (!foreignOrg) {
      const organization = await db().organization.create({data: {name: 'Synthetic foreign invitations'}});
      const source = await db().event.findUniqueOrThrow({where: {id: e.id}});
      const {id, ...data} = source;
      const foreignEvent = await db().event.create({data: {...data, name: 'Synthetic foreign event'}});
      foreignOrg = await db().organizationEvent.create({data: {eventId: foreignEvent.id, organizationId: organization.id}});
    }
    assert.equal((await api(`events/${foreignOrg.eventId}/students/${s.id}/invitation-links`, {body: confirm})).status, 403);
    const listed = ok(await api(links()), 200);
    assert.equal(JSON.stringify(listed).includes('token'), false);
    const view = ok(await call(), 200);
    assert.equal(view.studentName, 'Public sender');
    assert.equal(JSON.stringify(view).includes('Private other sender'), false);
    assert.equal((await request(base() + '/students', { token })).status, 401);
    assert.equal(
      (await call(undefined, 'AAST1.' + 'x'.repeat(43))).status,
      401,
    );
    assert.equal((await request('public/invitations')).status, 401);
    assert.equal(
      (
        await api(`events/7/students/${s.id}/invitation-links`, {
          body: confirm,
        })
      ).status,
      404,
    );
  });
  test('invitation links: strict custom fields and no privilege or cross-event injection', async () => {
    for (const payload of [
      add('Missing meal', { customValues: {} }),
      add('Wrong meal', { customValues: { meal: 'Unknown' } }),
      add('Override', { overrideReason: 'Unauthorized override' }),
      add('Wrong sender', { studentId: s2.id }),
      add('Wrong category', { categoryId: 3 }),
    ])
      assert.equal((await call(payload)).status, 400);
    assert.equal(
      await db().guestInvitation.count({ where: { eventId: e.id } }),
      0,
    );
  });
  test('invitation links: atomic automatic tickets and concurrent content-checked retries', async () => {
    const body = add('Public guest', { email: 'guest@example.com' });
    const results = await Promise.all([call(body), call(body)]);
    const first = ok(results[0], 200);
    assert.deepEqual(ok(results[1], 200), first);
    guestId = first.id;
    const guest = await db().guestInvitation.findUnique({
      where: { id: guestId },
    });
    assert.equal(guest.studentId, s.id);
    ticket = await db().ticket.findFirst({
      where: { attendeeId: guest.attendeeId },
    });
    assert.ok(ticket);
    assert.equal(ticket.status, 'Active');
    assert.equal(
      await db().ticket.count({ where: { attendeeId: guest.attendeeId } }),
      1,
    );
    const audit = await db().auditLog.findFirst({
      where: { eventId: e.id, action: 'registration.saved', actorId: null },
    });
    assert.equal(JSON.parse(audit.details).linkId, linkId);
    assert.equal(
      (await call({ ...body, guest: { ...body.guest, fullName: 'Changed' } }))
        .status,
      409,
    );
    const receipts = await db().ticketIssueReceipt.findMany({
      where: { eventId: e.id },
    });
    assert.equal(receipts[0].actorId, null);
  });
  test('invitation links: concurrent invitation quota cannot be exceeded', async () => {
    const results = await Promise.all([
      call(add('Quota A')),
      call(add('Quota B')),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.equal(
      await db().guestInvitation.count({
        where: { eventId: e.id, studentId: s.id, active: true },
      }),
      2,
    );
    assert.equal(
      await db().ticket.count({ where: { eventId: e.id, status: 'Active' } }),
      2,
    );
  });
  test('invitation links: foreign guest denied and cancellation preserves QR history and restores quota', async () => {
    const foreign = ok(
      await api(base() + '/guests', {
        body: {
          studentId: s2.id,
          fullName: 'Foreign guest',
          customValues: { meal: 'Normal' },
        },
      }),
    );
    const cancel = {
      action: 'cancel',
      guestId: foreign.id,
      requestKey: randomUUID(),
      confirmed: true,
      reason: 'Guest no longer attending',
    };
    assert.equal((await call(cancel)).status, 404);
    cancel.guestId = guestId;
    const original = structuredClone(ticket);
    const results = await Promise.all([call(cancel), call(cancel)]);
    ok(results[0], 200);
    assert.deepEqual(results[0], results[1]);
    const current = await db().ticket.findUnique({ where: { id: ticket.id } });
    assert.equal(current.status, 'Cancelled');
    assert.equal(current.tokenHash, original.tokenHash);
    assert.equal(current.number, original.number);
    ok(await call(add('Replacement guest')), 200);
    const replacement = await db().ticket.findFirst({
      where: { eventId: e.id, attendee: { fullName: 'Replacement guest' } },
    });
    assert.notEqual(replacement.tokenHash, original.tokenHash);
    assert.equal(
      (await call(add('Public guest', { email: 'guest@example.com' }))).status,
      400,
    );
  });
  test('invitation links: failed ticket allocation rolls back guest and operation receipt', async () => {
    const other = ok(await api(links(s2), { body: confirm }));
    const t = other.path.split('#')[1];
    const gate = await db().entrance.findFirst({ where: { eventId: e.id } });
    await db().entrance.update({
      where: { id: gate.id },
      data: { active: false },
    });
    const before = await db().guestInvitation.count({
      where: { eventId: e.id },
    });
    assert.equal((await call(add('Must roll back'), t)).status, 400);
    assert.equal(
      await db().guestInvitation.count({ where: { eventId: e.id } }),
      before,
    );
    assert.equal(
      await db().publicInvitationOperation.count({
        where: { linkId: other.id },
      }),
      0,
    );
    await db().entrance.update({
      where: { id: gate.id },
      data: { active: true },
    });
  });
  test('invitation links: automatic email jobs use encrypted outbox without impersonating an administrator', async () => {
    const saved = Object.fromEntries(['EMAIL_ENABLED','RESEND_API_KEY','EMAIL_FROM'].map(k => [k, process.env[k]]));
    Object.assign(process.env, {EMAIL_ENABLED: 'true', RESEND_API_KEY: 'synthetic-invitation-key', EMAIL_FROM: 'testing@example.com'});
    try {
      const l = ok(await api(links(s2), {body: confirm}));
      const result = ok(await call(add('Public mailed guest', {email: 'mail-guest@example.com'}), l.path.split('#')[1]), 200);
      const invited = await db().guestInvitation.findUnique({where: {id: result.id}});
      const t = await db().ticket.findFirst({where: {attendeeId: invited.attendeeId}});
      const dispatches = await db().ticketDispatch.findMany({where: {ticketId: t.id}, include: {job: true}});
      assert.equal(dispatches.length, 2);
      for (const dispatch of dispatches) {assert.equal(dispatch.job.status, 'Pending'); assert.equal(dispatch.job.payload.includes('mail-guest@example.com'), false);}
      assert.equal((await db().ticketIssueReceipt.findFirst({where: {eventId: e.id, requestKey: 'auto_'+digest(JSON.stringify([invited.attendeeId]))}})).actorId, null);
    } finally {for(const [k,v] of Object.entries(saved)) {if (v === undefined) delete process.env[k]; else process.env[k] = v;}}
  });
  test('invitation links: deadline blocks additions but cancellation works after start and retains admissions', async () => {
    const used = await db().ticket.findFirst({
      where: {
        eventId: e.id,
        status: 'Active',
        attendee: { guestInvitation: { studentId: s.id } },
      },
    });
    const gate = await db().entrance.findFirst({ where: { eventId: e.id } });
    await db().ticket.update({
      where: { id: used.id },
      data: { status: 'Used' },
    });
    const admission = await db().checkIn.create({
      data: {
        ticketId: used.id,
        eventId: e.id,
        entranceId: gate.id,
        staffId: 1,
      },
    });
    await db().event.update({
      where: { id: e.id },
      data: {
        startsAt: new Date(Date.now() - 60000),
        registrationDeadline: new Date(Date.now() - 30000),
      },
    });
    assert.equal(ok(await call(), 200).canAdd, false);
    assert.equal((await call(add('Past deadline'))).status, 400);
    const linked = await db().guestInvitation.findUnique({
      where: { attendeeId: used.attendeeId },
    });
    ok(
      await call({
        action: 'cancel',
        guestId: linked.id,
        requestKey: randomUUID(),
        confirmed: true,
        reason: 'Changed plans after admission',
      }),
      200,
    );
    assert.deepEqual(
      await db().checkIn.findUnique({ where: { id: admission.id } }),
      admission,
    );
    assert.equal(
      (await db().ticket.findUnique({ where: { id: used.id } })).status,
      'Used',
    );
  });
  test('invitation links: rotation, revocation, expiry and closed-event gates', async () => {
    const fresh = ok(await api(links(), { body: confirm }));
    assert.equal((await call()).status, 401);
    token = fresh.path.split('#')[1];
    ok(await call(), 200);
    await db().event.update({ where: { id: e.id }, data: { archived: true } });
    assert.equal((await call()).status, 400);
    await db().event.update({
      where: { id: e.id },
      data: { archived: false, status: 'Cancelled' },
    });
    assert.equal((await call()).status, 400);
    await db().event.update({
      where: { id: e.id },
      data: { status: 'Upcoming' },
    });
    ok(await api(links() + '/revoke', { body: confirm }), 200);
    assert.equal((await call()).status, 401);
    const last = ok(await api(links(), { body: confirm }));
    token = last.path.split('#')[1];
    await db().publicInvitationLink.update({
      where: { id: last.id },
      data: { expiresAt: new Date(0) },
    });
    assert.equal((await call()).status, 401);
    const receipt = await db().publicInvitationOperation.findFirst({
      where: { linkId },
    });
    await assert.rejects(
      db()
        .$executeRaw`DELETE FROM public_invitation_operations WHERE id=${receipt.id}`,
    );
    await assert.rejects(
      db().publicInvitationLink.create({
        data: {
          eventId: 7,
          studentId: s.id,
          tokenHash: 'f'.repeat(64),
          expiresAt: new Date('2035-01-01'),
        },
      }),
    );
    if (savedEmail === undefined) delete process.env.EMAIL_ENABLED;
    else process.env.EMAIL_ENABLED = savedEmail;
  });
}
