import assert from 'node:assert/strict';

export function registerReportTests({ test, adminRequest, getAuth, getDb, getOrigin, verifiedLogin, eventInput }) {
  test('organization audit preserves immutable ownership, excludes other organizations and pages safely',async()=>{
    const db=getDb(),token=await verifiedLogin(),headers={Authorization:`Bearer ${token}`},base=getOrigin()+'/api/v1/organization/audit';
    const created=await adminRequest('events',{body:{...eventInput,name:'Organization audit ownership'}});assert.equal(created.status,201);
    const eventId=created.body.id,owner=await db.organizationEvent.findUniqueOrThrow({where:{eventId}});
    const row=await db.auditLog.create({data:{eventId,action:'audit.scope.test',details:'=2+2'}});
    assert.equal((await db.auditOrganizationScope.findUniqueOrThrow({where:{auditLogId:row.id}})).organizationId,owner.organizationId);
    await assert.rejects(db.$executeRaw`UPDATE audit_organization_scopes SET organization_id=${owner.organizationId} WHERE audit_log_id=${row.id}`);
    await assert.rejects(db.$executeRaw`DELETE FROM audit_organization_scopes WHERE audit_log_id=${row.id}`);
    const other=await db.organization.create({data:{name:'Separate audit organization'}});
    const outsiderEvent=await db.event.create({data:{name:'Other audit event',eventDate:new Date('2030-01-01'),startsAt:new Date('2030-01-01T10:00:00Z'),endsAt:new Date('2030-01-01T12:00:00Z'),timezone:'UTC',venue:'Other',capacity:10,maxTickets:10}});
    await db.organizationEvent.create({data:{eventId:outsiderEvent.id,organizationId:other.id}});
    const outsider=await db.auditLog.create({data:{eventId:outsiderEvent.id,action:'other.organization.private',details:'Must stay isolated'}});
    const unknown=await db.auditLog.create({data:{eventId:2147483600,action:'unknown.historical.owner',details:'Retained but unscoped'}});
    // Ownership is historical evidence, independent of the current event ownership row.
    await db.organizationEvent.delete({where:{eventId}});
    let result=await fetch(base,{headers});assert.equal(result.status,200);let page=await result.json();
    assert.ok(page.rows.some(r=>r.id===row.id));assert.ok(!page.rows.some(r=>r.id===outsider.id||r.id===unknown.id));
    const exported=await fetch(base+'/export',{headers});assert.equal(exported.status,200);assert.match(await exported.text(),/'=2\+2/);
    await db.organizationEvent.create({data:{eventId,organizationId:owner.organizationId}});
    await db.auditLog.createMany({data:Array.from({length:205},(_,i)=>({eventId,action:'audit.page.test',details:String(i)}))});
    page=await(await fetch(base,{headers})).json();assert.equal(page.rows.length,200);assert.ok(page.nextBefore);
    const next=await(await fetch(base+'?before='+page.nextBefore,{headers})).json();assert.ok(next.rows.every(r=>r.id<page.nextBefore));
    assert.equal((await fetch(base+'?before=-1',{headers})).status,400);
    const managerToken=(await getAuth().login('test_manager','a-manager-test-password')).accessToken;
    assert.equal((await fetch(base,{headers:{Authorization:`Bearer ${managerToken}`}})).status,403);
  });
  test('reports are event-scoped and export real Excel and CSV files', async () => {
    const created = await adminRequest('events', { body: { ...eventInput, name: 'Synthetic reports event' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const eventId = created.body.id;
    const token = await verifiedLogin();
    const base = `${getOrigin()}/api/v1/events/${eventId}/reports`;
    const headers = { Authorization: `Bearer ${token}` };
    const report = await fetch(base, { headers });
    assert.equal(report.status, 200);
    const payload = await report.json();
    assert.equal(payload.event.id, eventId);
    assert.equal(payload.summary.registered, 0);
    assert.equal(payload.summary.ticketCapacityRemaining, created.body.maxTickets);
    assert.deepEqual(payload.timeline, []);
    const csv = await fetch(base + '/export?format=csv', { headers });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(await csv.text(), /ticketCapacityRemaining/);
    const xlsx = await fetch(base + '/export?format=xlsx', { headers });
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
    assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.equal((await fetch(base + '/export?format=pdf', { headers })).status, 400);
    assert.equal((await fetch(`${getOrigin()}/api/v1/events/999999/reports`, { headers })).status, 403);
    const historical = await fetch(`${getOrigin()}/api/v1/events/7/reports`, { headers });
    assert.equal(historical.status, 200);
    const history = await historical.json();
    assert.equal(history.summary.checkedIn, await getDb().checkIn.count({ where: { eventId: 7 } }));
    assert.equal(history.summary.issued, await getDb().ticket.count({ where: { eventId: 7 } }));
    assert.equal(history.entrances.reduce((total, entrance) => total + entrance.checkedIn, 0), history.summary.checkedIn);
    const supervisor = await adminRequest('users', { body: {
      username: 'report_supervisor', displayName: 'Report supervisor',
      password: 'synthetic-report-supervisor-password', orgRole: 'checkin_supervisor', eventId,
    } });
    assert.equal(supervisor.status, 201, JSON.stringify(supervisor.body));
    const supervisorToken = (await getAuth().login('report_supervisor', 'synthetic-report-supervisor-password')).accessToken;
    const supervisorHeaders = { Authorization: `Bearer ${supervisorToken}` };
    assert.equal((await fetch(base, { headers: supervisorHeaders })).status, 200);
    assert.equal((await fetch(base + '/export?format=xlsx', { headers: supervisorHeaders })).status, 403);
    assert.equal((await fetch(`${getOrigin()}/api/v1/events/7/reports`, { headers: supervisorHeaders })).status, 403);
    const auditResponse = await fetch(base + '/audit', { headers });
    assert.equal(auditResponse.status, 200);
    const audit = await auditResponse.json();
    assert.ok(audit.rows.some((row) => row.action === 'event.created'));
    assert.equal((await fetch(base + '/audit', { headers: supervisorHeaders })).status, 403);
    const auditCsv = await fetch(base + '/audit/export', { headers });
    assert.equal(auditCsv.status, 200);
    assert.match(await auditCsv.text(), /event\.created/);
    assert.equal((await fetch(base + '/audit/export', { headers: supervisorHeaders })).status, 403);
    const scanner = await adminRequest('users', { body: {
      username: 'report_scanner', displayName: 'Report scanner',
      password: 'synthetic-report-scanner-password', orgRole: 'scanner', eventId,
    } });
    assert.equal(scanner.status, 201, JSON.stringify(scanner.body));
    const monitorResponse = await fetch(base + '/scanners', { headers: supervisorHeaders });
    assert.equal(monitorResponse.status, 200);
    const monitor = await monitorResponse.json();
    assert.ok(monitor.staff.some((row) => row.username === 'report_scanner' && row.connected === false));
    assert.equal((await fetch(`${getOrigin()}/api/v1/events/7/reports/scanners`, { headers: supervisorHeaders })).status, 403);
  });
}
