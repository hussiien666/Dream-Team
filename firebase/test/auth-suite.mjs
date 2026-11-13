import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099')
  throw new Error('This suite must use the local Authentication emulator.');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern=Firebase', 'test/migration-auth.integration.mjs'], {
  cwd: new URL('../../backend/', import.meta.url), stdio: 'inherit',
  env: { ...process.env, TEST_DATABASE_URL: readFileSync(process.env.FIREBASE_TEST_DATABASE_FILE, 'utf8'), FIREBASE_PROJECT_ID: 'demo-dream-events', FIREBASE_AUTH_BRIDGE_ENABLED: 'true',
    RUN_FIREBASE_AUTH_TESTS: 'true', NODE_ENV: 'test' },
});
process.exitCode = result.status ?? 1;
