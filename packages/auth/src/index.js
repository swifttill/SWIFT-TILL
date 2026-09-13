const crypto = require('crypto');

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 12);
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.JWT_SECRET || 'swifttill-local-dev-secret-change-me';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signPayload(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (Buffer.byteLength(expected) !== Buffer.byteLength(parts[2])) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!String(stored).startsWith('scrypt$')) return String(password) === String(stored);
  const [, salt, hash] = String(stored).split('$');
  const test = hashPassword(password, salt).split('$')[2];
  return crypto.timingSafeEqual(Buffer.from(test), Buffer.from(hash));
}

function createSession(user, permissions = []) {
  return signPayload({ sub: user.id, email: user.email, name: user.name, permissions, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });
}

function parseBearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

module.exports = { hashPassword, verifyPassword, createSession, verifyToken, parseBearer, SESSION_TTL_MS };
