/**
 * Neos City — Challonge Profile Harvest (Browser Console)
 *
 * Why this exists: Challonge 403s every `axios.get('/users/<name>/tournaments')`
 * call from Node (harvest_new.js). The browser session has the cookies, UA, and
 * TLS fingerprint Challonge expects, so `fetch()` from the DevTools console
 * sails through. CORS isn't an issue because the request stays same-origin —
 * we never leave challonge.com to fetch the profile pages.
 *
 * HOW TO USE
 * ──────────
 * 1. Backend running on localhost:3001 (CORS for https://challonge.com is on).
 * 2. Open Chrome to ANY page on challonge.com (the root, your dashboard, an
 *    organizer's profile — doesn't matter, as long as the origin is correct).
 *    A reliable starting point that always loads:
 *      https://challonge.com/tournaments
 * 3. F12 → Console → paste this entire file → Enter.
 * 4. The script walks every organizer in ORGANIZERS below, scrapes their
 *    profile + paginates up to PAGES_PER_ORG, POSTs new URLs to the backend.
 *    The backend dedupes against harvested_tournaments.txt + tournaments DB
 *    and validates each new slug against the Pokkén keyword list before
 *    appending to the file.
 * 5. Re-run any time — already-known slugs are filtered out server-side.
 *
 * After this finishes, run `node batch_import.js` (or just `node pull_new.js`
 * again and skip the harvest step) to import the new URLs.
 *
 * NETWORK NOTE
 * ────────────
 * The script POSTs to http://localhost:3001 from https://challonge.com. Modern
 * Chrome allows http://localhost from https:// pages as a secure context, so
 * this works without mixed-content prompts. If you see "Failed to fetch" on
 * the POST, click the lock icon → Site settings → Insecure content → Allow
 * on challonge.com, then re-run.
 */

// Required — the import endpoint is gated and the script refuses to run if blank.
// Easiest path: from the project root, run
//   node prep_console.js harvest_console.js
// which reads ADMIN_TOKEN from backend/.env, inlines it, and copies the
// populated script to the clipboard. Then Ctrl+V into DevTools. Avoids
// pasting the token into source. The literal below stays empty in git.
const ADMIN_TOKEN = '';
const BACKEND_URL = 'http://localhost:3001';
const PAGES_PER_ORG = 5;     // mirrors harvest_new.js's default
const PAGE_DELAY_MS = 400;   // breath between page fetches per organizer
const ORG_DELAY_MS  = 600;   // breath between organizers

// Mirrors harvest_new.js / seed_organizers.sql. Comment out any you want to skip.
const ORGANIZERS = [
  { username: 'wise_',          series: 'FFC' },
  { username: 'rickythe3rd',    series: 'FFC' },
  { username: 'shean96',        series: 'RTG NA' },
  { username: 'rigz_',          series: 'RTG NA' },
  { username: '__chepestoopid', series: 'RTG EU' },
  { username: 'devlinhartfgc',  series: 'DCM' },
  { username: '__auradiance',   series: 'TCC' },
];

// Slugs that look like a tournament link in the HTML but aren't — same
// list as backend/src/services/challonge.js so we don't surface garbage.
const NON_TOURNAMENT_SLUGS = new Set([
  'login', 'logout', 'signup', 'settings', 'tournaments', 'users', 'search',
  'about', 'faq', 'contact', 'privacy', 'terms', 'api', 'help',
  'participants', 'matches', 'followers', 'announcements', 'events', 'rankings',
  'templates', 'partners', 'organizedplay', 'switch_locale', 'translate',
  'terms_of_service', 'privacy_policy', 'bracket_generator',
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!ADMIN_TOKEN) {
  console.error('❌ ADMIN_TOKEN is blank. Run `node prep_console.js harvest_console.js`');
  console.error('   to inline it from backend/.env, then paste the result.');
  throw new Error('ADMIN_TOKEN missing');
}

if (!location.host.endsWith('challonge.com')) {
  console.warn(
    `⚠️  You're on ${location.host}, not challonge.com. fetch() will go cross-origin ` +
    `and Challonge's CORS will likely block it. Navigate to https://challonge.com first.`
  );
}

// Fetch one profile page (HTML) and pull tournament slugs out of it. Mirrors
// the regex in backend/src/services/challonge.js:scrapeUserTournaments.
async function scrapePage(username, page) {
  const url = `/users/${username}/tournaments${page > 1 ? `?page=${page}` : ''}`;
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const html = await resp.text();

  const hrefPattern = new RegExp(
    `href="(?:https?://challonge\\.com)?/(${username}/)?([a-zA-Z0-9_-]+)(?:#[^"]*)?"`,
    'gi'
  );

  const slugs = new Set();
  let m;
  while ((m = hrefPattern.exec(html)) !== null) {
    const slug = m[2];
    if (NON_TOURNAMENT_SLUGS.has(slug.toLowerCase())) continue;
    if (slug.length < 3 || slug.length > 40) continue;
    // Skip the organizer's own username appearing as a link target
    if (slug.toLowerCase() === username.toLowerCase()) continue;
    slugs.add(slug);
  }
  return [...slugs];
}

async function scrapeOrganizer({ username, series }) {
  console.log(`%c[${series}] ${username}`, 'font-weight:bold');
  const all = new Set();
  for (let page = 1; page <= PAGES_PER_ORG; page++) {
    try {
      const slugs = await scrapePage(username, page);
      const before = all.size;
      slugs.forEach(s => all.add(s));
      const added = all.size - before;
      console.log(`  page ${page}: ${slugs.length} on page, ${added} new (running total ${all.size})`);
      // Mimic the Node scraper's "small-delta = end of list" heuristic
      if (added < 3 && page > 1) break;
    } catch (err) {
      console.warn(`  page ${page} failed: ${err.message}`);
      break;
    }
    if (page < PAGES_PER_ORG) await sleep(PAGE_DELAY_MS);
  }
  return [...all];
}

async function postToBackend(username, slugs, series) {
  if (slugs.length === 0) {
    return { appended: 0, skipped_known: 0, rejected_non_pokken: 0, new_slugs: [] };
  }
  const urls = slugs.map(s => `https://challonge.com/${username}/${s}`);
  const resp = await fetch(`${BACKEND_URL}/api/tournaments/append-harvest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ urls, organizer: `${series} / ${username}` }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`backend ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

(async () => {
  console.log(`%cHarvesting ${ORGANIZERS.length} organizer(s)…`, 'font-size:14px;font-weight:bold');
  console.log(`Origin: ${location.origin}  Backend: ${BACKEND_URL}\n`);

  const summary = [];
  for (const org of ORGANIZERS) {
    try {
      const slugs = await scrapeOrganizer(org);
      const result = await postToBackend(org.username, slugs, org.series);
      console.log(
        `  → backend: appended=${result.appended}, ` +
        `known=${result.skipped_known}, ` +
        `rejected_non_pokken=${result.rejected_non_pokken ?? 0}`
      );
      if (result.new_slugs?.length) {
        console.log(`    new: ${result.new_slugs.join(', ')}`);
      }
      summary.push({ ...org, scraped: slugs.length, appended: result.appended });
    } catch (err) {
      console.error(`  ❌ ${org.username}: ${err.message}`);
      summary.push({ ...org, scraped: 0, appended: 0, error: err.message });
    }
    console.log('');
    await sleep(ORG_DELAY_MS);
  }

  console.log('%c─── SUMMARY ───', 'font-weight:bold');
  console.table(summary);
  const totalNew = summary.reduce((n, s) => n + (s.appended || 0), 0);
  console.log(`%c${totalNew} new URL(s) appended to harvested_tournaments.txt`,
              totalNew > 0 ? 'color:#10b981;font-weight:bold' : 'color:#94a3b8');
  if (totalNew > 0) {
    console.log('%cNext: re-run `node pull_new.js` (skip harvest) or `node batch_import.js`',
                'color:#6366f1');
  } else {
    console.log('Nothing new this run.');
  }
})().catch(err => {
  console.error('Unhandled error:', err);
});
