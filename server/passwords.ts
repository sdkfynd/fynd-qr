import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { APIError } from './validation.ts';

// OWASP's 32 MiB scrypt profile: N=2^15, r=8, p=3; unique 128-bit salt.
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
let active = 0;
async function derive(password: string, salt: Buffer) {
  // Bound expensive work globally as well as throttling individual login routes.
  if (active >= 4) throw new APIError(429, 'Sign-in is busy. Please try again in a moment.');
  active++;
  try { return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, parameters, (error, key) => error ? reject(error) : resolve(key))); }
  finally { active--; }
}
export function checkPassword(password: string) {
  if ([...password].length < 15 || password.length > 128) throw new APIError(400, 'Use a password or passphrase with 15–128 characters.');
  if (/^(.)\1+$/.test(password) || ['passwordpassword', 'password123456789', '123456789012345', 'qwertyuiopasdfgh', 'thisisapassword'].includes(password.toLowerCase())) throw new APIError(400, 'Choose a less predictable password or passphrase.');
}
export function accountEmail(input: string) {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z\d.!#$%&'*+\/=?^_`{|}~-]+@[a-z\d-]+(?:\.[a-z\d-]+)+$/.test(email)) throw new APIError(400, 'Enter a valid email address.');
  return email;
}
export async function hashPassword(password: string) {
  checkPassword(password);
  const salt = randomBytes(16), key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
}
// The dummy verifier makes unknown accounts perform the same expensive operation.
const dummy = `scrypt$32768$8$3$${randomBytes(16).toString('hex')}$${randomBytes(32).toString('hex')}`;
export async function verifyPassword(password: string, encoded?: string) {
  const match = /^scrypt\$32768\$8\$3\$([a-f\d]{32})\$([a-f\d]{64})$/.exec(encoded || dummy);
  if (!match) { await derive(password, Buffer.alloc(16)); return false; }
  const key = await derive(password, Buffer.from(match[1], 'hex'));
  return timingSafeEqual(key, Buffer.from(match[2], 'hex')) && !!encoded;
}
