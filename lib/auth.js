import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDirectory, ConfigurationError } from './storage.js';

let cachedPassword, cachedKey;
function password() {
  if (process.env.ADMIN_PASSWORD !== undefined) {
    const value = process.env.ADMIN_PASSWORD;
    if (value.length < 12 || value.length > 256) throw new ConfigurationError('Defina ADMIN_PASSWORD com 12 a 256 caracteres na Vercel e faça um novo deploy.');
    return value;
  }
  if (process.env.VERCEL) throw new ConfigurationError('Defina apenas ADMIN_PASSWORD nas variáveis de ambiente da Vercel para entrar no painel. Não é necessário banco de dados.');
  const file = path.join(dataDirectory(), 'senha-admin.txt');
  if (!existsSync(file)) {
    mkdirSync(dataDirectory(), { recursive: true });
    try { writeFileSync(file, randomBytes(18).toString('base64url'), { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return readFileSync(file, 'utf8').trim();
}

function key() {
  const current = password();
  if (cachedPassword !== current) {
    cachedPassword = current;
    cachedKey = scryptSync(current, 'henrique-store-session-v2', 64);
  }
  return cachedKey;
}

export function verifyPassword(input) {
  const expected = key();
  return typeof input === 'string' && input.length <= 256 && timingSafeEqual(scryptSync(input, 'henrique-store-session-v2', 64), expected);
}

export function issueSession(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ expires: now + 28800000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return payload + '.' + createHmac('sha256', key()).update(payload).digest('base64url');
}

export function authenticated(token, now = Date.now()) {
  if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return false;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', key()).update(payload).digest();
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
  try {
    const { expires, nonce } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof nonce === 'string' && Number.isFinite(expires) && expires > now && expires <= now + 28800000;
  } catch { return false; }
}

// Best-effort local limiter; production-wide rules belong in the Vercel firewall.
const attempts = new Map();
export function attempt(ip) {
  const now = Date.now();
  for (const [entry, value] of attempts) if (value.expires <= now) attempts.delete(entry);
  if (attempts.size > 10000 && !attempts.has(ip)) return 11;
  const value = attempts.get(ip) || { count: 0, expires: now + 900000 };
  value.count++;
  attempts.set(ip, value);
  return value.count;
}
export function resetAttempts(ip) { attempts.delete(ip); }
