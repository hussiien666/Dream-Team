import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { defaultDesign } from '../dist/tickets/ticket-engine/design.js';
import { visualRuns } from '../dist/tickets/ticket-engine/pdf.util.js';
import { digest } from '../dist/common/crypto.util.js';
import {generateQrPng} from '../dist/tickets/ticket-engine/qr.util.js';
export function registerTemplateTests({
  test,
  adminRequest: api,
  request,
  getDb: db,
  getOrigin,
  verifiedLogin,
  eventInput,
  getApp,
}) {
  let e, c, p, t, template, token;
  const base = () => `events/${e.id}/ticket-templates`;
  const ok = (r, status = 201) => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  };
  async function bytes(route, body) {
    token ??= await verifiedLogin();
    return fetch(getOrigin() + '/api/v1/' + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  test('template CRUD is organization scoped, strictly validated and requires ticket permission', async () => {
    e = ok(
      await api('events', { body: { ...eventInput, name: 'Templates event' } }),
    );
    c = ok(
      await api(`events/${e.id}/categories`, {
        body: { name: 'Guests', code: 'G', allocation: 10 },
      }),
    );
    ok(
      await api(`events/${e.id}/entrances`, {
        body: { name: 'Arabic gate', code: 'A', categoryIds: [c.id] },
      }),
    );
    p = await db().attendee.create({
      data: {
        eventId: e.id,
        categoryId: c.id,
        fullName: 'أحمد محمد علي / Ahmed',
        email: 'arabic@example.com',
      },
    });
    for (const config of [
      { ...defaultDesign, primaryColor: 'red;script' },
      { ...defaultDesign, fields: ['unknown'] },
      { ...defaultDesign, logo: 'data:image/svg+xml;base64,AAAA' },
      { ...defaultDesign, logo: 'data:image/png;base64,AAAA' },
    ])
      assert.equal(
        (await api(base(), { body: { name: 'Invalid', config } })).status,
        400,
      );
    template = ok(
      await api(base(), {
        body: {
          name: 'University',
          config: {
            ...defaultDesign,
            layout: 'banner',
            heading: 'مرحبا بكم',
            footer: 'Private ticket',
            fields: ['date', 'venue', 'student', 'category', 'number'],
          },
        },
      }),
    );
    assert.equal(
      (
        await api(base(), {
          body: { name: 'University', config: defaultDesign },
        })
      ).status,
      400,
    );
    const org = await db().organization.create({
        data: { name: 'Foreign templates' },
      }),
      foreign = await db().ticketTemplate.create({
        data: {
          organizationId: org.id,
          name: 'Foreign',
          config: defaultDesign,
        },
      });
    assert.equal(
      (await api(base() + '/apply', { body: { templateId: foreign.id } }))
        .status,
      404,
    );
    assert.equal(
      (
        await api(base() + '/' + foreign.id, {
          method: 'PATCH',
          body: { name: 'Stolen', config: defaultDesign },
        })
      ).status,
      404,
    );
    const { AuthService } = await import('../dist/auth/auth.service.js');
    const manager = await getApp()
      .get(AuthService)
      .login('test_manager', 'a-manager-test-password');
    assert.equal(
      (await request(base(), { token: manager.accessToken })).status,
      403,
    );
    const library = ok(await api(base()), 200);
    assert.equal(library.templates.length, 1);
    assert.equal(library.templates[0].id, template.id);
  });
  test('applying and duplicating designs preserves QR identities and freezes event snapshots against later library changes', async () => {
    ok(await api(base() + '/apply', { body: { templateId: template.id } }));
    t = ok(
      await api(`events/${e.id}/tickets/issue`, {
        body: { attendeeId: p.id, requestKey: randomUUID() },
      }),
    ).tickets[0];
    const before = await db().ticket.findUnique({ where: { id: t.id } });
    ok(
      await api(base() + '/' + template.id, {
        method: 'PATCH',
        body: {
          name: 'Renamed template',
          config: { ...template.config, heading: 'Changed library heading' },
        },
      }),
      200,
    );
    assert.equal(ok(await api(base()), 200).applied.heading, 'مرحبا بكم');
    const clone = ok(
      await api(base() + '/' + template.id + '/duplicate', {
        body: { name: 'Template copy' },
      }),
    );
    assert.notEqual(clone.id, template.id);
    const eventCopy = ok(await api(`events/${e.id}/duplicate`, { body: {} }));
    assert.equal(
      JSON.parse(
        (
          await db().eventSetting.findUnique({
            where: {
              eventId_key: { eventId: eventCopy.id, key: 'ticket-design.v1' },
            },
          })
        ).value,
      ).config.heading,
      'مرحبا بكم',
    );
    ok(
      await api(base() + '/' + template.id, {
        method: 'DELETE',
        body: { confirmed: true },
      }),
      200,
    );
    assert.equal(ok(await api(base()), 200).applied.heading, 'مرحبا بكم');
    assert.equal(
      (await db().ticket.findUnique({ where: { id: t.id } })).tokenHash,
      before.tokenHash,
    );
    const html = await bytes(`events/${e.id}/tickets/${t.id}/html`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /مرحبا بكم/);
    const pdf = await bytes(`events/${e.id}/tickets/${t.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.ok(
      (await PDFDocument.load(await pdf.arrayBuffer())).getPageCount() >= 1,
    );
    assert.deepEqual(
      visualRuns('AAST أحمد')
        .map((s) => s.trim())
        .filter(Boolean),
      ['AAST', 'أحمد'],
    );
  });
  test('template previews are private, escape custom text and cannot admit guests', async () => {
    const config = {
      ...defaultDesign,
      heading: '<script>alert(1)</script>',
      footer: 'Safe preview',
    };
    const html = await bytes(base() + '/preview/html', { config });
    assert.equal(html.status, 201);
    assert.equal(html.headers.get('cache-control'), 'no-store');
    const value = await html.text();
    assert.ok(!value.includes('<script>'));
    assert.ok(value.includes('&lt;script&gt;'));
    assert.ok(value.includes('PREVIEW - NOT VALID FOR ENTRY'));
    const pdf = await bytes(base() + '/preview/pdf', { config: defaultDesign });
    assert.equal(pdf.status, 201);
    assert.ok(
      (await PDFDocument.load(await pdf.arrayBuffer())).getPageCount() >= 1,
    );
    assert.equal(await db().ticket.count({ where: { eventId: e.id } }), 1);
    assert.equal(
      await db().ticket.count({ where: { tokenHash: digest('PREVIEW-ONLY') } }),
      0,
    );
  });
  test('ZIP download round-trips PDF/HTML with external ZIP reader and rejects foreign, duplicate and hash-only records', async () => {
    const zip = await bytes(`events/${e.id}/tickets/download-zip`, {
      ticketIds: [t.id],
    });
    assert.equal(zip.status, 201);
    assert.equal(zip.headers.get('cache-control'), 'no-store');
    const archive = await JSZip.loadAsync(await zip.arrayBuffer(), {
      checkCRC32: true,
    });
    const names = Object.keys(archive.files);
    assert.equal(names.length, 2);
    const pdfName = names.find((n) => n.endsWith('.pdf')),
      htmlName = names.find((n) => n.endsWith('.html'));
    assert.ok(
      (await archive.file(pdfName).async('nodebuffer'))
        .subarray(0, 4)
        .equals(Buffer.from('%PDF')),
    );
    assert.match(await archive.file(htmlName).async('string'), /أحمد محمد علي/);
    for (const ticketIds of [[t.id, t.id], [999999], Array(51).fill(t.id)])
      assert.ok(
        [400, 404].includes(
          (await bytes(`events/${e.id}/tickets/download-zip`, { ticketIds }))
            .status,
        ),
      );
    const legacy = await db().ticket.create({
      data: {
        eventId: e.id,
        attendeeId: p.id,
        categoryId: c.id,
        number: 'AAST-ZIP-HASH-ONLY',
        tokenHash: digest('template-hash-only-'+randomUUID()),
        expiresAt: new Date(e.endsAt),
      },
    });
    assert.equal(
      (
        await bytes(`events/${e.id}/tickets/download-zip`, {
          ticketIds: [t.id, legacy.id],
        })
      ).status,
      400,
    );
  });
  test('archived events reject template mutations while applied ticket downloads remain readable', async () => {
    await db().event.update({ where: { id: e.id }, data: { archived: true } });
    assert.equal(
      (
        await api(base(), {
          body: { name: 'Archived create', config: defaultDesign },
        })
      ).status,
      400,
    );
    assert.equal(
      (await api(base() + '/apply', { body: { templateId: null } })).status,
      400,
    );
    assert.equal(
      (await bytes(`events/${e.id}/tickets/${t.id}/pdf`)).status,
      200,
    );
  });
  test('template image payloads above the old JSON limit are bounded and parsed safely',async()=>{
    const png=await generateQrPng('PREVIEW-ONLY'),image=Buffer.concat([png,Buffer.alloc(110000)]);
    const config={...defaultDesign,logo:'data:image/png;base64,'+image.toString('base64')};
    const preview=await bytes(base()+'/preview/pdf',{config});assert.equal(preview.status,201);
    assert.ok((await PDFDocument.load(await preview.arrayBuffer())).getPageCount()>=1);
    const oversized={...defaultDesign,background:'data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(270000)]).toString('base64')};
    assert.equal((await bytes(base()+'/preview/pdf',{config:oversized})).status,400);
  });
}
