const axios = require('axios');

// ─── Twitch Helix API ─────────────────────────────────────────────────────────
//
// Powers the (feature-flagged) Twitch streams page. Used only by the background
// poller / refreshTwitch.js — the frontend reads cached DB rows, so Twitch is
// never on the request path.
//
// Auth: app access token via the client-credentials flow. Register an app at
// https://dev.twitch.tv/console/apps (category "Website Integration", redirect
// URL can be http://localhost), then set TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET
// in backend/.env. Rate limit is 800 points/min per app — a full refresh here
// costs well under 20 requests, so polling every few minutes is trivial.
//
// How "last streamed Pokkén" is derived (official API only — no GQL scraping):
//   1. GET /streams?user_login=...  → anyone live RIGHT NOW, with their category.
//   2. GET /videos?game_id=<pokkén> → recent archive VODs in the Pokkén category,
//      newest first. VODs only persist 14–60 days on Twitch, so this sees a
//      rolling window — refreshTwitch.js persists the max into the DB so dates
//      survive VOD expiry. Streamers with VODs disabled are only caught live.

const HELIX = 'https://api.twitch.tv/helix';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

function isConfigured() {
  return !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

// ── App access token (client credentials), cached until shortly before expiry ─
let cachedToken = null; // { token, expiresAtMs }

async function getAppToken() {
  if (!isConfigured()) throw new Error('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set in backend/.env');
  if (cachedToken && Date.now() < cachedToken.expiresAtMs) return cachedToken.token;

  const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  }));
  cachedToken = {
    token: data.access_token,
    // refresh 5 min early; tokens normally last ~60 days
    expiresAtMs: Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000,
  };
  return cachedToken.token;
}

// params: URLSearchParams (Helix uses repeated keys like login=a&login=b, which
// axios' default object serialization would mangle into login[]=a&login[]=b).
async function helixGet(path, params) {
  const token = await getAppToken();
  const { data } = await axios.get(`${HELIX}${path}`, {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
    params,
  });
  return data;
}

// ── Pokkén category resolution ────────────────────────────────────────────────
// The directory is https://www.twitch.tv/directory/category/pokken-tournament-dx.
// We resolve game IDs by exact name and accept both DX and the original Wii U /
// arcade category. Override / pin with TWITCH_POKKEN_GAME_ID if Twitch ever
// renames the category.
const POKKEN_GAME_NAMES = ['Pokkén Tournament DX', 'Pokkén Tournament'];
const POKKEN_NAME_RE = /pokk[eé]n/i;

let cachedGameIds = null;

async function getPokkenGameIds() {
  if (process.env.TWITCH_POKKEN_GAME_ID) {
    return process.env.TWITCH_POKKEN_GAME_ID.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (cachedGameIds) return cachedGameIds;

  const qs = new URLSearchParams();
  for (const name of POKKEN_GAME_NAMES) qs.append('name', name);
  const data = await helixGet('/games', qs);
  const ids = (data.data || []).map(g => g.id);

  if (!ids.length) {
    // Exact-name lookup failed (rename?) — fall back to category search.
    const search = await helixGet('/search/categories', new URLSearchParams({ query: 'pokken', first: '10' }));
    for (const cat of search.data || []) {
      if (POKKEN_NAME_RE.test(cat.name)) ids.push(cat.id);
    }
  }
  if (!ids.length) throw new Error('Could not resolve the Pokkén category on Twitch');
  cachedGameIds = ids;
  return ids;
}

// True when a live stream / video belongs to the Pokkén category.
function isPokkenGame(gameIds, { game_id, game_name } = {}) {
  if (game_id && gameIds.includes(String(game_id))) return true;
  return !!(game_name && POKKEN_NAME_RE.test(game_name));
}

// ── Lookups (all accept up to 100 logins; our list is 14, no chunking needed) ─

// login → { login, display_name, avatar_url }
async function getUsers(logins) {
  if (!logins.length) return new Map();
  const qs = new URLSearchParams();
  for (const l of logins) qs.append('login', l);
  const data = await helixGet('/users', qs);
  return new Map((data.data || []).map(u => [u.login.toLowerCase(), {
    login: u.login.toLowerCase(),
    display_name: u.display_name || u.login,
    avatar_url: u.profile_image_url || null,
  }]));
}

// login → live stream object ({ game_id, game_name, title, started_at, ... })
async function getLiveStreams(logins) {
  if (!logins.length) return new Map();
  const qs = new URLSearchParams();
  for (const l of logins) qs.append('user_login', l);
  qs.append('first', '100');
  const data = await helixGet('/streams', qs);
  return new Map((data.data || []).map(s => [s.user_login.toLowerCase(), s]));
}

// All archive VODs currently in the Pokkén category, newest first, across the
// given game IDs. Paginated; maxPages * 100 is far more than the category ever
// holds (it's a small directory), so this is effectively exhaustive.
async function getRecentPokkenVideos(gameIds, { maxPages = 5 } = {}) {
  const videos = [];
  for (const gameId of gameIds) {
    let cursor = null;
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({
        game_id: gameId, sort: 'time', type: 'archive', first: '100',
      });
      if (cursor) qs.append('after', cursor);
      const data = await helixGet('/videos', qs);
      videos.push(...(data.data || []));
      cursor = data.pagination?.cursor || null;
      if (!cursor || (data.data || []).length === 0) break;
    }
  }
  return videos; // [{ user_login, title, url, created_at, duration, ... }]
}

module.exports = {
  isConfigured,
  getPokkenGameIds,
  isPokkenGame,
  getUsers,
  getLiveStreams,
  getRecentPokkenVideos,
};
