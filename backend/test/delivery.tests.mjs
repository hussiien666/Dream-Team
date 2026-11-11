import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { unseal } from '../dist/common/encryption.util.js';
import { EmailService } from '../dist/email/email.service.js';
import {
  ResendProvider,
  ProviderError,
} from '../dist/email/resend.provider.js';
export function registerDeliveryTests({
  test,
  adminRequest: api,
  request,
  getDb: db,
  getApp,
  getOrigin,
  verifiedLogin,
  eventInput,
}) {
  const ok = (r, status = 201) => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  };
  let e, c, s, g1, g2, t1, originalHash;
  const base = () => `events/${e.id}/tickets`;
  const enabled = () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.RESEND_API_KEY = 'synthetic-delivery-key';
    process.env.EMAIL_FROM = 'testing@example.com';
  };
  async function setup(name, automatic = false) {
    const event = ok(
      await api('events', { body: { ...eventInput, name, capacity: 20 } }),
    );
    const cat = ok(
      await api(`events/${event.id}/categories`, {
        body: { name: 'Guests', code: 'GUEST', allocation: 20 },
      }),
    );
    ok(
      await api(`events/${event.id}/entrances`, {
        body: {
          name: 'Delivery gate',
          code: 'DELIVERY',
          categoryIds: [cat.id],
        },
      }),
    );
    ok(
      await api(`events/${event.id}/settings`, {
        method: 'PATCH',
        body: {
          settings: {
            defaultCategoryId: cat.id,
            automaticTicketGeneration: automatic,
          },
        },
      }),
      200,
    );
    const student = ok(
      await api(`events/${event.id}/students`, {
        body: {
          studentId: 'DELIVERY1',
          fullName: 'Inviting student',
          email: 'sender@example.com',
        },
      }),
    );
    return { event, cat, student };
  }
  async function guest(event, student, name, email) {
    return api(`events/${event.id}/guests`, {
      body: {
        studentId: student.id,
        fullName: name,
        email,
        invitationGroup: 'Family',
      },
    });
  }
  async function isolate(jobId) {
    await db().backgroundJob.updateMany({
      where: { status: { in: ['Pending', 'Running'] }, id: { not: jobId } },
      data: { status: 'Failed', leaseUntil: null, leaseToken: '' },
    });
  }
  test('automatic guest issuance is opt-in, preserves atomic registration, and works with email disabled', async () => {
    const prev = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = 'false';
    try {
      const ctx = await setup('Automatic guests', true);
      const g = ok(
        await guest(
          ctx.event,
          ctx.student,
          'Automatic guest',
          'automatic@example.com',
        ),
      );
      const link = await db().guestInvitation.findUnique({
        where: { id: g.id },
      });
      assert.equal(
        await db().ticket.count({ where: { attendeeId: link.attendeeId } }),
        1,
      );
      assert.equal(
        await db().ticketDispatch.count({ where: { eventId: ctx.event.id } }),
        0,
      );
      await db().ticketCategory.update({
        where: { id: ctx.cat.id },
        data: { allocation: 1 },
      });
      assert.equal(
        (
          await guest(
            ctx.event,
            ctx.student,
            'Would exceed allocation',
            'blocked@example.com',
          )
        ).status,
        400,
      );
      assert.equal(
        await db().guestInvitation.count({ where: { eventId: ctx.event.id } }),
        1,
      );
    } finally {
      process.env.EMAIL_ENABLED = prev ?? 'false';
    }
  });
  test('group generation and concurrent retries atomically create private guest/student deliveries', async () => {
    enabled();
    const ctx = await setup('Group email delivery');
    e = ctx.event;
    c = ctx.cat;
    s = ctx.student;
    g1 = ok(await guest(e, s, 'Guest with email', 'guest@example.com'));
    g2 = ok(await guest(e, s, 'Guest via student', null));
    const key = randomUUID(),
      body = {
        studentId: s.id,
        invitationGroup: 'Family',
        confirmed: true,
        requestKey: key,
      };
    const pair = await Promise.all([
      api(base() + '/group-issue', { body }),
      api(base() + '/group-issue', { body }),
    ]);
    assert.deepEqual(ok(pair[0]), ok(pair[1]));
    assert.equal(pair[0].body.count, 2);
    const rows = await db().ticket.findMany({
      where: { eventId: e.id },
      orderBy: { id: 'asc' },
    });
    t1 = rows[0];
    originalHash = t1.tokenHash;
    const dispatches = await db().ticketDispatch.findMany({
      where: { eventId: e.id },
      include: { job: true },
    });
    assert.equal(dispatches.length, 3);
    for (const d of dispatches) {
      const message = JSON.parse(unseal(d.job.payload));
      assert.equal(message.to.length, 1);
      assert.equal(message.to[0], d.recipient);
      assert.equal(
        Buffer.from(message.attachments[0].content, 'base64')
          .subarray(0, 4)
          .toString(),
        '%PDF',
      );
      assert.ok(!d.job.payload.includes('AAST1.'));
    }
    assert.deepEqual(
      dispatches
        .filter((d) => d.ticketId === rows[1].id)
        .map((d) => d.recipient),
      ['sender@example.com'],
    );
    const foreign = await db().student.findFirst({
      where: { eventId: { not: e.id }, active: true },
    });
    if (foreign)
      assert.equal(
        (
          await api(base() + '/group-issue', {
            body: { ...body, requestKey: randomUUID(), studentId: foreign.id },
          })
        ).status,
        400,
      );
  });
  test('ticket delivery templates validate placeholders and previews/history omit protected credentials', async () => {
    const template = {
      subject: 'Ticket for {guest_name}',
      greeting: 'Hello {guest_name}',
      body: '<script>unsafe</script> {event_name}',
      signature: 'Dream Events',
      contact: 'Contact the organizer',
    };
    assert.equal(
      (
        await api(base() + '/delivery-settings', {
          method: 'PATCH',
          body: { ...template, subject: '{unknown}' },
        })
      ).status,
      400,
    );
    ok(
      await api(base() + '/delivery-settings', {
        method: 'PATCH',
        body: template,
      }),
      200,
    );
    const preview = ok(
      await api(base() + '/delivery-preview', { body: { ticketIds: [t1.id] } }),
    );
    assert.deepEqual(preview.rows[0].recipients, [
      'guest@example.com',
      'sender@example.com',
    ]);
    const value = ok(await api(base() + '/deliveries'), 200),
      text = JSON.stringify(value);
    assert.ok(!text.includes(originalHash));
    assert.ok(!text.includes('protectedToken'));
    assert.ok(!text.includes('payload'));
    const { AuthService } = await import('../dist/auth/auth.service.js');
    const login = await getApp()
      .get(AuthService)
      .login('test_manager', 'a-manager-test-password');
    assert.equal(
      (await request(base() + '/deliveries', { token: login.accessToken }))
        .status,
      403,
    );
  });
  test('explicit resend is reason-recorded and idempotent; pending attempts are never duplicated', async () => {
    const body = {
      ticketIds: [t1.id],
      requestKey: randomUUID(),
      confirmed: true,
      resend: true,
      reason: 'Intentional test resend',
    };
    assert.equal(ok(await api(base() + '/send-email', { body })).queued, 0);
    assert.equal(
      (
        await api(base() + '/send-email', {
          body: { ...body, requestKey: randomUUID(), reason: undefined },
        })
      ).status,
      400,
    );
    await db().backgroundJob.updateMany({
      where: { ticketDispatch: { is: { ticketId: t1.id } } },
      data: { status: 'Sent' },
    });
    const next = { ...body, requestKey: randomUUID() },
      pair = await Promise.all([
        api(base() + '/send-email', { body: next }),
        api(base() + '/send-email', { body: next }),
      ]);
    assert.deepEqual(ok(pair[0]), ok(pair[1]));
    assert.equal(pair[0].body.queued, 2);
    assert.equal(
      (await db().ticket.findUnique({ where: { id: t1.id } })).tokenHash,
      originalHash,
    );
    const latest = await db().ticketDispatch.findFirst({
        where: { ticketId: t1.id },
        orderBy: { jobId: 'desc' },
        include: { job: true },
      }),
      message = JSON.parse(unseal(latest.job.payload));
    assert.ok(message.html.includes('&lt;script&gt;'));
    assert.ok(!message.html.includes('<script>'));
    assert.equal(
      (
        await api(base() + '/send-email', {
          body: { ...next, ticketIds: [999999] },
        })
      ).status,
      409,
    );
  });
  test('worker rejects changed recipients before sending and creates durable administrator notices', async () => {
    const latest = await db().ticketDispatch.findFirst({
      where: { ticketId: t1.id },
      orderBy: { jobId: 'desc' },
    });
    await isolate(latest.jobId);
    await db().securityProfile.update({
      where: { userId: 1 },
      data: { email: 'admin-alert@example.com', emailVerified: true },
    });
    ok(
      await api(`events/${e.id}/guests/${g1.id}`, {
        method: 'PATCH',
        body: { email: 'changed@example.com' },
      }),
      200,
    );
    const provider = getApp().get(ResendProvider),
      saved = provider.send;
    let calls = 0;
    provider.send = async () => {
      calls++;
      throw new Error('No send expected');
    };
    try {
      await getApp().get(EmailService).tick();
    } finally {
      provider.send = saved;
    }
    assert.equal(calls, 0);
    assert.equal(
      (await db().backgroundJob.findUnique({ where: { id: latest.jobId } }))
        .status,
      'Failed',
    );
    assert.equal(
      await db().ticketMailNotice.count({ where: { jobId: latest.jobId } }),
      1,
    );
    assert.ok(
      await db().backgroundJob.count({
        where: {
          dedupeKey: { startsWith: 'resend:' },
          status: 'Pending',
          ticketDispatch: { is: null },
        },
      }),
    );
  });
  test('ticket worker retries durably with the same provider key and reconciles bounce notifications once', async () => {
    const result = ok(
      await api(base() + '/send-email', {
        body: {
          ticketIds: [t1.id],
          confirmed: true,
          resend: true,
          reason: 'Retry after recipient edit',
          requestKey: randomUUID(),
        },
      }),
    );
    assert.ok(result.queued > 0);
    const d = await db().ticketDispatch.findFirst({
      where: { ticketId: t1.id },
      orderBy: { jobId: 'desc' },
    });
    await isolate(d.jobId);
    const provider = getApp().get(ResendProvider),
      saved = provider.send,
      keys = [];
    provider.send = async (_, key) => {
      keys.push(key);
      if (keys.length === 1) throw new ProviderError(true, 'provider_503');
      return 'ticket-delivery-synthetic';
    };
    const email = getApp().get(EmailService),
      now = new Date();
    try {
      await email.tick(now);
      let job = await db().backgroundJob.findUnique({ where: { id: d.jobId } });
      assert.equal(job.status, 'Pending');
      assert.equal(+job.availableAt, +now + 60000);
      await email.tick(new Date(+now + 61000));
    } finally {
      provider.send = saved;
    }
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(
      (await db().mailDelivery.findUnique({ where: { jobId: d.jobId } }))
        .status,
      'Sent',
    );
    const notice = {
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: { email_id: 'ticket-delivery-synthetic' },
    };
    await email.webhook('ticket-bounce', notice);
    await email.webhook('ticket-bounce', notice);
    assert.equal(
      await db().ticketMailNotice.count({ where: { jobId: d.jobId } }),
      1,
    );
  });
  test('automatic issuance/outbox failure rolls registration, credentials and audits back together', async () => {
    enabled();
    const ctx = await setup('Registration outbox rollback', true);
    await db().$executeRawUnsafe(
      `CREATE FUNCTION delivery_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='email.queued' THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$`,
    );
    await db().$executeRawUnsafe(
      'CREATE TRIGGER delivery_test_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION delivery_test_failure()',
    );
    try {
      assert.equal(
        (
          await guest(
            ctx.event,
            ctx.student,
            'Rollback guest',
            'rollback@example.com',
          )
        ).status,
        500,
      );
    } finally {
      await db().$executeRawUnsafe(
        'DROP TRIGGER delivery_test_failure ON audit_logs',
      );
      await db().$executeRawUnsafe('DROP FUNCTION delivery_test_failure()');
    }
    assert.equal(
      await db().guestInvitation.count({ where: { eventId: ctx.event.id } }),
      0,
    );
    assert.equal(
      await db().ticket.count({ where: { eventId: ctx.event.id } }),
      0,
    );
    assert.equal(
      await db().backgroundJob.count({ where: { eventId: ctx.event.id } }),
      0,
    );
  });
  test('automatic Excel import commits tickets/outbox once and cancelled tickets never reach transport', async () => {
    enabled();
    const ctx = await setup('Automatic Excel delivery', true),
      token = await verifiedLogin(),
      wb = new ExcelJS.Workbook();
    wb.addWorksheet('Students').addRows([
      ['Student ID', 'Student name', 'Email', 'Phone'],
      ['DELIVERY1', 'Inviting student', 'sender@example.com', ''],
    ]);
    wb.addWorksheet('Guests').addRows([
      [
        'Student ID',
        'Guest name',
        'Guest email',
        'Guest phone',
        'Category',
        'Invitation group',
      ],
      ['DELIVERY1', 'Excel guest', 'excel@example.com', '', 'GUEST', 'Family'],
    ]);
    const buffer = await wb.xlsx.writeBuffer();
    async function upload(commit, fields = {}) {
      const f = new FormData();
      f.set('file', new Blob([buffer]), 'auto.xlsx');
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      const r = await fetch(
        getOrigin() +
          `/api/v1/events/${ctx.event.id}/registration-import/${commit ? 'commit' : 'preview'}`,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: f,
        },
      );
      return { status: r.status, body: await r.json() };
    }
    const preview = ok(await upload(false)),
      fields = {
        confirmed: 'true',
        previewHash: preview.previewHash,
        requestKey: randomUUID(),
      };
    const first = ok(await upload(true, fields));
    assert.deepEqual(ok(await upload(true, fields)), first);
    assert.equal(
      await db().ticket.count({ where: { eventId: ctx.event.id } }),
      1,
    );
    assert.equal(
      await db().ticketDispatch.count({ where: { eventId: ctx.event.id } }),
      2,
    );
    const dispatch = await db().ticketDispatch.findFirst({
      where: { eventId: ctx.event.id },
    });
    await isolate(dispatch.jobId);
    await db().ticket.update({
      where: { id: dispatch.ticketId },
      data: { status: 'Cancelled' },
    });
    const provider = getApp().get(ResendProvider),
      saved = provider.send;
    let calls = 0;
    provider.send = async () => {
      calls++;
      return 'not-expected';
    };
    try {
      await getApp().get(EmailService).tick();
    } finally {
      provider.send = saved;
    }
    assert.equal(calls, 0);
  });
}
