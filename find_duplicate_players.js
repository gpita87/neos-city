#!/usr/bin/env node
/**
 * find_duplicate_players.js — Read-only candidate finder for player merges.
 *
 * Surfaces pairs of players whose challonge_username / display_name suggests
 * they are the same human (e.g. TEC_XX vs TEC, jukem vs Jukem_, etc.).
 *
 * Heuristics, in descending confidence:
 *   1. Same normalized handle  (alphanumerics-only, lowercase)
 *      e.g.  tec_xx ↔ tec.xx ↔ tecxx
 *   2. Same display_name (case-insensitive trim), different challonge_username
 *      e.g.  display "Jukem" on @jukem and on @magicrock
 *   3. Prefix/suffix overlap of the normalized handle (one is a strict prefix
 *      or suffix of the other; both have at least 3 chars in the overlap)
 *      e.g.  tec ↔ tec_xx,  jukem ↔ jukem_ts
 *   4. Levenshtein distance 1–2 between normalized handles, both ≥ 5 chars
 *      e.g.  shean96 ↔ shean69 (typo)
 *
 * Already-merged aliases (rows in player_aliases) are excluded.
 *
 * Run from the neos-city directory:
 *   node find_duplicate_players.js
 *
 * Optional flags:
 *   --limit N         Show top N pairs total (default 60)
 *   --tier high|all   Filter to high-confidence only (heuristics 1–2), or all
 *   --json            Emit a JSON array instead of the human-readable table
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : (args[i + 1] || fallback);
};
const has = (name) => args.includes(name);

const LIMIT = parseInt(flag('--limit', '60'), 10);
const TIER = flag('--tier', 'all');
const AS_JSON = has('--json');

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Iterative Levenshtein with early-exit when distance exceeds maxD.
function lev(a, b, maxD) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxD) return maxD + 1;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  let v0 = new Array(n + 1).fill(0).map((_, i) => i);
  let v1 = new Array(n + 1).fill(0);
  for (let i = 0; i < m; i++) {
    v1[0] = i + 1;
    let rowMin = v1[0];
    for (let j = 0; j < n; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      if (v1[j + 1] < rowMin) rowMin = v1[j + 1];
    }
    if (rowMin > maxD) return maxD + 1;
    [v0, v1] = [v1, v0];
  }
  return v0[n];
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows: players } = await pool.query(`
    SELECT
      p.id,
      p.challonge_username,
      p.display_name,
      p.region,
      COALESCE(p.tournaments_entered, 0)                                          AS tournaments_entered,
      COALESCE(p.total_match_wins, 0) + COALESCE(p.total_match_losses, 0)         AS matches,
      COALESCE(p.offline_score, 0)                                                AS offline_score,
      (SELECT COUNT(*)::int FROM tournament_placements tp
         JOIN tournaments t ON tp.tournament_id = t.id
        WHERE tp.player_id = p.id AND t.is_offline = TRUE)                        AS offline_placements,
      (SELECT COUNT(*)::int FROM tournament_placements tp
         JOIN tournaments t ON tp.tournament_id = t.id
        WHERE tp.player_id = p.id AND t.is_offline = FALSE)                       AS online_placements,
      (SELECT MAX(t.completed_at) FROM tournament_placements tp
         JOIN tournaments t ON tp.tournament_id = t.id
        WHERE tp.player_id = p.id)                                                AS last_seen
    FROM players p
    WHERE COALESCE(p.tournaments_entered, 0) > 0
       OR EXISTS (SELECT 1 FROM tournament_placements WHERE player_id = p.id)
       OR EXISTS (SELECT 1 FROM matches WHERE player1_id = p.id OR player2_id = p.id)
  `);

  let aliased = new Set();
  try {
    const { rows } = await pool.query(`SELECT alias_username FROM player_aliases`);
    aliased = new Set(rows.map(r => r.alias_username));
  } catch { /* table may not exist yet */ }

  const pool_ = players.filter(p => p.challonge_username && !aliased.has(p.challonge_username));

  const seen = new Set();
  const pairKey = (a, b) => {
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    return `${x.id}-${y.id}`;
  };
  const addPair = (out, a, b, heuristic, score) => {
    if (a.id === b.id) return;
    const k = pairKey(a, b);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ a, b, heuristic, score });
  };

  const pairs = [];

  // 1. Exact normalized handle match
  const byNorm = new Map();
  for (const p of pool_) {
    const n = normalize(p.challonge_username);
    if (n.length < 2) continue;
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(p);
  }
  for (const [, group] of byNorm) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].challonge_username !== group[j].challonge_username) {
          addPair(pairs, group[i], group[j], 'normalized handle match', 100);
        }
      }
    }
  }

  // 2. Same display_name, different username
  const byDisplay = new Map();
  for (const p of pool_) {
    const d = String(p.display_name || '').toLowerCase().trim();
    if (d.length < 2) continue;
    if (!byDisplay.has(d)) byDisplay.set(d, []);
    byDisplay.get(d).push(p);
  }
  for (const [, group] of byDisplay) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        addPair(pairs, group[i], group[j], 'same display_name', 90);
      }
    }
  }

  if (TIER !== 'high') {
    // 3. Prefix/suffix overlap on normalized handle (overlap ≥ 3 chars)
    // Bucket by first 3 chars to limit comparisons; also bucket by last 3 chars
    // to catch suffix-anchored cases (e.g. "tec_xx" vs "xx").
    const buckets = new Map();
    const bucket = (k, p) => {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    };
    for (const p of pool_) {
      const n = normalize(p.challonge_username);
      if (n.length < 3) continue;
      bucket('p:' + n.slice(0, 3), p);
      bucket('s:' + n.slice(-3), p);
    }
    for (const [, group] of buckets) {
      for (let i = 0; i < group.length; i++) {
        const a = normalize(group[i].challonge_username);
        for (let j = i + 1; j < group.length; j++) {
          const b = normalize(group[j].challonge_username);
          if (a === b) continue;
          const minLen = Math.min(a.length, b.length);
          if (minLen < 3) continue;
          if (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a)) {
            addPair(pairs, group[i], group[j], 'prefix/suffix overlap', 60);
            continue;
          }
          // 4. Levenshtein 1–2 on long-enough handles
          if (minLen >= 5 && Math.abs(a.length - b.length) <= 2) {
            const d = lev(a, b, 2);
            if (d === 1) {
              addPair(pairs, group[i], group[j], 'edit distance 1', 50);
            } else if (d === 2 && minLen >= 7) {
              addPair(pairs, group[i], group[j], 'edit distance 2', 30);
            }
          }
        }
      }
    }
  }

  // Sort: high confidence first, then by total combined activity (interesting pairs)
  pairs.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    const xa = (x.a.matches + x.a.online_placements + x.a.offline_placements) +
               (x.b.matches + x.b.online_placements + x.b.offline_placements);
    const ya = (y.a.matches + y.a.online_placements + y.a.offline_placements) +
               (y.b.matches + y.b.online_placements + y.b.offline_placements);
    return ya - xa;
  });

  const top = pairs.slice(0, LIMIT);

  if (AS_JSON) {
    console.log(JSON.stringify(top.map(p => ({
      heuristic: p.heuristic, score: p.score,
      a: p.a, b: p.b,
    })), null, 2));
    await pool.end();
    return;
  }

  console.log(`\nScanned ${pool_.length} players (excluding ${aliased.size} already-aliased handles).`);
  console.log(`Found ${pairs.length} candidate duplicate pairs; showing top ${top.length}.\n`);
  console.log('Direction tip: link_offline_player.js <FROM> <INTO>');
  console.log('  FROM = the row that gets deleted, INTO = the row that survives.');
  console.log('  The "Suggest" line below picks INTO as the side with the cleaner-looking handle');
  console.log('  (no underscores, suffix tags, or numbers); flip if it looks wrong.\n');
  console.log('─'.repeat(110));

  const fmtRow = (p) => {
    const last = p.last_seen ? new Date(p.last_seen).toISOString().slice(0, 10) : '       —  ';
    return [
      `id=${String(p.id).padStart(5)}`,
      `@${p.challonge_username}`.padEnd(28),
      `"${(p.display_name || '').slice(0, 18)}"`.padEnd(22),
      `${(p.region || '—').padEnd(2)}`,
      `m=${String(p.matches).padStart(4)}`,
      `on=${String(p.online_placements).padStart(3)}`,
      `off=${String(p.offline_placements).padStart(2)}`,
      `last=${last}`,
    ].join('  ');
  };

  // Heuristic for picking INTO: prefer the handle with the cleaner shape.
  // Score = 0 baseline, +1 for no underscore, +1 for no digits, +1 for shorter,
  // +1 for matching display_name (i.e. handle and display agree).
  const cleanScore = (p) => {
    const h = p.challonge_username;
    let s = 0;
    if (!/_/.test(h)) s += 2;
    if (!/\d/.test(h)) s += 1;
    if (h.length <= 8) s += 1;
    if ((p.display_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === normalize(h)) s += 1;
    return s;
  };

  for (const { a, b, heuristic, score } of top) {
    const into = cleanScore(a) >= cleanScore(b) ? a : b;
    const from = into === a ? b : a;
    const conf = score >= 90 ? 'HIGH  ' : score >= 60 ? 'MED   ' : 'LOW   ';
    console.log(`[${conf}] ${heuristic}`);
    console.log('  A: ' + fmtRow(a));
    console.log('  B: ' + fmtRow(b));
    console.log(`  Suggest: node link_offline_player.js ${from.challonge_username} ${into.challonge_username}`);
    console.log('');
  }

  if (pairs.length > top.length) {
    console.log(`(${pairs.length - top.length} more pairs hidden — re-run with --limit ${pairs.length} to see all,`);
    console.log(' or --tier high to keep only normalized/display matches.)\n');
  }

  await pool.end();
}

main().catch(err => {
  console.error('find_duplicate_players failed:', err.message);
  process.exit(1);
});
