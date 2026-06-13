const twitch = require('./twitch');

// Refresh the cached twitch_streamers rows from the Helix API.
//
// Per streamer we update:
//   • display_name / avatar_url        (from /users)
//   • is_live + live_game_name/title   (from /streams — live in ANY category)
//   • last_pokken_stream_at/title/vod  (monotonic max of: live-in-Pokkén "now",
//                                       newest Pokkén-category archive VOD, and
//                                       whatever the DB already knows)
//
// last_pokken_stream_at never moves backwards — Twitch VODs expire after
// 14–60 days, so once a date is gone from the API the DB copy is the only
// record. Called by the poller and by POST /api/twitch/refresh.
async function refreshTwitchStreamers(db) {
  const { rows } = await db.query(
    'SELECT id, login, last_pokken_stream_at FROM twitch_streamers'
  );
  if (!rows.length) return { total: 0, ok: 0, live: 0 };

  const logins = rows.map(r => r.login.toLowerCase());
  const gameIds = await twitch.getPokkenGameIds();
  const [users, streams, videos] = await Promise.all([
    twitch.getUsers(logins),
    twitch.getLiveStreams(logins),
    twitch.getRecentPokkenVideos(gameIds),
  ]);

  // Newest Pokkén VOD per login. The API returns newest-first, but we compare
  // anyway in case of multiple game IDs.
  const newestVod = new Map();
  for (const v of videos) {
    const login = (v.user_login || '').toLowerCase();
    if (!logins.includes(login)) continue;
    const prev = newestVod.get(login);
    if (!prev || new Date(v.created_at) > new Date(prev.created_at)) newestVod.set(login, v);
  }

  let ok = 0, live = 0;
  for (const row of rows) {
    const login = row.login.toLowerCase();
    const user = users.get(login);
    const stream = streams.get(login);
    const vod = newestVod.get(login);
    const liveInPokken = !!(stream && twitch.isPokkenGame(gameIds, stream));
    if (stream) live++;

    // Pick the best-known "last streamed Pokkén" moment.
    let bestAt = row.last_pokken_stream_at ? new Date(row.last_pokken_stream_at) : null;
    let bestTitle = null, bestVodUrl = null, changed = false;
    if (vod && (!bestAt || new Date(vod.created_at) > bestAt)) {
      bestAt = new Date(vod.created_at);
      bestTitle = vod.title || null;
      bestVodUrl = vod.url || null;
      changed = true;
    }
    if (liveInPokken && (!bestAt || Date.now() > bestAt.getTime())) {
      bestAt = new Date();
      bestTitle = stream.title || null;
      bestVodUrl = null; // the VOD doesn't exist yet; next refresh fills it
      changed = true;
    }

    await db.query(
      `UPDATE twitch_streamers SET
         display_name          = COALESCE($1, display_name),
         avatar_url            = COALESCE($2, avatar_url),
         is_live               = $3,
         live_game_name        = $4,
         live_title            = $5,
         last_pokken_stream_at = COALESCE($6, last_pokken_stream_at),
         last_pokken_title     = CASE WHEN $7 THEN $8 ELSE last_pokken_title END,
         last_pokken_vod_url   = CASE WHEN $7 THEN $9 ELSE last_pokken_vod_url END,
         last_checked_at       = NOW()
       WHERE id = $10`,
      [
        user?.display_name || null,
        user?.avatar_url || null,
        !!stream,
        stream?.game_name || null,
        stream?.title || null,
        bestAt ? bestAt.toISOString() : null,
        changed,
        bestTitle,
        bestVodUrl,
        row.id,
      ]
    );
    ok++;
  }
  return { total: rows.length, ok, live };
}

module.exports = { refreshTwitchStreamers };
