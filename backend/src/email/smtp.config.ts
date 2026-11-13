import { gmailOptions } from './gmail.config.js';
export function emailMode(env: NodeJS.ProcessEnv = process.env): 'resend' | 'smtp' | 'gmail' {
  const mode = env.EMAIL_PROVIDER ?? 'resend';
  if (!['resend', 'smtp', 'gmail'].includes(mode)) throw new Error('EMAIL_PROVIDER must be gmail, resend or smtp.');
  return mode as 'resend' | 'smtp' | 'gmail';
}
export function smtpOptions(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.SMTP_PORT ?? 587);
  if (!env.SMTP_HOST || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(env.SMTP_HOST) ||
      ![465, 587].includes(port) || !env.SMTP_USERNAME || !env.SMTP_PASSWORD ||
      /[\r\n]/.test(env.SMTP_USERNAME + env.SMTP_PASSWORD))
    throw new Error('Configure SMTP_HOST, port 465 or 587, and private SMTP credentials.');
  return {
    host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  };
}
export function emailConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (env.EMAIL_ENABLED !== 'true' || !env.EMAIL_FROM) return false;
  try {
    if (emailMode(env) === 'gmail') { gmailOptions(env); return true; }
    if (emailMode(env) === 'smtp') { smtpOptions(env); return true; }
    return !!env.RESEND_API_KEY;
  } catch { return false; }
}
