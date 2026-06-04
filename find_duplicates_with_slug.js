#!/usr/bin/env node
/**
 * find_duplicates_with_slug.js — Surface duplicate-player candidates using
 * four queries, with canonical-direction suggestions based on
 * `players.challonge_profile_slug`.
 *
 * Background
 * ----------
 * `players.challonge_username` is supposed to be the URL slug for
 * challonge.com/users/<slug>. But the importer in
 * `backend/src/routes/tournaments.js:261-289` falls back to a slugified
 * `display_name` when a participant entered an event as a guest (no
 * Challonge account linked). So `challonge_username` is sometimes a real
 * slug and sometimes a fake one — and you can't tell from the row alone.
 *
 * `challonge_profile_slug` (nullable TEXT) was added later and is
 * populated only when the v1 API returned `attrs.challonge_username`
 * non-empty. A non-NULL value here is ground truth for the real URL slug.
 * Historical rows are NULL until a backfill runs.
 *
 * What this script reports
 * ------------------------
 *   Query 1: Pairs of distinct players with the same display_name
 *            (LOWER comparison). Strongest duplicate signal — bracket
 *            name agrees, the row keys disagree.
 *
 *   Query 2: Rows whose challonge_username equals slugify(display_name)
 *            AND whose challonge_profile_slug is NULL. These are likely
 *            fallback-derived guest entries with no real Challonge profile.
 *
 *   Query 3: Rows where challonge_profile_slug was captured but differs
 *            from challonge_username. Authoritative mismatch — only
 *            meaningful once the backfill has run.
 *
 *   Query 4: Fuzzy handle-overlap pairs (normalized-handle match +
 *            prefix/suffix overlap). Catches princessknight/princessknight9-
 *            style duplicates where display names DIFFER but the handle
 *            structure suggests one human. Pairs already surfaced in
 *            Query 1 are filtered out so this view is purely additive.
 *
 * Canonical-direction rules (Queries 1 and 4)
 * -------------------------------------------
 *   - Exactly one row has non-NULL challonge_profile_slug → that row is canonical.
 *   - Neither does → flag for manual verification (open both Challonge URLs).
 *   - Both do, same value → both confirm the same human; pick whichever row's
 *     handle already matches the real slug, else lower id wins.
 *   - Both do, different values → likely NOT duplicates; surface both URLs
 *     and do not auto-suggest.
 *
 * Read-only — never invokes merge_players.js.
 *
 * Usage:
 *   node find_duplicates_with_slug.js               # human-readable report
 *   node find_duplicates_with_slug.js --json        # raw JSON for piping
 *   node find_duplicates_with_slug.js --q4-limit N  # cap Query 4 rows (default 80)
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const Q4_LIMIT = (() => {
  const i = args.indexOf('--q4-limit');
  const v = i !== -1 ? parseInt(args[i + 1], 10) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 80;
})();
const APP_BASE = 'https://www.neos-city.com';
const CHALLONGE_BASE = 'https://challonge.com/users';

const appUrl = (id) => `${APP_BASE}/players/${id}`;
const chalUrl = (slug) => `${CHALLONGE_BASE}/${encodeURIComponent(slug)}`;

function canonicalChoice(a, b) {
  const aHas = a.challonge_profile_slug != null && a.challonge_profile_slug !== '';
  const bHas = b.challonge_profile_slug != null && b.challonge_profile_slug !== '';
  if (aHas && !bHas) {
    return { keep: a, drop: b, confidence: 'HIGH',
      reason: `A has confirmed Challonge profile slug "${a.challonge_profile_slug}"; B does not.` };
  }
  if (bHas && !aHas) {
    return { keep: b, drop: a, confidence: 'HIGH',
      reason: `B has confirmed Challonge profile slug "${b.challonge_profile_slug}"; A does not.` };
  }
  if (aHas && bHas) {
    if (a.challonge_profile_slug === b.challonge_profile_slug) {
      // Both rows resolve to the same real Challonge account.
      const aMatchesReal = a.challonge_username === a.challonge_profile_slug;
      const bMatchesReal = b.challonge_username === b.challonge_profile_slug;
      let keep, drop;
      if (aMatchesReal && !bMatchesReal)      { keep = a; drop = b; }
      else if (bMatchesReal && !aMatchesReal) { keep = b; drop = a; }
      else                                    { keep = a; drop = b; } // lower id (a.id < b.id by query)
      return { keep, drop, confidence: 'HIGH',
        reason: `Both rows confirm the same Challonge profile slug "${a.challonge_profile_slug}". Keeping the row whose key already matches the real slug (else lower id).` };
    }
    return { keep: null, drop: null, confidence: 'MANUAL',
      reason: `Both rows have non-NULL profile slugs but they differ ("${a.challonge_profile_slug}" vs "${b.challonge_profile_slug}"). Probably NOT duplicates — verify before merging.` };
  }
  return { keep: null, drop: null, confidence: 'MANUAL',
    reason: 'Neither row has a confirmed Challonge profile slug. Open both Challonge URLs in a browser; the row whose URL resolves to a real profile is canonical.' };
}

// Alphanumerics-only lowercase, for handle comparison. "TEC_XX" → "tecxx",
// "princess_knight!" → "princessknight". Mirrors the same helper in
// find_duplicate_players.js so Q4 here surfaces the same pairs.
function normHandle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Returns pair objects {a, b, heuristic} for the fuzzy-handle duplicate
// classes from find_duplicate_players.js:
//   - Normalized handle match (same alphanumerics, different keys)
//   - Prefix or suffix overlap of ≥3 chars on the normalized handle
// Edit-distance heuristics are intentionally NOT ported — they produce
// a lot of low-signal pairs that don't benefit from the slug tiebreaker.
function findFuzzyPairs(players) {
  const seen = new Set();
  const pairKey = (a, b) => {
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    return `${x.id}-${y.id}`;
  };
  const out = [];
  const addPair = (a, b, heuristic) => {
    if (a.id === b.id) return;
    const k = pairKey(a, b);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ a, b, heuristic });
  };

  // 1. Normalized handle match
  const byNorm = new Map();
  for (const p of players) {
    const n = normHandle(p.challonge_username);
    if (n.length < 2) continue;
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(p);
  }
  for (const group of byNorm.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].challonge_username !== group[j].challonge_username) {
          addPair(group[i], group[j], 'normalized handle match');
        }
      }
    }
  }

  // 2. Prefix/suffix overlap (≥3 chars in the overlap segment)
  const buckets = new Map();
  const bucket = (k, p) => {
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  };
  for (const p of players) {
    const n = normHandle(p.challonge_username);
    if (n.length < 3) continue;
    bucket('p:' + n.slice(0, 3), p);
    bucket('s:' + n.slice(-3), p);
  }
  for (const group of buckets.values()) {
    for (let i = 0; i < group.length; i++) {
      const a = normHandle(group[i].challonge_username);
      for (let j = i + 1; j < group.length; j++) {
        const b = normHandle(group[j].challonge_username);
        if (a === b) continue;
        const minLen = Math.min(a.length, b.length);
        if (minLen < 3) continue;
        if (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a)) {
          addPair(group[i], group[j], 'prefix/suffix overlap');
        }
      }
    }
  }

  return out;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // ── QUERY 1: same display_name pairs ────────────────────────────────────
  const { rows: pairs } = await pool.query(`
    SELECT a.id AS a_id, a.challonge_username AS a_user, a.display_name AS a_name,
           a.challonge_profile_slug AS a_slug,
           COALESCE((SELECT COUNT(*)::int FROM tournament_placements WHERE player_id = a.id), 0) AS a_placements,
           b.id AS b_id, b.challonge_username AS b_user, b.display_name AS b_name,
           b.challonge_profile_slug AS b_slug,
           COALESCE((SELECT COUNT(*)::int FROM tournament_placements WHERE player_id = b.id), 0) AS b_placements
    FROM players a
    JOIN players b
      ON LOWER(a.display_name) = LOWER(b.display_name)
     AND a.id < b.id
    ORDER BY LOWER(a.display_name), a.id
  `);

  // ── QUERY 2: fallback-derived rows ──────────────────────────────────────
  const { rows: fallback } = await pool.query(`
    SELECT p.id, p.challonge_username, p.display_name, p.challonge_profile_slug,
           COALESCE((SELECT COUNT(*)::int FROM tournament_placements WHERE player_id = p.id), 0) AS placements
    FROM players p
    WHERE LOWER(REPLACE(p.display_name, ' ', '_')) = p.challonge_username
      AND p.challonge_profile_slug IS NULL
    ORDER BY p.display_name
  `);

  // ── QUERY 3: confirmed mismatches (post-backfill signal) ────────────────
  const { rows: mismatch } = await pool.query(`
    SELECT id, challonge_username, display_name, challonge_profile_slug
    FROM players
    WHERE challonge_profile_slug IS NOT NULL
      AND challonge_profile_slug != challonge_username
    ORDER BY challonge_username
  `);

  // ── QUERY 4: fuzzy handle overlap (additive on top of Query 1) ──────────
  // Pull every player with activity, run the JS-side fuzzy heuristic, then
  // drop pairs that Query 1 already surfaced so the section is purely
  // additive. Excluded handles in `player_aliases` are skipped — those have
  // a prior canonical decision in the DB.
  const { rows: activePlayers } = await pool.query(`
    SELECT p.id, p.challonge_username, p.display_name, p.challonge_profile_slug,
           COALESCE((SELECT COUNT(*)::int FROM tournament_placements WHERE player_id = p.id), 0) AS placements
    FROM players p
    WHERE EXISTS (SELECT 1 FROM tournament_placements WHERE player_id = p.id)
       OR EXISTS (SELECT 1 FROM matches WHERE player1_id = p.id OR player2_id = p.id)
  `);
  let aliased = new Set();
  try {
    const { rows } = await pool.query(`SELECT alias_username FROM player_aliases`);
    aliased = new Set(rows.map(r => r.alias_username));
  } catch { /* player_aliases is optional; safe to skip */ }
  const eligible = activePlayers.filter(p => p.challonge_username && !aliased.has(p.challonge_username));

  const q1Keys = new Set(pairs.map(r => {
    const lo = Math.min(r.a_id, r.b_id);
    const hi = Math.max(r.a_id, r.b_id);
    return `${lo}-${hi}`;
  }));
  const fuzzyAll = findFuzzyPairs(eligible).filter(({ a, b }) => {
    const lo = Math.min(a.id, b.id);
    const hi = Math.max(a.id, b.id);
    return !q1Keys.has(`${lo}-${hi}`);
  });
  // HIGH-confidence pairs first (slug evidence settles direction), then by
  // combined placement activity descending so eyeballs land on the cases
  // worth your time.
  fuzzyAll.sort((x, y) => {
    const xc = canonicalChoice(x.a, x.b).confidence;
    const yc = canonicalChoice(y.a, y.b).confidence;
    if (xc !== yc) return xc === 'HIGH' ? -1 : 1;
    const xa = (x.a.placements || 0) + (x.b.placements || 0);
    const ya = (y.a.placements || 0) + (y.b.placements || 0);
    return ya - xa;
  });
  const fuzzy = fuzzyAll.slice(0, Q4_LIMIT);
  const fuzzyHidden = fuzzyAll.length - fuzzy.length;

  if (AS_JSON) {
    console.log(JSON.stringify({ pairs, fallback, mismatch, fuzzy, fuzzy_total: fuzzyAll.length }, null, 2));
    await pool.end();
    return;
  }

  console.log('');
  console.log(`Query 1: ${pairs.length} duplicate-display-name pair(s).`);
  console.log(`Query 2: ${fallback.length} likely fallback-derived row(s) (handle = slugify(display_name), no profile slug).`);
  console.log(`Query 3: ${mismatch.length} confirmed slug-mismatch row(s).`);
  console.log(`Query 4: ${fuzzyAll.length} fuzzy-handle pair(s) not already in Query 1 (showing top ${fuzzy.length}).`);
  console.log('');

  // ── Report Query 1 ──────────────────────────────────────────────────────
  console.log('═'.repeat(110));
  console.log(' QUERY 1 — Same display_name pairs (strongest duplicate signal)');
  console.log('═'.repeat(110));

  if (pairs.length === 0) {
    console.log('  None.\n');
  }

  for (const r of pairs) {
    const a = {
      id: r.a_id, challonge_username: r.a_user, display_name: r.a_name,
      challonge_profile_slug: r.a_slug, placements: r.a_placements,
    };
    const b = {
      id: r.b_id, challonge_username: r.b_user, display_name: r.b_name,
      challonge_profile_slug: r.b_slug, placements: r.b_placements,
    };
    const choice = canonicalChoice(a, b);

    console.log('');
    console.log(`"${a.display_name}"   [${choice.confidence}]`);
    for (const row of [a, b]) {
      const slug = row.challonge_profile_slug ? `slug="${row.challonge_profile_slug}"` : 'slug=NULL';
      console.log(`  id=${String(row.id).padStart(5)}  @${row.challonge_username.padEnd(30)}  ${slug.padEnd(34)}  placements=${row.placements}`);
      console.log(`    app:  ${appUrl(row.id)}`);
      console.log(`    chal: ${chalUrl(row.challonge_username)}`);
    }
    console.log(`  ${choice.reason}`);
    if (choice.keep) {
      console.log(`  Suggest: node merge_players.js ${choice.drop.challonge_username} ${choice.keep.challonge_username}`);
    } else {
      console.log(`  Verify both Challonge URLs above. Then run one of:`);
      console.log(`    node merge_players.js ${b.challonge_username} ${a.challonge_username}`);
      console.log(`    node merge_players.js ${a.challonge_username} ${b.challonge_username}`);
    }
  }

  // ── Report Query 2 ──────────────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(110));
  console.log(' QUERY 2 — Likely fallback-derived rows (no confirmed Challonge profile)');
  console.log('═'.repeat(110));
  console.log(' Heuristic: challonge_username == slugify(display_name), no profile slug captured.');
  console.log(' Open verify URL — if it resolves to a real profile, the user has another row that should');
  console.log(' merge here. If 404, this row IS the guest entry and another row probably holds the real slug.');
  console.log('');

  if (fallback.length === 0) {
    console.log('  None.');
  }

  for (const r of fallback) {
    console.log(`  id=${String(r.id).padStart(5)}  @${r.challonge_username.padEnd(30)}  "${r.display_name}"  placements=${r.placements}`);
    console.log(`    app:    ${appUrl(r.id)}`);
    console.log(`    verify: ${chalUrl(r.challonge_username)}`);
  }

  // ── Report Query 3 ──────────────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(110));
  console.log(' QUERY 3 — Confirmed slug mismatches (post-backfill signal)');
  console.log('═'.repeat(110));
  if (mismatch.length === 0) {
    console.log(' None. (challonge_profile_slug has not been backfilled on historical rows yet — expected.)');
  } else {
    for (const r of mismatch) {
      console.log(`  id=${r.id}  key=@${r.challonge_username}  real_slug="${r.challonge_profile_slug}"  display="${r.display_name}"`);
      console.log(`    app:  ${appUrl(r.id)}`);
      console.log(`    real: ${chalUrl(r.challonge_profile_slug)}`);
    }
  }

  // ── Report Query 4 ──────────────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(110));
  console.log(' QUERY 4 — Fuzzy handle overlap (normalized match + prefix/suffix overlap)');
  console.log('═'.repeat(110));
  console.log(' Display names DIFFER (otherwise the pair would be in Query 1), but the handle');
  console.log(' structure suggests one human. HIGH = slug evidence picks a direction; MANUAL =');
  console.log(' neither side has slug evidence, browser-verify before merging.');
  console.log('');

  if (fuzzy.length === 0) {
    console.log('  None.');
  }

  for (const { a, b, heuristic } of fuzzy) {
    const choice = canonicalChoice(a, b);
    console.log('');
    console.log(`@${a.challonge_username} ↔ @${b.challonge_username}   [${choice.confidence}]  (${heuristic})`);
    for (const row of [a, b]) {
      const slug = row.challonge_profile_slug ? `slug="${row.challonge_profile_slug}"` : 'slug=NULL';
      console.log(`  id=${String(row.id).padStart(5)}  @${row.challonge_username.padEnd(30)}  ${slug.padEnd(34)}  "${row.display_name}"  placements=${row.placements}`);
      console.log(`    app:  ${appUrl(row.id)}`);
      console.log(`    chal: ${chalUrl(row.challonge_username)}`);
    }
    console.log(`  ${choice.reason}`);
    if (choice.keep) {
      console.log(`  Suggest: node merge_players.js ${choice.drop.challonge_username} ${choice.keep.challonge_username}`);
    } else {
      console.log(`  Verify both Challonge URLs above. Then run one of:`);
      console.log(`    node merge_players.js ${b.challonge_username} ${a.challonge_username}`);
      console.log(`    node merge_players.js ${a.challonge_username} ${b.challonge_username}`);
    }
  }

  if (fuzzyHidden > 0) {
    console.log('');
    console.log(`  (${fuzzyHidden} more pair(s) hidden — re-run with --q4-limit ${fuzzyAll.length} to see all.)`);
  }
  console.log('');

  await pool.end();
}

main().catch(err => {
  console.error('find_duplicates_with_slug failed:', err.message);
  process.exit(1);
});
