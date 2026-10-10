import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);

export const tokenHash = value => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export function validPassword(value) { return typeof value === 'string' && value.length >= 12 && value.length <= 256; }
export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error('Use a password with 12–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password,salt,64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password,encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [algorithm,salt,hash] = (encoded || '').split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const candidate = await derive(password,salt,64);
  return timingSafeEqual(candidate,Buffer.from(hash,'hex'));
}
export function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid staff email.');
  return value.trim().toLowerCase();
}
export function safeFilePath(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^[a-zA-Z0-9_./-]+$/.test(value) ||
    value.split('/').some(part => !part || part.startsWith('.'))) throw new Error('Invalid upload path.');
  return value;
}
export function imageType(buffer) {
  if (buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer[0]===255 && buffer[1]===216 && buffer[2]===255) return 'image/jpeg';
  if (buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP') return 'image/webp';
  if (buffer.toString('ascii',4,8)==='ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(buffer.toString('ascii',8,12))) return 'image/heic';
  throw new Error('Upload a PNG, JPEG, WebP or HEIC image.');
}
