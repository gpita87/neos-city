/**
 * Neos City — joltaru profile harvest (browser console)
 *
 * One-off harvester for Challonge user `joltaru`'s tournaments
 * (https://challonge.com/users/joltaru/tournaments). joltaru is a PERSONAL
 * user, not a tracked series organizer — these import as plain online Pokkén
 * events with NO series. So this is deliberately separate from
 * harvest_console.js (which walks the seven series organizers and POSTs to the
 * backend's append-harvest route). This script does NOT touch
 * harvested_tournaments.txt and does NOT call the backend at all — it only
 * scrapes joltaru's profile and hands you the candidate URLs. Validation
 * (is each one actually Pokkén?) happens afterward on `main` via
 * thunderdome_import.js, which can hit the v1 API from Node (only the profile
 * LISTING page 403s server-side; individual tournament fetches work fine).
 *
 * WHY A BROWSER PASTE
 * ───────────────────
 * joltaru's profile listing 403s every server-side fetch (Challonge bot
 * detection — confirmed for both the HTML page and the .rss feed). The browser
 * session has the cookies / UA / TLS fingerprint Challonge expects, and a
 * same-origin fetch() from a challonge.com tab sails through.
 *
 * HOW TO USE
 * ──────────
 * 1. Open Chrome to ANY page on challonge.com. A page that always loads:
 *      https://challonge.com/tournaments
 *    (The joltaru profile itself is fine too — being on challonge.com is the
 *    only requirement, so the fetch stays same-origin.)
 * 2. F12 -> Console -> paste this entire file -> Enter.
 * 3. It fetches joltaru's profile pages, parses out tournament slugs, prints
 *    the candidate URLs, and copies them to your clipboard (DevTools copy()).
 * 4. Paste the clipboard into  thunderdome_urls.txt  in the project root,
 *    replacing the placeholder lines. Then follow the runbook (validate +
 *    import on main).
 *
 * No ADMIN_TOKEN needed — this script never calls the Neos City backend.
 */

const USERNAME       = 'joltaru';
const PAGES_TO_SCRAPE = 5;     // joltaru has ~17 events; this is plenty of headroom
const PAGE_DELAY_MS   = 400;

// Slugs that look like tournament links but are site chrome / nav. Mirrors
// backend/src/services/challonge.js so we don't surface garbage. Validation on
// `main` would drop these anyway (404 -> rejected), but filtering here keeps the
// candidate list close to the real ~17.
const NON_TOURNAMENT_SLUGS = new Set([
  'login', 'logout', 'signup', 'settings', 'tournaments', 'users', 'search',
  'about', 'faq', 'contact', 'privacy', 'terms', 'api', 'help',
  'participants', 'matches', 'followers', 'announcements', 'events', 'rankings',
  'templates', 'partners', 'organizedplay', 'switch_locale', 'translate',
  'terms_of_service', 'privacy_policy', 'bracket_generator',
  'pricing', 'features', 'communities', 'tournament', 'communities',
  'premier', 'pro', 'plus', 'upgrade', 'billing', 'notifications',
  // Logged-in profile chrome (the joltaru profile renders these when you're
  // signed in): dashboard nav, the messages inbox, the news feed, log-out.
  'dashboard', 'comment_threads', 'news', 'user_session',
]);

// joltaru's PROFILE lists every tournament he touched — both the ones he RAN
// and the (many) ones he only PLAYED IN (Road to Greatness, Devcord Community
// Monthly, Synergy Smackdown, End of the Road, FFC, …). We only want the ones
// he organized: the Thunderdome series. Those are the only joltaru-original
// events, so the brand name is the reliable discriminator — the Pokkén check
// downstream can't help, since the participated-in events are Pokkén too.
// Match by title keyword OR slug prefix (slugs: Tdome1, TdomeR, TdomeR2..17,
// TDomeR11; titles: "Thunderdome Pokken #N", "The Thunderdome Returns #11").
const ONLY_THUNDERDOME = true;
function isThunderdome(slug, title) {
  return /thunderdome/i.test(title || '') || /^tdome/i.test(slug);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!location.host.endsWith('challonge.com')) {
  console.warn(
    `You're on ${location.host}, not challonge.com. The profile fetch will go ` +
    `cross-origin and Challonge's CORS will block it. Navigate to ` +
    `https://challonge.com/tournaments first, then re-paste.`
  );
}

// Pull tournament {slug, title} pairs out of one profile page's HTML.
// joltaru is a personal user, so tournament links are global-namespace:
//   <a href="/SOME_SLUG">Title</a>   (occasionally /joltaru/SOME_SLUG)
// A leading locale segment (/sv/, /es/, ...) is stripped if present.
function parseProfileHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = new Map(); // slug -> title (dedupe by slug)

  for (const a of doc.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href');
    if (!raw) continue;

    let pathname;
    try { pathname = new URL(raw, location.origin).pathname; }
    catch { continue; }

    let parts = pathname.split('/').filter(Boolean);
    // Strip a leading 2-letter locale segment (e.g. /sv/...) when more follows.
    if (parts.length > 1 && /^[a-z]{2}$/.test(parts[0])) parts = parts.slice(1);

    let slug = null;
    if (parts.length === 1) slug = parts[0];
    else if (parts.length === 2 && parts[0].toLowerCase() === USERNAME.toLowerCase()) slug = parts[1];
    if (!slug) continue;

    const lower = slug.toLowerCase();
    if (NON_TOURNAMENT_SLUGS.has(lower)) continue;
    if (lower === USERNAME.toLowerCase()) continue;
    if (slug.length < 3 || slug.length > 40) continue;
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) continue;

    const title = (a.textContent || '').trim().replace(/\s+/g, ' ');
    if (!out.has(slug) || (!out.get(slug) && title)) out.set(slug, title);
  }
  return out;
}

async function fetchPage(page) {
  const url = `/users/${USERNAME}/tournaments${page > 1 ? `?page=${page}` : ''}`;
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${url}`);
  return resp.text();
}

(async () => {
  console.log(`%cHarvesting joltaru's tournaments…`, 'font-size:14px;font-weight:bold');
  console.log(`Origin: ${location.origin}\n`);

  const bySlug = new Map();
  for (let page = 1; page <= PAGES_TO_SCRAPE; page++) {
    let html;
    try {
      html = await fetchPage(page);
    } catch (err) {
      console.warn(`  page ${page}: ${err.message} — stopping pagination`);
      break;
    }
    const found = parseProfileHtml(html);
    const before = bySlug.size;
    for (const [slug, title] of found) {
      if (!bySlug.has(slug) || (!bySlug.get(slug) && title)) bySlug.set(slug, title);
    }
    const added = bySlug.size - before;
    console.log(`  page ${page}: ${found.size} on page, ${added} new (running total ${bySlug.size})`);
    // Personal profiles are short — once a page adds nothing new, we're done.
    if (added === 0 && page > 1) break;
    if (page < PAGES_TO_SCRAPE) await sleep(PAGE_DELAY_MS);
  }

  const allSlugs = [...bySlug.keys()];
  // Keep only joltaru's own Thunderdome events; drop everything he merely
  // played in (and any stray chrome). Flip ONLY_THUNDERDOME to false to see the
  // full unfiltered list (e.g. if the series ever gets a non-Thunderdome name).
  const slugs = ONLY_THUNDERDOME
    ? allSlugs.filter(s => isThunderdome(s, bySlug.get(s)))
    : allSlugs;
  const droppedCount = allSlugs.length - slugs.length;

  // Canonical, clickable personal-tournament URLs (global namespace).
  const urls = slugs.map(s => `https://challonge.com/${s}`);

  console.log(
    `\n%c─── ${slugs.length} Thunderdome event(s) kept` +
    `${droppedCount ? `, ${droppedCount} other/participated-in dropped` : ''} ───`,
    'font-weight:bold'
  );
  console.table(slugs.map(s => ({ slug: s, title: bySlug.get(s) || '(no title text)' })));

  if (urls.length === 0) {
    console.warn(
      'No Thunderdome events found among ' + allSlugs.length + ' profile links. ' +
      'Either the profile DOM changed, the fetch was blocked, or the naming changed. ' +
      'Confirm you can load https://challonge.com/users/joltaru/tournaments in this ' +
      'same tab; to inspect the full unfiltered list, set ONLY_THUNDERDOME = false and re-paste.'
    );
    return;
  }

  const blob = urls.join('\n');
  try {
    copy(blob); // DevTools magic — puts the URL list on your clipboard
    console.log('%cCopied the URL list to your clipboard.', 'color:#10b981;font-weight:bold');
  } catch {
    console.log('(copy() unavailable — select the block below manually.)');
  }
  console.log(
    '%cNext: paste into thunderdome_urls.txt (replace the placeholder lines), ' +
    'then run the validate + import runbook on main.',
    'color:#6366f1'
  );
  console.log('\n' + blob);
})().catch(err => console.error('Unhandled error:', err));
