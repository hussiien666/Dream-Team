import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g)!.map(part => ALPHABET[parseInt(part, 2)]).join('');
}

export function totp(secret: string, counter = Math.floor(Date.now()/30000)): string {
  const chars = secret.replace(/=+$/, '').toUpperCase();
  if (!/^[A-Z2-7]+$/.test(chars)) throw new Error('Invalid authenticator secret');
  const bits = [...chars].map(c => ALPHABET.indexOf(c).toString(2).padStart(5,'0')).join('');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(s => parseInt(s, 2)));
  const moving = Buffer.alloc(8);
  moving.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', key).update(moving).digest();
  return String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export function matchedCounter(secret: string, code: string, after: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(Date.now()/30000);
  for (let c=now-1; c<=now+1; c++) {
    if (c > after && timingSafeEqual(Buffer.from(totp(secret, c)), Buffer.from(code))) return c;
  }
  return null;
}
