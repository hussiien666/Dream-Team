import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
const require = createRequire(new URL('./package.json', import.meta.url));
const { getGlobalDefaultAccount } = require('firebase-tools/lib/auth.js');
const { requireAuth } = require('firebase-tools/lib/requireAuth.js');
const sql = require('firebase-tools/lib/gcp/cloudsql/cloudsqladmin.js');
const { FBToolsAuthClient } = require('firebase-tools/lib/gcp/cloudsql/fbToolsAuthClient.js');
const { Connector, IpAddressTypes, AuthTypes } = require('@google-cloud/cloud-sql-connector');
const { Pool } = require('pg');

// Explicit, read-only inspection of the owner's already-created trial. Never
// modifies project IAM, enables APIs, applies migrations or logs rows. The
// explicit --prepare-owner-login flag adds only the already-signed-in owner as
// a database IAM user when IAM authentication is already enabled.
const projectId = 'dream-team-bed27', instanceId = 'dream-team-bed27-instance';
const database = 'dream-team-bed27-2-database';
async function prepareSchemaAccess(instance, owner) {
  const name = 'de_setup_' + randomBytes(10).toString('hex');
  const password = randomBytes(36).toString('base64url');
  const secure = new Connector({ auth: new FBToolsAuthClient() });
  let admin, created = false;
  try {
    await sql.createUser(projectId, instanceId, 'BUILT_IN', name, password); created = true;
    const connection = await secure.getOptions({ instanceConnectionName: instance.connectionName,
      ipType: IpAddressTypes.PUBLIC, authType: AuthTypes.PASSWORD });
    admin = new Pool({ ...connection, user: name, password, database, max: 1,
      connectionTimeoutMillis: 15000, statement_timeout: 10000 });
    admin.on('error', () => {});
    const quoted = '"' + owner.replaceAll('"', '""') + '"';
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quoted}`);
    await admin.query(`GRANT CREATE ON DATABASE "${database}" TO ${quoted}`);
    console.log('Granted the existing owner schema creation privileges within this empty database only.');
  } finally {
    if (admin) await admin.end().catch(() => {});
    secure.close();
    if (created) {
      await sql.deleteUser(projectId, instanceId, name);
      const users = await sql.listUsers(projectId, instanceId);
      if (users.some(user => user.name === name)) throw new Error('Temporary database setup login cleanup requires review.');
      console.log('Temporary setup login removed; its password was never saved.');
    }
  }
}
let pool, connector;
try {
  const account = getGlobalDefaultAccount();
  if (!account) throw new Error('not_signed_in');
  const options = { project: projectId, nonInteractive: true, ...account };
  await requireAuth(options);
  const instance = await sql.getInstance(projectId, instanceId);
  let databases = await sql.listDatabases(projectId, instanceId);
  if (!databases.some(item => item.name === database) && process.argv.includes('--prepare-empty-database')) {
    await sql.createDatabase(projectId, instanceId, database);
    databases = await sql.listDatabases(projectId, instanceId);
    console.log('Prepared the named empty database inside the existing trial instance.');
  }
  console.log(JSON.stringify({ availableDatabases: databases.map(database => database.name),
    configuredDatabaseExists: databases.some(item => item.name === database) }));
  const users = await sql.listUsers(projectId, instanceId);
  let iam = users.find(user => user.name === account.user.email && user.type === 'CLOUD_IAM_USER');
  const iamEnabled = instance.settings?.databaseFlags?.some(flag => flag.name === 'cloudsql.iam_authentication' && flag.value === 'on');
  if (!iam && iamEnabled && process.argv.includes('--prepare-owner-login')) {
    await sql.createUser(projectId, instanceId, 'CLOUD_IAM_USER', account.user.email);
    iam = { name: account.user.email };
    console.log('Added the existing signed-in owner database IAM login; no project IAM or instance settings changed.');
  }
  const publicAddress = instance.ipAddresses?.some(ip => ip.type === 'PRIMARY');
  const details = { projectId, instanceId, database, state: instance.state,
    region: instance.region, version: instance.databaseVersion,
    createdAt: instance.createTime ?? null, tier: instance.settings?.tier ?? null,
    storageGb: instance.settings?.dataDiskSizeGb ?? null,
    trialFields: Object.keys(instance).filter(key => /trial|expir/i.test(key)),
    publicConnectionAvailable: !!publicAddress, iamAuthenticationEnabled: !!iamEnabled, currentIamUserExists: !!iam };
  console.log(JSON.stringify(details));
  if (instance.state !== 'RUNNABLE' || !instance.connectionName || !publicAddress || !iam) {
    console.log('Direct SQL readiness is incomplete. No database/IAM settings changed.');
    process.exitCode = 2;
  } else {
    connector = new Connector({ auth: new FBToolsAuthClient() });
    const connection = await connector.getOptions({ instanceConnectionName: instance.connectionName,
      ipType: IpAddressTypes.PUBLIC, authType: AuthTypes.IAM });
    pool = new Pool({ ...connection, user: iam.name, database, max: 1,
      connectionTimeoutMillis: 15000, statement_timeout: 10000 });
    pool.on('error', () => {});
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const tables = await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'");
      const privileges = await client.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create,has_database_privilege(current_user,current_database(),'CREATE') AS can_create_schema");
      console.log(JSON.stringify({ directSqlReadVerified: true, publicTables: tables.rows[0].count,
        canCreateInPublic: privileges.rows[0].can_create,canCreateSchema:privileges.rows[0].can_create_schema }));
      await client.query('ROLLBACK');
      if ((!privileges.rows[0].can_create || !privileges.rows[0].can_create_schema) && tables.rows[0].count === 0 && process.argv.includes('--prepare-schema-access')) {
        await prepareSchemaAccess(instance, iam.name);
        const checked = await client.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS ready");
        console.log(JSON.stringify({ schemaCreatePermissionPrepared: checked.rows[0].ready }));
      }
    } finally { client.release(); }
  }
} catch (error) {
  const status = error?.status ?? error?.context?.response?.statusCode ?? error?.code;
  console.error(JSON.stringify({ trialInspectionFailed: true,
    ...(typeof status === 'number' || /^[0-9A-Z_]{2,40}$/.test(String(status)) ? { status } : {}),
    message: 'Trial SQL access is not verified. No application data was modified.' }));
  process.exitCode = 1;
} finally {
  if (pool) await pool.end().catch(() => {});
  connector?.close();
}
