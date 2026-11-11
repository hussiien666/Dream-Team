import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { unseal } from '../dist/common/encryption.util.js';
import { digest } from '../dist/common/crypto.util.js';
export function registerTicketTests({
  test,
  adminRequest: api,
  request,
  getDb: db,
  getOrigin,
  verifiedLogin,
  eventInput,
  getApp,
}) {
  const ok = (r, status = 201) => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  };
  let event, cat, gate, people, ticket, original;
  const base = () => `events/${event.id}/tickets`;
  const issue = (ids, key = randomUUID()) =>
    api(base() + '/batch-issue', {
      body: { attendeeIds: ids, requestKey: key },
    });
  const op = (id, action, reason = 'Integration ticket operation') =>
    api(`${base()}/${id}/${action}`, { body: { confirmed: true, reason } });
  async function setup(name, capacity = 10, allocation = 10) {
    const e = ok(
      await api('events', { body: { ...eventInput, name, capacity } }),
    );
    const c = ok(
      await api(`events/${e.id}/categories`, {
        body: { name: 'Guests', code: 'G', allocation, maxPerAttendee: 3 },
      }),
    );
    const g = ok(
      await api(`events/${e.id}/entrances`, {
        body: { name: 'Gate', code: 'GATE', categoryIds: [c.id] },
      }),
    );
    const p = await Promise.all(
      [0, 1, 2].map((i) =>
        db().attendee.create({
          data: {
            eventId: e.id,
            categoryId: c.id,
            fullName: 'Ticket guest ' + i,
            email: `ticket-${e.id}-${i}@example.com`,
          },
        }),
      ),
    );
    return { e, c, g, p };
  }
  test('ticket issuance validates strict bodies, event scope, roles and atomic batch boundaries', async () => {
    const s = await setup('Ticket integrity');
    event = s.e;
    cat = s.c;
    gate = s.g;
    people = s.p;
    for (const body of [
      { attendeeIds: [people[0].id] },
      { attendeeIds: ['1'], requestKey: randomUUID() },
      { attendeeIds: [], requestKey: randomUUID() },
      { attendeeIds: [people[0].id, people[0].id], requestKey: randomUUID() },
      {
        attendeeIds: [people[0].id],
        requestKey: randomUUID(),
        tokenHash: 'forged',
      },
    ])
      assert.equal((await api(base() + '/batch-issue', { body })).status, 400);
    const rejected = await issue([people[0].id, 999999]);
    assert.equal(rejected.status, 404);
    assert.equal(await db().ticket.count({ where: { eventId: event.id } }), 0);
    assert.equal(
      await db().ticketCredential.count({
        where: { ticket: { eventId: event.id } },
      }),
      0,
    );
    assert.equal(
      await db().ticketIssueReceipt.count({ where: { eventId: event.id } }),
      0,
    );
    const token = (
      await getApp()
        .get((await import('../dist/auth/auth.service.js')).AuthService)
        .login('test_manager', 'a-manager-test-password')
    ).accessToken;
    assert.equal((await request(base(), { token })).status, 403);
    assert.equal(
      (
        await request(base() + '/batch-issue', {
          token,
          body: { attendeeIds: [people[0].id], requestKey: randomUUID() },
        })
      ).status,
      403,
    );
  });
  test('concurrent issuance retries return one receipt and never expose raw credentials or hashes', async () => {
    const key = randomUUID();
    const both = await Promise.all([
      issue([people[0].id], key),
      issue([people[0].id], key),
    ]);
    assert.deepEqual(ok(both[0]), ok(both[1]));
    ticket = both[0].body.tickets[0];
    assert.equal(await db().ticket.count({ where: { eventId: event.id } }), 1);
    const cred = await db().ticketCredential.findUnique({
      where: { ticketId: ticket.id },
    });
    original = unseal(cred.protectedToken);
    assert.notEqual(cred.protectedToken, original);
    assert.equal(cred.tokenHash, digest(original));
    assert.equal((await issue([people[1].id], key)).status, 409);
    assert.equal((await issue([people[0].id])).status, 409);
    const list = ok(await api(base()), 200);
    assert.equal(list[0].recoverable, true);
    for (const value of [both[0].body, list]) {
      const text = JSON.stringify(value);
      assert.ok(!text.includes(original));
      assert.ok(!text.includes(cred.tokenHash));
      assert.ok(!text.includes('protectedToken'));
    }
    await assert.rejects(
      db()
        .$executeRaw`UPDATE ticket_issue_receipts SET content_hash='bad' WHERE event_id=${event.id}`,
    );
  });
  test('PDF/mobile recovery and normal refresh preserve the same QR after registration edits', async () => {
    await db().attendee.update({
      where: { id: people[0].id },
      data: { fullName: 'Updated ticket guest' },
    });
    const before = await db().ticket.findUnique({ where: { id: ticket.id } });
    ok(await api(`${base()}/${ticket.id}/regenerate`, { body: {} }));
    const after = await db().ticket.findUnique({ where: { id: ticket.id } });
    assert.equal(after.tokenHash, before.tokenHash);
    assert.equal(after.number, before.number);
    const token = await verifiedLogin();
    const pdf = await fetch(
      getOrigin() + `/api/v1/${base()}/${ticket.id}/pdf`,
      { headers: { Authorization: 'Bearer ' + token } },
    );
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('cache-control'), 'no-store');
    assert.ok(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 4)
        .equals(Buffer.from('%PDF')),
    );
    const html = await fetch(
      getOrigin() + `/api/v1/${base()}/${ticket.id}/html`,
      { headers: { Authorization: 'Bearer ' + token } },
    );
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Updated ticket guest/);
    // A fresh service instance recovers the credential from PostgreSQL, not HTTP/session memory.
    const { TicketsService } =
      await import('../dist/tickets/tickets.service.js');
    const { EventsService } = await import('../dist/events/events.service.js');
    const fresh = new TicketsService(db(), getApp().get(EventsService));
    assert.ok(
      (await fresh.getPdf(event.id, ticket.id, 1, 'super_admin', 1)).length >
        1000,
    );
  });
  test('legacy credential adoption requires an exact original QR and never rotates its identity', async () => {
    const raw = 'L'.repeat(43);
    const legacy = await db().ticket.create({
      data: {
        eventId: event.id,
        attendeeId: people[1].id,
        categoryId: cat.id,
        number: 'AAST-LEGACY-ADOPTION',
        tokenHash: digest(raw),
        expiresAt: new Date(event.endsAt),
      },
    });
    assert.equal((await api(`${base()}/${legacy.id}/pdf`)).status, 400);
    assert.equal(
      (
        await api(`${base()}/${legacy.id}/adopt`, {
          body: { qr: 'AAST1.' + 'W'.repeat(43), confirmed: true },
        })
      ).status,
      400,
    );
    ok(
      await api(`${base()}/${legacy.id}/adopt`, {
        body: { qr: 'AAST1.' + raw, confirmed: true },
      }),
    );
    assert.equal(
      (await db().ticket.findUnique({ where: { id: legacy.id } })).tokenHash,
      digest(raw),
    );
    assert.equal(
      unseal(
        (
          await db().ticketCredential.findUnique({
            where: { ticketId: legacy.id },
          })
        ).protectedToken,
      ),
      raw,
    );
    assert.equal(
      (
        await api(`events/7/tickets/${legacy.id}/adopt`, {
          body: { qr: 'AAST1.' + raw, confirmed: true },
        })
      ).status,
      404,
    );
  });
  test('cancellation/reactivation retain QR, permanent revocation cannot reactivate, and replacement is explicit', async () => {
    assert.equal(
      (
        await api(`${base()}/${ticket.id}/cancel`, {
          body: { confirmed: false, reason: 'test reason' },
        })
      ).status,
      400,
    );
    ok(await op(ticket.id, 'cancel'));
    assert.equal(
      (await db().ticket.findUnique({ where: { id: ticket.id } })).tokenHash,
      digest(original),
    );
    ok(await op(ticket.id, 'reactivate'));
    assert.equal(
      (await db().ticket.findUnique({ where: { id: ticket.id } })).tokenHash,
      digest(original),
    );
    ok(await op(ticket.id, 'replace'));
    const changed = await db().ticket.findUnique({ where: { id: ticket.id } });
    assert.notEqual(changed.tokenHash, digest(original));
    assert.equal(changed.number, ticket.number);
    ok(await op(ticket.id, 'revoke'));
    assert.equal((await op(ticket.id, 'reactivate')).status, 400);
    assert.equal((await op(ticket.id, 'replace')).status, 400);
    const history = await db().auditLog.findMany({
      where: { eventId: event.id, action: 'ticket.revoke' },
    });
    assert.match(history[0].details, /Integration ticket operation/);
  });
  test('concurrent distinct batches cannot exceed event or category allocations', async () => {
    for (const [capacity, allocation] of [
      [1, 10],
      [10, 1],
    ]) {
      const { e, p } = await setup(
        'Concurrent ticket allocation',
        capacity,
        allocation,
      );
      const results = await Promise.all(
        p
          .slice(0, 2)
          .map((person) =>
            api(`events/${e.id}/tickets/issue`, {
              body: { attendeeId: person.id, requestKey: randomUUID() },
            }),
          ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
      assert.equal(
        await db().ticket.count({ where: { eventId: e.id, status: 'Active' } }),
        1,
      );
    }
  });
  test('render and audit failures roll back tickets, encrypted credentials, receipts and issuance evidence', async () => {
    const { e, p } = await setup('Issuance rollback');
    const path = `events/${e.id}/tickets/batch-issue`;
    const { TicketsService } =
      await import('../dist/tickets/tickets.service.js');
    const service = getApp().get(TicketsService),
      render = service.render;
    let renders = 0;
    service.render = async function (...args) {
      if (++renders === 2) throw new Error('synthetic renderer failure');
      return render.apply(this, args);
    };
    try {
      assert.equal(
        (
          await api(path, {
            body: {
              attendeeIds: p.slice(0, 2).map((p) => p.id),
              requestKey: randomUUID(),
            },
          })
        ).status,
        500,
      );
    } finally {
      service.render = render;
    }
    assert.equal(await db().ticket.count({ where: { eventId: e.id } }), 0);
    await db().$executeRawUnsafe(
      `CREATE FUNCTION ticket_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ticket.issued' THEN RAISE EXCEPTION 'synthetic ticket audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db().$executeRawUnsafe(
      'CREATE TRIGGER ticket_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ticket_test_audit_failure()',
    );
    try {
      assert.equal(
        (
          await api(path, {
            body: { attendeeIds: [p[0].id], requestKey: randomUUID() },
          })
        ).status,
        500,
      );
    } finally {
      await db().$executeRawUnsafe(
        'DROP TRIGGER ticket_test_audit_failure ON audit_logs',
      );
      await db().$executeRawUnsafe('DROP FUNCTION ticket_test_audit_failure()');
    }
    assert.equal(await db().ticket.count({ where: { eventId: e.id } }), 0);
    assert.equal(
      await db().ticketCredential.count({
        where: { ticket: { eventId: e.id } },
      }),
      0,
    );
    assert.equal(
      await db().ticketIssueReceipt.count({ where: { eventId: e.id } }),
      0,
    );
    assert.equal(
      await db().auditLog.count({
        where: { eventId: e.id, action: 'ticket.issued' },
      }),
      0,
    );
  });
  test('used ticket lifecycle edits are denied and scanner accepts a recovered QR exactly once', async () => {
    const { ScannerService } =
      await import('../dist/scanner/scanner.service.js');
    const scanner = getApp().get(ScannerService);
    await db().eventAssignment.upsert({
      where: { userId_eventId: { userId: 2, eventId: event.id } },
      create: { userId: 2, eventId: event.id, organizationId: 1 },
      update: {},
    });
    const code = await scanner.createCode(
      event.id,
      'Tickets integration',
      [gate.id],
      [2],
      1,
      'super_admin',
      1,
    );
    const login = await scanner.login(
      'legacy_scanner',
      'a-new-scanner-password',
      code.code,
    );
    await scanner.switchEntrance(login.token, gate.id);
    const legacy = await db().ticket.findUnique({
      where: { number: 'AAST-LEGACY-ADOPTION' },
    });
    const scans = await Promise.all([
      scanner.scan(login.token, 'AAST1.' + 'L'.repeat(43)),
      scanner.scan(login.token, 'AAST1.' + 'L'.repeat(43)),
    ]);
    assert.equal(scans.filter((r) => r.accepted).length, 1);
    const before = await db().checkIn.findUnique({
      where: { ticketId: legacy.id },
    });
    for (const action of ['cancel', 'reactivate', 'replace', 'revoke'])
      assert.equal((await op(legacy.id, action)).status, 400);
    assert.deepEqual(
      await db().checkIn.findUnique({ where: { ticketId: legacy.id } }),
      before,
    );
  });
  test('cancelled registration, inactive gates, archives and stale credentials cannot bypass issuance/recovery checks', async () => {
    const { e, c, g, p } = await setup('Ticket rejection boundaries');
    const path = `events/${e.id}/tickets`;
    await db().attendee.update({
      where: { id: p[0].id },
      data: { status: 'Cancelled' },
    });
    assert.equal(
      (
        await api(path + '/issue', {
          body: { attendeeId: p[0].id, requestKey: randomUUID() },
        })
      ).status,
      400,
    );
    await db().entrance.update({
      where: { id: g.id },
      data: { active: false },
    });
    assert.equal(
      (
        await api(path + '/issue', {
          body: { attendeeId: p[1].id, requestKey: randomUUID() },
        })
      ).status,
      400,
    );
    await db().entrance.update({ where: { id: g.id }, data: { active: true } });
    const issued = ok(
      await api(path + '/issue', {
        body: { attendeeId: p[1].id, requestKey: randomUUID() },
      }),
    ).tickets[0];
    await db().ticketCredential.update({
      where: { ticketId: issued.id },
      data: { tokenHash: '0'.repeat(64) },
    });
    assert.equal((await api(path + `/${issued.id}/pdf`)).status, 409);
    await db().event.update({ where: { id: e.id }, data: { archived: true } });
    assert.equal(
      (
        await api(path + '/issue', {
          body: { attendeeId: p[2].id, requestKey: randomUUID() },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await api(path + `/${issued.id}/cancel`, {
          body: { confirmed: true, reason: 'Archive must deny' },
        })
      ).status,
      400,
    );
  });
}
