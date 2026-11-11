import { config } from 'dotenv';
import { resolve } from 'node:path';
import pg from 'pg';
import { databaseOptions } from '../config/runtime.js';
config({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });
let client: pg.Client | undefined;
try {
  client = new pg.Client({ ...databaseOptions(), statement_timeout: 5000 });
  await client.connect();
  await client.query('SELECT 1');
  const tls = await client.query(
    'SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()',
  );
  const schema = await client.query(
    "SELECT to_regclass('public.users') IS NOT NULL AS ready",
  );
  console.log('PostgreSQL connection successful.');
  console.log(
    tls.rows[0]?.ssl
      ? 'TLS is active; server certificate verification is enabled.'
      : 'TLS is not active (local development only).',
  );
  console.log(
    schema.rows[0].ready
      ? 'Application users table exists.'
      : 'Application tables are not installed yet.',
  );
} catch (error) {
  const safeCodes = [
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    '28P01',
    '3D000',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'CERT_HAS_EXPIRED',
  ];
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  console.error(
    'PostgreSQL connection failed. Check NODE_DATABASE_URL, PG_SSL and the CA certificate file.' +
      (safeCodes.includes(code) ? ' Code: ' + code : ''),
  );
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
