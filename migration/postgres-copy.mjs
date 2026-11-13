/** Protected staging restore between PostgreSQL databases. No runtime cutover. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);
const migrationRoot = new URL('../backend/prisma/migrations/', import.meta.url);

async function schema(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
  const columns = (await client.query(`SELECT c.relname AS table_name,a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,
    coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS default_value
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`)).rows;
  const constraints = (await client.query(`SELECT c.relname AS table_name,k.conname AS name,
    pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname,k.conname`)).rows;
  const indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  const triggers = (await client.query(`SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,
    pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`)).rows;
  const functions = (await client.query(`SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`)).rows;
  return { tables, columns, constraints, indexes, triggers, functions };
}
async function rows(client, table) {
  // Keep PostgreSQL's canonical JSON text opaque: no JS numeric/date conversion.
  return (await client.query(`SELECT to_jsonb(t)::text AS value FROM public.${quote(table)} t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r => r.value);
}
async function migrations(records) {
  const files = [];
  const local = (await readdir(migrationRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  if (json(local) !== json(records.map(r => r.migration_name).sort())) throw new Error('Migration history does not match the reviewed local revisions.');
  for (const record of records.sort((a,b) => a.migration_name.localeCompare(b.migration_name))) {
    const sql = await readFile(new URL(record.migration_name + '/migration.sql', migrationRoot), 'utf8');
    if (![sql, sql.replaceAll('\r\n','\n'), sql.replace(/\r?\n/g,'\r\n')].some(value => hash(value) === record.checksum))
      throw new Error('An applied migration checksum differs from the reviewed source.');
    files.push({ name: record.migration_name, sql, digest: hash(sql) });
  }
  return files;
}
export async function snapshotPostgres(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const structure = await schema(client);
    const history = (await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
    if (history.some(row => !row.finished_at || row.rolled_back_at)) throw new Error('Incomplete migration history.');
    const revisions = await migrations(history);
    const tables = {};
    for (const table of structure.tables) {
      const values = await rows(client, table);
      tables[table] = { rows: values, count: values.length, digest: hash(json(values)) };
    }
    const dependencies = (await client.query(`SELECT c.relname AS child,p.relname AS parent
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname='public' ORDER BY c.relname,p.relname`)).rows;
    const sequences = [];
    for (const { sequencename, increment_by } of (await client.query("SELECT sequencename,increment_by::text FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows) {
      if (increment_by !== '1') throw new Error('Nonstandard sequences require explicit migration handling.');
      const state = (await client.query(`SELECT last_value::text AS value,is_called FROM public.${quote(sequencename)}`)).rows[0];
      sequences.push({ name: sequencename, ...state });
    }
    await client.query('COMMIT');
    return { format: 'dream-events-pg-staging-v1', createdAt: new Date().toISOString(), structure,
      schemaDigest: hash(json(structure)), revisions, dependencies, sequences, tables };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

function validate(snapshot) {
  if (snapshot?.format !== 'dream-events-pg-staging-v1' || hash(json(snapshot.structure)) !== snapshot.schemaDigest)
    throw new Error('Invalid staging snapshot.');
  if (json(Object.keys(snapshot.tables).sort()) !== json([...snapshot.structure.tables].sort())) throw new Error('Snapshot table mismatch.');
  for (const [name, table] of Object.entries(snapshot.tables)) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name) || table.count !== table.rows.length || hash(json(table.rows)) !== table.digest)
      throw new Error('Snapshot row verification failed.');
  }
}
function order(snapshot) {
  const pending = new Set(snapshot.structure.tables), result = [];
  while (pending.size) {
    const ready = [...pending].filter(table => snapshot.dependencies.every(fk => fk.child !== table || fk.parent === table || !pending.has(fk.parent)));
    if (!ready.length) throw new Error('Cyclic relationships require an explicit restore design.');
    for (const table of ready) { result.push(table); pending.delete(table); }
  }
  return result;
}
export async function restorePostgres(client, snapshot, { commit = false } = {}) {
  validate(snapshot);
  const reviewed = await migrations(snapshot.revisions.map(revision => ({ migration_name: revision.name, checksum: revision.digest })));
  if (json(reviewed) !== json(snapshot.revisions)) throw new Error('Snapshot migration SQL differs from reviewed source.');
  const ordered = order(snapshot);
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout='120s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(701386252)");
    if ((await client.query("SELECT 1 FROM pg_tables WHERE schemaname='public' LIMIT 1")).rowCount)
      throw new Error('The staging target must have no public tables; existing data was not changed.');
    for (const revision of reviewed) await client.query(revision.sql);
    // This metadata table belongs to the backup just like the restored revision
    // history. Migrations above execute their original reviewed SQL in full.
    await client.query(`CREATE TABLE _prisma_migrations (
      id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,finished_at timestamptz,
      migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0)`);
    const restoredSchema = await schema(client);
    if (hash(json(restoredSchema)) !== snapshot.schemaDigest) {
      const sections = Object.keys(restoredSchema).filter(key => json(restoredSchema[key]) !== json(snapshot.structure[key]));
      throw new Error('Restored schema differs from source in: ' + sections.join(', ') + '; transaction rolled back.');
    }
    // Restore the independent historical identity ledger verbatim. The normal
    // insert trigger would otherwise create duplicate identities on user load.
    await client.query('ALTER TABLE users DISABLE TRIGGER account_identity_created');
    const hasAuditScopes = ordered.includes('audit_organization_scopes');
    if (hasAuditScopes) await client.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_organization_recorded');
    for (const table of ordered) {
      const columns = snapshot.structure.columns.filter(column => column.table_name === table).map(column => quote(column.name)).join(',');
      const records = snapshot.tables[table].rows;
      for (let offset=0; offset<records.length; offset+=100)
        await client.query(`INSERT INTO public.${quote(table)} (${columns}) SELECT ${columns} FROM json_populate_recordset(NULL::public.${quote(table)},$1::json)`, ['['+records.slice(offset,offset+100).join(',')+']']);
    }
    await client.query('ALTER TABLE users ENABLE TRIGGER account_identity_created');
    if (hasAuditScopes) await client.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_organization_recorded');
    for (const table of ordered) {
      if (hash(json(await rows(client, table))) !== snapshot.tables[table].digest)
        throw new Error('Restored rows differ from source; transaction rolled back.');
    }
    if (hash(json(await schema(client))) !== snapshot.schemaDigest) throw new Error('Restored protection/schema verification failed.');
    // RESTART is transactional, unlike setval. Use the same next value; a
    // never-called sequence and an already-called sequence keep their semantics.
    for (const sequence of snapshot.sequences) {
      if (!/^\d+$/.test(sequence.value)) throw new Error('Invalid sequence state.');
      const next = BigInt(sequence.value) + (sequence.is_called ? 1n : 0n);
      await client.query(`ALTER SEQUENCE public.${quote(sequence.name)} RESTART WITH ${next}`);
    }
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return { dryRun: !commit, tables: ordered.length,
      rows: Object.values(snapshot.tables).reduce((sum,table) => sum + table.count,0),
      schemaDigest: snapshot.schemaDigest, allRowsMatched: true };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
