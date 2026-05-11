const axios = require('axios');

const BASE_URL    = 'https://api.challonge.com/v2.1';
const BASE_V1_URL = 'https://api.challonge.com/v1';
const TOKEN_URL   = 'https://api.challonge.com/oauth/token';

// ─── Authentication ──────────────────────────────────────────────────────────
//
// Challonge v2.1 supports two auth styles:
//
//   "Migrated APIv1 Key" (preferred):
//     Authorization-Type: v1
//     Authorization: <v1-api-key>
//
//   OAuth2 client credentials (fallback):
//     Authorization-Type: v2
//     Authorization: Bearer <oauth-token>
//
// Set CHALLONGE_V1_KEY in .env (the client_id from the Developer Portal
// "Migrated APIv1 Key" app) to use the simpler v1-key path.

let cachedToken = null;
let tokenExpiry = null;

// Returns the correct request headers for the v2.1 API.
// All v2.1 requests require Content-Type + Accept regardless of method.
// Prefers "Migrated APIv1 Key" (CHALLONGE_V1_KEY); falls back to OAuth.
async function getApiHeaders() {
  const base = {
    'Content-Type': 'application/vnd.api+json',
    'Accept': 'application/json',
  };

  const v1Key = process.env.CHALLONGE_V1_KEY;
  if (v1Key) {
    return { ...base, 'Authorization-Type': 'v1', 'Authorization': v1Key };
  }

  // OAuth2 client-credentials fallback
  if (!cachedToken || !tokenExpiry || Date.now() >= tokenExpiry) {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', process.env.CHALLONGE_CLIENT_ID);
    params.append('client_secret', process.env.CHALLONGE_CLIENT_SECRET);
    const response = await axios.post(TOKEN_URL, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  }

  return { ...base, 'Authorization-Type': 'v2', 'Authorization': `Bearer ${cachedToken}` };
}

// Kept for the /api/health/challonge diagnostic route
async function getAccessToken() {
  const headers = await getApiHeaders();
  // Return the token value regardless of auth style
  return process.env.CHALLONGE_V1_KEY || cachedToken;
}

async function apiGet(path, params = {}) {
  const headers = await getApiHeaders();
  const response = await axios.get(`${BASE_URL}${path}`, { headers, params, timeout: 15000 });
  return response.data;
}

// v1 API helper — always uses ?api_key= query param, works for ANY public tournament
// regardless of whether it's connected to the OAuth app.
async function v1Get(path, params = {}) {
  const key = process.env.CHALLONGE_V1_KEY;
  if (!key) throw new Error('CHALLONGE_V1_KEY not set — cannot use v1 API');
  const response = await axios.get(`${BASE_V1_URL}${path}`, {
    params: { api_key: key, ...params },
    timeout: 15000,
  });
  return response.data;
}

// ─── Tournaments ────────────────────────────────────────────────────────────

// List all tournaments connected to this app (v2.1 OAuth only)
async function listTournaments({ page = 1, perPage = 25 } = {}) {
  return apiGet('/application/tournaments', { page, per_page: perPage });
}

// Get a single tournament by its slug or numeric ID — uses v1 API to access any public tournament
async function getTournament(tournamentId) {
  return v1Get(`/tournaments/${tournamentId}.json`);
}

// Get participants for a tournament — v1 API
async function getParticipants(tournamentId) {
  return v1Get(`/tournaments/${tournamentId}/participants.json`);
}

// Get matches for a tournament — v1 API
async function getMatches(tournamentId, { state } = {}) {
  const params = {};
  if (state) params.state = state;
  return v1Get(`/tournaments/${tournamentId}/matches.json`, params);
}

// Get a single match — v1 API
async function getMatch(tournamentId, matchId) {
  return v1Get(`/tournaments/${tournamentId}/matches/${matchId}.json`);
}

// ─── Shared slug extractor ───────────────────────────────────────────────────
// Pull just the tournament slug from a full Challonge URL.
// "https://challonge.com/wise_/ffc12" → "ffc12"
// "https://challonge.com/ffc12"       → "ffc12"
function extractSlugFromUrl(fullUrl = '') {
  const path = fullUrl.replace(/^https?:\/\/challonge\.com\//, '').replace(/^\//, '');
  const parts = path.split('/').filter(Boolean);
  return (parts[parts.length - 1] || '').split('#')[0] || null;
}

// ─── Organizer discovery via public profile scraping ─────────────────────────
//
// Challonge's API (v1 and v2) cannot list another user's public tournaments
// without their credentials. However, each user's profile page is public:
//   https://challonge.com/users/USERNAME/tournaments
// We fetch and regex-parse that page to extract tournament slugs.
// If HTML scraping is blocked (403), we fall back to the RSS feed for that user.
// If neither works, callers can optionally supply a Challonge community subdomain
// and we use the v1 API to list tournaments under that subdomain.

// Full Chrome 124 header set — includes sec-ch-ua client hints and sec-fetch-*
// signals that Cloudflare and modern bot detection check for.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  'Connection': 'keep-alive',
};

// Build a deduplicated list of candidate profile URLs for a given username.
// Accounts like __chepestoopid have leading underscores in their handle but
// Challonge strips them in the URL, so we try both forms — but only when they differ.
function profileUrlCandidates(username) {
  const stripped = username.replace(/^_+/, '');
  const urls = [`https://challonge.com/users/${username}/tournaments`];
  if (stripped !== username) urls.push(`https://challonge.com/users/${stripped}/tournaments`);
  urls.push(`https://challonge.com/en/users/${username}/tournaments`);
  return urls;
}

async function scrapeUserTournaments(username, { pages = 5 } = {}) {
  const slugs = new Set();

  // Try each URL pattern until one succeeds (avoids double-fetching page 1)
  let baseUrl = null;
  let firstHtml = null;
  for (const candidate of profileUrlCandidates(username)) {
    try {
      const resp = await axios.get(candidate, { headers: BROWSER_HEADERS, timeout: 12000, maxRedirects: 5 });
      baseUrl = candidate;
      firstHtml = resp.data;
      console.log(`  Using URL: ${candidate}`);
      break;
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) {
        console.warn(`  403 on ${candidate} — trying alternate URL…`);
        continue;
      }
      // Non-403 error (network, 404, etc.) — stop trying
      console.warn(`  Page 1 failed for ${username}: ${err.message}`);
      return [];
    }
  }

  if (!baseUrl) {
    console.warn(`  All URL patterns returned 403 for ${username} — Challonge may be blocking scraping. Use batch import instead.`);
    return [];
  }

  for (let page = 1; page <= pages; page++) {
    let html;
    if (page === 1 && firstHtml) {
      // Reuse the response we already fetched during URL probing
      html = firstHtml;
    } else {
      const url = `${baseUrl}?page=${page}`;
      try {
        const headers = { ...BROWSER_HEADERS, 'Referer': baseUrl, 'sec-fetch-site': 'same-origin' };
        const resp = await axios.get(url, { headers, timeout: 12000, maxRedirects: 5 });
        html = resp.data;
      } catch (err) {
        console.warn(`  Page ${page} failed for ${username}: ${err.message}`);
        break;
      }
      // Small delay between pages — avoids rate-limit triggers
      if (page < pages) await new Promise(r => setTimeout(r, 600));
    }

    // Challonge renders tournament rows with hrefs like:
    //   href="/USERNAME/slug"  or  href="/slug"
    // We look for all unique slugs linked from this page.
    const hrefPattern = new RegExp(
      `href="(?:https?://challonge\\.com)?/(${username}/)?([a-zA-Z0-9_-]+)(?:#[^"]*)?"`
      , 'gi'
    );
    let match;
    let foundOnPage = 0;
    while ((match = hrefPattern.exec(html)) !== null) {
      const slug = match[2];
      // Skip obvious non-tournament paths
      if (['login', 'logout', 'signup', 'settings', 'tournaments', 'users', 'search',
           'about', 'faq', 'contact', 'privacy', 'terms', 'api', 'help',
           'participants', 'matches', 'signup'].includes(slug.toLowerCase())) continue;
      if (slug.length < 3 || slug.length > 40) continue;
      if (!slugs.has(slug)) {
        slugs.add(slug);
        foundOnPage++;
      }
    }

    console.log(`  Scraped page ${page} for ${username}: ${foundOnPage} slugs found`);

    // If we find a very small number of new slugs, assume we've reached the end
    if (foundOnPage < 3 && page > 1) break;
  }

  return [...slugs];
}

// ─── Method 4: RSS feed discovery ────────────────────────────────────────────
//
// Challonge publishes an RSS feed at /users/USERNAME/tournaments.rss
// This is a separate endpoint from the HTML page and may not be behind the
// same bot-detection rules. Parse <link> tags from RSS items for tournament URLs.
async function rssUserTournaments(username) {
  const stripped = username.replace(/^_+/, '');
  const candidates = [`https://challonge.com/users/${username}/tournaments.rss`];
  if (stripped !== username) candidates.push(`https://challonge.com/users/${stripped}/tournaments.rss`);

  const rssHeaders = {
    ...BROWSER_HEADERS,
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  };

  for (const url of candidates) {
    try {
      const resp = await axios.get(url, { headers: rssHeaders, timeout: 12000 });
      const xml = String(resp.data);

      const slugs = new Set();
      // RSS 2.0: <link>https://challonge.com/USER/SLUG</link>
      // Some feeds use CDATA: <link><![CDATA[https://...]]></link>
      const linkPattern = /<link>(?:<!\[CDATA\[)?(https?:\/\/challonge\.com\/[^\]<]+)(?:\]\]>)?<\/link>/gi;
      let match;
      while ((match = linkPattern.exec(xml)) !== null) {
        const slug = extractSlugFromUrl(match[1].trim());
        if (slug && slug.length >= 3 && slug.length <= 40) slugs.add(slug);
      }

      if (slugs.size > 0) {
        console.log(`  RSS: ${slugs.size} slugs for ${username} via ${url}`);
        return [...slugs];
      }
      console.warn(`  RSS ${url}: no slugs found in feed`);
    } catch (err) {
      const status = err.response?.status;
      console.warn(`  RSS ${url} failed (${status || err.message})`);
      if (status !== 403 && status !== 404) break; // unexpected error — stop
    }
  }
  return [];
}

// ─── Method 3: Community subdomain API (v1) ───────────────────────────────────
//
// If a series has a Challonge community subdomain (e.g. ffc.challonge.com),
// the v1 API supports GET /v1/tournaments.json?subdomain=ffc and returns all
// tournaments in that community. Requires our OAuth Bearer token.
// Store the subdomain in organizers.challonge_subdomain to enable this.
async function subdomainTournaments(subdomain, { pages = 10 } = {}) {
  const headers = await getApiHeaders();
  const slugs = new Set();

  for (let page = 1; page <= pages; page++) {
    try {
      const resp = await axios.get(`${BASE_V1_URL}/tournaments.json`, {
        headers,
        params: { subdomain, state: 'ended', per_page: 100, page },
        timeout: 12000,
      });
      const items = Array.isArray(resp.data) ? resp.data : [];
      if (items.length === 0) break;

      for (const item of items) {
        const attrs = item.tournament || item;
        const url = attrs.full_challonge_url || attrs.url || '';
        const slug = extractSlugFromUrl(url) || String(attrs.id || '');
        if (slug && slug.length >= 3 && slug.length <= 40) slugs.add(slug);
      }

      console.log(`  Subdomain API page ${page} for [${subdomain}]: ${items.length} items`);
      if (items.length < 100) break;
    } catch (err) {
      console.warn(`  Subdomain API failed for [${subdomain}]: ${err.response?.status || err.message}`);
      break;
    }
  }

  console.log(`  Subdomain [${subdomain}]: ${slugs.size} total slugs`);
  return [...slugs];
}

// ─── Method 1: Slug pattern enumeration ──────────────────────────────────────
//
// For series with predictable slugs (ffc1, ffc2, … rtgna1, rtgna2, …) we probe
// the v2 API directly — no scraping required.
//
// Direction: high → low (newest first), so we find the active range quickly and
// stop once we've seen enough consecutive misses past the bottom.
//
// Returns slugs sorted ascending by number — correct order for ELO import.

async function tournamentExists(slug) {
  const headers = await getApiHeaders();
  await axios.get(`${BASE_URL}/tournaments/${slug}`, { headers, timeout: 8000 });
}

async function enumerateSlugPatterns(prefixes, { maxN = 50, stopAfterMisses = 20 } = {}) {
  // {prefix, n} records for found slugs, so we can sort correctly at the end
  const found = [];

  for (const prefix of prefixes) {
    let consecutiveMisses = 0;
    console.log(`  Enumerating ${prefix}1…${prefix}${maxN} (reverse)…`);

    for (let n = maxN; n >= 1; n--) {
      const slug = `${prefix}${n}`;
      try {
        await tournamentExists(slug);
        found.push({ slug, prefix, n });
        consecutiveMisses = 0;
      } catch (err) {
        const status = err.response?.status;
        if (status === 401 || status === 403) {
          // Auth failure — stop entirely, no point continuing
          console.warn(`  Enumeration auth error (${status}) on ${slug} — stopping`);
          return [];
        }
        consecutiveMisses++;
        if (consecutiveMisses >= stopAfterMisses) {
          console.log(`  ${consecutiveMisses} consecutive misses after ${slug} — done with ${prefix}`);
          break;
        }
      }
      // Respect Challonge rate limits — small delay between existence checks
      await new Promise(r => setTimeout(r, 150));
    }
    console.log(`  ${prefix}: found ${found.filter(f => f.prefix === prefix).length} slugs`);
  }

  // Sort ascending by n so tournaments are imported oldest-first (correct ELO order)
  found.sort((a, b) => a.n - b.n);
  return found.map(f => f.slug);
}

// ─── Slug validation: keep only Pokkén-related tournaments ───────────────────
//
// scrapeUserTournaments returns every tournament slug an organizer has run,
// which can include unrelated games and silently grow if Challonge changes
// their HTML. This validator fetches each slug via the v1 API and keeps only
// those whose game_name or tournament name match a Pokkén keyword list.
//
// Cost: 1 API call per slug + ~150ms politeness delay. For ~50 slugs that's
// ~10s; for 250 it's ~50s. Worth it to avoid garbage imports.

const POKKEN_GAME_NAME_RE = /pokk[eé]n/i;

// Tournament-name keywords that strongly imply Pokkén even if game_name is
// missing or set wrong. Drawn from the eight tracked series in AGENT_CONTEXT.
const POKKEN_NAME_KEYWORDS = [
  'pokken', 'pokkén',
  'ferrum',                  // FFC = Ferrum Fist Challenge
  'fighting for cheese',     // FFC alt title wise_ uses
  'neos',                    // Neos City references
  'road to greatness', 'rtg',
  'croissant',               // TCC = The Croissant Cup
  'dcm',                     // devlinhartfgc's series
  'end of the road', 'eotr',
  'heaven\'s arena', 'heavens arena',
  'mouse cup', 'ねずみ',     // Tonamel — won't appear on Challonge but cheap to keep
];

function looksLikePokkenTournament(meta) {
  if (!meta || typeof meta !== 'object') return false;
  const game = String(meta.game_name || '').toLowerCase();
  if (POKKEN_GAME_NAME_RE.test(game)) return true;

  const name = String(meta.name || '').toLowerCase();
  return POKKEN_NAME_KEYWORDS.some(kw => name.includes(kw));
}

async function validatePokkenSlugs(slugs, { sleepMs = 150 } = {}) {
  if (!Array.isArray(slugs) || slugs.length === 0) return [];

  const valid = [];
  const rejected = [];
  const errored = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    try {
      const data = await getTournament(slug);
      // v1 returns { tournament: { ... } }; v2 returns { data: { ... } }
      const meta = data?.tournament || data?.data?.attributes || data;
      if (looksLikePokkenTournament(meta)) {
        valid.push(slug);
      } else {
        rejected.push({ slug, name: meta?.name, game: meta?.game_name });
      }
    } catch (err) {
      const status = err.response?.status;
      // 404 = slug doesn't exist; treat as rejected. Other errors we keep
      // the slug to avoid losing real tournaments to a transient failure.
      if (status === 404) {
        rejected.push({ slug, error: '404 not found' });
      } else {
        errored.push({ slug, error: err.message });
        valid.push(slug);
      }
    }
    if (i < slugs.length - 1) await new Promise(r => setTimeout(r, sleepMs));
  }

  console.log(`  Validation: ${valid.length} kept, ${rejected.length} rejected, ${errored.length} errored (kept defensively)`);
  if (rejected.length) {
    const sample = rejected.slice(0, 5).map(r => `${r.slug}${r.name ? ` (${r.name})` : ''}`).join(', ');
    console.log(`    Rejected sample: ${sample}${rejected.length > 5 ? `, +${rejected.length - 5} more` : ''}`);
  }

  return valid;
}

// ─── Combined discovery: HTML → RSS → validate ───────────────────────────────
// Tries HTML scraping first, falls back to RSS if the scraper gets blocked.
// By default, every discovered slug is then validated against a Pokkén keyword
// list — pass { validate: false } to skip validation (e.g. for diagnostics).
// Subdomain is handled separately by the organizers route (per-organizer config).
async function discoverUserTournaments(username, { pages = 5, validate = true } = {}) {
  let slugs = await scrapeUserTournaments(username, { pages });
  if (slugs.length === 0) {
    console.log(`  HTML scraping returned 0 for ${username} — trying RSS…`);
    slugs = await rssUserTournaments(username);
  }
  if (slugs.length === 0) return [];

  if (!validate) return slugs;

  console.log(`  Validating ${slugs.length} slugs for ${username} against Pokkén keyword list…`);
  return validatePokkenSlugs(slugs);
}

// List ALL pages of app-connected tournaments (auto-paginates).
// Uses the v2.1 /application/tournaments endpoint which works with our OAuth
// client credentials token — no per-user API key needed.
// Each tournament's full_challonge_url contains the organizer username, e.g.
//   "https://challonge.com/wise_/ffc12"  →  organizer = "wise_"
//   "https://challonge.com/ffc12"        →  organizer = null (root namespace)
async function listAllApplicationTournaments({ state = 'ended' } = {}) {
  const results = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await listTournaments({ page, perPage: 100, state });
    const items = Array.isArray(data) ? data : (data.data || []);
    results.push(...items);
    hasMore = items.length === 100;
    page++;
    if (page > 20) break; // safety cap: 2000 tournaments
  }

  return results;
}

// Extract the Challonge username that owns a tournament from its URL.
// Returns lowercase username string, or null for root-namespace slugs.
function extractOrganizerFromUrl(fullUrl = '') {
  // fullUrl examples:
  //   "https://challonge.com/wise_/ffc12"
  //   "https://challonge.com/ffc12"
  const path = fullUrl.replace(/^https?:\/\/challonge\.com\//, '');
  const parts = path.split('/').filter(Boolean);
  // If there are 2+ parts, the first is the username
  return parts.length >= 2 ? parts[0].toLowerCase() : null;
}

// Kept for backwards-compatibility in case other code imports it.
// Now simply delegates to the app-level endpoint and ignores username.
async function listAllTournamentsByUser(_username) {
  return listAllApplicationTournaments();
}

module.exports = {
  _getAccessToken: getAccessToken,   // exposed for diagnostics only
  _v1Get: v1Get,                     // exposed for diagnostics only
  listTournaments,
  listAllApplicationTournaments,
  listAllTournamentsByUser,  // legacy alias
  extractOrganizerFromUrl,
  extractSlugFromUrl,
  scrapeUserTournaments,
  rssUserTournaments,
  subdomainTournaments,
  discoverUserTournaments,
  enumerateSlugPatterns,
  validatePokkenSlugs,
  looksLikePokkenTournament,
  getTournament,
  getParticipants,
  getMatches,
  getMatch
};
