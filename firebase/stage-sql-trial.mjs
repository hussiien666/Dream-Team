import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pg from '../backend/node_modules/pg/lib/index.js';
import { databaseOptions } from '../backend/dist/config/runtime.js';
import { seal, unseal } from '../backend/dist/common/encryption.util.js';
import { snapshotPostgres, restorePostgres } from '../migration/postgres-copy.mjs';
const require = createRequire(new URL('./package.json', import.meta.url));
const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url));
const { getGlobalDefaultAccount } = require('firebase-tools/lib/auth.js');
const { requireAuth } = require('firebase-tools/lib/requireAuth.js');
const { getInstance } = require('firebase-tools/lib/gcp/cloudsql/cloudsqladmin.js');
const { FBToolsAuthClient } = require('firebase-tools/lib/gcp/cloudsql/fbToolsAuthClient.js');
const { Connector, IpAddressTypes, AuthTypes } = require('@google-cloud/cloud-sql-connector');
const root = fileURLToPath(new URL('../', import.meta.url));
const backend = path.join(root,'backend');
const env = backendRequire('dotenv').parse(await readFile(path.join(backend,'.env')));
const sourceUrl = new URL(env.NODE_DATABASE_URL || env.DATABASE_URL || 'invalid:');
if (!sourceUrl.hostname.endsWith('.aivencloud.com')) throw new Error('Expected the existing Aiven staging source.');
process.env.APP_ENCRYPTION_KEY = env.APP_ENCRYPTION_KEY || '';
process.env.APP_KEY_FILE = env.APP_KEY_FILE ? path.resolve(backend,env.APP_KEY_FILE) : '';
if (env.PG_CA_FILE) env.PG_CA_FILE = path.resolve(backend,env.PG_CA_FILE);
const commit = process.argv.includes('--commit');
let source, pool, connector, target;
try {
  source = new pg.Client({...databaseOptions(env),statement_timeout:30000}); await source.connect();
  const snapshot = await snapshotPostgres(source);
  console.log(JSON.stringify({ snapshotTables: Object.keys(snapshot.tables).length,
    snapshotRows: Object.values(snapshot.tables).reduce((sum,table)=>sum+table.count,0) }));
  // Backup is authenticated-encrypted and verified before any target restore.
  const directory = path.join(root,'migration/exports'); await mkdir(directory,{recursive:true});
  const file = path.join(directory,'aiven-before-sql-trial-'+Date.now()+'.encrypted');
  const text = JSON.stringify(snapshot), encrypted = seal(text);
  if (unseal(encrypted) !== text) throw new Error('Backup round-trip verification failed.');
  await writeFile(file,encrypted,{flag:'wx',mode:0o600});
  console.log('Protected source snapshot saved and decrypted/verified; do not publish migration/exports.');
  await source.end(); source=undefined;
  const account = getGlobalDefaultAccount(); if (!account) throw new Error('Firebase CLI sign-in is required.');
  await requireAuth({project:'dream-team-bed27',nonInteractive:true,...account});
  const instance = await getInstance('dream-team-bed27','dream-team-bed27-instance');
  if (instance.state !== 'RUNNABLE' || instance.region !== 'us-east4') throw new Error('Expected trial instance is not ready.');
  connector = new Connector({auth:new FBToolsAuthClient()});
  const options = await connector.getOptions({instanceConnectionName:instance.connectionName,
    ipType:IpAddressTypes.PUBLIC,authType:AuthTypes.IAM});
  pool = new pg.Pool({...options,user:account.user.email,database:'dream-team-bed27-2-database',max:1,connectionTimeoutMillis:15000});
  pool.on('error',()=>{}); target=await pool.connect();
  const result = await restorePostgres(target,snapshot,{commit});
  const report = {createdAt:new Date().toISOString(),target:'dreamteam-66',sourceBackup:path.basename(file),...result,
    applicationConnectionChanged:false,emailSent:false};
  await writeFile(path.join(directory,'sql-trial-report-'+Date.now()+'.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(report));
} catch (error) {
  // No provider/SQL error bodies: they can contain source rows or credentials.
  const message = typeof error?.message === 'string' && /^(Restored schema differs|Migration history|An applied migration|The staging target|Cyclic relationships|Nonstandard sequences|Restored rows differ)/.test(error.message)
    ? error.message : 'Staging restore did not complete. Application connections were not changed.';
  console.error(message); process.exitCode=1;
  if (/^[0-9A-Z]{5}$/.test(String(error?.code))) console.error('PostgreSQL error code: ' + error.code);
} finally {
  target?.release(); if(pool) await pool.end().catch(()=>{}); connector?.close(); if(source) await source.end().catch(()=>{});
}
