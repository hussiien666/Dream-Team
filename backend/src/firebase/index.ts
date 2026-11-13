import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const runtime = defineSecret('DREAM_EVENTS_RUNTIME');
let ready: Promise<import('express').Express> | undefined;
const allowed = new Set(['NODE_DATABASE_URL', 'PG_CA_CERT', 'PG_SSL', 'PG_POOL_MAX',
  'APP_ENCRYPTION_KEY', 'CORS_ORIGINS', 'PUBLIC_BASE_URL', 'SESSION_HOURS', 'ADMIN_IDLE_MINUTES',
  'TRUST_PROXY_HOPS', 'THROTTLE_TTL', 'THROTTLE_LIMIT', 'EMAIL_ENABLED', 'EMAIL_PROVIDER',
  'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'EMAIL_FROM', 'EMAIL_REPLY_TO',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'FIREBASE_AUTH_BRIDGE_ENABLED', 'FIREBASE_PROJECT_ID',
  'TURNSTILE_ENABLED', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_HOSTNAMES']);

export function applyRuntime(value: string) {
  const config: unknown = JSON.parse(value);
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Invalid runtime configuration.');
  for (const [name, setting] of Object.entries(config)) {
    if (!allowed.has(name) || typeof setting !== 'string') throw new Error('Invalid runtime configuration.');
    process.env[name] = setting;
  }
  process.env.NODE_ENV = process.env.FUNCTIONS_EMULATOR === 'true' ? 'test' : 'production';
  delete process.env.APP_KEY_FILE;
  delete process.env.PG_CA_FILE;
}

async function application() {
  if (!ready) ready = (async () => {
    const started = Date.now();
    console.info(JSON.stringify({ event: 'firebase.api_initializing', phase: 'configuration' }));
    applyRuntime(runtime.value());
    console.info(JSON.stringify({ event: 'firebase.api_initializing', phase: 'modules' }));
    const [{ default: express }, { createHttpApp }] = await Promise.all([
      import('express'), import('../http-app.js'),
    ]);
    const server = express();
    console.info(JSON.stringify({ event: 'firebase.api_initializing', phase: 'application', elapsedMs: Date.now() - started }));
    const app = await createHttpApp(server);
    await app.init();
    console.info(JSON.stringify({ event: 'firebase.api_initialized', elapsedMs: Date.now() - started }));
    return server;
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}

export const api = onRequest({ region: 'europe-west1', memory: '512MiB',
  timeoutSeconds: 180, concurrency: 10, maxInstances: 3, minInstances: 0,
  cors: false, secrets: [runtime] }, async (req, res) => {
  try {
    const maximum = req.get('content-type')?.startsWith('multipart/form-data') ? 10 * 1024 * 1024 + 65536 : 1024 * 1024;
    if (req.rawBody?.length > maximum) {
      res.set('Cache-Control', 'no-store').status(413).json({ message: 'The uploaded request is too large.' }); return;
    }
    const server = await application();
    await new Promise<void>(resolve => {
      res.once('finish', resolve); res.once('close', resolve);
      server(req, res);
    });
  } catch {
    console.error(JSON.stringify({ event: 'firebase.api_unavailable' }));
    if (!res.headersSent) res.set('Cache-Control', 'no-store').status(503).json({ message: 'The server is temporarily unavailable.' });
  }
});
