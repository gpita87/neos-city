const express = require('express');
const router = express.Router();
const db = require('../db');
const youtube = require('../services/youtube');
const { refreshCreator, refreshFeatured } = require('../services/refreshCreators');
const requireAdmin = require('../middleware/requireAdmin');

// How long since the last upload before a creator drops out of the "active"
// spotlight. Pokkén is a mature game with sporadic uploads, so the default is
// generous (4 months). Override per-request with ?active_days=N.
const DEFAULT_ACTIVE_DAYS = 120;

// GET /api/creators — every creator in curated order, each with a derived
// `is_active` flag, a resource count, and its recent uploads. Also returns the
// featured-video spotlight. `?active_days=N` tunes the is_active threshold.
router.get('/', async (req, res) => {
  const activeDays = Math.max(1, parseInt(req.query.active_days, 10) || DEFAULT_ACTIVE_DAYS);
  try {
    const { rows: creators } = await db.query(
      `SELECT
         c.*,
         (c.latest_upload_at IS NOT NULL
            AND c.latest_upload_at >= NOW() - make_interval(days => $1)) AS is_active,
         (SELECT COUNT(*)::int FROM resources r WHERE r.creator_id = c.id) AS resource_count,
         p.display_name AS player_name,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'video_id', v.video_id, 'title', v.title, 'published_at', v.published_at)
                  ORDER BY v.published_at DESC NULLS LAST)
           FROM creator_videos v WHERE v.creator_id = c.id
         ), '[]'::json) AS videos
       FROM creators c
       LEFT JOIN players p ON p.id = c.player_id
       ORDER BY c.sort_order ASC, c.name ASC`,
      [activeDays]
    );
    const { rows: featured } = await db.query(
      `SELECT id, video_id, title, channel_name, channel_url, note, thumbnail_url, sort_order
       FROM featured_videos
       ORDER BY sort_order ASC, added_at DESC`
    );
    res.json({ active_days: activeDays, creators, featured });
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
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::text[], '{}'), $7, $8, COALESCE($9, 0))
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

// ── Featured-video spotlight (registered before the /:id routes) ────────────

// POST /api/creators/featured — add/curate a spotlight video.
// Body: { video_id, note?, channel_url?, sort_order? }. Title/channel/thumbnail
// are filled from YouTube (best-effort here, and kept fresh by the poller).
router.post('/featured', requireAdmin, async (req, res) => {
  const { video_id, note, channel_url, sort_order } = req.body;
  if (!video_id) return res.status(400).json({ error: 'video_id is required' });
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO featured_videos (video_id, note, channel_url, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, 0))
       ON CONFLICT (video_id) DO UPDATE SET
         note        = COALESCE(EXCLUDED.note, featured_videos.note),
         channel_url = COALESCE(EXCLUDED.channel_url, featured_videos.channel_url),
         sort_order  = EXCLUDED.sort_order
       RETURNING *`,
      [video_id, note || null, channel_url || null, sort_order]
    );
    // Best-effort metadata fill; non-fatal if the API key is missing/over quota.
    try { await refreshFeatured(db, { onlyMissing: true }); } catch (e) { /* poller retries */ }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/creators/featured/:fid
router.delete('/featured/:fid', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM featured_videos WHERE id = $1', [req.params.fid]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/creators/:id/refresh — pull this creator's recent uploads from
// YouTube and cache them. Handy for testing without the poller / batch script.
router.post('/:id/refresh', requireAdmin, async (req, res) => {
  try {
    const { rows: [c] } = await db.query('SELECT * FROM creators WHERE id = $1', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Creator not found' });
    await refreshCreator(db, c);
    const { rows: [updated] } = await db.query('SELECT * FROM creators WHERE id = $1', [c.id]);
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
