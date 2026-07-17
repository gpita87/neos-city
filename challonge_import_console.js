/**
 * Neos City — Challonge Bulk Import via Page Scraping (Browser Console)
 *
 * Why this exists: the Challonge v1 API key is metered (500 requests / 30 days)
 * and a full import costs ~3 calls per tournament, so bulk imports are
 * impossible through the API. But every public bracket page server-renders the
 * complete SPA store — window._initialStoreState.TournamentStore — containing
 * the full match list (real match ids, rounds, scores, winners, player names,
 * avatars), and the /standings page server-renders authoritative final ranks
 * plus each player's real Challonge username. Same-origin fetch() from a
 * challonge.com tab reads all of it with no API key and no quota.
 *
 * HOW TO USE
 * ──────────
 * 1. Backend running on localhost:3001 (CORS for *.challonge.com is on).
 * 2. Open Chrome to ANY page on https://challonge.com
 *    (e.g. https://challonge.com/tournaments).
 * 3. From the project root run:
 *      node prep_console.js challonge_import_console.js
 *    which inlines ADMIN_TOKEN from backend/.env and copies this script to the
 *    clipboard. Paste into DevTools Console (F12) → Enter.
 * 4. The script asks the backend which harvested Challonge URLs are still
 *    unimported (GET /api/tournaments/pending-challonge-urls), scrapes each
 *    bracket + standings page (~1.5s per event), sorts everything
 *    chronologically, then POSTs each payload to
 *    POST /api/tournaments/import-challonge-scraped.
 * 5. Re-run any time — the pending endpoint and the backend upserts are both
 *    idempotent (dedupe on challonge_id + real Challonge match ids).
 *
 * AFTER THE RUN
 * ─────────────
 * Run `node recalculate_elo.js` from the project root (Pass-2 achievements +
 * chronological ELO), then `node check_import_status.js`.
 *
 * VARIANTS
 * ────────
 * - Import an explicit list (bypasses the pending endpoint):
 *     runChallongeImport({ urls: ['https://challonge.com/SomeSlug', …] })
 * - Force-import events that fail the Pokkén keyword check:
 *     runChallongeImport({ urls: [...], force: true })
 * - Re-POST payloads that were scraped but failed to POST (e.g. after fixing
 *   a mixed-content block): _challongePhase2()
 *
 * SUBDOMAIN EVENTS
 * ────────────────
 * True community events render only on their own subdomain
 * (e.g. https://ffc.challonge.com/slug) — a cross-origin fetch from
 * challonge.com can't read them. The script detects those (404 on the root
 * origin for an org-namespaced URL), lists them at the end, and you re-run the
 * same paste on the subdomain's own tab. Their challonge_id is stored as
 * "<org>-<slug>", the v1 API's equivalent slug for namespaced tournaments.
 * (Most organizer URLs are NOT like this — e.g. rickythe3rd.challonge.com/FFC250
 * just redirects to challonge.com/FFC250 and imports fine from the root run.)
 *
 * NETWORK NOTE
 * ────────────
 * The script POSTs to http://localhost:3001 from https://challonge.com. Modern
 * Chrome treats http://localhost as a secure context so this works without
 * mixed-content prompts. If you see "Failed to fetch" on the POST, click the
 * lock icon → Site settings → Insecure content → Allow, then re-run.
 */

// Required — the import endpoint is gated and the script refuses to run if
// blank. Use `node prep_console.js challonge_import_console.js` to inline it
// from backend/.env. The literal below stays empty in git.
const ADMIN_TOKEN = '';
const BACKEND_URL = 'http://localhost:3001';
const PAGE_DELAY_MS = 700;   // breath between page fetches (2 fetches per event)
const POST_DELAY_MS = 250;   // breath between backend POSTs

// Same intent as validatePokkenSlugs() in backend/src/services/challonge.js:
// accept when the game is Pokkén OR the name matches a known-series keyword.
// Most curated locals (Synergy Smackdown, Bronol's Legacy, …) only match via
// the game line, so both checks matter.
const POKKEN_GAME_RE = /pokk[eé]n/i;
const POKKEN_NAME_RE = /pokk[eé]n|ferrum|fighting for cheese|road to greatness|\brtg\b|croissant|\bdcm\b|end of the road|\beotr\b|heaven'?s arena|mouse cup|ねずみ|burst attack/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!ADMIN_TOKEN) {
  console.error('❌ ADMIN_TOKEN is blank. Run `node prep_console.js challonge_import_console.js`');
  console.error('   to inline it from backend/.env, then paste the result.');
  throw new Error('ADMIN_TOKEN missing');
}

if (!location.host.endsWith('challonge.com')) {
  console.warn(
    `⚠️  You're on ${location.host}, not a challonge.com origin. Same-origin ` +
    `fetches of bracket pages will fail. Navigate to https://challonge.com first.`
  );
}

// ── URL → { url, org, slug } ──────────────────────────────────────────────────
// Handles https://challonge.com/<slug>, https://challonge.com/<org>/<slug>,
// https://<org>.challonge.com/<slug>, and bare slugs.
function parseTargetUrl(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^https?:\/\/(?:([a-z0-9_-]+)\.)?challonge\.com\/([^\s#?]+)/i);
  if (m) {
    const sub = (m[1] || '').toLowerCase() === 'www' ? null : (m[1] || null);
    const parts = m[2].split('/').filter(Boolean);
    const slug = parts[parts.length - 1];
    const org = sub || (parts.length >= 2 ? parts[0].toLowerCase() : null);
    return slug ? { url: s, org, slug } : null;
  }
  if (/^[a-zA-Z0-9_-]+$/.test(s)) return { url: `https://challonge.com/${s}`, org: null, slug: s };
  return null;
}

// ── Page parsing helpers ──────────────────────────────────────────────────────

// The store assignment script is server-rendered into every bracket page. It
// contains only `window._initialStoreState[...] = {...};` statements, so
// executing it against a stub window is the most robust way to get the JSON
// out (no brace-counting on a 100KB blob).
function extractStore(doc) {
  const sc = [...doc.querySelectorAll('script')]
    .find((s) => s.textContent.includes("_initialStoreState['TournamentStore']"));
  if (!sc) return null;
  const win = {};
  try {
    new Function('window', 'document', sc.textContent)(win, {});
  } catch (err) {
    console.warn('   store eval failed:', err.message);
    return null;
  }
  return (win._initialStoreState && win._initialStoreState.TournamentStore) || null;
}

function pageName(doc) {
  const og = doc.querySelector('meta[property="og:title"]');
  if (og && og.content) {
    const n = og.content.replace(/\s+-\s+Challonge\s*$/, '').trim();
    if (n) return n;
  }
  const h1 = doc.querySelector('h1');
  if (!h1) return null;
  for (const n of h1.childNodes) {
    if (n.nodeType === 3 && n.textContent.trim()) return n.textContent.trim();
  }
  return (h1.textContent || '').trim().split('\n')[0].trim() || null;
}

// Banner meta list: "Players 20", "Format Double Elimination",
// "Game Pokkén Tournament", plus a .start-time div with the start date.
function pageMeta(doc) {
  const out = { players: null, game: null, date: null };
  for (const li of doc.querySelectorAll('.redesigned-meta-list .item')) {
    const txt = (li.textContent || '').replace(/\s+/g, ' ').trim();
    let m;
    if ((m = txt.match(/^Players\s+(\d+)/i))) out.players = parseInt(m[1]);
    else if ((m = txt.match(/^Game\s+(.+)$/i))) out.game = m[1].trim();
  }
  const st = doc.querySelector('.start-time');
  if (st) {
    // "July 31, 2016 at 5:00 PM EDT" → keep the date part; format as
    // YYYY-MM-DD from local date parts so no timezone math shifts the day.
    const raw = (st.textContent || '').trim().split(/\s+at\s+/i)[0].trim();
    let d = new Date(raw);
    // Challonge omits the year for current-year events ("January 11" instead
    // of "January 11, 2026") and Date() then defaults to 2001. Re-parse with
    // the current year, rolling back one if that would land in the future.
    if (!isNaN(d) && !/\b\d{4}\b/.test(raw)) {
      d = new Date(`${raw}, ${new Date().getFullYear()}`);
      if (!isNaN(d) && d.getTime() > Date.now()) d.setFullYear(d.getFullYear() - 1);
    }
    if (!isNaN(d)) {
      out.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return out;
}

// Keep only real uploaded avatars. The store falls back to a gravatar URL
// (with a gray-fireball default) for everyone else — storing those would fill
// players.avatar_url with placeholder noise via the backend's COALESCE.
function cleanAvatar(src) {
  if (!src) return null;
  const url = String(src).replace(/&amp;/g, '&');
  if (!/user-assets\.challonge\.com/.test(url)) return null;
  if (/\/misc\//.test(url)) return null;
  return url;
}

function playerFromStore(p) {
  if (!p || p.id == null) return null;
  const name = (p.display_name || '').trim();
  if (!name) return null;
  return { id: p.id, name, avatar: cleanAvatar(p.portrait_url) };
}

// Flatten the final stage plus any group stages into one match list.
// Group matches carry their group index so the backend can order them first
// and exclude them from elimination-based placement derivation.
function matchesFromStore(ts) {
  const out = [];
  const addStage = (stage, groupIdx) => {
    const byRound = (stage && stage.matches_by_round) || {};
    for (const key of Object.keys(byRound)) {
      for (const m of byRound[key] || []) {
        if (!m) continue;
        out.push({
          id: m.id,
          round: m.round,
          state: m.state,
          group: groupIdx,
          winner_id: m.winner_id != null ? m.winner_id : null,
          score1: Array.isArray(m.scores) && Number.isFinite(m.scores[0]) ? m.scores[0] : null,
          score2: Array.isArray(m.scores) && Number.isFinite(m.scores[1]) ? m.scores[1] : null,
          player1: playerFromStore(m.player1),
          player2: playerFromStore(m.player2),
        });
      }
    }
  };
  addStage(ts, null);
  (ts.groups || []).forEach((g, i) => addStage(g, i));
  return out;
}

// /standings is server-rendered for every bracket page — even never-finalized
// ones — with Challonge's own final ranks. Elimination tables have a
// "Challonge User" column; round-robin tables don't, but every row still links
// the account holder's /users/<name> profile, so we read usernames from hrefs.
function parseStandings(doc) {
  const table = doc.querySelector('table');
  if (!table) return [];
  const out = [];
  for (const row of [...table.rows].slice(1)) {
    const cells = [...row.cells].map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
    const rank = parseInt(cells[0]);
    const name = cells[1] || '';
    if (!Number.isFinite(rank) || !name) continue;
    let username = null;
    const a = row.querySelector('a[href*="/users/"]');
    if (a) {
      const m = (a.getAttribute('href') || '').match(/\/users\/([^\/?#]+)/);
      if (m && m[1] !== 'new') username = decodeURIComponent(m[1]);
    }
    out.push({ rank, name, username });
  }
  return out;
}

// The bracket page itself links some players' /users/<name> profiles (podium
// cards, participant blocks). Round-robin standings tables carry no username
// column, so this is the only username source for RR events — without it a
// "CC | Savvy" display name would fork a duplicate player record instead of
// merging with the existing savvy_ row.
function parseProfileLinks(doc) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href*="/users/"]')) {
    const m = (a.getAttribute('href') || '').match(/\/users\/([^\/?#]+)$/);
    const name = (a.textContent || '').trim();
    if (!m || m[1] === 'new' || !name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, username: decodeURIComponent(m[1]) });
  }
  return out;
}

// ── Scrape one event ──────────────────────────────────────────────────────────
async function scrapeOne(entry, { force = false } = {}) {
  // Always try the bare slug on the CURRENT origin. Organizer-created events
  // usually live at (or redirect to) the root namespace; true community
  // events 404 here and must be scraped from their own subdomain tab.
  const resp = await fetch(`/${entry.slug}`, { credentials: 'include' });
  if (resp.status === 404) {
    if (entry.org && location.host.replace(/^www\./, '') === 'challonge.com') {
      return { needsSubdomain: `https://${entry.org}.challonge.com/${entry.slug}` };
    }
    return { error: 'HTTP 404' };
  }
  if (!resp.ok) return { error: `HTTP ${resp.status}` };

  const finalUrl = new URL(resp.url);
  const host = finalUrl.host.replace(/^www\./, '');
  const finalSlug = finalUrl.pathname.split('/').filter(Boolean).pop() || entry.slug;
  // v1-equivalent id: bare slug at the root namespace, "<sub>-<slug>" on a
  // community subdomain. This is what keeps dedupe aligned with the v1 importer.
  const challonge_id = host === 'challonge.com' ? finalSlug : `${host.split('.')[0]}-${finalSlug}`;

  const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
  const ts = extractStore(doc);
  if (!ts || !ts.tournament) {
    return { skip: 'no bracket store on page (empty / 0-1 participants?)' };
  }
  if (ts.tournament.is_team) return { skip: 'team tournament' };

  const name = pageName(doc);
  const meta = pageMeta(doc);
  if (!name) return { error: 'could not read tournament name' };

  const isPokken = POKKEN_GAME_RE.test(meta.game || '') || POKKEN_NAME_RE.test(name);
  if (!isPokken && !force) {
    return { skip: `not Pokkén? name="${name}" game="${meta.game || '?'}" (use force:true to override)` };
  }

  const matches = matchesFromStore(ts);
  if (!matches.some((m) => m.state === 'complete' && m.player1 && m.player2)) {
    return { skip: 'no completed matches' };
  }

  await sleep(300);
  let standings = [];
  try {
    const sResp = await fetch(`${finalUrl.pathname}/standings`, { credentials: 'include' });
    if (sResp.ok) {
      standings = parseStandings(new DOMParser().parseFromString(await sResp.text(), 'text/html'));
    }
  } catch (err) {
    console.warn(`   standings fetch failed for ${entry.slug}: ${err.message} (backend will derive ranks)`);
  }

  return {
    payload: {
      challonge_id,
      url: resp.url,
      name,
      tournament_type: ts.tournament.tournament_type || null,
      state: ts.tournament.state || null,
      is_team: !!ts.tournament.is_team,
      participants_count: meta.players,
      game_name: meta.game,
      date: meta.date,
      matches,
      standings,
      profiles: parseProfileLinks(doc),
    },
  };
}

// ── Backend helpers ───────────────────────────────────────────────────────────
async function backendGet(path) {
  const resp = await fetch(`${BACKEND_URL}${path}`, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

async function postPayload(payload) {
  const resp = await fetch(`${BACKEND_URL}/api/tournaments/import-challonge-scraped`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runChallongeImport({ urls = null, force = false } = {}) {
  console.log('%c⚔️  Neos City — Challonge Scraped Bulk Import',
    'font-size:16px;font-weight:bold;color:#818cf8');
  console.log(`Origin: ${location.origin}  Backend: ${BACKEND_URL}\n`);

  // Build the target list: explicit URLs, or whatever the harvested file still
  // has pending (the backend dedupes against the DB with the same skip rule
  // as /batch-import).
  let targets;
  if (Array.isArray(urls) && urls.length > 0) {
    targets = urls.map(parseTargetUrl).filter(Boolean);
  } else {
    const pending = await backendGet('/api/tournaments/pending-challonge-urls');
    targets = pending.pending.map((p) => ({ url: p.url, org: p.org, slug: p.slug }));
    console.log(`📋 Backend reports ${targets.length} pending Challonge URL(s) ` +
      `(of ${pending.total} harvested)`);
  }
  // On a subdomain tab, only touch that community's own URLs — fetching a
  // root-namespace slug from here would bounce through a cross-origin redirect
  // that fetch() can't follow.
  const curHost = location.host.replace(/^www\./, '');
  if (curHost !== 'challonge.com' && curHost.endsWith('challonge.com')) {
    const sub = curHost.split('.')[0].toLowerCase();
    const before = targets.length;
    targets = targets.filter((t) => (t.org || '').toLowerCase() === sub);
    console.log(`🔀 Subdomain run (${sub}): processing ${targets.length}/${before} matching URL(s)`);
  }

  if (targets.length === 0) {
    console.log('✅ Nothing to do — everything is already imported.');
    return;
  }

  // ── Phase 1: scrape ────────────────────────────────────────────────────────
  window._challongeScrapedQueue = window._challongeScrapedQueue || [];
  const queuedIds = new Set(window._challongeScrapedQueue.map((p) => p.challonge_id));
  const needsSubdomain = [];
  const skipped = [];
  const errors = [];

  for (let i = 0; i < targets.length; i++) {
    const entry = targets[i];
    const tag = `[${i + 1}/${targets.length}] ${entry.org ? entry.org + '/' : ''}${entry.slug}`;
    try {
      const r = await scrapeOne(entry, { force });
      if (r.needsSubdomain) {
        needsSubdomain.push(r.needsSubdomain);
        console.warn(`🔀 ${tag} — community subdomain event, scrape from ${r.needsSubdomain}`);
      } else if (r.skip) {
        skipped.push({ slug: entry.slug, reason: r.skip });
        console.warn(`⏭️  ${tag} — ${r.skip}`);
      } else if (r.error) {
        errors.push({ slug: entry.slug, error: r.error });
        console.error(`❌ ${tag} — ${r.error}`);
      } else if (queuedIds.has(r.payload.challonge_id)) {
        console.log(`⏭️  ${tag} — already scraped this session`);
      } else {
        window._challongeScrapedQueue.push(r.payload);
        queuedIds.add(r.payload.challonge_id);
        const nMatches = r.payload.matches.filter((m) => m.state === 'complete').length;
        console.log(`✅ ${tag} — "${r.payload.name}" ${r.payload.date || '????-??-??'} · ` +
          `${nMatches} matches · ${r.payload.standings.length} standings rows`);
      }
    } catch (err) {
      errors.push({ slug: entry.slug, error: err.message });
      console.error(`❌ ${tag} — ${err.message}`);
    }
    await sleep(PAGE_DELAY_MS);
  }

  console.log(`\n📦 Phase 1 done — ${window._challongeScrapedQueue.length} queued, ` +
    `${skipped.length} skipped, ${errors.length} errored, ${needsSubdomain.length} need a subdomain run`);

  // ── Phase 2: POST chronologically ──────────────────────────────────────────
  // Oldest first so live ELO replays in roughly the right order (the
  // post-import recalculate_elo.js makes it exact).
  window._challongeScrapedQueue.sort((a, b) =>
    String(a.date || '9999').localeCompare(String(b.date || '9999')));
  await window._challongePhase2();

  if (skipped.length) console.table(skipped);
  if (errors.length) console.table(errors);
  if (needsSubdomain.length) {
    console.log('%c🔀 Community-subdomain events — open each origin below in a tab, ' +
      'paste this script again, and it will pick them up:', 'color:#fbbf24;font-weight:bold');
    for (const u of needsSubdomain) console.log('   ' + u);
  }
  console.log('%c🏁 Done. Next: node recalculate_elo.js, then node check_import_status.js',
    'color:#34d399;font-weight:bold');
}

// Re-POST whatever is still queued (survives mixed-content fixes; Phase 1 data
// lives on window._challongeScrapedQueue).
window._challongePhase2 = async function _challongePhase2() {
  const queued = window._challongeScrapedQueue || [];
  if (!queued.length) { console.log('Nothing queued for POST.'); return; }
  console.log(`\n%c📤 POSTing ${queued.length} tournament(s) to the backend…`,
    'font-size:14px;font-weight:bold;color:#818cf8');

  let ok = 0, failed = 0;
  for (const payload of [...queued]) {
    try {
      const result = await postPayload(payload);
      if (result.skipped) {
        console.log(`⏭️  ${payload.name} — backend skipped (${result.reason})`);
      } else {
        const src = result.placements_source === 'standings' ? '🏷 standings' : '🧮 derived';
        console.log(`✅ ${payload.name} — ${result.matches_imported} matches, ` +
          `${result.participants} players, ${src}${result.partial ? ' · PARTIAL' : ''}`);
      }
      ok++;
      window._challongeScrapedQueue = window._challongeScrapedQueue.filter(
        (p) => p.challonge_id !== payload.challonge_id);
    } catch (err) {
      failed++;
      console.error(`❌ ${payload.name}: ${err.message}`);
      if (/Failed to fetch|blocked|mixed/i.test(err.message)) {
        console.error('%cMixed-content error suspected. Lock icon → Site settings → ' +
          'Insecure content → Allow, reload, re-paste, then run _challongePhase2()',
          'color:#fbbf24;font-weight:bold');
        break; // the rest will fail the same way
      }
    }
    await sleep(POST_DELAY_MS);
  }
  console.log(`\n📊 POST phase: ${ok} ok, ${failed} failed, ` +
    `${(window._challongeScrapedQueue || []).length} still queued`);
};

// ── Run ───────────────────────────────────────────────────────────────────────
runChallongeImport().catch((err) => console.error('Unhandled error:', err));

// Variants:
// runChallongeImport({ urls: ['https://challonge.com/SomeSlug'] });
// runChallongeImport({ urls: [...], force: true });   // bypass Pokkén keyword check
