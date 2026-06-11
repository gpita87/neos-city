const youtube = require('./youtube');

// Shared creator-refresh logic — the single source of truth used by the backend
// poller (services/poller.js), the standalone refresh_creators.js script, and
// the admin POST /api/creators/:id/refresh route. Every caller passes in a `db`
// with a `.query()` method (the backend pool wrapper, or a one-off pg Pool).

const DEFAULT_VIDEO_COUNT = 3;

// Refresh one creator: resolve its channel, pull the N most-recent uploads,
// replace its cached video rows, and update the denormalized latest_* columns
// (still used for the card's relative-time + the is_active threshold).
async function refreshCreator(db, creator, { videoCount = DEFAULT_VIDEO_COUNT } = {}) {
  let channelId = creator.channel_id;
  if (!channelId) {
    channelId = await youtube.resolveChannelId(creator.channel_url);
    if (!channelId) throw new Error('could not resolve channel ID from URL');
  }

  const { avatarUrl, videos } = await youtube.getChannelRecent(channelId, videoCount);
  const latest = videos[0] || null;

  await db.query(
    `UPDATE creators SET
       channel_id         = $2,
       avatar_url         = COALESCE($3, avatar_url),
       latest_upload_at   = $4,
       latest_video_id    = $5,
       latest_video_title = $6,
       last_checked_at    = NOW()
     WHERE id = $1`,
    [creator.id, channelId, avatarUrl,
     latest?.publishedAt || null, latest?.videoId || null, latest?.title || null]
  );

  // Replace the creator's recent-video set so the table holds exactly the
  // current top-N (older uploads naturally drop off as new ones land).
  await db.query('DELETE FROM creator_videos WHERE creator_id = $1', [creator.id]);
  for (const v of videos) {
    await db.query(
      `INSERT INTO creator_videos (creator_id, video_id, title, published_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (creator_id, video_id) DO UPDATE SET
         title = EXCLUDED.title, published_at = EXCLUDED.published_at`,
      [creator.id, v.videoId, v.title || null, v.publishedAt || null]
    );
  }

  return { channelId, videoCount: videos.length, latest };
}

// Refresh every creator. Never throws for a single bad channel — collects
// per-creator results so a poller run logs failures without aborting.
async function refreshAllCreators(db, opts = {}) {
  const { rows: creators } = await db.query(
    'SELECT id, name, channel_url, channel_id FROM creators ORDER BY sort_order, id'
  );
  let ok = 0, failed = 0;
  const results = [];
  for (const c of creators) {
    try {
      const r = await refreshCreator(db, c, opts);
      results.push({ name: c.name, ...r });
      ok++;
    } catch (err) {
      results.push({ name: c.name, error: err.message });
      failed++;
    }
  }
  return { ok, failed, total: creators.length, results };
}

// Fill in / refresh featured-video metadata (title, channel, thumbnail) from the
// YouTube API. With onlyMissing, skips rows that already have a title.
async function refreshFeatured(db, { onlyMissing = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, video_id FROM featured_videos
     ${onlyMissing ? 'WHERE title IS NULL' : ''}`
  );
  let ok = 0, failed = 0;
  for (const f of rows) {
    try {
      const meta = await youtube.getVideoMeta(f.video_id);
      if (!meta) throw new Error('video not found');
      await db.query(
        `UPDATE featured_videos SET
           title         = COALESCE($2, title),
           channel_name  = COALESCE($3, channel_name),
           thumbnail_url = COALESCE($4, thumbnail_url)
         WHERE id = $1`,
        [f.id, meta.title, meta.channelTitle, meta.thumbnailUrl]
      );
      ok++;
    } catch (err) {
      failed++;
    }
  }
  return { ok, failed, total: rows.length };
}

module.exports = { refreshCreator, refreshAllCreators, refreshFeatured, DEFAULT_VIDEO_COUNT };
