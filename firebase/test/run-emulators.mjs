import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Firebase CLI can debug-log the full child environment. Give it no provider
// secrets or database URI; only the actual test process receives the QA URL.
const mode = process.argv[2];
if (!['auth', 'rules', 'functions'].includes(mode)) throw new Error('Choose auth, rules or functions.');
const env = {};
for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC',
  'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'JAVA_HOME'])
  if (process.env[name] !== undefined) env[name] = process.env[name];
Object.assign(env, { CI: 'true', FIREBASE_CLI_DISABLE_MOTD: 'true', GCLOUD_PROJECT: 'demo-dream-events', FUNCTIONS_DISCOVERY_TIMEOUT: '60' });
let databaseFile, fixture;
const lock = fileURLToPath(new URL('../.emulators.lock', import.meta.url));
await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }).catch(() => {
  throw new Error('Another emulator validation is running. Run Firebase suites sequentially.');
});
try {
  if (mode === 'auth' || mode === 'functions') {
    const value = process.env.TEST_DATABASE_URL;
    const url = new URL(value ?? 'invalid:');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('TEST_DATABASE_URL must target a disposable loopback PostgreSQL server.');
    const scratch = fileURLToPath(new URL('../../tmp/', import.meta.url));
    await mkdir(scratch, { recursive: true });
    databaseFile = path.join(scratch, `firebase-test-${randomUUID()}.env`);
    await writeFile(databaseFile, value, { flag: 'wx', mode: 0o600 });
    env.FIREBASE_TEST_DATABASE_FILE = databaseFile;
    if (mode === 'functions') {
      const { prepareFunctionsFixture } = await import('./functions-fixture.mjs');
      fixture = await prepareFunctionsFixture(value);
    }
  }
  const cli = fileURLToPath(new URL('../node_modules/firebase-tools/lib/bin/firebase.js', import.meta.url));
  const script = mode === 'auth' ? 'node test/auth-suite.mjs' : mode === 'functions' ? 'node --test test/functions.test.mjs' : 'node --test test/rules.test.mjs';
  const child = spawn(process.execPath, [cli, 'emulators:exec', '--project', 'demo-dream-events',
    '--only', mode === 'auth' ? 'auth' : mode === 'functions' ? 'functions' : 'firestore,storage', script], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally {
  if (databaseFile) await unlink(databaseFile).catch(() => {});
  if (fixture) await fixture.cleanup();
  await unlink(lock).catch(() => {});
}
