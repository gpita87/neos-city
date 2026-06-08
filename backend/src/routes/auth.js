const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const { requireAuth } = require('../middleware/requireAuth');

// ── Config / helpers ────────────────────────────────────────────────────────
//
// Login is OAuth-only: Discord and Google. There is no email/password path and
// no email sending — both providers return a provider-verified email, which is
// all we need to gate the future ranked identity. See resolveOAuthUser below.

const SESSION_TTL = '30d';
const STATE_TTL = '10m';

// Tighter limiter for the OAuth callbacks, on top of the global 500/15min.
// Loopback exempt in dev (matches app.js); in prod req.ip is the real client IP.
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: (req) => LOOPBACK_IPS.has(req.ip),
});

function secret() {
  return process.env.JWT_SECRET;
}
function ensureSecret(res) {
  if (!secret()) {
    res.status(503).json({ error: 'Auth not configured on server' });
    return false;
  }
  return true;
}
// Base URL of the frontend — target for the OAuth callback redirect.
// FRONTEND_URL is required in prod (app.js enforces); dev falls back to Vite.
function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}
// Embeds the user's token_version as `tv`. requireAuth rejects the token once
// token_version moves past it (logout-all), revoking old sessions. Accepts a
// row carrying { id, token_version }.
function signSession(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version ?? 0 }, secret(), { expiresIn: SESSION_TTL });
}
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Resolve (or create) the user for an OAuth login, returning a row carrying
// { id, token_version } for signSession. Shared by both callbacks. Precedence:
//   1. provider id (discord_id / google_id) — the stable per-provider key.
//   2. verified-email link — if this provider asserts a verified email and an
//      existing account already holds that same email *verified*, attach this
//      provider to it. This is how a Discord login and a Google login on the
//      same address become one account. Safe ONLY because every email in the
//      system is provider-verified (no self-registration), so the old
//      "attacker pre-registers an unverified email" takeover risk is gone.
//   3. otherwise create a new account; store the email only if it doesn't
//      collide with an existing row (else NULL), so the partial-unique index
//      on LOWER(email) can never throw.
async function resolveOAuthUser({ provider, providerId, email, emailVerified, username, avatarUrl, displayName }) {
  // Internal constants (not user input) — safe to interpolate into SQL.
  const idCol = provider === 'discord' ? 'discord_id' : 'google_id';
  const usernameCol = provider === 'discord' ? 'discord_username' : null; // no google_username column

  // 1. Known provider identity.
  const { rows: [byId] } = await db.query(
    `SELECT id, token_version FROM users WHERE ${idCol} = $1`, [providerId]
  );
  if (byId) {
    if (usernameCol) {
      await db.query(
        `UPDATE users SET ${usernameCol} = $1, avatar_url = COALESCE($2, avatar_url), updated_at = NOW()
         WHERE id = $3`,
        [username, avatarUrl, byId.id]
      );
    } else {
      await db.query(
        `UPDATE users SET avatar_url = COALESCE($1, avatar_url), updated_at = NOW() WHERE id = $2`,
        [avatarUrl, byId.id]
      );
    }
    return byId;
  }

  const normEmail = email ? normalizeEmail(email) : null;

  // 2. Verified-email link onto an existing verified account (cross-provider merge).
  if (normEmail && emailVerified) {
    const { rows: [byEmail] } = await db.query(
      `SELECT id, token_version FROM users WHERE LOWER(email) = $1 AND email_verified = TRUE`,
      [normEmail]
    );
    if (byEmail) {
      const setUsername = usernameCol ? `${usernameCol} = COALESCE(${usernameCol}, $3),` : '';
      // Param order: $1 = provider id, $2 = avatar, [$3 = username], next = display_name, last = id.
      const params = usernameCol
        ? [providerId, avatarUrl, username, displayName, byEmail.id]
        : [providerId, avatarUrl, displayName, byEmail.id];
      const dnParam = usernameCol ? '$4' : '$3';
      const idParam = usernameCol ? '$5' : '$4';
      await db.query(
        `UPDATE users SET ${idCol} = $1, avatar_url = COALESCE(avatar_url, $2), ${setUsername}
                display_name = COALESCE(display_name, ${dnParam}), updated_at = NOW()
         WHERE id = ${idParam}`,
        params
      );
      return byEmail;
    }
  }

  // 3. Create a new account. Store the email only if it's free.
  let emailToStore = null;
  let storeVerified = false;
  if (normEmail) {
    const { rows: [clash] } = await db.query(`SELECT 1 FROM users WHERE LOWER(email) = $1`, [normEmail]);
    if (!clash) {
      emailToStore = normEmail;
      storeVerified = !!emailVerified;
    }
  }
  if (usernameCol) {
    const { rows: [created] } = await db.query(
      `INSERT INTO users (${idCol}, ${usernameCol}, avatar_url, email, email_verified, display_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, token_version`,
      [providerId, username, avatarUrl, emailToStore, storeVerified, displayName]
    );
    return created;
  }
  const { rows: [created] } = await db.query(
    `INSERT INTO users (${idCol}, avatar_url, email, email_verified, display_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, token_version`,
    [providerId, avatarUrl, emailToStore, storeVerified, displayName]
  );
  return created;
}

// ── Session ─────────────────────────────────────────────────────────────────

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ── Discord OAuth2 ──────────────────────────────────────────────────────────

// GET /api/auth/discord — kick off the flow.
router.get('/discord', (req, res) => {
  if (!ensureSecret(res)) return;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !redirectUri) return res.status(503).json({ error: 'Discord login not configured' });

  const state = jwt.sign({ purpose: 'discord_state' }, secret(), { expiresIn: STATE_TTL });
  const url = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify email',
    state,
  }).toString();
  res.redirect(url);
});

// GET /api/auth/discord/callback — exchange code, resolve user, hand back a token.
router.get('/discord/callback', authLimiter, async (req, res) => {
  const base = frontendUrl();
  const fail = (msg) => {
    console.error('[auth] discord callback:', msg);
    res.redirect(`${base}/login?error=discord`);
  };
  if (!secret()) return fail('JWT_SECRET unset');

  const { code, state } = req.query;
  try {
    const sp = jwt.verify(String(state || ''), secret());
    if (sp.purpose !== 'discord_state') throw new Error('bad state');
  } catch {
    return fail('invalid state');
  }
  if (!code) return fail('missing code');

  try {
    // Exchange the auth code for an access token.
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // Fetch the Discord identity.
    const me = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });
    const d = me.data; // { id, username, email, verified, avatar }
    const avatarUrl = d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png` : null;

    const sessionUser = await resolveOAuthUser({
      provider: 'discord',
      providerId: d.id,
      email: d.email,
      emailVerified: !!d.verified,
      username: d.username,
      avatarUrl,
      displayName: d.username,
    });

    // Hand the session token to the frontend via URL fragment (not query) so it
    // never lands in server logs / referrers / browser history.
    res.redirect(`${base}/auth/callback#token=${signSession(sessionUser)}`);
  } catch (err) {
    fail(err.response?.data?.error_description || err.message);
  }
});

// ── Google OAuth2 ───────────────────────────────────────────────────────────

// GET /api/auth/google — kick off the flow.
router.get('/google', (req, res) => {
  if (!ensureSecret(res)) return;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) return res.status(503).json({ error: 'Google login not configured' });

  const state = jwt.sign({ purpose: 'google_state' }, secret(), { expiresIn: STATE_TTL });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  }).toString();
  res.redirect(url);
});

// GET /api/auth/google/callback — exchange code, resolve user, hand back a token.
router.get('/google/callback', authLimiter, async (req, res) => {
  const base = frontendUrl();
  const fail = (msg) => {
    console.error('[auth] google callback:', msg);
    res.redirect(`${base}/login?error=google`);
  };
  if (!secret()) return fail('JWT_SECRET unset');

  const { code, state } = req.query;
  try {
    const sp = jwt.verify(String(state || ''), secret());
    if (sp.purpose !== 'google_state') throw new Error('bad state');
  } catch {
    return fail('invalid state');
  }
  if (!code) return fail('missing code');

  try {
    // Exchange the auth code for an access token.
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // Fetch the Google identity.
    const me = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });
    const g = me.data; // { sub, email, email_verified, name, picture }

    const sessionUser = await resolveOAuthUser({
      provider: 'google',
      providerId: g.sub,
      email: g.email,
      // userinfo returns a boolean, but tolerate the string form defensively.
      emailVerified: g.email_verified === true || g.email_verified === 'true',
      username: g.name,
      avatarUrl: g.picture || null,
      displayName: g.name,
    });

    res.redirect(`${base}/auth/callback#token=${signSession(sessionUser)}`);
  } catch (err) {
    fail(err.response?.data?.error_description || err.response?.data?.error || err.message);
  }
});

// ── Account ↔ player linking (trust-based self-claim) ───────────────────────

// POST /api/auth/link  { player_id }
// Any signed-in (OAuth-authenticated) user may claim — the provider login is
// itself the identity proof, so there's no separate email-verification gate.
router.post('/link', requireAuth, async (req, res) => {
  const playerId = Number(req.body.player_id);
  if (!playerId) return res.status(400).json({ error: 'player_id required' });
  if (req.user.player_id) return res.status(409).json({ error: 'Your account is already linked to a player' });

  try {
    const { rows: [player] } = await db.query(`SELECT id FROM players WHERE id = $1`, [playerId]);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    // First-come: claim only if no other user holds this player. The partial
    // unique index is the hard guarantee; the NOT EXISTS makes a race return a
    // clean 409 rather than a constraint error.
    const { rows: [updated] } = await db.query(
      `UPDATE users SET player_id = $1, updated_at = NOW()
       WHERE id = $2 AND NOT EXISTS (SELECT 1 FROM users WHERE player_id = $1)
       RETURNING player_id`,
      [playerId, req.user.id]
    );
    if (!updated) return res.status(409).json({ error: 'That player is already claimed' });
    res.json({ success: true, player_id: updated.player_id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That player is already claimed' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/unlink — user releases their own claim.
router.post('/unlink', requireAuth, async (req, res) => {
  await db.query(`UPDATE users SET player_id = NULL, updated_at = NOW() WHERE id = $1`, [req.user.id]);
  res.json({ success: true });
});

// POST /api/auth/logout-all — bump token_version to invalidate every session
// (including this one). The caller's current token stops working immediately;
// the frontend should clear it locally and send the user to sign in again.
router.post('/logout-all', requireAuth, async (req, res) => {
  await db.query(
    `UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1`,
    [req.user.id]
  );
  res.json({ success: true });
});

// POST /api/auth/admin/unlink  { user_id } — admin safety valve.
router.post('/admin/unlink', requireAdmin, async (req, res) => {
  const userId = Number(req.body.user_id);
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  await db.query(`UPDATE users SET player_id = NULL, updated_at = NOW() WHERE id = $1`, [userId]);
  res.json({ success: true });
});

module.exports = router;
