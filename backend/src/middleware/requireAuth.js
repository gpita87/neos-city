const jwt = require('jsonwebtoken');
const db = require('../db');

// Columns returned for req.user. Never includes password_hash.
// token_version backs session revocation — see the `tv` check below.
const USER_COLUMNS = `id, email, email_verified, discord_id, discord_username,
                      google_id, display_name, ingame_name, region, avatar_url, player_id, is_admin, token_version`;

// A session token is only valid while its `tv` claim matches the user's current
// token_version. Tokens minted before this column existed carry no `tv` claim;
// treat those as version 0 (the column default) so a deploy doesn't mass-logout.
function tokenVersionMatches(payload, user) {
  return (payload.tv ?? 0) === user.token_version;
}

let warnedMissing = false;

function loadSecret(res) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (!warnedMissing) {
      console.warn('[requireAuth] JWT_SECRET is not set — all auth routes will 503. Set it in backend/.env.');
      warnedMissing = true;
    }
    if (res) res.status(503).json({ error: 'Auth not configured on server' });
    return null;
  }
  return secret;
}

function bearerToken(req) {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Verify a session JWT, load the user, attach to req.user. Fails closed.
// The per-request DB lookup keeps is_admin / player_id authoritative, so an
// admin unlink or a fresh claim takes effect immediately (not at token expiry).
async function requireAuth(req, res, next) {
  const secret = loadSecret(res);
  if (!secret) return; // 503 already sent
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, secret);
    const { rows: [user] } = await db.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [payload.sub]
    );
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!tokenVersionMatches(payload, user)) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Non-blocking variant: attaches req.user if a valid token is present, else
// leaves req.user = null and continues. For routes that behave differently when
// logged in (e.g. a "claim this profile" button on the public player profile).
async function attachUser(req, res, next) {
  req.user = null;
  const secret = process.env.JWT_SECRET;
  const token = bearerToken(req);
  if (!secret || !token) return next();
  try {
    const payload = jwt.verify(token, secret);
    const { rows: [user] } = await db.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [payload.sub]
    );
    req.user = (user && tokenVersionMatches(payload, user)) ? user : null;
  } catch { /* invalid token — stay anonymous */ }
  next();
}

module.exports = { requireAuth, attachUser, USER_COLUMNS, tokenVersionMatches };
