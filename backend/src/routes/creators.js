const express = require('express');
const router = express.Router();
const db = require('../db');
const youtube = require('../services/youtube');
const requireAdmin = require('../middleware/requireAdmin');

// How long since the last upload before a creator drops out of the "active"
// spotlight. Pokkén is a mature game with sporadic uploads, so the default is
// generous (4 months). Override per-request with ?active_days=N.
const DEFAULT_ACTIVE_DAYS = 120;

// GET /api/creators — every creator, newest-upload first, with a derived
// `is_active` flag and a resource count. `?active_days=N` tunes the threshold.
router.get('/', async (req, res) => {
  const activeDays = Math.max(1, parseInt(req.query.active_days, 10) || DEFAULT_ACTIVE_DAYS);
  try {
    const { rows } = await db.query(
      `SELECT
         c.*,
         (c.latest_upload_at IS NOT NULL
            AND c.latest_upload_at >= NOW() - make_interval(days => $1)) AS is_active,
         (SELECT COUNT(*)::int FROM resources r WHERE r.creator_id = c.id) AS resource_count,
         p.display_name AS player_name
       FROM creators c
       LEFT JOIN players p ON p.id = c.player_id
       ORDER BY is_active DESC NULLS LAST,
                c.latest_upload_at DESC NULLS LAST,
                c.sort_order ASC,
                c.name ASC`,
      [activeDays]
    );
    res.json({ active_days: activeDays, creators: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/creators — add or update a creator (upsert on channel_id).
// Body: { name, channel_url, channel_id?, blurb?, region?, series?, player_id?,
//         avatar_url?, sort_order? }. If channel_id is omitted we try to resolve
// it from channel_url so the refresh job can find the channel.
router.post('/', requireAdmin, async (req, res) => {
  const {
    name, channel_url, blurb, region, series, player_id, avatar_url, sort_order,
  } = req.body;
  let { channel_id } = req.body;

  if (!name || !channel_url) {
    return res.status(400).json({ error: 'name and channel_url are required' });
  }

  try {
    if (!channel_id) {
      // Best-effort resolve; non-fatal if it fails (refresh can fix it later).
      try { channel_id = await youtube.resolveChannelId(channel_url); }
      catch (e) { console.warn('[creators] channel resolve failed:', e.message); }
    }

    const seriesArr = Array.isArray(series) ? series : null;

    // Upsert keyed on channel_id when we have one; otherwise plain insert.
    const { rows: [creator] } = await db.query(
      `INSERT INTO creators
         (name, channel_url, channel_id, blurb, region, series, player_id, avatar_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, '{}'), $7, $8, COALESCE($9, 0))
       ON CONFLICT (channel_id) WHERE channel_id IS NOT NULL DO UPDATE SET
         name        = EXCLUDED.name,
         channel_url = EXCLUDED.channel_url,
         blurb       = COALESCE(EXCLUDED.blurb, creators.blurb),
         region      = COALESCE(EXCLUDED.region, creators.region),
         series      = EXCLUDED.series,
         player_id   = COALESCE(EXCLUDED.player_id, creators.player_id),
         avatar_url  = COALESCE(EXCLUDED.avatar_url, creators.avatar_url),
         sort_order  = EXCLUDED.sort_order
       RETURNING *`,
      [name, channel_url, channel_id || null, blurb || null, region || null,
       seriesArr, player_id || null, avatar_url || null, sort_order]
    );
    res.json(creator);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/creators/:id/refresh — pull this creator's latest upload from
// YouTube and cache it. Useful for testing without running the batch script.
router.post('/:id/refresh', requireAdmin, async (req, res) => {
  try {
    const { rows: [c] } = await db.query('SELECT * FROM creators WHERE id = $1', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Creator not found' });

    let channelId = c.channel_id;
    if (!channelId) channelId = await youtube.resolveChannelId(c.channel_url);
    if (!channelId) return res.status(422).json({ error: 'Could not resolve channel ID' });

    const snap = await youtube.getChannelSnapshot(channelId);
    const { rows: [updated] } = await db.query(
      `UPDATE creators SET
         channel_id         = $2,
         avatar_url         = COALESCE($3, avatar_url),
         latest_upload_at   = $4,
         latest_video_id    = $5,
         latest_video_title = $6,
         last_checked_at    = NOW()
       WHERE id = $1
       RETURNING *`,
      [c.id, snap.channelId, snap.avatarUrl, snap.latestUploadAt,
       snap.latestVideoId, snap.latestVideoTitle]
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/creators/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM creators WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
