// Autenticación sin dependencias externas: hashing de contraseñas con
// scrypt (nativo de Node) y cookies de sesión firmadas con HMAC.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'lion-records-dev-secret-change-me';
const COOKIE_NAME = 'lr_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const hashBuffer = Buffer.from(hash, 'hex');
    const suppliedBuffer = crypto.scryptSync(password, salt, 64);
    return hashBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(hashBuffer, suppliedBuffer);
  } catch (e) {
    return false;
  }
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signSession(data) {
  const payload = { ...data, exp: Date.now() + SESSION_MS };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expectedSig = b64url(crypto.createHmac('sha256', SECRET).update(payloadB64).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(fromB64url(payloadB64).toString('utf-8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function sessionCookieHeader(token, { clear = false } = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [`${COOKIE_NAME}=${clear ? '' : encodeURIComponent(token)}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (isProd) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${Math.floor(SESSION_MS / 1000)}`);
  return parts.join('; ');
}

module.exports = {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  parseCookies,
  sessionCookieHeader,
  COOKIE_NAME
};
