import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { digest } from '../dist/common/crypto.util.js';
export function registerStudentTests({
  test,
  adminRequest: api,
  request,
  getDb,
  getOrigin,
  verifiedLogin,
  getAuth,
  eventInput,
}) {
  let e, c, v, gate, s1, s2, g1, g2, active, used, uploadToken;
  const base = () => `events/${e.id}`;
  const ok = (r, status = 201) => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  };
  async function setup(name) {
    const event = ok(await api('events', { body: { ...eventInput, name } }));
    const cat = ok(
      await api(`events/${event.id}/categories`, {
        body: {
          name: 'Family',
          code: 'FAMILY',
          allocation: 25,
          maxPerAttendee: 3,
        },
      }),
    );
    ok(
      await api(`events/${event.id}/settings`, {
        method: 'PATCH',
        body: { settings: { defaultCategoryId: cat.id } },
      }),
      200,
    );
    return { event, cat };
  }
  async function book(students, guests) {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Students').addRows([
      ['Student ID', 'Student name', 'Email', 'Phone'],
      ...students,
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
      ...guests,
    ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  async function upload(eventId, buffer, commit = false, extra = {}) {
    const token = (uploadToken ??= await verifiedLogin());
    const f = new FormData();
    f.set('file', new Blob([buffer]), 'registration.xlsx');
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    const r = await fetch(
      getOrigin() +
        `/api/v1/events/${eventId}/registration-import/${commit ? 'commit' : 'preview'}`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: f,
      },
    );
    return { status: r.status, body: await r.json() };
  }
  test('student/guest APIs scope IDs, preserve legacy rows and validate strict payloads', async () => {
    ({ event: e, cat: c } = await setup('Students management'));
    v = ok(
      await api(base() + '/categories', {
        body: { name: 'VIP', code: 'VIP', allocation: 25, maxPerAttendee: 3 },
      }),
    );
    gate = ok(
      await api(base() + '/entrances', {
        body: {
          name: 'Registration gate',
          code: 'REG',
          categoryIds: [c.id, v.id],
        },
      }),
    );
    for (const data of [
      { studentId: '001', fullName: 'Sender', email: 'bad' },
      {
        studentId: '001',
        fullName: 'Sender',
        email: 'sender@example.com',
        active: true,
      },
      { studentId: '001', fullName: ' ', email: 'sender@example.com' },
    ])
      assert.equal(
        (await api(base() + '/students', { body: data })).status,
        400,
      );
    s1 = ok(
      await api(base() + '/students', {
        body: {
          studentId: '001',
          fullName: 'First sender',
          email: 'sender@example.com',
          phone: '00123456789',
        },
      }),
    );
    s2 = ok(
      await api(base() + '/students', {
        body: {
          studentId: '002',
          fullName: 'Second sender',
          email: 'sender@example.com',
        },
      }),
    );
    assert.equal(
      (
        await api(base() + '/students', {
          body: {
            studentId: '001',
            fullName: 'Duplicate',
            email: 'other@example.com',
          },
        })
      ).status,
      400,
    );
    assert.equal((await api(`events/7/students/${s1.id}`)).status, 404);
    const manager = await getAuth().login(
      'test_manager',
      'a-manager-test-password',
    );
    assert.equal(
      (await request(base() + '/students', { token: manager.accessToken }))
        .status,
      403,
    );
    const foreign = await getDb().organizationEvent.findFirst({
      where: { organizationId: { not: 1 } },
    });
    assert.equal((await api(`events/${foreign.eventId}/students`)).status, 403);
    assert.equal(
      (
        await api(base() + '/guests', {
          body: { studentId: s1.id, fullName: 'Bad category', categoryId: 3 },
        })
      ).status,
      400,
    );
    g1 = ok(
      await api(base() + '/guests', {
        body: {
          studentId: s1.id,
          fullName: 'First guest',
          email: 'shared@example.com',
          phone: '01012345678',
        },
      }),
    );
    g2 = ok(
      await api(base() + '/guests', {
        body: {
          studentId: s2.id,
          fullName: 'Other invitation',
          email: 'shared@example.com',
        },
      }),
    );
    const invites = await getDb().guestInvitation.findMany({
      where: { eventId: e.id },
      include: { attendee: true },
    });
    assert.equal(invites.length, 2);
    assert.ok(invites.every((g) => g.attendee.email === null));
    assert.equal(
      await getDb().guestInvitation.count({ where: { eventId: 7 } }),
      0,
    );
    assert.equal(
      (
        await api(base() + '/guests', {
          body: {
            studentId: s1.id,
            fullName: 'Duplicate email',
            email: 'SHARED@example.com',
          },
        })
      ).status,
      400,
    );
    ok(
      await api(base() + '/students/' + s1.id, {
        method: 'PATCH',
        body: { fullName: 'Updated sender' },
      }),
      200,
    );
    assert.equal(
      (await getDb().student.findUnique({ where: { id: s1.id } })).phone,
      '00123456789',
    );
    assert.equal(
      (
        await api(base() + '/guests/' + g1.id, {
          method: 'PATCH',
          body: { studentId: s2.id },
        })
      ).status,
      400,
    );
  });
  test('concurrent event/student/category quotas serialize and audited overrides require event management', async () => {
    const limits = {
      guestLimit: 3,
      perStudentLimit: 2,
      defaultCategoryId: c.id,
      categoryLimits: [{ categoryId: v.id, limit: 1 }],
    };
    ok(
      await api(base() + '/invitation-limits', {
        method: 'PATCH',
        body: limits,
      }),
      200,
    );
    const outcomes = await Promise.all(
      ['A', 'B'].map((n) =>
        api(base() + '/guests', {
          body: { studentId: s1.id, fullName: 'Race ' + n, categoryId: v.id },
        }),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === 201).length, 1);
    assert.equal(outcomes.filter((r) => r.status === 400).length, 1);
    assert.equal(
      (
        await api(base() + '/guests', {
          body: { studentId: s2.id, fullName: 'Event overflow' },
        })
      ).status,
      400,
    );
    ok(
      await api(base() + '/guests', {
        body: {
          studentId: s2.id,
          fullName: 'Authorized exception',
          overrideReason: 'Approved additional invitation',
        },
      }),
    );
    assert.ok(
      await getDb().auditLog.findFirst({
        where: {
          eventId: e.id,
          action: 'registration.saved',
          details: { contains: 'Approved additional invitation' },
        },
      }),
    );
    const user = ok(
      await api('users', {
        body: {
          username: 'registration_ticket_manager',
          displayName: 'Registration operator',
          password: 'a-registration-test-password',
          orgRole: 'ticket_manager',
          eventId: e.id,
        },
      }),
    );
    const login = await getAuth().login(
      'registration_ticket_manager',
      'a-registration-test-password',
    );
    assert.equal(
      (
        await request(base() + '/guests', {
          token: login.accessToken,
          body: {
            studentId: s2.id,
            fullName: 'Unauthorized exception',
            overrideReason: 'Trying to bypass invitation quota',
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(base() + '/invitation-limits', {
          token: login.accessToken,
          method: 'PATCH',
          body: limits,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api(base() + '/settings', {
          method: 'PATCH',
          body: { settings: { guestLimit: 1 } },
        })
      ).status,
      400,
    );
    ok(
      await api(base() + '/invitation-limits', {
        method: 'PATCH',
        body: {
          ...limits,
          guestLimit: 20,
          perStudentLimit: 10,
          categoryLimits: [],
        },
      }),
      200,
    );
  });
  test('category edits keep unused QR identity and independently preserve used categories/admission evidence', async () => {
    const db = getDb(),
      g = await db.guestInvitation.findUnique({ where: { id: g1.id } });
    active = await db.ticket.create({
      data: {
        eventId: e.id,
        attendeeId: g.attendeeId,
        categoryId: c.id,
        number: 'STUDENT-ACTIVE',
        tokenHash: digest('q'.repeat(43)),
        expiresAt: new Date('2034-01-02T18:00Z'),
      },
    });
    used = await db.ticket.create({
      data: {
        eventId: e.id,
        attendeeId: g.attendeeId,
        categoryId: c.id,
        number: 'STUDENT-USED',
        tokenHash: digest('r'.repeat(43)),
        status: 'Used',
        expiresAt: new Date('2034-01-02T18:00Z'),
        checkIn: { create: { eventId: e.id, entranceId: gate.id, staffId: 1 } },
      },
    });
    const history = await db.checkIn.findUnique({
      where: { ticketId: used.id },
    });
    ok(
      await api(base() + '/guests/' + g1.id, {
        method: 'PATCH',
        body: { categoryId: v.id, fullName: 'Updated first guest' },
      }),
      200,
    );
    const a = await db.ticket.findUnique({ where: { id: active.id } }),
      u = await db.ticket.findUnique({ where: { id: used.id } });
    assert.equal(a.tokenHash, active.tokenHash);
    assert.equal(a.number, active.number);
    assert.equal(a.categoryId, v.id);
    assert.equal(u.categoryId, c.id);
    assert.equal(u.status, 'Used');
    assert.deepEqual(
      await db.checkIn.findUnique({ where: { ticketId: used.id } }),
      history,
    );
    await assert.rejects(
      db.$executeRaw`UPDATE tickets SET category_id=3 WHERE id=${active.id}`,
    );
    await assert.rejects(
      db.$executeRaw`UPDATE tickets SET attendee_id=9 WHERE id=${active.id}`,
    );
    assert.equal(
      (
        await api(base() + `/attendees/${g.attendeeId}`, {
          method: 'PATCH',
          body: { fullName: 'Bypass' },
        })
      ).status,
      400,
    );
  });
  test('student cancellation confirms current affected counts and preserves used tickets/check-ins', async () => {
    const db = getDb();
    const impact = ok(
      await api(base() + `/students/${s1.id}/cancellation-impact`),
      200,
    );
    assert.equal(impact.guestCount, 2);
    assert.equal(
      (
        await api(base() + `/students/${s1.id}`, {
          method: 'DELETE',
          body: {
            confirmed: true,
            reason: 'Cancelled by organizer',
            expectedGuestCount: 0,
          },
        })
      ).status,
      409,
    );
    ok(
      await api(base() + `/students/${s1.id}`, {
        method: 'DELETE',
        body: {
          confirmed: true,
          reason: 'Cancelled by organizer',
          expectedGuestCount: impact.guestCount,
        },
      }),
      200,
    );
    assert.equal(
      (await db.ticket.findUnique({ where: { id: active.id } })).status,
      'Cancelled',
    );
    assert.equal(
      (await db.ticket.findUnique({ where: { id: used.id } })).status,
      'Used',
    );
    assert.ok(await db.checkIn.findUnique({ where: { ticketId: used.id } }));
    assert.equal(
      (
        await api(base() + '/students/' + s1.id, {
          method: 'PATCH',
          body: { fullName: 'Reactivate' },
        })
      ).status,
      400,
    );
    const input = await book(
      [['001', 'Attempted revival', 'sender@example.com', '']],
      [],
    );
    const preview = ok(await upload(e.id, input));
    assert.ok(preview.errors.some((e) => e.message.includes('cancelled')));
    assert.equal(
      (await db.student.findUnique({ where: { id: s1.id } })).active,
      false,
    );
  });
  test('all seven custom-field types validate manual input, enforce required answers and retain inactive values', async () => {
    const { event, cat } = await setup('Custom fields');
    const b = `events/${event.id}`;
    const specs = [
      ['department', 'text'],
      ['age', 'number'],
      ['contact', 'email'],
      ['mobile', 'phone'],
      ['birthday', 'date'],
      ['degree', 'dropdown'],
      ['consent', 'checkbox'],
    ];
    const fields = [];
    for (const [key, type] of specs)
      fields.push(
        ok(
          await api(b + '/registration-fields', {
            body: {
              target: 'student',
              key,
              label: key,
              type,
              required: true,
              options: type === 'dropdown' ? ['BSc', 'MSc'] : [],
            },
          }),
        ),
      );
    assert.equal(
      (
        await api(b + '/students', {
          body: {
            studentId: '001',
            fullName: 'Custom sender',
            email: 'c@example.com',
          },
        })
      ).status,
      400,
    );
    const answers = {
      department: 'Computing',
      age: 22,
      contact: 'contact@example.com',
      mobile: '00123456789',
      birthday: '2004-02-29',
      degree: 'BSc',
      consent: false,
    };
    for (const invalid of [
      { age: '22' },
      { birthday: '2004-02-30' },
      { degree: 'Unknown' },
      { consent: 'yes' },
      { unknown: 'bad' },
    ])
      assert.equal(
        (
          await api(b + '/students', {
            body: {
              studentId: '001',
              fullName: 'Custom sender',
              email: 'c@example.com',
              customValues: { ...answers, ...invalid },
            },
          })
        ).status,
        400,
      );
    const s = ok(
      await api(b + '/students', {
        body: {
          studentId: '001',
          fullName: 'Custom sender',
          email: 'c@example.com',
          customValues: answers,
        },
      }),
    );
    ok(
      await api(b + '/registration-fields/' + fields[0].id, {
        method: 'DELETE',
      }),
      200,
    );
    ok(
      await api(b + '/students/' + s.id, {
        method: 'PATCH',
        body: { fullName: 'Updated custom sender', customValues: { age: 23 } },
      }),
      200,
    );
    const found = await getDb().student.findUnique({ where: { id: s.id } });
    assert.equal(found.customValues.department, 'Computing');
    assert.equal(found.customValues.age, 23);
    const copy = ok(await api(b + '/duplicate', { method: 'POST' }));
    assert.equal(
      await getDb().registrationField.count({ where: { eventId: copy.id } }),
      7,
    );
    assert.equal(
      await getDb().student.count({ where: { eventId: copy.id } }),
      0,
    );
  });
  test('two-sheet Excel template round-trips text IDs/phones, source rows and idempotent import receipts', async () => {
    const { event, cat } = await setup('Excel roundtrip');
    const token = await verifiedLogin();
    const r = await fetch(
      getOrigin() + `/api/v1/events/${event.id}/registration-template`,
      { headers: { Authorization: 'Bearer ' + token } },
    );
    assert.equal(r.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
    assert.deepEqual(
      wb.worksheets.map((s) => s.name),
      ['Students', 'Guests'],
    );
    assert.equal(wb.getWorksheet('Students').getColumn(1).numFmt, '@');
    wb.getWorksheet('Students').getRow(2).values = [
      '00001',
      'Excel sender',
      'excel@example.com',
      '00123456789',
    ];
    wb.getWorksheet('Guests').getRow(4).values = [
      '00001',
      'Excel guest',
      'guest@example.com',
      '00111111111',
      'FAMILY',
      'Friends',
    ];
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = ok(await upload(event.id, file));
    assert.equal(preview.errors.length, 0, JSON.stringify(preview.errors));
    assert.equal(preview.guests[0].row, 4);
    assert.equal(
      await getDb().student.count({ where: { eventId: event.id } }),
      0,
    );
    const body = {
      previewHash: preview.previewHash,
      requestKey: 'excel-roundtrip-request',
      confirmed: 'true',
    };
    const committed = ok(await upload(event.id, file, true, body));
    assert.equal(committed.counts.newGuests, 1);
    const retry = ok(await upload(event.id, file, true, body));
    assert.deepEqual(retry, committed);
    assert.equal(
      await getDb().registrationImport.count({ where: { eventId: event.id } }),
      1,
    );
    const student = await getDb().student.findFirst({
      where: { eventId: event.id },
    });
    assert.equal(student.studentId, '00001');
    assert.equal(student.phone, '00123456789');
    const guest = await getDb().guestInvitation.findFirst({
      where: { eventId: event.id },
      include: { attendee: true },
    });
    assert.equal(guest.attendee.phone, '00111111111');
    const vip = ok(
      await api(`events/${event.id}/categories`, {
        body: { name: 'VIP', code: 'VIP', allocation: 25, maxPerAttendee: 3 },
      }),
    );
    const importGate = ok(
      await api(`events/${event.id}/entrances`, {
        body: {
          name: 'Import gate',
          code: 'IMPORT',
          categoryIds: [cat.id, vip.id],
        },
      }),
    );
    const original = await getDb().ticket.create({
      data: {
        eventId: event.id,
        attendeeId: guest.attendeeId,
        categoryId: cat.id,
        number: 'IMPORT-ACTIVE',
        tokenHash: digest('import-active'),
        expiresAt: new Date(event.endsAt),
      },
    });
    const historic = await getDb().ticket.create({
      data: {
        eventId: event.id,
        attendeeId: guest.attendeeId,
        categoryId: cat.id,
        number: 'IMPORT-USED',
        tokenHash: digest('import-used'),
        status: 'Used',
        expiresAt: new Date(event.endsAt),
        checkIn: {
          create: { eventId: event.id, entranceId: importGate.id, staffId: 1 },
        },
      },
    });
    const changed = await book(
      [['00001', 'Updated Excel sender', 'updated@example.com', '00123456789']],
      [
        [
          '00001',
          'Updated Excel guest',
          'GUEST@example.com',
          '00111111111',
          'VIP',
          'Friends',
        ],
      ],
    );
    const next = ok(await upload(event.id, changed));
    assert.equal(next.counts.updatedStudents, 1);
    assert.equal(next.counts.updatedGuests, 1);
    ok(
      await upload(event.id, changed, true, {
        previewHash: next.previewHash,
        requestKey: 'excel-update-request',
        confirmed: 'true',
      }),
    );
    assert.equal(
      await getDb().guestInvitation.count({ where: { eventId: event.id } }),
      1,
    );
    assert.equal(
      (await getDb().guestInvitation.findUnique({ where: { id: guest.id } }))
        .attendeeId,
      guest.attendeeId,
    );
    const current = await getDb().ticket.findUnique({
      where: { id: original.id },
    });
    assert.equal(current.categoryId, vip.id);
    assert.equal(current.tokenHash, original.tokenHash);
    assert.equal(
      (await getDb().ticket.findUnique({ where: { id: historic.id } }))
        .categoryId,
      cat.id,
    );
  });
  test('Excel preview rejects duplicate rows, invalid references, formulas and numeric IDs without partial saves', async () => {
    const { event } = await setup('Excel errors');
    const file = await book(
      [
        ['00001', 'Sender', 's@example.com', ''],
        ['00001', 'Duplicate', 'other@example.com', ''],
      ],
      [
        ['missing', 'Orphan', '', '', '', ''],
        ['00001', { formula: '1+1', result: 2 }, '', '', '', ''],
      ],
    );
    const preview = ok(await upload(event.id, file));
    assert.ok(preview.errors.some((e) => e.message.includes('Duplicate')));
    assert.ok(preview.errors.some((e) => e.message.includes('Student ID')));
    assert.ok(preview.errors.some((e) => e.message.includes('Formulas')));
    assert.equal(
      (
        await upload(event.id, file, true, {
          previewHash: preview.previewHash,
          requestKey: 'invalid-import-request',
          confirmed: 'true',
        })
      ).status,
      400,
    );
    assert.equal(
      await getDb().student.count({ where: { eventId: event.id } }),
      0,
    );
    const numeric = ok(
      await upload(
        event.id,
        await book([[123, 'Number ID', 'n@example.com', '']], []),
      ),
    );
    assert.ok(numeric.errors.some((e) => e.message.includes('Text')));
    const bad = await upload(event.id, Buffer.from('not excel'));
    assert.equal(bad.status, 400);
  });
  test('import commit detects stale previews, transaction failures roll back every row, and concurrent retries commit once', async () => {
    const { event } = await setup('Import integrity');
    const file = await book(
      [['001', 'Transaction sender', 't@example.com', '']],
      [['001', 'Transaction guest', '', '', '', '']],
    );
    let preview = ok(await upload(event.id, file));
    ok(
      await api(`events/${event.id}/students`, {
        body: {
          studentId: 'other',
          fullName: 'Other sender',
          email: 'o@example.com',
        },
      }),
    );
    assert.equal(
      (
        await upload(event.id, file, true, {
          previewHash: preview.previewHash,
          requestKey: 'stale-import-request',
          confirmed: 'true',
        })
      ).status,
      409,
    );
    const db = getDb();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION reject_registration_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='registration.imported' THEN RAISE EXCEPTION 'Injected failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER reject_registration_import BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_registration_import()`,
    );
    preview = ok(await upload(event.id, file));
    const body = {
      previewHash: preview.previewHash,
      requestKey: 'rollback-import-request',
      confirmed: 'true',
    };
    try {
      assert.equal((await upload(event.id, file, true, body)).status, 500);
      assert.equal(
        await db.student.count({
          where: { eventId: event.id, studentId: '001' },
        }),
        0,
      );
      assert.equal(
        await db.guestInvitation.count({ where: { eventId: event.id } }),
        0,
      );
      assert.equal(
        await db.registrationImport.count({ where: { eventId: event.id } }),
        0,
      );
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER reject_registration_import ON audit_logs',
      );
      await db.$executeRawUnsafe('DROP FUNCTION reject_registration_import()');
    }
    const results = await Promise.all([
      upload(event.id, file, true, body),
      upload(event.id, file, true, body),
    ]);
    results.forEach((r) => ok(r));
    assert.deepEqual(results[0].body, results[1].body);
    assert.equal(
      await db.registrationImport.count({ where: { eventId: event.id } }),
      1,
    );
  });
  test('archived events reject registration, field, limit and import writes', async () => {
    const { event, cat } = await setup('Archived registration');
    const b = `events/${event.id}`;
    const s = ok(
      await api(b + '/students', {
        body: {
          studentId: '001',
          fullName: 'Archived sender',
          email: 'a@example.com',
        },
      }),
    );
    ok(await api(b, { method: 'PATCH', body: { status: 'Completed' } }), 200);
    ok(await api(b + '/archive', { method: 'POST' }), 204);
    for (const [path, method, body] of [
      [
        b + '/students',
        'POST',
        { studentId: '002', fullName: 'No', email: 'no@example.com' },
      ],
      [b + '/students/' + s.id, 'PATCH', { fullName: 'No edit' }],
      [
        b + '/registration-fields',
        'POST',
        { target: 'student', key: 'new', label: 'New', type: 'text' },
      ],
      [
        b + '/invitation-limits',
        'PATCH',
        { guestLimit: 10, perStudentLimit: 2, defaultCategoryId: cat.id },
      ],
    ])
      assert.equal((await api(path, { method, body })).status, 400, path);
    assert.equal(
      (
        await upload(
          event.id,
          await book([['002', 'Archived import', 'a@example.com', '']], []),
        )
      ).status,
      400,
    );
    assert.equal((await api(b + '/students')).status, 200);
  });
  test('name/phone matching is scoped to the sender and cancelled guests never reactivate', async () => {
    const { event } = await setup('Guest fallback matches');
    const b = `events/${event.id}`;
    const s = ok(
      await api(b + '/students', {
        body: {
          studentId: 'A',
          fullName: 'Fallback sender',
          email: 'f@example.com',
        },
      }),
    );
    const g = ok(
      await api(b + '/guests', {
        body: {
          studentId: s.id,
          fullName: 'Fallback guest',
          phone: '01012345678',
        },
      }),
    );
    assert.equal(
      (
        await api(b + '/guests', {
          body: {
            studentId: s.id,
            fullName: 'fallback  guest',
            phone: '010-1234-5678',
          },
        })
      ).status,
      400,
    );
    const file = await book(
      [],
      [['A', 'FALLBACK GUEST', '', '01012345678', 'FAMILY', 'Friends']],
    );
    const preview = ok(await upload(event.id, file));
    assert.equal(preview.counts.updatedGuests, 1);
    assert.equal(preview.counts.newGuests, 0);
    ok(
      await api(b + `/guests/${g.id}/cancel`, {
        body: { confirmed: true, reason: 'Guest requested cancellation' },
      }),
      200,
    );
    const cancelled = ok(await upload(event.id, file));
    assert.ok(cancelled.errors.some((e) => e.message.includes('cancelled')));
    assert.equal(
      (await getDb().guestInvitation.findUnique({ where: { id: g.id } }))
        .active,
      false,
    );
  });
  test('each quota independently prevents simultaneous registrations from exceeding its limit', async () => {
    for (const kind of ['event', 'student', 'category']) {
      const { event, cat } = await setup('Concurrent ' + kind);
      const b = `events/${event.id}`;
      const sender = ok(
        await api(b + '/students', {
          body: {
            studentId: 'A',
            fullName: 'Race sender',
            email: 'r@example.com',
          },
        }),
      );
      ok(
        await api(b + '/invitation-limits', {
          method: 'PATCH',
          body: {
            guestLimit: kind === 'event' ? 1 : 10,
            perStudentLimit: kind === 'student' ? 1 : 10,
            categoryLimits:
              kind === 'category' ? [{ categoryId: cat.id, limit: 1 }] : [],
            defaultCategoryId: cat.id,
          },
        }),
        200,
      );
      const results = await Promise.all(
        ['A', 'B'].map((name) =>
          api(b + '/guests', {
            body: { studentId: sender.id, fullName: name },
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 400], kind);
      assert.equal(
        await getDb().guestInvitation.count({ where: { eventId: event.id } }),
        1,
      );
    }
  });
  test('Excel validates required custom types and bounds compressed archive expansion', async () => {
    const { event } = await setup('Excel custom bounds');
    const b = `events/${event.id}`;
    for (const [key, type, options] of [
      ['age', 'number', []],
      ['degree', 'dropdown', ['BSc', 'MSc']],
      ['consent', 'checkbox', []],
    ])
      ok(
        await api(b + '/registration-fields', {
          body: {
            target: 'student',
            key,
            label: key,
            type,
            required: true,
            options,
          },
        }),
      );
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Students').addRows([
      [
        'Student ID',
        'Student name',
        'Email',
        'Field: age',
        'Field: degree',
        'Field: consent',
      ],
      ['0001', 'Excel custom', 'e@example.com', 22, 'BSc', 'FALSE'],
    ]);
    wb.addWorksheet('Guests').addRow(['Student ID', 'Guest name']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const good = ok(await upload(event.id, buffer));
    assert.equal(good.errors.length, 0, JSON.stringify(good.errors));
    wb.getWorksheet('Students').getCell('D2').value = 'twenty';
    const bad = ok(
      await upload(event.id, Buffer.from(await wb.xlsx.writeBuffer())),
    );
    assert.ok(
      bad.errors.some((e) => e.row === 2 && e.message.includes('number')),
    );
    const oversized = Buffer.from(buffer);
    let eocd = -1;
    for (let i = oversized.length - 22; i >= 0; i--)
      if (oversized.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    const central = oversized.readUInt32LE(eocd + 16);
    oversized.writeUInt32LE(31 * 1024 * 1024, central + 24);
    assert.equal((await upload(event.id, oversized)).status, 400);
  });
}
