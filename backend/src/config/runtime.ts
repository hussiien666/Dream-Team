import { readFileSync } from 'node:fs';
import { emailMode, smtpOptions } from '../email/smtp.config.js';
import { turnstileConfig } from '../students/turnstile.js';
import { gmailOptions } from '../email/gmail.config.js';
export function databaseOptions(env: NodeJS.ProcessEnv = process.env) {
  const value = env.NODE_DATABASE_URL ?? env.DATABASE_URL;
  if (!value || !/^postgres(ql)?:\/\//.test(value))
    throw new Error('Configure a PostgreSQL NODE_DATABASE_URL.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid PostgreSQL connection configuration.');
  }
  const production = env.NODE_ENV === 'production';
  const cloudSql = env.CLOUD_SQL_CONNECTION_NAME;
  if (cloudSql && (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z0-9-]+:[a-z][a-z0-9-]+$/.test(cloudSql) ||
      !(env.K_SERVICE || env.CLOUD_RUN_JOB) || url.hostname !== 'localhost' || url.search || url.hash || !url.username || !url.password))
    throw new Error('Cloud SQL sockets require a managed Cloud Run service, exact instance name and localhost credentials without URL options.');
  const mode = url.searchParams.get('sslmode');
  const tls =
    production || env.PG_SSL === 'true' || (!!mode && mode !== 'disable');
  if (
    production && !cloudSql &&
    (env.PG_SSL === 'false' || ['disable', 'no-verify'].includes(mode ?? ''))
  )
    throw new Error(
      'Production database TLS certificate verification is required.',
    );
  const ca =
    env.PG_CA_CERT ||
    (env.PG_CA_FILE ? readFileSync(env.PG_CA_FILE, 'utf8') : undefined);
  if (tls && !ca && env.PG_SSL === 'true')
    throw new Error('Configure PG_CA_CERT or PG_CA_FILE for the database CA.');
  // pg URL ssl parameters otherwise override the explicit verified TLS object.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'])
    url.searchParams.delete(key);
  const max = Number(env.PG_POOL_MAX ?? 10);
  if (!Number.isInteger(max) || max < 1 || max > 50)
    throw new Error('PG_POOL_MAX must be an integer from 1 to 50.');
  return {
    ...(cloudSql ? { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)) } : { connectionString: url.toString() }),
    max,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    // Cloud Run's managed Unix socket encrypts/verifies the remote hop via Auth Proxy.
    // Never disable TLS for ordinary TCP connections.
    ...(cloudSql ? { host: '/cloudsql/' + cloudSql, ssl: false as const } : tls
      ? { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } }
      : {}),
  };
}
export function validateEnvironment(env: Record<string, string>) {
  if (
    !['development', 'test', 'production'].includes(
      env.NODE_ENV ?? 'development',
    )
  )
    throw new Error('Invalid NODE_ENV.');
  databaseOptions(env);
  turnstileConfig(env);
  if (env.FIREBASE_AUTH_BRIDGE_ENABLED && !['true', 'false'].includes(env.FIREBASE_AUTH_BRIDGE_ENABLED))
    throw new Error('FIREBASE_AUTH_BRIDGE_ENABLED must be true or false.');
  if (env.FIREBASE_AUTH_NATIVE_ENABLED && !['true', 'false'].includes(env.FIREBASE_AUTH_NATIVE_ENABLED))
    throw new Error('FIREBASE_AUTH_NATIVE_ENABLED must be true or false.');
  if ((env.FIREBASE_AUTH_BRIDGE_ENABLED === 'true' || env.FIREBASE_AUTH_NATIVE_ENABLED === 'true') &&
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIREBASE_PROJECT_ID ?? ''))
    throw new Error('Configure FIREBASE_PROJECT_ID before enabling the identity bridge.');
  if (env.FIREBASE_AUTH_EMULATOR_HOST && (env.NODE_ENV === 'production' ||
      !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(env.FIREBASE_AUTH_EMULATOR_HOST)))
    throw new Error('Firebase Authentication emulator must be local and non-production.');
  if (env.EMAIL_ENABLED && !['true', 'false'].includes(env.EMAIL_ENABLED))
    throw new Error('EMAIL_ENABLED must be true or false.');
  const mailMode = emailMode(env);
  if (env.EMAIL_REPLY_TO && !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(env.EMAIL_REPLY_TO))
    throw new Error('EMAIL_REPLY_TO must be one valid email address.');
  if (env.EMAIL_ENABLED === 'true' && mailMode === 'smtp') smtpOptions(env);
  if (env.EMAIL_ENABLED === 'true' && mailMode === 'gmail') gmailOptions(env);
  if (
    env.EMAIL_ENABLED === 'true' &&
    ((mailMode === 'resend' && !env.RESEND_API_KEY?.startsWith('re_')) ||
      !env.EMAIL_FROM ||
      !/^[^\r\n]+@[^\s@]+\.[^\s@]+>?$/.test(env.EMAIL_FROM))
  )
    throw new Error(
      'Configure the selected email provider and a verified EMAIL_FROM before enabling email.',
    );
  const prod = env.NODE_ENV === 'production';
  for (const [key, min, max, fallback] of [
    ['SESSION_HOURS', 1, 24, 8],
    ['ADMIN_IDLE_MINUTES', 5, 240, 30],
    ['THROTTLE_TTL', 1000, 3600000, 60000],
    ['THROTTLE_LIMIT', 1, 100000, 100],
    ['PORT', 1, 65535, 3000],
  ] as const) {
    // Firebase/Cloud Run owns the listener; its emulator may use a named pipe.
    if (key === 'PORT' && env.FUNCTION_TARGET) continue;
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${key}.`);
  }
  if (!['0', '1', '2'].includes(env.TRUST_PROXY_HOPS ?? '0'))
    throw new Error('TRUST_PROXY_HOPS must be 0, 1 or 2.');
  const origins = (
    env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174'
  )
    .split(',')
    .map((s) => s.trim());
  if (prod && !env.CORS_ORIGINS)
    throw new Error('Explicit production CORS_ORIGINS are required.');
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain exact origins.');
    }
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          !prod &&
          ['localhost', '127.0.0.1'].includes(url.hostname)
        ))
    )
      throw new Error('CORS_ORIGINS must contain approved HTTPS origins.');
  }
  if (prod && !env.APP_ENCRYPTION_KEY && !env.APP_KEY_FILE)
    throw new Error('The preserved encryption key is required.');
  return env;
}
