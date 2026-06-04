/**
 * refresh_creators.js — Refresh every creator's latest-upload snapshot from the
 * YouTube Data API and cache it on the `creators` row. The /creators page reads
 * these cached values, so this is the only thing that ever touches YouTube.
 *
 * Usage (from the neos-city directory):
 *   node refresh_creators.js
 *
 * Requires YOUTUBE_API_KEY in backend/.env. Run it after seeding creators, and
 * periodically thereafter (e.g. a daily cron / GitHub Action) to keep the
 * active-vs-archive split honest.
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');
const youtube = require('./backend/src/services/youtube');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  if (!process.env.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY not set in backend/.env — aborting.');
    process.exit(1);
  }

  const { rows: creators } = await pool.query(
    'SELECT id, name, channel_url, channel_id FROM creators ORDER BY id'
  );
  if (creators.length === 0) {
    console.log('No creators to refresh. Seed some first (see seed_creators.js).');
    await pool.end();
    return;
  }

  console.log(`Refreshing ${creators.length} creator(s)…\n`);
  let ok = 0, failed = 0;

  for (const c of creators) {
    try {
      let channelId = c.channel_id;
      if (!channelId) {
        channelId = await youtube.resolveChannelId(c.channel_url);
        if (!channelId) throw new Error('could not resolve channel ID from URL');
      }

      const snap = await youtube.getChannelSnapshot(channelId);
      await pool.query(
        `UPDATE creators SET
           channel_id         = $2,
           avatar_url         = COALESCE($3, avatar_url),
           latest_upload_at   = $4,
           latest_video_id    = $5,
           latest_video_title = $6,
           last_checked_at    = NOW()
         WHERE id = $1`,
        [c.id, snap.channelId, snap.avatarUrl, snap.latestUploadAt,
         snap.latestVideoId, snap.latestVideoTitle]
      );

      const when = snap.latestUploadAt
        ? new Date(snap.latestUploadAt).toISOString().slice(0, 10)
        : 'no uploads';
      console.log(`✅ ${c.name.padEnd(24)} latest: ${when}`);
      ok++;
    } catch (err) {
      console.warn(`⚠️  ${c.name.padEnd(24)} ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${ok} refreshed, ${failed} failed.`);
  await pool.end();
})().catch(err => {
  console.error('Fatal:', err.message);
  pool.end();
  process.exit(1);
});
