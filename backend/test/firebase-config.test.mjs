import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvironment } from '../dist/config/runtime.js';
const base = { NODE_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5555/synthetic', NODE_ENV: 'test' };
test('Firebase identity bridge rejects invalid projects and remote emulators', () => {
  assert.doesNotThrow(() => validateEnvironment(base));
  assert.throws(() => validateEnvironment({ ...base, FIREBASE_AUTH_BRIDGE_ENABLED: 'yes' }));
  assert.throws(() => validateEnvironment({ ...base, FIREBASE_AUTH_BRIDGE_ENABLED: 'true' }));
  assert.throws(() => validateEnvironment({ ...base, FIREBASE_AUTH_EMULATOR_HOST: 'external.example:9099' }));
  assert.doesNotThrow(() => validateEnvironment({ ...base, FIREBASE_AUTH_BRIDGE_ENABLED: 'true',
    FIREBASE_PROJECT_ID: 'demo-dream-events', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }));
  assert.throws(() => validateEnvironment({ ...base, NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }));
  assert.throws(() => validateEnvironment({ ...base, PORT: '0' }));
  assert.doesNotThrow(() => validateEnvironment({ ...base, PORT: 'named-pipe', FUNCTION_TARGET: 'api' }));
});
