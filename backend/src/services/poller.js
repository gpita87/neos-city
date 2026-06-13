const db = require('../db');
const { refreshAllCreators, refreshFeatured, refreshPlaylists } = require('./refreshCreators');
const twitch = require('./twitch');
const { refreshTwitchStreamers } = require('./refreshTwitch');

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
    const pl = await refreshPlaylists(db);
    console.log(
      `[creator-poll] creators ${c.ok}/${c.total} refreshed` +
      `${c.skipped ? ` (${c.skipped} locked)` : ''}${c.failed ? ` (${c.failed} failed)` : ''}` +
      `; featured ${f.ok}/${f.total}; playlists ${pl.ok}/${pl.total}`
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

// ── Twitch streamers poll ─────────────────────────────────────────────────────
// Keeps twitch_streamers live-status + last-Pokkén-stream data fresh. Shorter
// cadence than the creator poll because live status goes stale in minutes.
// Disabled automatically when the Twitch app credentials are unset.
//
// Tunables (backend/.env):
//   TWITCH_POLL_MINUTES   interval in minutes (default 10)
//   TWITCH_POLL_ON_BOOT   run once ~20s after boot unless set to "false"

const TWITCH_POLL_MINUTES = parseFloat(process.env.TWITCH_POLL_MINUTES) || 10;
const TWITCH_RUN_ON_BOOT = process.env.TWITCH_POLL_ON_BOOT !== 'false';

let twitchTimer = null;

async function runTwitchOnce() {
  try {
    const r = await refreshTwitchStreamers(db);
    console.log(`[twitch-poll] ${r.ok}/${r.total} streamers refreshed (${r.live} live)`);
  } catch (err) {
    console.warn('[twitch-poll] run failed:', err.message);
  }
}

function startTwitchPolling() {
  if (!twitch.isConfigured()) {
    console.log('[twitch-poll] TWITCH_CLIENT_ID/SECRET not set — polling disabled.');
    return;
  }
  if (twitchTimer) return;

  if (TWITCH_RUN_ON_BOOT) setTimeout(runTwitchOnce, 20_000);
  twitchTimer = setInterval(runTwitchOnce, Math.max(1, TWITCH_POLL_MINUTES) * 60 * 1000);
  if (typeof twitchTimer.unref === 'function') twitchTimer.unref();

  console.log(`[twitch-poll] enabled — every ${TWITCH_POLL_MINUTES}min${TWITCH_RUN_ON_BOOT ? ' (and ~20s after boot)' : ''}.`);
}

module.exports = { startCreatorPolling, runOnce, startTwitchPolling, runTwitchOnce };
