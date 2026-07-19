/**
 * Neos City — NAIC 2022 Placement Backfill (Browser Console)
 *
 * DB row id 568 (NAIC 2022, source 'liquipedia') has bracket matches but only
 * top-8 placement rows and a NULL participants_count. The official Challonge
 * bracket — https://pokkentournament.challonge.com/gcrniykz (49 players) —
 * server-renders full final ranks on its /standings page (e.g. TapuCocoa
 * 13th). Importing that slug normally would duplicate row 568, so this script
 * scrapes the standings and POSTs them to the merge endpoint
 * POST /api/tournaments/backfill-scraped-placements, which backfills the
 * missing placement rows + participants_count onto the EXISTING row.
 *
 * HOW TO USE
 * ──────────
 * 1. Backend running on localhost:3001 (CORS for *.challonge.com is on).
 * 2. From the project root:  node prep_console.js naic_backfill_console.js
 * 3. Open Chrome to https://pokkentournament.challonge.com/gcrniykz
 *    (the SUBDOMAIN tab — a challonge.com root tab can't fetch it same-origin).
 * 4. F12 → Console → Ctrl+V → Enter. This runs a DRY RUN: the backend reports
 *    per-row actions (insert / fill-rank / keep-existing / create-player) and
 *    writes NOTHING.
 * 5. Review the table — especially 'create-player+insert' rows, which mean no
 *    existing player matched (candidates for merge_players.js afterwards).
 * 6. To apply for real:  _naicBackfillApply()
 * 7. Then from the project root: node recalculate_elo.js
 */

const ADMIN_TOKEN = '';
const BACKEND_URL = 'http://localhost:3001';

const TOURNAMENT_ID = 568;          // NAIC 2022 row (source 'liquipedia')
const SLUG = 'gcrniykz';            // official bracket on pokkentournament.challonge.com
const EXPECTED_HOST = 'pokkentournament.challonge.com';

if (!ADMIN_TOKEN) {
  console.error('❌ ADMIN_TOKEN is blank. Run `node prep_console.js naic_backfill_console.js`');
  console.error('   to inline it from backend/.env, then paste the result.');
  throw new Error('ADMIN_TOKEN missing');
}

if (location.host.replace(/^www\./, '') !== EXPECTED_HOST) {
  console.warn(`⚠️  You're on ${location.host} — this bracket lives on the community subdomain.`);
  console.warn(`   Open https://${EXPECTED_HOST}/${SLUG} and paste there, or the fetches will fail.`);
}

// Same parser as challonge_import_console.js: every standings row links the
// account holder's /users/<name> profile, so usernames come from hrefs; rows
// whose rank cell doesn't parse are kept with rank:null (backend drops them).
function parseStandings(doc) {
  const table = doc.querySelector('table');
  if (!table) return [];
  const out = [];
  for (const row of [...table.rows].slice(1)) {
    const cells = [...row.cells].map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
    const rank = parseInt(cells[0]);
    const name = cells[1] || '';
    if (!name) continue;
    let username = null;
    const a = row.querySelector('a[href*="/users/"]');
    if (a) {
      const m = (a.getAttribute('href') || '').match(/\/users\/([^\/?#]+)/);
      if (m && m[1] !== 'new') username = decodeURIComponent(m[1]);
    }
    out.push({ rank: Number.isFinite(rank) ? rank : null, name, username });
  }
  return out;
}

// "Players 49" from the bracket page's banner meta list.
function parsePlayersCount(doc) {
  for (const li of doc.querySelectorAll('.redesigned-meta-list .item')) {
    const m = (li.textContent || '').replace(/\s+/g, ' ').trim().match(/^Players\s+(\d+)/i);
    if (m) return parseInt(m[1]);
  }
  return null;
}

async function fetchDoc(path) {
  const resp = await fetch(path, { credentials: 'include' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${path}`);
  return new DOMParser().parseFromString(await resp.text(), 'text/html');
}

async function postBackfill(payload) {
  const resp = await fetch(`${BACKEND_URL}/api/tournaments/backfill-scraped-placements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

function report(result) {
  console.log(`%c${result.dry_run ? '🔎 DRY RUN' : '✅ APPLIED'} — "${result.tournament.name}" ` +
    `(id ${result.tournament.id}, source ${result.tournament.source})`,
    `font-weight:bold;color:${result.dry_run ? '#fbbf24' : '#34d399'}`);
  console.log(`   ${result.standings_rows} standings rows · participants_count: ${result.participants_count}`);
  console.log('   action counts:', result.counts);
  console.table(result.actions);
  const creates = result.actions.filter((a) => a.action === 'create-player+insert');
  if (creates.length) {
    console.log(`%c⚠️  ${creates.length} row(s) would create NEW players — eyeball these for ` +
      `name variants of existing players (merge_players.js candidates):`, 'color:#fbbf24;font-weight:bold');
    for (const a of creates) console.log(`   rank ${a.rank}: ${a.name}`);
  }
  const mismatches = result.actions.filter((a) => /RANK MISMATCH/.test(a.detail || ''));
  if (mismatches.length) {
    console.log('%c⚠️  Rank mismatches vs existing (existing kept):', 'color:#fbbf24;font-weight:bold');
    for (const a of mismatches) console.log(`   ${a.name}: ${a.detail}`);
  }
}

(async () => {
  console.log('%c⚔️  Neos City — NAIC 2022 standings backfill',
    'font-size:16px;font-weight:bold;color:#818cf8');

  const bracketDoc = await fetchDoc(`/${SLUG}`);
  const playersCount = parsePlayersCount(bracketDoc); // expected 49
  const standingsDoc = await fetchDoc(`/${SLUG}/standings`);
  const standings = parseStandings(standingsDoc);
  console.log(`Scraped ${standings.length} standings row(s); bracket says ${playersCount ?? '?'} players.`);
  if (!standings.length) throw new Error('standings table parsed empty — is this the right tab/slug?');

  window._naicPayload = {
    tournament_id: TOURNAMENT_ID,
    participants_count: playersCount,
    standings,
    dry_run: true,
  };

  report(await postBackfill(window._naicPayload));
  console.log('%cReview the table above, then run  _naicBackfillApply()  to write for real.',
    'color:#6366f1;font-weight:bold');
})().catch((err) => console.error('Unhandled error:', err));

window._naicBackfillApply = async function _naicBackfillApply() {
  if (!window._naicPayload) { console.error('No payload — run the paste first.'); return; }
  report(await postBackfill({ ...window._naicPayload, dry_run: false }));
  console.log('%c🏁 Done. Next: node recalculate_elo.js, then node check_import_status.js',
    'color:#34d399;font-weight:bold');
};
