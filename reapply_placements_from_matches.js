#!/usr/bin/env node
/**
 * reapply_placements_from_matches.js — Rebuild tournament_placements for
 * every offline tournament whose match data is in the DB but whose
 * placements are empty (or stale).
 *
 * Why this exists: the browser-driven liquipedia bracket re-import path
 * is brittle for already-imported events — the per-match upsert key is
 * `liq_<tid>_<round>_<section>_<p1>_<p2>`, so when the parser produces
 * the same matches a second time the ON CONFLICT DO NOTHING clause
 * stops new rows from landing AND skips the whole post-insert block.
 * After the May-04 fix added a DELETE-before-INSERT to that block, the
 * net effect on a re-import that produces *some* but not *all* of the
 * existing match keys is that placements get wiped without being fully
 * repopulated. This script bypasses the import path entirely: it reads
 * matches straight out of the matches table, runs the same v2 placement
 * algorithm importOneLiquipediaBracket uses, and writes the result.
 *
 * Workflow:
 *   1. node reset_bracket_placements.js   (optional — wipe first)
 *   2. node reapply_placements_from_matches.js
 *   3. node recalculate_elo.js            (picks up the fresh placements)
 *
 * Read-only modes:
 *   node reapply_placements_from_matches.js --list
 *   node reapply_placements_from_matches.js --tournament 554
 *   node reapply_placements_from_matches.js --dry-run
 *
 * Default: process every offline tournament that has at least one
 * match in the matches table. Idempotent.
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');
const readline = require('readline');

const args = process.argv.slice(2);
const listOnly  = args.includes('--list');
const dryRun    = args.includes('--dry-run');
const skipConfirm = args.includes('--yes') || args.includes('-y');
let oneTournamentId = null;
{
  const i = args.findIndex(a => a === '--tournament' || a === '-t');
  if (i !== -1 && args[i + 1] != null) oneTournamentId = parseInt(args[i + 1], 10);
}

function prompt(rl, q) { return new Promise(r => rl.question(q, ans => r(ans.trim()))); }

// Mirror the careerPoints rule from backend/src/routes/tournaments.js so this
// script writes the same values the bracket import would.
function careerPoints(rank, total) {
  if (rank === 1)            return 10;
  if (rank === 2)            return 7;
  if (rank <= 4)             return 5;
  if (rank / total <= 0.125) return 3;
  return 1;
}

const OFFLINE_TIERS = ['worlds', 'major', 'regional', 'other'];
const OFFLINE_WEIGHTS = {
  worlds:   { wins: 100, runner_up: 60, top4: 35, top8: 20 },
  major:    { wins: 50,  runner_up: 30, top4: 18, top8: 10 },
  regional: { wins: 25,  runner_up: 15, top4: 9,  top8: 5 },
  other:    { wins: 10,  runner_up: 6,  top4: 3,  top8: 2 },
};

async function refreshOfflineStatsFor(client, playerId) {
  const { rows: [s] } = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank = 1)   AS worlds_wins,
      COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank = 2)   AS worlds_runner_up,
      COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank <= 4)  AS worlds_top4,
      COUNT(*) FILTER (WHERE t.series = 'worlds' AND tp.final_rank <= 8)  AS worlds_top8,
      COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank = 1)    AS major_wins,
      COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank = 2)    AS major_runner_up,
      COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank <= 4)   AS major_top4,
      COUNT(*) FILTER (WHERE t.series = 'major' AND tp.final_rank <= 8)   AS major_top8,
      COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank = 1) AS regional_wins,
      COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank = 2) AS regional_runner_up,
      COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank <= 4) AS regional_top4,
      COUNT(*) FILTER (WHERE t.series = 'regional' AND tp.final_rank <= 8) AS regional_top8,
      COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank = 1)    AS other_wins,
      COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank = 2)    AS other_runner_up,
      COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank <= 4)   AS other_top4,
      COUNT(*) FILTER (WHERE t.series = 'other' AND tp.final_rank <= 8)   AS other_top8,
      COUNT(*) FILTER (WHERE tp.final_rank = 1)  AS total_wins,
      COUNT(*) FILTER (WHERE tp.final_rank <= 2) AS total_top2
    FROM tournament_placements tp
    JOIN tournaments t ON tp.tournament_id = t.id
    WHERE tp.player_id = $1 AND t.is_offline = TRUE
  `, [playerId]);

  let score = 0;
  for (const tier of OFFLINE_TIERS) {
    const w = OFFLINE_WEIGHTS[tier];
    const wins = parseInt(s[`${tier}_wins`]) || 0;
    const ru   = parseInt(s[`${tier}_runner_up`]) || 0;
    const top4 = parseInt(s[`${tier}_top4`]) || 0;
    const top8 = parseInt(s[`${tier}_top8`]) || 0;
    const pure_top4 = Math.max(0, top4 - wins - ru);
    const pure_top8 = Math.max(0, top8 - top4);
    score += wins * w.wins + ru * w.runner_up + pure_top4 * w.top4 + pure_top8 * w.top8;
  }

  await client.query(`
    UPDATE players SET
      offline_wins = $2, offline_top2 = $3,
      offline_worlds_wins = $4, offline_worlds_runner_up = $5,
      offline_worlds_top4 = $6, offline_worlds_top8 = $7,
      offline_major_wins = $8, offline_major_runner_up = $9,
      offline_major_top4 = $10, offline_major_top8 = $11,
      offline_regional_wins = $12, offline_regional_runner_up = $13,
      offline_regional_top4 = $14, offline_regional_top8 = $15,
      offline_other_wins = $16, offline_other_runner_up = $17,
      offline_other_top4 = $18, offline_other_top8 = $19,
      offline_score = $20
    WHERE id = $1
  `, [
    playerId,
    parseInt(s.total_wins) || 0, parseInt(s.total_top2) || 0,
    parseInt(s.worlds_wins) || 0, parseInt(s.worlds_runner_up) || 0,
    parseInt(s.worlds_top4) || 0, parseInt(s.worlds_top8) || 0,
    parseInt(s.major_wins) || 0, parseInt(s.major_runner_up) || 0,
    parseInt(s.major_top4) || 0, parseInt(s.major_top8) || 0,
    parseInt(s.regional_wins) || 0, parseInt(s.regional_runner_up) || 0,
    parseInt(s.regional_top4) || 0, parseInt(s.regional_top8) || 0,
    parseInt(s.other_wins) || 0, parseInt(s.other_runner_up) || 0,
    parseInt(s.other_top4) || 0, parseInt(s.other_top8) || 0,
    score,
  ]);
}

// Reconstruct the per-match weight that importOneLiquipediaBracket uses for
// placement derivation, from the (round, bracket_section) columns the matches
// table actually stores. Original parser:
//     weight = isLower ? (colIdx + 1) * 2 : (colIdx + 1) * 2 - 1
// where colIdx is the bracket column index. The matches table stores
// `round = colIdx + 1` and `bracket_section IN ('winners', 'losers')`, so the
// inverse is straightforward. Legacy-parsed brackets (pre-2020 events) write
// every match as bracket_section='winners' with round = DOM index + 1, which
// gives strictly increasing weights — the v2 algorithm picks up the GF winner
// correctly there too.
function deriveWeight(round, bracketSection) {
  const r = round || 1;
  return bracketSection === 'losers' ? r * 2 : r * 2 - 1;
}

// Run the v2 'last match defines you' algorithm against an array of match
// records, returning a Map<player_id, rank>. Tournaments with no matches
// produce an empty Map; the caller is expected to skip those (or use this
// repair script's --tournament flag to inspect a known-bad row by hand).
function derivePlacements(matches) {
  if (!matches.length) return new Map();

  const lastMatch = new Map(); // player_id → { weight, isWin, idx }
  matches.forEach((m, idx) => {
    const upd = (id, isWin) => {
      if (id == null) return;
      const cur = lastMatch.get(id);
      if (!cur
          || m.weight > cur.weight
          || (m.weight === cur.weight && idx > cur.idx)) {
        lastMatch.set(id, { weight: m.weight, isWin, idx });
      }
    };
    if (m.winner_id == null) return;
    const loserId = m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
    upd(m.winner_id, true);
    upd(loserId,     false);
  });

  // Champion = player whose last match was a win at the highest weight
  let championId = null;
  let champWeight = -Infinity;
  for (const [pid, rec] of lastMatch) {
    if (rec.isWin && rec.weight > champWeight) {
      champWeight = rec.weight;
      championId = pid;
    }
  }

  const placements = new Map();
  if (championId != null) placements.set(championId, 1);

  const others = [...lastMatch.entries()]
    .filter(([pid]) => pid !== championId)
    .sort((a, b) => b[1].weight - a[1].weight);

  let rank = 2, i = 0;
  while (i < others.length) {
    const w = others[i][1].weight;
    let j = i;
    while (j < others.length && others[j][1].weight === w) j++;
    for (let k = i; k < j; k++) placements.set(others[k][0], rank);
    rank += (j - i);
    i = j;
  }
  return placements;
}

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let inTx = false;
  let rl = null;

  try {
    // ── Find candidate tournaments ────────────────────────────────────────
    // Every offline tournament with at least one match. We don't filter on
    // current placement count because both "0 placements + matches" and
    // "stale placements + matches" are repair-eligible.
    const candSql = oneTournamentId
      ? `SELECT t.id, t.name, t.completed_at, t.participants_count,
                COUNT(m.id)::int  AS match_count,
                COALESCE(p.placement_count, 0)::int AS placement_count
         FROM tournaments t
         LEFT JOIN matches m ON m.tournament_id = t.id
         LEFT JOIN (
           SELECT tournament_id, COUNT(*) AS placement_count
           FROM tournament_placements GROUP BY tournament_id
         ) p ON p.tournament_id = t.id
         WHERE t.id = $1
         GROUP BY t.id, p.placement_count`
      : `SELECT t.id, t.name, t.completed_at, t.participants_count,
                COUNT(m.id)::int  AS match_count,
                COALESCE(p.placement_count, 0)::int AS placement_count
         FROM tournaments t
         JOIN matches m ON m.tournament_id = t.id
         LEFT JOIN (
           SELECT tournament_id, COUNT(*) AS placement_count
           FROM tournament_placements GROUP BY tournament_id
         ) p ON p.tournament_id = t.id
         WHERE t.is_offline = TRUE
         GROUP BY t.id, p.placement_count
         ORDER BY t.completed_at DESC NULLS LAST`;

    const { rows: tournaments } = await client.query(
      candSql, oneTournamentId ? [oneTournamentId] : []
    );

    if (tournaments.length === 0) {
      console.log(oneTournamentId
        ? `No tournament with id=${oneTournamentId} found, or it has no matches.`
        : 'No offline tournaments with matches found. Nothing to repair.');
      return;
    }

    console.log(`\nFound ${tournaments.length} offline tournament${tournaments.length === 1 ? '' : 's'} with matches:`);
    for (const t of tournaments) {
      const date = t.completed_at ? new Date(t.completed_at).toISOString().slice(0, 10) : '----------';
      console.log(`  id=${String(t.id).padStart(4)}  ${date}  matches=${String(t.match_count).padStart(3)}  placements=${String(t.placement_count).padStart(3)}  ${t.name}`);
    }

    if (listOnly) {
      console.log('\n(--list only — no changes will be made.)');
      return;
    }

    if (!skipConfirm && !dryRun) {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await prompt(rl, '\nProceed (will DELETE+INSERT placements for every tournament above)? [y/N] ');
      rl.close(); rl = null;
      if (!/^y/i.test(ans)) { console.log('Aborted.'); return; }
    }

    if (!dryRun) { await client.query('BEGIN'); inTx = true; }

    let totalDeleted = 0, totalInserted = 0, skippedNoMatches = 0, skippedNoPlacements = 0;
    const affectedPlayers = new Set();

    for (const t of tournaments) {
      // Pull match list for this tournament. Only fully-decided matches
      // contribute to placements; matches without a winner_id are dropped
      // (and would have been dropped on import too).
      const { rows: matches } = await client.query(
        `SELECT id, player1_id, player2_id, winner_id, round, bracket_section
         FROM matches
         WHERE tournament_id = $1 AND winner_id IS NOT NULL
         ORDER BY round ASC NULLS FIRST, id ASC`,
        [t.id]
      );

      if (matches.length === 0) { skippedNoMatches++; continue; }

      // Attach derived weight (mirrors the parser's per-column scheme).
      const weighted = matches.map((m, idx) => ({
        ...m,
        weight: deriveWeight(m.round, m.bracket_section),
        _idx: idx,
      }));

      const placements = derivePlacements(weighted);

      if (placements.size === 0) { skippedNoPlacements++; continue; }

      const totalParticipants = t.participants_count || placements.size;

      if (!dryRun) {
        const del = await client.query(
          `DELETE FROM tournament_placements WHERE tournament_id = $1`,
          [t.id]
        );
        totalDeleted += del.rowCount;

        for (const [playerId, rank] of placements) {
          const pts = careerPoints(rank, totalParticipants);
          await client.query(
            `INSERT INTO tournament_placements (tournament_id, player_id, final_rank, career_points)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tournament_id, player_id) DO UPDATE SET final_rank=$3, career_points=$4`,
            [t.id, playerId, rank, pts]
          );
          affectedPlayers.add(playerId);
          totalInserted++;
        }
      } else {
        for (const [playerId] of placements) affectedPlayers.add(playerId);
        totalInserted += placements.size;
      }

      console.log(`  id=${String(t.id).padStart(4)}  → derived ${placements.size} placement${placements.size === 1 ? '' : 's'}`);
    }

    if (skippedNoMatches > 0) console.log(`\n  Skipped ${skippedNoMatches} tournament(s) with no winner-decided matches.`);
    if (skippedNoPlacements > 0) console.log(`  Skipped ${skippedNoPlacements} tournament(s) where the algorithm produced no champion (likely missing winner_id values).`);
    console.log(`\n  Deleted ${totalDeleted} stale placement row${totalDeleted === 1 ? '' : 's'}.`);
    console.log(`  Inserted ${totalInserted} fresh placement row${totalInserted === 1 ? '' : 's'}.`);

    if (!dryRun) {
      // Refresh per-player offline tier counts + offline_score from the
      // freshly-rewritten placements. This mirrors what
      // importOneLiquipediaBracket does after writing each tournament.
      let refreshed = 0;
      for (const pid of affectedPlayers) {
        await refreshOfflineStatsFor(client, pid);
        refreshed++;
      }
      console.log(`  Refreshed offline stats for ${refreshed} player${refreshed === 1 ? '' : 's'}.`);

      await client.query('COMMIT');
      inTx = false;
      console.log('\n✅  Repair complete. Run `node recalculate_elo.js` to pick up the fresh placements in stats and achievements.');
    } else {
      console.log('\n(dry-run — no rows changed.)');
    }
  } catch (err) {
    if (inTx) { try { await client.query('ROLLBACK'); } catch { /* ignore */ } }
    console.error('\n❌  Repair failed, transaction rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    if (rl) { try { rl.close(); } catch { /* ignore */ } }
    client.release();
    await pool.end();
  }
}

run();
