import {registerStudentTests} from './students.tests.mjs';
import {registerTicketTests} from './tickets.tests.mjs';
import {registerTemplateTests} from './templates.tests.mjs';
import {registerInvitationLinkTests} from './invitation-links.tests.mjs';
import {registerDeliveryTests} from './delivery.tests.mjs';
import {registerMobileTicketTransferTests} from './mobile-tickets-transfers.tests.mjs';
import 'reflect-metadata';
import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {NestFactory} from '@nestjs/core';
import {ValidationPipe} from '@nestjs/common';
import {AppModule} from '../dist/app.module.js';
import {PrismaService} from '../dist/database/prisma.service.js';
import {AuthService} from '../dist/auth/auth.service.js';
import {ScannerService} from '../dist/scanner/scanner.service.js';
import {UsersService} from '../dist/users/users.service.js';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {totp, newSecret} from '../dist/auth/totp.js';
import {seal, unseal} from '../dist/common/encryption.util.js';
import {digest, parseQrPayload} from '../dist/common/crypto.util.js';
import {importPostgres, validateSnapshot} from '../../migration/legacy.mjs';

const fixture = path.resolve('test/legacy-fixture.json');
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
let db, auth, app, origin, url;
before(async () => {
  const base = process.env.TEST_DATABASE_URL;
  assert.ok(base?.startsWith('postgres'), 'Set TEST_DATABASE_URL to the disposable PostgreSQL server.');
  const control = new pg.Client({connectionString:base});
  await control.connect();
  const name = 'aast_migration_test_'+Date.now();
  await control.query('CREATE DATABASE "'+name+'" TEMPLATE template0 ENCODING \'UTF8\' LC_COLLATE \'C\' LC_CTYPE \'C\'');
  await control.end();
  const target = new URL(base); target.pathname = '/'+name; url = target.toString();
  process.env.NODE_DATABASE_URL = url;
  process.env.PG_SSL = 'false';
  process.env.PG_CA_FILE = '';
  process.env.PG_CA_CERT = '';
  process.env.NODE_ENV = 'test';
  process.env.PRISMA_MIGRATION_DATABASE_URL = url;
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32,7).toString('base64url');
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js','migrate','deploy'], {env:process.env,encoding:'utf8',timeout:60000});
  assert.equal(migrated.status,0,migrated.stderr);
  const trial = await importPostgres(fixture,{url});
  assert.equal(trial.dryRun,true);
  const probe = new pg.Client({connectionString:url}); await probe.connect();
  assert.equal((await probe.query('SELECT count(*) FROM users')).rows[0].count,'0');
  await probe.end();
  const imported = await importPostgres(fixture,{url,commit:true});
  assert.equal(Object.keys(imported.tables).length,28);
  app = await NestFactory.create(AppModule,{logger:false,rawBody:true});
  app.useBodyParser('json',{limit:'1mb'});
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  if(process.env.RUN_REACT_BROWSER==='true')app.enableCors({origin:/^http:\/\/127\.0\.0\.1:\d+$/,credentials:false});
  await app.listen(0,'127.0.0.1');
  origin = await app.getUrl();
  db=app.get(PrismaService); auth=app.get(AuthService);
}, {timeout:120000});
after(async () => {if (app) await app.close();});

async function request(route,{token,body,method}={}) {
  const response = await fetch(origin+'/api/v1/'+route,{method:method ?? (body ? 'POST':'GET'), headers:{...(token ? {Authorization:'Bearer '+token}:{}),...(body ? {'Content-Type':'application/json'}:{})},body:body ? JSON.stringify(body):undefined});
  return {status:response.status,body:response.status===204 ? null : await response.json()};
}
async function verifiedLogin() {
  const login = await auth.login('legacy_admin','legacy-test-password');
  const code = (await auth.regenerateRecovery(await verifiedHash())).recoveryCodes[0];
  await auth.verifyFactor(digest(login.accessToken),code);
  return login.accessToken;
}
let firstVerified;
async function verifiedHash() {
  if (!firstVerified) {
    const result=await auth.login('legacy_admin','legacy-test-password');
    await auth.verifyFactor(digest(result.accessToken),totp(secret));
    firstVerified=digest(result.accessToken);
  }
  return firstVerified;
}

test('round-trip preserves imported QR lookup, deleted-event audit and microseconds', async()=>{
  assert.equal((await db.ticket.findUnique({where:{tokenHash:parseQrPayload('AAST1.'+'x'.repeat(43))}})).number,'AAST-IMPORTED-ACTIVE');
  assert.equal((await db.checkIn.findUnique({where:{ticketId:12}})).id,5);
  assert.equal((await db.auditLog.findUnique({where:{id:13}})).eventId,999);
  const result=await db.$queryRaw`SELECT to_char(starts_at, 'US') AS micros FROM events WHERE id=7`;
  assert.equal(result[0].micros,'123456');
  await assert.rejects(importPostgres(fixture,{url}),/rolled back/);
});

test('database health and OpenAPI metadata run on compiled Nest modules',async()=>{
  const result=await request('health');
  assert.equal(result.status,200);
  assert.equal(result.body.database,'connected');
  const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('AAST').setVersion('1').addBearerAuth().build());
  assert.ok(document.paths['/api/v1/scanner/checkin']);
  assert.ok(document.paths['/api/v1/auth/totp/begin']);
});

test('immutable history and cross-event foreign keys survive migration',async()=>{
  await assert.rejects(db.$executeRaw`UPDATE audit_logs SET action='bad' WHERE id=13`);
  await assert.rejects(db.$executeRaw`DELETE FROM check_ins WHERE id=5`);
  await assert.rejects(db.$executeRaw`INSERT INTO entrance_category_permissions(entrance_id,category_id,event_id) VALUES(4,3,999)`);
});

test('Fernet secrets generated by Python decrypt and new encryption rejects tampering',async()=>{
  const profile=await db.securityProfile.findUnique({where:{userId:1}});
  assert.equal(unseal(profile.totpSecret),secret);
  const protectedValue=seal('private-test');
  assert.equal(unseal(protectedValue),'private-test');
  assert.throws(()=>unseal(protectedValue.slice(0,-3)+'xyz'));
});

test('TOTP uses base32 and RFC6238 counters',()=>{
  assert.match(newSecret(),/^[A-Z2-7]{32}$/);
  assert.equal(totp(secret,1),'287082');
  assert.equal(totp(secret,1111111109/30|0),'081804');
});

test('API blocks all management before factor and never exposes password/session hashes',async()=>{
  const login=await request('auth/login',{body:{username:'legacy_admin',password:'legacy-test-password'}});
  assert.equal(login.status,200);
  assert.equal(login.body.requiresFactor,true);
  assert.equal(login.body.sessionHash,undefined);
  assert.equal((await request('events',{token:login.body.accessToken})).status,403);
  const token=await verifiedLogin();
  const users=await request('users',{token});
  assert.equal(users.status,200);
  assert.ok(!JSON.stringify(users.body).includes('passwordHash'));
  assert.equal((await request('events',{token})).status,200);
  assert.equal((await request('auth/login',{body:{username:'legacy_admin',password:'x',extra:'bad'}})).status,400);
});

test('TOTP replay and recovery replay rejected; rotation invalidates old bearer',async()=>{
  await verifiedHash();
  const result=await auth.login('legacy_admin','legacy-test-password');
  const usedCounter=(await db.securityProfile.findUnique({where:{userId:1}})).totpCounter;
  await assert.rejects(auth.verifyFactor(digest(result.accessToken),totp(secret,usedCounter)),/Invalid/);
  const code=(await auth.regenerateRecovery(firstVerified)).recoveryCodes[0];
  const checks=await Promise.allSettled([auth.verifyFactor(digest(result.accessToken),code),auth.verifyFactor(digest(result.accessToken),code)]);
  assert.equal(checks.filter(x=>x.status==='fulfilled').length,1);
  const rotated=await auth.refreshToken(result.accessToken);
  await assert.rejects(auth.authenticate(result.accessToken));
  await auth.authenticate(rotated.accessToken);
  await auth.logout(digest(rotated.accessToken));
  await assert.rejects(auth.authenticate(rotated.accessToken));
});

test('server idle timeout and role/organization reads are enforced',async()=>{
  const token=await verifiedLogin();
  await db.securitySession.update({where:{tokenHash:digest(token)},data:{lastSeen:new Date(Date.now()-3600000)}});
  await assert.rejects(auth.authenticate(token),/inactivity/);
  const manager=await app.get((await import('../dist/users/users.service.js')).UsersService).create({username:'test_manager',password:'a-manager-test-password',displayName:'Manager',orgRole:'event_manager'},1,1,'super_admin');
  const managerLogin=await auth.login('test_manager','a-manager-test-password');
  assert.equal((await request('events',{token:managerLogin.accessToken})).body.length,0);
  assert.equal((await request('events/7',{token:managerLogin.accessToken})).status,403);
  const org=await db.organization.create({data:{name:'Other organization'}});
  const foreign=await db.event.create({data:{name:'Foreign',venue:'Hall',eventDate:new Date('2031-01-01'),startsAt:new Date('2031-01-01T08:00Z'),endsAt:new Date('2031-01-01T17:00Z'),capacity:10,maxTickets:10,organizationEvent:{create:{organizationId:org.id}}}});
  const valid=await verifiedLogin();
  assert.equal((await request('events/'+foreign.id,{token:valid})).status,403);
  const grant=await request('users/'+manager.id+'/events/'+foreign.id+'/assign',{token:valid,method:'POST'});
  assert.equal(grant.status,403);
});

test('export tampering is rejected before import',()=>{
  const snapshot=JSON.parse(readFileSync(fixture,'utf8'));
  snapshot.tables.tickets.rows[0].token_hash='changed';
  assert.throws(()=>validateSnapshot(snapshot),/checksum/);
});

let code,scannerToken;
test('scanner requires account, event code and explicit staff/entrance grants',async()=>{
  const scanner=app.get(ScannerService);
  code=await scanner.createCode(7,'Main entrance',[4],[2],1,'super_admin',1);
  assert.ok(code.code);
  assert.ok(!JSON.stringify(await scanner.listCodes(7,1,'super_admin',1)).includes(code.code));
  await assert.rejects(scanner.login('legacy_scanner','scanner-test-password','WRONG'));
  const login=await scanner.login('legacy_scanner','scanner-test-password',code.code);
  scannerToken=login.token;
  assert.ok(scannerToken);
  const state=await scanner.state(scannerToken);
  assert.equal(state.event.id,7);
  assert.equal(state.entrances.length,1);
  await assert.rejects(scanner.switchEntrance(scannerToken,999));
  await scanner.switchEntrance(scannerToken,4);
  const publicState=await request('scanner/state',{token:scannerToken});
  assert.equal(publicState.status,200);
  assert.ok(!JSON.stringify(publicState.body).includes('guest@example.com'));
  assert.equal((await request('events',{token:scannerToken})).status,401);
});

test('two phones scanning an imported legacy QR accept exactly once',async()=>{
  const scanner=app.get(ScannerService);
  const qr='AAST1.'+'x'.repeat(43);
  const scans=await Promise.all([scanner.scan(scannerToken,qr),scanner.scan(scannerToken,qr)]);
  assert.deepEqual(scans.map(s=>s.accepted).sort(),[false,true]);
  assert.equal(scans.find(s=>!s.accepted).originalEntrance,'Main');
  assert.equal(await db.checkIn.count({where:{ticketId:11}}),1);
  const state=await scanner.state(scannerToken);
  assert.equal(state.accepted,1);assert.equal(state.rejected,1);
  assert.equal(state.checked,1);assert.equal(state.remaining,0);
});

test('scanner has no inactivity expiry; disablement/reset preserve its active session',async()=>{
  const scanner=app.get(ScannerService),users=app.get(UsersService);
  await db.scannerSession.update({where:{userId:2},data:{lastSeen:new Date('2020-01-01')}});
  await scanner.state(scannerToken);
  await users.setActive(2,false,1,1,'super_admin');
  assert.equal((await scanner.state(scannerToken)).staff,'Gate staff');
  await assert.rejects(scanner.login('legacy_scanner','scanner-test-password',code.code));
  const temp=await users.temporaryPassword(2,1,1,'super_admin');
  await scanner.state(scannerToken);
  await users.setActive(2,true,1,1,'super_admin');
  const pending=await scanner.login('legacy_scanner',temp.password,code.code);
  assert.equal(pending.requiresPasswordChange,true);
  await scanner.state(scannerToken); // pending login has not displaced active phone
  const complete=await scanner.finishTemporaryPassword(pending.challenge,'a-new-scanner-password');
  await assert.rejects(scanner.state(scannerToken));
  scannerToken=complete.token;
  await scanner.state(scannerToken);
  await assert.rejects(scanner.finishTemporaryPassword(pending.challenge,'another-new-password'));
});

test('new scanner login displaces the old phone; remote logout and deactivated codes revoke access',async()=>{
  const scanner=app.get(ScannerService);
  const second=await scanner.login('legacy_scanner','a-new-scanner-password',code.code);
  await assert.rejects(scanner.state(scannerToken));
  scannerToken=second.token;
  await scanner.remoteLogout(2,1,'super_admin',1);
  await assert.rejects(scanner.state(scannerToken));
  scannerToken=(await scanner.login('legacy_scanner','a-new-scanner-password',code.code)).token;
  const removed=await scanner.deactivateCode(7,code.id,1,'super_admin',1);
  assert.equal(removed.terminated,1);
  await assert.rejects(scanner.state(scannerToken));
  await assert.rejects(scanner.login('legacy_scanner','a-new-scanner-password',code.code));
});

test('scanner own recent ten scans and statistics exclude another staff member',async()=>{
  const scanner=app.get(ScannerService),users=app.get(UsersService);
  const other=await users.create({username:'other_scanner',displayName:'Other staff',password:'a-test-scanner-password',orgRole:'scanner'},1,1,'super_admin');
  await users.assignEvent(other.id,7,true,1,1,'super_admin');
  const fresh=await scanner.createCode(7,'Shared gate',[4],[2,other.id],1,'super_admin',1);
  const login=await scanner.login('legacy_scanner','a-new-scanner-password',fresh.code);
  const otherLogin=await scanner.login('other_scanner','a-test-scanner-password',fresh.code);
  await scanner.switchEntrance(login.token,4);await scanner.switchEntrance(otherLogin.token,4);
  for(let i=0;i<12;i++)await scanner.scan(login.token,'bad-qr');
  await scanner.scan(otherLogin.token,'bad-qr');
  const state=await scanner.state(login.token),otherState=await scanner.state(otherLogin.token);
  assert.equal(state.recent.length,10);assert.equal(state.rejected,12);
  assert.equal(otherState.rejected,1);assert.equal(otherState.recent.length,1);
  await scanner.preferences(login.token,{successSound:false,rejectionSound:false,successVibration:false,rejectionVibration:false});
  assert.equal((await scanner.state(login.token)).preferences.successSound,false);
});


// Priority 1: real HTTP validation and PostgreSQL transaction regressions.
let managementToken, managedEvent, managedCategory, managedEntrance, managedCode, managedTicket;
async function adminRequest(route,options={}) {
  managementToken ??= await verifiedLogin();
  return request(route,{...options,token:managementToken});
}
const eventInput={name:'Priority 1 event',venue:'University hall',eventDate:'2034-01-02',startsAt:'2034-01-02T08:00:00Z',endsAt:'2034-01-02T18:00:00Z',capacity:30,status:'Upcoming'};

test('event API strictly validates payloads, defaults ticket limit and fixes ownership',async()=>{
  for(const patch of [{name:'  '},{capacity:0},{maxTickets:40},{timezone:'Not/AZone'},{startsAt:'2034-01-02T08:00:00'},{endsAt:'2034-01-02T07:00:00Z'},{organizationId:2},{capacity:'30'},{venue:null},{distributionEnd:'2035-01-01T00:00:00Z'}]) {
    const result=await adminRequest('events',{body:{...eventInput,...patch}});
    assert.equal(result.status,400,JSON.stringify(patch));
  }
  const result=await adminRequest('events',{body:eventInput});
  assert.equal(result.status,201,JSON.stringify(result.body));
  managedEvent=result.body;
  assert.equal(managedEvent.maxTickets,30);
  assert.equal((await db.organizationEvent.findUnique({where:{eventId:managedEvent.id}})).organizationId,1);
  assert.equal((await adminRequest(`events/${managedEvent.id}`,{method:'PATCH',body:{status:'Cancelled'}})).status,400);
});

test('category and entrance APIs validate cross-event grants and serialize duplicates',async()=>{
  const base=`events/${managedEvent.id}`;
  for(const data of [{name:'VIP',code:'VIP',allocation:-1},{name:'VIP',code:'VIP',allocation:10,active:'false'},{name:'VIP',code:'VIP',allocation:10,extra:true},{name:' ',code:'VIP',allocation:10}]) assert.equal((await adminRequest(base+'/categories',{body:data})).status,400);
  const duplicates=await Promise.all([adminRequest(base+'/categories',{body:{name:'Guests',code:'GUEST',allocation:20}}),adminRequest(base+'/categories',{body:{name:'guests',code:'guest',allocation:20}})]);
  assert.deepEqual(duplicates.map(r=>r.status).sort(),[201,400]);
  managedCategory=duplicates.find(r=>r.status===201).body;
  const before=await db.entrance.count({where:{eventId:managedEvent.id}});
  const bad=await adminRequest(base+'/entrances',{body:{name:'Invalid gate',code:'BAD',categoryIds:[3]}});
  assert.equal(bad.status,400); assert.equal(await db.entrance.count({where:{eventId:managedEvent.id}}),before);
  const entrance=await adminRequest(base+'/entrances',{body:{name:'Main',code:'MAIN',categoryIds:[managedCategory.id]}});
  assert.equal(entrance.status,201,JSON.stringify(entrance.body)); managedEntrance=entrance.body;
  const partial=await adminRequest(base+'/categories/'+managedCategory.id,{method:'PATCH',body:{description:'Partial update'}});
  assert.equal(partial.status,200); assert.equal(partial.body.name,managedCategory.name);
  const original=await db.entrancePermission.findMany({where:{entranceId:managedEntrance.id}});
  assert.equal((await adminRequest(base+'/entrances/'+managedEntrance.id,{method:'PATCH',body:{location:'Changed',categoryIds:[3]}})).status,400);
  assert.equal((await db.entrance.findUnique({where:{id:managedEntrance.id}})).location,'');
  assert.deepEqual(await db.entrancePermission.findMany({where:{entranceId:managedEntrance.id}}),original);
  assert.equal((await adminRequest(base+'/categories/3',{method:'DELETE'})).status,404);
});

test('event configuration is typed, event scoped and protects the default category',async()=>{
  const route=`events/${managedEvent.id}/settings`;
  for(const settings of [{defaultCategoryId:3},{primaryColor:'red'},{directGuestDelivery:'false'},{privatePassword:'hidden'},{transferDeadline:'2035-01-01T00:00:00Z'}]) assert.equal((await adminRequest(route,{method:'PATCH',body:{settings}})).status,400);
  assert.equal((await adminRequest(route,{method:'PATCH',body:{}})).status,400);
  const saved=await adminRequest(route,{method:'PATCH',body:{settings:{defaultCategoryId:managedCategory.id,guestLimit:20,perStudentLimit:3,directGuestDelivery:true,primaryColor:'#142D4E'}}});
  assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal((await adminRequest(route)).body.settings.guestLimit,20);
  assert.equal((await adminRequest(`events/${managedEvent.id}/categories/${managedCategory.id}`,{method:'PATCH',body:{active:false}})).status,400);
});

test('access code activation, regeneration and grant edits revoke old access atomically',async()=>{
  const base=`events/${managedEvent.id}/access-codes`,scanner=app.get(ScannerService);
  await app.get(UsersService).assignEvent(2,managedEvent.id,true,1,1,'super_admin');
  assert.equal((await adminRequest(base,{body:{name:'Wrong gate',entranceIds:[4],staffIds:[2]}})).status,400);
  const created=await adminRequest(base,{body:{name:'Gate team',entranceIds:[managedEntrance.id],staffIds:[2]}});
  assert.equal(created.status,201);managedCode=created.body;
  let login=await scanner.login('legacy_scanner','a-new-scanner-password',managedCode.code);
  const regen=await adminRequest(base+'/'+managedCode.id+'/regenerate',{method:'POST'});
  assert.equal(regen.status,201); assert.notEqual(regen.body.code,managedCode.code);
  await assert.rejects(scanner.state(login.token));
  await assert.rejects(scanner.login('legacy_scanner','a-new-scanner-password',managedCode.code));
  managedCode.code=regen.body.code;
  login=await scanner.login('legacy_scanner','a-new-scanner-password',managedCode.code);
  assert.equal((await adminRequest(base+'/'+managedCode.id,{method:'PATCH',body:{name:'Changed',entranceIds:[4],staffIds:[2]}})).status,400);
  await scanner.state(login.token); // failed grant edit did not revoke or partially change anything
  assert.equal((await adminRequest(base+'/'+managedCode.id,{method:'PATCH',body:{name:'Changed',entranceIds:[managedEntrance.id],staffIds:[2]}})).status,200);
  await assert.rejects(scanner.state(login.token));
  await adminRequest(base+'/'+managedCode.id+'/deactivate',{method:'POST'});
  await assert.rejects(scanner.login('legacy_scanner','a-new-scanner-password',managedCode.code));
  assert.equal((await adminRequest(base+'/'+managedCode.id+'/activate',{method:'POST'})).status,201);
  login=await scanner.login('legacy_scanner','a-new-scanner-password',managedCode.code);
  const listed=await adminRequest(base);
  assert.equal(listed.body.find(c=>c.id===managedCode.id)._count.scannerSessions,1);
  assert.ok(!JSON.stringify(listed.body).includes(managedCode.code));
  assert.equal((await adminRequest(`events/7/access-codes/${managedCode.id}/deactivate`,{method:'POST'})).status,400);
});

test('duplication copies configuration and assignments but never credentials or activity',async()=>{
  const attendee=await db.attendee.create({data:{eventId:managedEvent.id,categoryId:managedCategory.id,fullName:'Synthetic guest',email:'synthetic@example.test'}});
  managedTicket=await db.ticket.create({data:{eventId:managedEvent.id,categoryId:managedCategory.id,attendeeId:attendee.id,number:'PRIORITY-ONE',tokenHash:parseQrPayload('AAST1.'+'z'.repeat(43)),expiresAt:new Date(managedEvent.endsAt)}});
  const copy=await adminRequest(`events/${managedEvent.id}/duplicate`,{method:'POST'});
  assert.equal(copy.status,201,JSON.stringify(copy.body));
  assert.notEqual(copy.body.id,managedEvent.id); assert.equal(copy.body.status,'Draft');
  const id=copy.body.id;
  for(const table of ['attendee','ticket','checkIn','scannerSession','scanAttempt','emailDelivery']) assert.equal(await db[table].count({where:{eventId:id}}),0,table);
  assert.equal(await db.eventAssignment.count({where:{eventId:id,userId:2}}),1);
  const category=await db.ticketCategory.findFirst({where:{eventId:id}});
  const entrance=await db.entrance.findFirst({where:{eventId:id}});
  assert.notEqual(category.id,managedCategory.id);assert.notEqual(entrance.id,managedEntrance.id);
  assert.ok(await db.entrancePermission.findUnique({where:{entranceId_categoryId:{entranceId:entrance.id,categoryId:category.id}}}));
  assert.equal((await adminRequest(`events/${id}/settings`)).body.settings.defaultCategoryId,category.id);
  const cloned=await db.accessCode.findFirst({where:{eventId:id},include:{codeEntrances:true,codeStaff:true}});
  assert.equal(cloned.active,false);assert.notEqual(cloned.codeHash,digest(managedCode.code));
  assert.equal(cloned.codeEntrances[0].entranceId,entrance.id);assert.equal(cloned.codeStaff[0].userId,2);
});

test('event configuration and audit roll back together when duplication audit fails',async()=>{
  const count=await db.event.count();
  await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_duplicate_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='event.duplicated' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER test_reject_duplicate BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_reject_duplicate_audit()');
  try {
    const result=await adminRequest(`events/${managedEvent.id}/duplicate`,{method:'POST'});
    assert.equal(result.status,500);assert.equal(await db.event.count(),count);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER test_reject_duplicate ON audit_logs');
    await db.$executeRawUnsafe('DROP FUNCTION test_reject_duplicate_audit()');
  }
});

test('rescheduling preserves QR identities, extends expiry and rejects unsafe limits',async()=>{
  const route=`events/${managedEvent.id}`;
  await db.$executeRaw`UPDATE events SET ends_at=TIMESTAMP '2034-01-02 18:00:00.123456' WHERE id=${managedEvent.id}`;
  await db.$executeRaw`UPDATE tickets SET expires_at=TIMESTAMP '2034-01-02 18:00:00.123456' WHERE id=${managedTicket.id}`;
  const result=await adminRequest(route,{method:'PATCH',body:{eventDate:'2034-02-02',startsAt:'2034-02-02T08:00:00Z',endsAt:'2034-02-02T18:00:00Z'}});
  assert.equal(result.status,200,JSON.stringify(result.body));
  const ticket=await db.ticket.findUnique({where:{id:managedTicket.id}});
  assert.equal(ticket.number,managedTicket.number);assert.equal(ticket.tokenHash,managedTicket.tokenHash);assert.equal(ticket.status,'Active');
  assert.equal(ticket.expiresAt.toISOString(),'2034-02-02T18:00:00.000Z');
  await db.ticket.create({data:{eventId:managedEvent.id,categoryId:managedCategory.id,attendeeId:ticket.attendeeId,number:'PRIORITY-USED',tokenHash:digest('synthetic-used'),status:'Used',expiresAt:ticket.expiresAt}});
  assert.equal((await adminRequest(route,{method:'PATCH',body:{capacity:1,maxTickets:1}})).status,400);
  assert.equal((await adminRequest(route+'/categories/'+managedCategory.id,{method:'PATCH',body:{allocation:1}})).status,400);
  assert.equal((await adminRequest(route+'/categories/'+managedCategory.id,{method:'PATCH',body:{maxPerAttendee:1}})).status,400);
});

test('cancellation and Super Admin reopening preserve ticket and cancellation evidence',async()=>{
  const route=`events/${managedEvent.id}`,scanner=app.get(ScannerService);
  const login=await scanner.login('legacy_scanner','a-new-scanner-password',managedCode.code);
  await scanner.switchEntrance(login.token,managedEntrance.id);
  assert.equal((await adminRequest(route+'/cancel',{method:'POST'})).status,204);
  assert.equal((await db.ticket.findUnique({where:{id:managedTicket.id}})).status,'Cancelled');
  assert.equal((await db.ticket.findUnique({where:{number:'PRIORITY-USED'}})).status,'Used');
  assert.equal((await scanner.scan(login.token,'AAST1.'+'z'.repeat(43))).accepted,false);
  const managerLogin=await auth.login('test_manager','a-manager-test-password');
  assert.equal((await request(route+'/reopen',{token:managerLogin.accessToken,method:'POST'})).status,403);
  assert.equal((await adminRequest(route+'/reopen',{method:'POST'})).status,204);
  const result=await scanner.scan(login.token,'AAST1.'+'z'.repeat(43));
  assert.equal(result.accepted,false);assert.match(result.message,/cancelled/i);
  assert.equal(await db.auditLog.count({where:{eventId:managedEvent.id,action:'event.cancelled'}}),1);
  assert.equal(await db.auditLog.count({where:{eventId:managedEvent.id,action:'event.reopened'}}),1);
});

test('concurrent cancellation and scanning never leave a valid unused ticket',async()=>{
  const scanner=app.get(ScannerService);
  const ticket=await db.ticket.create({data:{eventId:managedEvent.id,categoryId:managedCategory.id,attendeeId:managedTicket.attendeeId,number:'PRIORITY-RACE',tokenHash:parseQrPayload('AAST1.'+'w'.repeat(43)),expiresAt:new Date('2034-02-02T18:00:00Z')}});
  const login=await scanner.login('legacy_scanner','a-new-scanner-password',managedCode.code);
  await scanner.switchEntrance(login.token,managedEntrance.id);
  const [scanned,cancelled]=await Promise.all([scanner.scan(login.token,'AAST1.'+'w'.repeat(43)),adminRequest(`events/${managedEvent.id}/cancel`,{method:'POST'})]);
  assert.equal(cancelled.status,204);
  const stored=await db.ticket.findUnique({where:{id:ticket.id},include:{checkIn:true}});
  assert.equal(stored.status,scanned.accepted?'Used':'Cancelled');
  assert.equal(Boolean(stored.checkIn),scanned.accepted);
});

test('completed archives are read-only and only Super Admin can restore',async()=>{
  const route=`events/${managedEvent.id}`;
  await adminRequest(route+'/reopen',{method:'POST'});
  assert.equal((await adminRequest(route+'/archive',{method:'POST'})).status,400);
  assert.equal((await adminRequest(route,{method:'PATCH',body:{status:'Completed'}})).status,200);
  assert.equal((await adminRequest(route+'/archive',{method:'POST'})).status,204);
  const changes=[
    [route,'PATCH',{venue:'Changed'}], [route+'/settings','PATCH',{settings:{guestLimit:10}}],
    [route+'/categories/'+managedCategory.id,'PATCH',{name:'Changed'}], [route+'/entrances/'+managedEntrance.id,'PATCH',{location:'Changed'}],
    [route+'/categories/'+managedCategory.id,'DELETE'],[route+'/entrances/'+managedEntrance.id,'DELETE'],
    [route+'/access-codes/'+managedCode.id+'/activate','POST'],
    [route+'/tickets/'+managedTicket.id+'/regenerate','POST'],[route+'/tickets/'+managedTicket.id+'/revoke','POST'],
    [route+'/attendees/'+managedTicket.attendeeId+'/cancel','POST'],[route+'/attendees/'+managedTicket.attendeeId,'DELETE'],
    ['users/2/events/'+managedEvent.id+'/assign','POST'],
  ];
  for(const [path,method,body] of changes) assert.equal((await adminRequest(path,{method,body})).status,400,path);
  const manager=await auth.login('test_manager','a-manager-test-password');
  assert.equal((await request(route+'/restore',{token:manager.accessToken,method:'POST'})).status,403);
  assert.equal((await adminRequest(route+'/restore',{method:'POST'})).status,204);
  assert.equal((await db.event.findUnique({where:{id:managedEvent.id}})).status,'Completed');
  assert.equal((await adminRequest(route)).status,200);
  // Assigned managers can manage their own event, never foreign events or Super-only actions.
  const other=await adminRequest('events',{body:{...eventInput,name:'Manager owned event'}});
  const user=await db.user.findUnique({where:{username:'test_manager'}});
  await app.get(UsersService).assignEvent(user.id,other.body.id,true,1,1,'super_admin');
  assert.equal((await request(`events/${other.body.id}`,{token:manager.accessToken,method:'PATCH',body:{venue:'Manager updated venue'}})).status,200);
  assert.equal((await request(`events/${other.body.id}/access-codes`,{token:manager.accessToken})).status,403);
  assert.equal((await request(`events/${other.body.id}/duplicate`,{token:manager.accessToken,method:'POST'})).status,403);
});


test('React session hydration reports current password/factor gates without secrets',async()=>{
  const pending=await auth.login('legacy_admin','legacy-test-password');
  const result=await request('auth/me',{token:pending.accessToken});
  assert.equal(result.status,200);assert.equal(result.body.requiresFactor,true);assert.equal(result.body.enrolled,true);assert.equal(result.body.requiresPasswordChange,false);
  assert.ok(!JSON.stringify(result.body).includes('sessionHash'));
  const verified=await request('auth/me',{token:await verifiedLogin()});
  assert.equal(verified.body.requiresFactor,false);
});

test('staff creation plus event assignment is atomic and validates server DTOs',async()=>{
  const foreign=await db.event.findFirst({where:{name:'Foreign'}});
  const before=await db.user.count();
  const body={username:'atomic_scanner',displayName:'Atomic scanner',password:'a-test-atomic-password',orgRole:'scanner'};
  assert.equal((await adminRequest('users',{body:{...body,eventId:foreign.id}})).status,403);
  assert.equal(await db.user.count(),before);
  assert.equal((await adminRequest('users',{body:{...body,role:'admin'}})).status,400);
  const event=await adminRequest('events',{body:{...eventInput,name:'Staff creation event'}});
  const created=await adminRequest('users',{body:{...body,eventId:event.body.id}});
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.ok(await db.eventAssignment.findUnique({where:{userId_eventId:{userId:created.body.id,eventId:event.body.id}}}));
  const users=await adminRequest('users');
  assert.ok(users.body.find(u=>u.id===created.body.id).eventAssignments.some(a=>a.eventId===event.body.id));
});

test('runtime configuration enforces verified TLS, explicit origins and bounded pooling',async()=>{
  const {databaseOptions,validateEnvironment}=await import('../dist/config/runtime.js');
  const local={NODE_DATABASE_URL:'postgresql://fake:fake@localhost:5432/disposable',NODE_ENV:'development'};
  assert.equal(databaseOptions(local).ssl,undefined);
  const tls=databaseOptions({...local,NODE_ENV:'production',PG_SSL:'true',PG_CA_CERT:'synthetic-ca',PG_POOL_MAX:'5'});
  assert.equal(tls.ssl.rejectUnauthorized,true);assert.equal(tls.ssl.ca,'synthetic-ca');assert.equal(tls.max,5);
  assert.throws(()=>databaseOptions({...local,NODE_ENV:'production',PG_SSL:'false'}));
  assert.throws(()=>databaseOptions({...local,PG_POOL_MAX:'999'}));
  assert.throws(()=>validateEnvironment({...local,NODE_ENV:'production',APP_ENCRYPTION_KEY:'synthetic'}));
  assert.throws(()=>validateEnvironment({...local,CORS_ORIGINS:'*'}));
  assert.throws(()=>validateEnvironment({...local,CORS_ORIGINS:'http://unapproved.example'}));
  assert.throws(()=>validateEnvironment({...local,SESSION_HOURS:'NaN'}));
});

let emailJobId;
test('Resend queue encrypts payloads, deduplicates and leases sends across workers',async()=>{
  const {EmailService}=await import('../dist/email/email.service.js'),{ResendProvider}=await import('../dist/email/resend.provider.js');
  process.env.EMAIL_ENABLED='true';process.env.RESEND_API_KEY='re_synthetic_test_only';process.env.EMAIL_FROM='Dream Events <test@example.test>';
  const email=app.get(EmailService),provider=app.get(ResendProvider);const original=provider.send;
  const message={to:['recipient@example.test'],subject:'Synthetic private message',html:'<p>Private test body</p>'};
  let sends=0;
  provider.send=async(payload,key)=>{sends++;assert.equal(payload.to[0],message.to[0]);assert.match(key,/^resend:/);await new Promise(r=>setTimeout(r,20));return 'synthetic-resend-1';};
  try {
    const results=await Promise.all([email.enqueue(1,7,1,message,'test-queue-1'),email.enqueue(1,7,1,message,'test-queue-1')]);
    assert.equal(results[0].id,results[1].id);emailJobId=results[0].id;
    const stored=await db.backgroundJob.findUnique({where:{id:emailJobId}});
    assert.ok(!stored.payload.includes('recipient@example.test'));assert.ok(!stored.payload.includes('Private test body'));
    await assert.rejects(email.enqueue(1,7,1,{...message,subject:'Changed'},'test-queue-1'));
    await Promise.all([email.tick(),email.tick()]);assert.equal(sends,1);
    assert.equal((await db.mailDelivery.findUnique({where:{jobId:emailJobId}})).status,'Sent');
    assert.equal((await db.mailDelivery.findUnique({where:{jobId:emailJobId}})).providerMessageId,'synthetic-resend-1');
  }finally{provider.send=original;}
});

test('Resend retries transient failures only, with bounded durable backoff and safe errors',async()=>{
  const {EmailService}=await import('../dist/email/email.service.js'),{ResendProvider,ProviderError}=await import('../dist/email/resend.provider.js');
  const email=app.get(EmailService),provider=app.get(ResendProvider),original=provider.send;
  try {
    provider.send=async()=>{throw new ProviderError(true,'provider_503');};
    const queued=await email.enqueue(1,7,1,{to:['retry@example.test'],subject:'Retry test',html:'test'},'test-retry-1');
    let now=new Date(Date.now()+1000);
    for(const delay of [60000,300000,900000]){await email.tick(now);const job=await db.backgroundJob.findUnique({where:{id:queued.id}});assert.equal(job.status,'Pending');assert.equal(+job.availableAt-+now,delay);now=new Date(+job.availableAt+1);}
    await email.tick(now);assert.equal((await db.backgroundJob.findUnique({where:{id:queued.id}})).status,'Failed');
    assert.equal((await db.mailDelivery.findUnique({where:{jobId:queued.id}})).status,'Failed');
    provider.send=async()=>{throw new ProviderError(false,'provider_401');};
    const rejected=await email.enqueue(1,7,1,{to:['rejected@example.test'],subject:'Reject test',html:'test'},'test-reject-1');
    await email.tick();const job=await db.backgroundJob.findUnique({where:{id:rejected.id}});assert.equal(job.attempts,1);assert.equal(job.status,'Failed');assert.equal(job.lastError,'provider_401');
  }finally{provider.send=original;}
});

test('Resend webhooks verify raw signatures, deduplicate and reject stale delivery regression',async()=>{
  const {createHmac}=await import('node:crypto');
  const secret=Buffer.alloc(32,8);process.env.RESEND_WEBHOOK_SECRET='whsec_'+secret.toString('base64');
  async function send(id,type,created_at,signatureValid=true){
    const payload=JSON.stringify({type,created_at,data:{email_id:'synthetic-resend-1'}}),timestamp=String(Math.floor(Date.now()/1000));
    const signature='v1,'+createHmac('sha256',secret).update(id+'.'+timestamp+'.'+payload).digest('base64');
    const response=await fetch(origin+'/api/v1/email/resend/webhook',{method:'POST',headers:{'Content-Type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':signatureValid?signature:'v1,invalid'},body:payload});return response.status;
  }
  assert.equal(await send('event-unauthorized','email.delivered','2026-11-10T12:00:00Z',false),401);
  assert.equal(await send('event-delivered','email.delivered','2026-11-10T12:02:00Z'),204);
  assert.equal(await send('event-delivered','email.delivered','2026-11-10T12:02:00Z'),204);
  assert.equal(await send('event-sent','email.sent','2026-11-10T12:01:00Z'),204);
  assert.equal((await db.mailDelivery.findUnique({where:{jobId:emailJobId}})).status,'Delivered');
  assert.equal(await db.mailWebhook.count({where:{id:'event-delivered'}}),1);
  await assert.rejects(db.$executeRaw`DELETE FROM mail_webhooks WHERE id='event-delivered'`);
});

test('provider transport sends a stable idempotency header and safely classifies HTTP failures',async()=>{
  const {ResendProvider,ProviderError}=await import('../dist/email/resend.provider.js');
  const provider=new ResendProvider(),original=globalThis.fetch;
  try{
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'synthetic-stable-key');assert.equal(options.redirect,'error');return new Response(JSON.stringify({id:'synthetic-provider-id'}),{status:200});};
    assert.equal(await provider.send({from:'test@example.test',to:['recipient@example.test'],subject:'test',html:'test'},'synthetic-stable-key'),'synthetic-provider-id');
    globalThis.fetch=async()=>new Response('{}',{status:429});await assert.rejects(provider.send({},'test'),e=>e instanceof ProviderError&&e.retryable);
    globalThis.fetch=async()=>new Response('{}',{status:401});await assert.rejects(provider.send({},'test'),e=>e instanceof ProviderError&&!e.retryable&&e.safeCode==='provider_401');
  }finally{globalThis.fetch=original;}
});

test('early provider callbacks and lost persistence reconcile under the same operation key',async()=>{
  const {EmailService}=await import('../dist/email/email.service.js'),{ResendProvider}=await import('../dist/email/resend.provider.js');
  const email=app.get(EmailService),provider=app.get(ResendProvider),original=provider.send;
  try{
    const early=await email.enqueue(1,null,1,{to:['early@example.test'],subject:'Early callback',html:'test'},'early-callback');
    provider.send=async()=>{await email.webhook('early-event',{type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:'synthetic-early'}});return 'synthetic-early';};
    await email.tick();assert.equal((await db.mailDelivery.findUnique({where:{jobId:early.id}})).status,'Delivered');
    const lost=await email.enqueue(1,7,1,{to:['lost@example.test'],subject:'Lost response',html:'test'},'lost-persistence');
    const keys=[];provider.send=async(_,key)=>{keys.push(key);return 'synthetic-persistence';};
    await db.$executeRawUnsafe(`CREATE FUNCTION test_mail_persist_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider_message_id='synthetic-persistence' THEN RAISE EXCEPTION 'synthetic persistence outage'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_mail_persist_failure BEFORE UPDATE ON mail_deliveries FOR EACH ROW EXECUTE FUNCTION test_mail_persist_failure()');
    try{await assert.rejects(email.tick(),/persistence/);assert.equal((await db.backgroundJob.findUnique({where:{id:lost.id}})).status,'Running');}
    finally{await db.$executeRawUnsafe('DROP TRIGGER test_mail_persist_failure ON mail_deliveries');await db.$executeRawUnsafe('DROP FUNCTION test_mail_persist_failure()');}
    await email.tick(new Date(Date.now()+61000));assert.equal(new Set(keys).size,1);assert.equal(keys.length,2);assert.equal((await db.mailDelivery.findUnique({where:{jobId:lost.id}})).status,'Sent');
  }finally{provider.send=original;}
});

test('account role edits revoke sessions and rejected self-demotion changes nothing',async()=>{
  const original=await db.user.findUnique({where:{id:1}});
  assert.equal((await adminRequest('users/1',{method:'PATCH',body:{displayName:'Should not persist',orgRole:'event_manager'}})).status,400);
  assert.equal((await db.user.findUnique({where:{id:1}})).displayName,original.displayName);
  const created=await adminRequest('users',{body:{username:'role_edit_test',displayName:'Role edit',password:'a-role-edit-test-password',orgRole:'event_manager'}});
  const old=await auth.login('role_edit_test','a-role-edit-test-password');
  assert.equal((await adminRequest('users/'+created.body.id,{method:'PATCH',body:{displayName:'Updated role edit',orgRole:'checkin_supervisor'}})).status,204);
  await assert.rejects(auth.authenticate(old.accessToken));
  const fresh=await auth.login('role_edit_test','a-role-edit-test-password');
  assert.equal((await request('auth/me',{token:fresh.accessToken})).body.role,'checkin_supervisor');
});

registerStudentTests({test,adminRequest,request,getDb:()=>db,getOrigin:()=>origin,verifiedLogin,getAuth:()=>auth,eventInput});
registerTicketTests({test,adminRequest,request,getDb:()=>db,getOrigin:()=>origin,verifiedLogin,getApp:()=>app,eventInput});
registerTemplateTests({test,adminRequest,request,getDb:()=>db,getOrigin:()=>origin,verifiedLogin,getApp:()=>app,eventInput});
registerDeliveryTests({test,adminRequest,request,getDb:()=>db,getOrigin:()=>origin,verifiedLogin,getApp:()=>app,eventInput});
registerInvitationLinkTests({test,adminRequest,request,getDb:()=>db,eventInput});
registerMobileTicketTransferTests({test,adminRequest,request,getDb:()=>db,getApp:()=>app,eventInput});

if(process.env.RUN_REACT_BROWSER==='true')test('React administration works against the real API with 2FA, event/access forms and role isolation',async()=>{
  const {runAdminBrowser}=await import('./react-admin.browser.mjs');
  const recoveryCode=(await auth.regenerateRecovery(await verifiedHash())).recoveryCodes[0];
  await runAdminBrowser({origin,auth,db,recoveryCode});
},{timeout:120000});
