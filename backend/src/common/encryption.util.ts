import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

function getKey(): Buffer {
  const value = process.env.APP_ENCRYPTION_KEY || (process.env.APP_KEY_FILE ? readFileSync(process.env.APP_KEY_FILE, 'utf8').trim() : '');
  const key = /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64url');
  if (key.length !== 32) throw new Error('Set a private 32-byte APP_ENCRYPTION_KEY or APP_KEY_FILE. Retain the legacy Fernet key when importing security profiles.');
  return key;
}

/** New values use authenticated AES-GCM; imported Fernet remains readable. */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

export function unseal(value: string): string {
  const key = getKey();
  if (value.startsWith('v1:')) {
    const parts = value.split(':');
    if (parts.length !== 4) throw new Error('Invalid protected value');
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    cipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([cipher.update(Buffer.from(parts[3], 'base64url')), cipher.final()]).toString('utf8');
  }
  // Legacy Node scaffold format (never emitted by the Python application).
  if (value.includes(':')) {
    const [iv, tag, data] = value.split(':');
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8');
  }
  // Fernet specification: version | timestamp | IV | AES-CBC | HMAC-SHA256.
  const token = Buffer.from(value, 'base64url');
  if (token.length < 73 || token[0] !== 0x80 || (token.length-57) % 16 !== 0) throw new Error('Invalid legacy protected value');
  const data = token.subarray(0, -32);
  const signature = createHmac('sha256', key.subarray(0, 16)).update(data).digest();
  if (!timingSafeEqual(signature, token.subarray(-32))) throw new Error('Invalid legacy protected value');
  const cipher = createDecipheriv('aes-128-cbc', key.subarray(16), token.subarray(9, 25));
  return Buffer.concat([cipher.update(token.subarray(25, -32)), cipher.final()]).toString('utf8');
}
