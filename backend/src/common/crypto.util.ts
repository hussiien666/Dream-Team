import { createHash, randomBytes } from 'crypto';

/** SHA-256 hex digest — identical to Python's digest() function */
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Generate a URL-safe random token + its SHA-256 hash */
export function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: digest(raw) };
}

/** QR token prefix — MUST match Python PREFIX = "AAST1." */
export const QR_PREFIX = 'AAST1.';

/** Build the full QR payload from a raw token */
export function qrPayload(rawToken: string): string {
  return QR_PREFIX + rawToken;
}

/** Extract token from QR payload and return its hash, or null if invalid */
export function parseQrPayload(qrValue: string): string | null {
  const v = (qrValue ?? '').trim();
  if (!v.startsWith(QR_PREFIX)) return null;
  const token = v.slice(QR_PREFIX.length);
  // base64url: 32 bytes → 43 chars
  if (token.length !== 43) return null;
  return digest(token);
}
