/**
 * refresh_creators.js — Refresh every creator's recent uploads (and the
 * featured-video metadata) from the YouTube Data API and cache them in the DB.
 * The /creators page reads only these cached values, so this is the only thing
 * that touches YouTube — alongside the in-process poller (services/poller.js),
 * which runs the same shared logic automatically on the live backend.
 *
 * Usage (from the neos-city directory):
 *   node refresh_creators.js
 *
 * Requires YOUTUBE_API_KEY in backend/.env. Run it after seeding to populate
 * the page immediately; the backend poller keeps it fresh thereafter.
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');
const { refreshAllCreators, refreshFeatured } = require('./backend/src/services/refreshCreators');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  if (!process.env.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY not set in backend/.env — aborting.');
    process.exit(1);
  }

  console.log('Refreshing creators…\n');
  const c = await refreshAllCreators(pool);
  for (const r of c.results) {
    if (r.error) {
      console.warn(`⚠️  ${r.name.padEnd(24)} ${r.error}`);
    } else if (r.skipped) {
      console.log(`⏭️  ${r.name.padEnd(24)} locked (auto-update disabled)`);
    } else {
      const latest = r.latest?.publishedAt
        ? `, latest ${new Date(r.latest.publishedAt).toISOString().slice(0, 10)}`
        : '';
      console.log(`✅ ${r.name.padEnd(24)} ${r.videoCount} video(s)${latest}`);
    }
  }
  console.log(`\nCreators: ${c.ok} refreshed, ${c.skipped} locked, ${c.failed} failed.`);

  const f = await refreshFeatured(pool);
  console.log(`Featured: ${f.ok}/${f.total} refreshed${f.failed ? `, ${f.failed} failed` : ''}.`);

  await pool.end();
})().catch(err => {
  console.error('Fatal:', err.message);
  pool.end();
  process.exit(1);
});
