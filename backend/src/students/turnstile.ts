import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';

export function turnstileConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.TURNSTILE_ENABLED && !['true', 'false'].includes(env.TURNSTILE_ENABLED))
    throw new Error('TURNSTILE_ENABLED must be true or false.');
  if (env.TURNSTILE_ENABLED !== 'true') return undefined;
  const siteKey = env.TURNSTILE_SITE_KEY ?? '', secret = env.TURNSTILE_SECRET_KEY ?? '';
  const hostnames = (env.TURNSTILE_HOSTNAMES ?? '').split(',').map(s => s.trim());
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(siteKey) || !/^[A-Za-z0-9_-]{10,200}$/.test(secret) ||
      !hostnames.length || hostnames.some(host => !/^(localhost|[a-z0-9]+(?:[.-][a-z0-9]+)*)$/.test(host)))
    throw new Error('Configure Turnstile keys and exact lowercase TURNSTILE_HOSTNAMES.');
  if (env.NODE_ENV === 'production' && (/[123]x0{8}/.test(siteKey) || /[123]x0{8}/.test(secret)))
    throw new Error('Turnstile testing keys are forbidden in production.');
  return { siteKey, secret, hostnames };
}

@Injectable()
export class TurnstileService {
  publicSettings() {
    const config = turnstileConfig();
    return config ? { siteKey: config.siteKey } : null;
  }

  async verify(token: string | undefined) {
    const config = turnstileConfig();
    if (!config) return;
    const denied = () => new BadRequestException('Complete the security check again, then retry. Your form details have been kept.');
    if (!token || token.length > 2048 || /\s/.test(token)) throw denied();
    let result: Record<string, unknown>;
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        // Never transmit the invitation capability, form values or untrusted forwarded IP headers.
        body: JSON.stringify({ secret: config.secret, response: token }),
      });
      if (!response.ok || !response.body) throw new Error('verification unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 16384) throw new Error('verification unavailable');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid response');
    } catch {
      // Fail closed; provider bodies and tokens must never be logged or returned.
      throw new ServiceUnavailableException('The security check is temporarily unavailable. Retry after a moment.');
    }
    const timestamp = typeof result.challenge_ts === 'string' ? Date.parse(result.challenge_ts) : NaN;
    if (result.success !== true || result.action !== 'public-invitation' ||
        typeof result.hostname !== 'string' || !config.hostnames.includes(result.hostname) ||
        !Number.isFinite(timestamp) || Date.now() - timestamp > 300000 || timestamp - Date.now() > 60000)
      throw denied();
  }
}
