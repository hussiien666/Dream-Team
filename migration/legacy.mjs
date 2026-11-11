/** Offline SQLite -> PostgreSQL migration. Never mutates the SQLite source. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from '../backend/node_modules/pg/lib/index.js';

export const mapping = JSON.parse(readFileSync(new URL('../backend/prisma/legacy-map.json', import.meta.url), 'utf8'));
const quote = name => '"'+name.replaceAll('"','""')+'"';
const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
function normalize(value, type) {
  if (value === null) return null;
  const base = type.replace('?', '');
  if (base === 'Bytes') {
    if (value?.$bytes !== undefined) return {$bytes: value.$bytes};
    return {$bytes: Buffer.from(value).toString('base64')};
  }
  if (base === 'Boolean') {
    if (![true,false,0,1].includes(value)) throw new Error('Invalid boolean in export');
    return Boolean(value);
  }
  if (base === 'DateTime') {
    const text = value instanceof Date ? value.toISOString() : String(value);
    const match = /^(\d{4}-\d\d-\d\d)(?:[ T](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z?)?$/.exec(text);
    if (!match) throw new Error('Invalid timestamp in export');
    return match[1]+(match[2] ? ' '+match[2]+'.'+(match[3] ?? '').padEnd(6,'0') : '');
  }
  if (base === 'Decimal') return Number(value).toFixed(2);
  return value;
}
function normalizeRow(table, row) {
  const result = {};
  for (const {column,type} of Object.values(mapping[table].fields)) result[column] = normalize(row[column], type);
  return result;
}
function rowsDigest(table, rows) {
  const values = rows.map(row => normalizeRow(table, row));
  values.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  return digest(values);
}

export function exportSqlite(source, output) {
  const db = new DatabaseSync(resolve(source), {readOnly: true});
  let snapshot;
  try {
    db.exec('BEGIN');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite integrity/relationships failed');
    const revision = db.prepare('SELECT version_num FROM alembic_version').get()?.version_num;
    if (revision !== '04_security_sessions') throw new Error('Expected legacy revision 04_security_sessions. Upgrade a protected copy first; do not guess at older schemas.');
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
    if (names.some(name => name !== 'alembic_version' && !mapping[name])) throw new Error('Unknown SQLite tables exist. Extend the explicit migration mapping before exporting.');
    const tables = {};
    for (const [table, meta] of Object.entries(mapping)) {
      const columns = db.prepare('PRAGMA table_info('+quote(table)+')').all().map(row=>row.name).sort();
      const expected = Object.values(meta.fields).map(f=>f.column).sort();
      if (JSON.stringify(columns) !== JSON.stringify(expected)) throw new Error('Unexpected columns in '+table);
      const rows = db.prepare('SELECT * FROM '+quote(table)).all().map(row=>normalizeRow(table,row));
      tables[table] = {rows, count: rows.length, digest: rowsDigest(table, rows)};
    }
    snapshot = {format: 'aast-legacy-v1', revision, exportedAt: new Date().toISOString(), tables};
    db.exec('COMMIT');
  } finally { db.close(); }
  writeFileSync(output, JSON.stringify(snapshot), {flag:'wx', mode:0o600});
  return {tables: Object.keys(snapshot.tables).length, rows: Object.values(snapshot.tables).reduce((sum,t)=>sum+t.count,0)};
}

export function validateSnapshot(snapshot) {
  if (snapshot.format !== 'aast-legacy-v1' || snapshot.revision !== '04_security_sessions') throw new Error('Unsupported migration export');
  if (JSON.stringify(Object.keys(snapshot.tables).sort()) !== JSON.stringify(Object.keys(mapping).sort())) throw new Error('Missing or unknown tables in export');
  for (const [table, content] of Object.entries(snapshot.tables)) {
    if (!Array.isArray(content.rows) || content.rows.length !== content.count || rowsDigest(table, content.rows) !== content.digest) throw new Error('Count/checksum mismatch in '+table);
    const columns = Object.values(mapping[table].fields).map(f=>f.column).sort();
    for (const row of content.rows) if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(columns)) throw new Error('Unexpected row fields in '+table);
  }
  return snapshot;
}

export async function importPostgres(input, {url, commit = false, reportFile} = {}) {
  if (!url?.startsWith('postgres')) throw new Error('Set NODE_DATABASE_URL to an empty, migrated PostgreSQL database.');
  const snapshot = validateSnapshot(JSON.parse(readFileSync(input, 'utf8')));
  // Preserve microseconds, rather than silently truncating timestamps through JS Date.
  const types = {getTypeParser(oid, format) {return oid === 1114 || oid === 1082 ? value => value : pg.types.getTypeParser(oid, format);}};
  const client = new pg.Client({connectionString: url, types});
  await client.connect();
  const report = {format: snapshot.format, sourceRevision: snapshot.revision, dryRun: !commit, at: new Date().toISOString(), tables: {}};
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(70514322)');
    for (const table of Object.keys(mapping)) {
      if (Number((await client.query('SELECT count(*) FROM '+quote(table))).rows[0].count)) throw new Error('Target is not empty: '+table+'. Import will not merge or overwrite records.');
    }
    for (const [table, meta] of Object.entries(mapping)) {
      const content = snapshot.tables[table];
      const fields = Object.values(meta.fields);
      const sql = 'INSERT INTO '+quote(table)+' ('+fields.map(f=>quote(f.column)).join(',')+') VALUES ('+fields.map((_,i)=>'$'+(i+1)).join(',')+')';
      for (const row of content.rows) {
        const values = fields.map(f => f.type.replace('?','') === 'Bytes' && row[f.column] !== null ? Buffer.from(row[f.column].$bytes, 'base64') : row[f.column]);
        await client.query(sql, values);
      }
      const actual = (await client.query('SELECT * FROM '+quote(table))).rows;
      const actualDigest = rowsDigest(table, actual);
      if (actual.length !== content.count || actualDigest !== content.digest) throw new Error('Imported rows differ in '+table);
      report.tables[table] = {count: actual.length, digest: actualDigest, verified: true};
    }
    // Sequence changes intentionally happen only on a committed import.
    if (commit) for (const [table, meta] of Object.entries(mapping)) {
      if (meta.fields.id?.type === 'Int') {
        await client.query("SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM "+quote(table)+"),1), EXISTS(SELECT 1 FROM "+quote(table)+"))", [table]);
      }
    }
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    report.result = commit ? 'Imported and verified' : 'Validated and rolled back; target remains empty';
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw new Error('Migration failed and rolled back. Review source schema/constraints; no source data was modified.', {cause:error});
  } finally { await client.end(); }
  if (reportFile) writeFileSync(reportFile, JSON.stringify(report,null,2), {flag:'wx',mode:0o600});
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, destination, ...flags] = process.argv.slice(2);
  try {
    if (command === 'export' && source && destination) console.log(JSON.stringify(exportSqlite(source,destination)));
    else if (command === 'import' && source && destination) {
      const report = await importPostgres(source,{url:process.env.NODE_DATABASE_URL,commit:flags.includes('--commit'),reportFile:destination});
      console.log(JSON.stringify({result:report.result, tables:Object.keys(report.tables).length}));
    } else throw new Error('Usage: node migration/legacy.mjs export source.db new-export.json | import export.json new-report.json [--commit] (default: dry-run)');
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
