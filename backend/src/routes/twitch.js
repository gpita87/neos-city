const express = require('express');
const router = express.Router();
const db = require('../db');
const twitch = require('../services/twitch');
const { refreshTwitchStreamers } = require('../services/refreshTwitch');
const requireAdmin = require('../middleware/requireAdmin');

// GET /api/twitch — every tracked streamer with cached live status + last
// Pokkén stream date. Live-in-Pokkén first, then most recent Pokkén stream,
// never-seen channels last (in curated order). Reads only the DB — the Helix
// API is hit by the background poller, not here.
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, login, display_name, avatar_url, is_live, live_game_name,
              live_title, last_pokken_stream_at, last_pokken_title,
              last_pokken_vod_url, last_checked_at
       FROM twitch_streamers
       ORDER BY
         (is_live AND live_game_name ~* 'pokk[eé]n') DESC,
         is_live DESC,
         last_pokken_stream_at DESC NULLS LAST,
         sort_order ASC, login ASC`
    );
    res.json({
      configured: twitch.isConfigured(),
      last_checked_at: rows.reduce(
        (max, r) => (r.last_checked_at && (!max || r.last_checked_at > max)) ? r.last_checked_at : max,
        null
      ),
      streamers: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/twitch/refresh — pull fresh data from Twitch now. Handy for testing
// without waiting on the poller.
router.post('/refresh', requireAdmin, async (req, res) => {
  try {
    if (!twitch.isConfigured()) {
      return res.status(503).json({ error: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set' });
    }
    const summary = await refreshTwitchStreamers(db);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
