import pg from '../../backend/node_modules/pg/lib/index.js';
import { importPostgres } from '../../migration/legacy.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export async function prepareFunctionsFixture(base) {
  const name = 'dream_functions_' + randomUUID().replaceAll('-', '');
  const control = new pg.Client({ connectionString: base });
  await control.connect();
  await control.query('CREATE DATABASE "' + name + '" TEMPLATE template0 ENCODING \'UTF8\' LC_COLLATE \'C\' LC_CTYPE \'C\'');
  const target = new URL(base); target.pathname = '/' + name;
  const url = target.toString();
  const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
  const env = { ...process.env, NODE_DATABASE_URL: url, PRISMA_MIGRATION_DATABASE_URL: url,
    PG_SSL: 'false', PG_CA_FILE: '', PG_CA_CERT: '' };
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: backend, env, encoding: 'utf8', timeout: 60000,
  });
  if (migrated.status !== 0) {
    const safe = (migrated.error?.message || migrated.stderr || '').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/g, '[private database URL]').slice(-1800);
    await control.query('DROP DATABASE "' + name + '" WITH (FORCE)'); await control.end();
    throw new Error('Disposable Functions schema setup failed: ' + safe);
  }
  await importPostgres(fileURLToPath(new URL('../../backend/test/legacy-fixture.json', import.meta.url)), { url, commit: true });
  const secret = fileURLToPath(new URL('../functions/.secret.local', import.meta.url));
  const runtime = { NODE_DATABASE_URL: url, PG_SSL: 'false', PG_POOL_MAX: '2',
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
    CORS_ORIGINS: 'http://127.0.0.1:5174', THROTTLE_LIMIT: '10000', EMAIL_ENABLED: 'false',
    RESEND_WEBHOOK_SECRET: 'whsec_' + Buffer.alloc(32, 8).toString('base64') };
  await writeFile(secret, "DREAM_EVENTS_RUNTIME='" + JSON.stringify(runtime) + "'\n", { flag: 'wx', mode: 0o600 });
  return { cleanup: async () => {
    await unlink(secret);
    await control.query('DROP DATABASE "' + name + '" WITH (FORCE)');
    await control.end();
  } };
}
