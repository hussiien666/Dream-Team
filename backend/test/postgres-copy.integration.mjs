import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { importPostgres } from '../../migration/legacy.mjs';
import { snapshotPostgres, restorePostgres } from '../../migration/postgres-copy.mjs';
let source, target, snapshot, control, sourceName, targetName;
before(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'invalid:');
  assert.ok(['postgresql:', 'postgres:'].includes(url.protocol) && ['127.0.0.1','localhost'].includes(url.hostname), 'Use disposable loopback PostgreSQL.');
  control = new pg.Client({connectionString:url.toString()}); await control.connect();
  sourceName = 'de_copy_source_' + randomUUID().replaceAll('-',''); targetName = 'de_copy_target_' + randomUUID().replaceAll('-','');
  for (const name of [sourceName,targetName]) await control.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  url.pathname = '/' + sourceName;
  const migrated = spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{
    env: {...process.env,NODE_DATABASE_URL:url.toString(),PRISMA_MIGRATION_DATABASE_URL:url.toString()}, encoding:'utf8',timeout:90000 });
  assert.equal(migrated.status,0,'Synthetic schema migration failed.');
  await importPostgres('test/legacy-fixture.json',{url:url.toString(),commit:true});
  source = new pg.Client({connectionString:url.toString()}); await source.connect();
  snapshot = await snapshotPostgres(source);
  url.pathname = '/' + targetName; target = new pg.Client({connectionString:url.toString()}); await target.connect();
}, {timeout:120000});
after(async () => {
  await source?.end(); await target?.end();
  if (control) { for (const name of [sourceName,targetName]) if(name) await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await control.end(); }
});
const empty = async () => assert.equal((await target.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count,0);
test('PostgreSQL staging rejects tampering and rolls back schema plus records on FK failures', async () => {
  const changed = structuredClone(snapshot); changed.tables.users.rows[0] += ' ';
  await assert.rejects(restorePostgres(target,changed),/verification/); await empty();
  const invalid = structuredClone(snapshot), table=invalid.tables.tickets;
  const row=JSON.parse(table.rows[0]); row.attendee_id=2147483000;
  table.rows[0]=JSON.stringify(row);table.digest=createHash('sha256').update(JSON.stringify(table.rows)).digest('hex');
  await assert.rejects(restorePostgres(target,invalid)); await empty();
});
test('PostgreSQL staging dry run preserves precision, QR/history and restores protections without changing source', async () => {
  const result = await restorePostgres(target,snapshot);
  assert.equal(result.dryRun,true); assert.equal(result.allRowsMatched,true); await empty();
  const committed = await restorePostgres(target,snapshot,{commit:true}); assert.equal(committed.allRowsMatched,true);
  const restored = await snapshotPostgres(target);
  assert.deepEqual(restored.tables,snapshot.tables);
  assert.deepEqual((await snapshotPostgres(source)).tables,snapshot.tables);
  assert.equal((await target.query("SELECT to_char(starts_at,'US') AS micros FROM events WHERE id=7")).rows[0].micros,'123456');
  await assert.rejects(target.query('DELETE FROM audit_logs WHERE id=13'));
  await assert.rejects(target.query('UPDATE check_ins SET staff_id=1 WHERE id=5'));
  await assert.rejects(restorePostgres(target,snapshot,{commit:true}),/no public tables/);
  // The source never advanced its sequence; target's next value must match it.
  const next = (await target.query("SELECT nextval(pg_get_serial_sequence('users','id'))::text AS value")).rows[0].value;
  const sequence = snapshot.sequences.find(row=>row.name==='users_id_seq');
  assert.equal(next,String(BigInt(sequence.value)+(sequence.is_called?1n:0n)));
});
