const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const { requireAuth, USER_COLUMNS } = require('../middleware/requireAuth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');

// ── Config / helpers ────────────────────────────────────────────────────────

const SESSION_TTL = '30d';
const VERIFY_TTL = '24h';
const RESET_TTL = '1h';
const STATE_TTL = '10m';
const BCRYPT_COST = 10;

// Tighter limiter for credential endpoints, on top of the global 500/15min.
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
// Base URL of the frontend — target for emailed links + the Discord redirect.
// FRONTEND_URL is required in prod (app.js enforces); dev falls back to Vite.
function frontendUrl() {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}
function signSession(userId) {
  return jwt.sign({ sub: userId }, secret(), { expiresIn: SESSION_TTL });
}
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Fetch the public-safe user shape (no password_hash) for response bodies.
async function fetchPublicUser(id) {
  const { rows: [user] } = await db.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]
  );
  return user || null;
}

// ── Email + password ────────────────────────────────────────────────────────

// POST /api/auth/register  { email, password, display_name? }
router.post('/register', authLimiter, async (req, res) => {
  if (!ensureSecret(res)) return;
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const displayName = req.body.display_name ? String(req.body.display_name).trim() : null;

  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const { rows: [row] } = await db.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [email, passwordHash, displayName]
    );

    // Fire-and-await the verification email (dev fallback logs it to console).
    const verifyToken = jwt.sign({ sub: row.id, purpose: 'verify_email' }, secret(), { expiresIn: VERIFY_TTL });
    await sendVerificationEmail(email, `${frontendUrl()}/verify-email#token=${verifyToken}`)
      .catch(err => console.error('[auth] verification email failed:', err.message));

    res.status(201).json({ token: signSession(row.id), user: await fetchPublicUser(row.id) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login  { email, password }
router.post('/login', authLimiter, async (req, res) => {
  if (!ensureSecret(res)) return;
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  try {
    const { rows: [row] } = await db.query(
      `SELECT id, password_hash FROM users WHERE LOWER(email) = $1`, [email]
    );
    // Generic message for every failure mode (no user / bad password / no password).
    const ok = row && row.password_hash && await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: signSession(row.id), user: await fetchPublicUser(row.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/verify-email  { token }
router.post('/verify-email', authLimiter, async (req, res) => {
  if (!ensureSecret(res)) return;
  try {
    const payload = jwt.verify(String(req.body.token || ''), secret());
    if (payload.purpose !== 'verify_email') throw new Error('wrong purpose');
    await db.query(`UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1`, [payload.sub]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Invalid or expired verification link' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', requireAuth, async (req, res) => {
  if (req.user.email_verified) return res.json({ success: true, already_verified: true });
  if (!req.user.email) return res.status(400).json({ error: 'No email on file to verify' });
  const verifyToken = jwt.sign({ sub: req.user.id, purpose: 'verify_email' }, secret(), { expiresIn: VERIFY_TTL });
  await sendVerificationEmail(req.user.email, `${frontendUrl()}/verify-email#token=${verifyToken}`)
    .catch(err => console.error('[auth] verification resend failed:', err.message));
  res.json({ success: true });
});

// POST /api/auth/request-password-reset  { email }
// Always 200 — never reveal whether an account exists.
router.post('/request-password-reset', authLimiter, async (req, res) => {
  if (!ensureSecret(res)) return;
  const email = normalizeEmail(req.body.email);
  try {
    const { rows: [row] } = await db.query(
      `SELECT id, email FROM users WHERE LOWER(email) = $1 AND password_hash IS NOT NULL`, [email]
    );
    if (row) {
      const resetToken = jwt.sign({ sub: row.id, purpose: 'pwreset' }, secret(), { expiresIn: RESET_TTL });
      await sendPasswordResetEmail(row.email, `${frontendUrl()}/reset-password#token=${resetToken}`)
        .catch(err => console.error('[auth] reset email failed:', err.message));
    }
  } catch (err) {
    console.error('[auth] request-password-reset:', err.message);
  }
  res.json({ success: true });
});

// POST /api/auth/reset-password  { token, password }
router.post('/reset-password', authLimiter, async (req, res) => {
  if (!ensureSecret(res)) return;
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const payload = jwt.verify(String(req.body.token || ''), secret());
    if (payload.purpose !== 'pwreset') throw new Error('wrong purpose');
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await db.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, payload.sub]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Invalid or expired reset link' });
  }
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

    // Resolve identity by discord_id ONLY — never merge by email (takeover risk).
    let userId;
    const { rows: [existing] } = await db.query(`SELECT id FROM users WHERE discord_id = $1`, [d.id]);
    if (existing) {
      await db.query(
        `UPDATE users SET discord_username = $1, avatar_url = COALESCE($2, avatar_url), updated_at = NOW()
         WHERE id = $3`,
        [d.username, avatarUrl, existing.id]
      );
      userId = existing.id;
    } else {
      // Store the Discord email only if it doesn't collide with an existing
      // account — otherwise leave it NULL so we never implicitly merge.
      let emailToStore = null;
      let emailVerified = false;
      if (d.email) {
        const { rows: [clash] } = await db.query(
          `SELECT 1 FROM users WHERE LOWER(email) = $1`, [normalizeEmail(d.email)]
        );
        if (!clash) {
          emailToStore = normalizeEmail(d.email);
          emailVerified = !!d.verified;
        }
      }
      const { rows: [created] } = await db.query(
        `INSERT INTO users (discord_id, discord_username, avatar_url, email, email_verified, display_name)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [d.id, d.username, avatarUrl, emailToStore, emailVerified, d.username]
      );
      userId = created.id;
    }

    // Hand the session token to the frontend via URL fragment (not query) so it
    // never lands in server logs / referrers / browser history.
    res.redirect(`${base}/auth/callback#token=${signSession(userId)}`);
  } catch (err) {
    fail(err.response?.data?.error_description || err.message);
  }
});

// ── Account ↔ player linking (trust-based self-claim) ───────────────────────

// POST /api/auth/link  { player_id }
router.post('/link', requireAuth, async (req, res) => {
  if (!req.user.email_verified) {
    return res.status(403).json({ error: 'Verify your email before claiming a player' });
  }
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

// POST /api/auth/admin/unlink  { user_id } — admin safety valve.
router.post('/admin/unlink', requireAdmin, async (req, res) => {
  const userId = Number(req.body.user_id);
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  await db.query(`UPDATE users SET player_id = NULL, updated_at = NOW() WHERE id = $1`, [userId]);
  res.json({ success: true });
});

module.exports = router;
