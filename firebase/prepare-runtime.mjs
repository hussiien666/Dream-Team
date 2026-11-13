import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validateEnvironment } from '../backend/dist/config/runtime.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const { parse } = createRequire(new URL('../backend/package.json', import.meta.url))('dotenv');
const backend = path.join(root, 'backend');
const env = parse(await readFile(path.join(backend, '.env')));
const keys = ['NODE_DATABASE_URL', 'PG_SSL', 'PG_POOL_MAX', 'CORS_ORIGINS', 'PUBLIC_BASE_URL',
  'SESSION_HOURS', 'ADMIN_IDLE_MINUTES', 'THROTTLE_TTL', 'THROTTLE_LIMIT', 'EMAIL_PROVIDER',
  'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'EMAIL_FROM', 'EMAIL_REPLY_TO',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'FIREBASE_AUTH_BRIDGE_ENABLED', 'FIREBASE_PROJECT_ID',
  'TURNSTILE_ENABLED', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_HOSTNAMES'];
const config = Object.fromEntries(keys.filter(key => env[key]).map(key => [key, env[key]]));
config.NODE_DATABASE_URL = env.NODE_DATABASE_URL || env.DATABASE_URL || '';
config.CORS_ORIGINS = env.HOSTED_CORS_ORIGINS || config.CORS_ORIGINS;
config.PUBLIC_BASE_URL = env.HOSTED_PUBLIC_BASE_URL || config.PUBLIC_BASE_URL;
config.APP_ENCRYPTION_KEY = env.APP_ENCRYPTION_KEY || (env.APP_KEY_FILE ? (await readFile(path.resolve(backend, env.APP_KEY_FILE), 'utf8')).trim() : '');
config.PG_CA_CERT = env.PG_CA_CERT || (env.PG_CA_FILE ? await readFile(path.resolve(backend, env.PG_CA_FILE), 'utf8') : '');
config.EMAIL_ENABLED = 'false';
config.TRUST_PROXY_HOPS = '1';
// Each Functions instance owns its own pool; do not inherit a larger local pool.
config.PG_POOL_MAX = env.HOSTED_PG_POOL_MAX || '2';
if (!config.CORS_ORIGINS || config.CORS_ORIGINS.split(',').some(value => !value.trim().startsWith('https://')))
  throw new Error('Set exact approved HTTPS Vercel/scanner origins in backend/.env before preparing the hosted runtime.');
validateEnvironment({ ...config, NODE_ENV: 'production' });
const directory = path.join(root, 'tmp'); await mkdir(directory, { recursive: true });
const output = path.join(directory, 'firebase-runtime.json');
await writeFile(output, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
console.log('Private runtime prepared in ignored tmp/firebase-runtime.json. Keep this file private; email remains disabled.');
