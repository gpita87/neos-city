const db = require('../db');
const { refreshAllCreators, refreshFeatured } = require('./refreshCreators');

// Background poller — keeps creator recent-uploads + featured-video metadata
// fresh from the always-on backend, so the /creators page never has to hit the
// YouTube API on a request. Self-contained: no cron infra, no duplicated
// secrets. Disabled automatically when YOUTUBE_API_KEY is unset.
//
// Tunables (backend/.env):
//   CREATOR_POLL_HOURS    interval in hours (default 6)
//   CREATOR_POLL_ON_BOOT  run once ~15s after boot unless set to "false"

const POLL_HOURS = parseFloat(process.env.CREATOR_POLL_HOURS) || 6;
const RUN_ON_BOOT = process.env.CREATOR_POLL_ON_BOOT !== 'false';

let timer = null;

async function runOnce() {
  try {
    const c = await refreshAllCreators(db);
    const f = await refreshFeatured(db);
    console.log(
      `[creator-poll] creators ${c.ok}/${c.total} refreshed` +
      `${c.skipped ? ` (${c.skipped} locked)` : ''}${c.failed ? ` (${c.failed} failed)` : ''}` +
      `; featured ${f.ok}/${f.total}`
    );
  } catch (err) {
    console.warn('[creator-poll] run failed:', err.message);
  }
}

// Start the interval. No-ops if already started or if no API key is configured.
function startCreatorPolling() {
  if (!process.env.YOUTUBE_API_KEY) {
    console.log('[creator-poll] YOUTUBE_API_KEY not set — polling disabled.');
    return;
  }
  if (timer) return;

  if (RUN_ON_BOOT) setTimeout(runOnce, 15_000);
  timer = setInterval(runOnce, Math.max(0.25, POLL_HOURS) * 3600 * 1000);
  // Don't keep the process alive solely for the timer — the HTTP server does
  // that, and unref lets a shutdown proceed cleanly.
  if (typeof timer.unref === 'function') timer.unref();

  console.log(`[creator-poll] enabled — every ${POLL_HOURS}h${RUN_ON_BOOT ? ' (and ~15s after boot)' : ''}.`);
}

module.exports = { startCreatorPolling, runOnce };
