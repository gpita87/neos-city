const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { USER_COLUMNS, tokenVersionMatches } = require('./requireAuth');

// Compare two strings in constant time. timingSafeEqual rejects buffers of
// different lengths, so we pad the shorter one to a fixed compare length and
// then verify the original lengths matched.
function safeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a), 'utf8');
  const bBuf = Buffer.from(String(b), 'utf8');
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return crypto.timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

function bearerToken(req) {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

let warnedMissing = false;

// Transitional admin gate. Authorizes a request if EITHER:
//   (a) it carries a valid session bearer JWT for a user with is_admin = true
//       (same verify + token_version revocation check as requireAuth), OR
//   (b) it carries the legacy shared x-admin-token matching ADMIN_TOKEN.
// Fails closed: 503 if NEITHER mechanism is configured, 401 otherwise.
// The legacy token path stays until is_admin is confirmed working in prod;
// retiring it (and ADMIN_TOKEN) is the final cleanup step — see AUTH_HANDOFF.md.
async function requireAdmin(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;
  const jwtSecret = process.env.JWT_SECRET;

  if (!adminToken && !jwtSecret) {
    if (!warnedMissing) {
      console.warn('[requireAdmin] Neither ADMIN_TOKEN nor JWT_SECRET is set — all admin routes will 503. Set one in backend/.env.');
      warnedMissing = true;
    }
    return res.status(503).json({ error: 'Admin auth not configured on server' });
  }

  // (a) Admin session: a logged-in user whose is_admin = true.
  const token = bearerToken(req);
  if (token && jwtSecret) {
    try {
      const payload = jwt.verify(token, jwtSecret);
      const { rows: [user] } = await db.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [payload.sub]
      );
      if (user && tokenVersionMatches(payload, user) && user.is_admin) {
        req.user = user;
        return next();
      }
    } catch { /* invalid/expired token — fall through to legacy token */ }
  }

  // (b) Legacy shared secret.
  const provided = req.header('x-admin-token') || '';
  if (adminToken && provided && safeStringEqual(provided, adminToken)) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = requireAdmin;
