/**
 * check_startgg_scores.js
 *
 * Diagnostic for the start.gg score-backfill effort. Designed to be run
 * BEFORE and AFTER `node import_heavens_arena.js` (and any other start.gg
 * re-import) so we can see exactly how many matches still have NULL scores.
 *
 * Usage:  node check_startgg_scores.js
 *
 * What "missing" means:
 *   - both_null   — neither player1_score nor player2_score is set
 *   - one_null    — one slot has a number, the other is NULL (start.gg
 *                   reports this on DQs / walkovers / forfeits where the
 *                   loser's score.value is null instead of 0)
 *   - both_set    — both scores are set (good)
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // ── Overall start.gg breakdown ─────────────────────────────────────────
  const { rows: [overall] } = await pool.query(`
    SELECT
      COUNT(*)                                                      AS total,
      COUNT(*) FILTER (WHERE m.player1_score IS NOT NULL
                         AND m.player2_score IS NOT NULL)           AS both_set,
      COUNT(*) FILTER (WHERE (m.player1_score IS NULL) <>
                             (m.player2_score IS NULL))             AS one_null,
      COUNT(*) FILTER (WHERE m.player1_score IS NULL
                         AND m.player2_score IS NULL)               AS both_null
    FROM matches m
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.source = 'startgg'
      AND m.state = 'complete'
  `);

  // ── Same breakdown but scoped to Heaven's Arena ────────────────────────
  const { rows: [ha] } = await pool.query(`
    SELECT
      COUNT(*)                                                      AS total,
      COUNT(*) FILTER (WHERE m.player1_score IS NOT NULL
                         AND m.player2_score IS NOT NULL)           AS both_set,
      COUNT(*) FILTER (WHERE (m.player1_score IS NULL) <>
                             (m.player2_score IS NULL))             AS one_null,
      COUNT(*) FILTER (WHERE m.player1_score IS NULL
                         AND m.player2_score IS NULL)               AS both_null
    FROM matches m
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.source = 'startgg'
      AND t.series = 'ha'
      AND m.state = 'complete'
  `);

  // ── Per-tournament breakdown for HA so we can spot stuck events ────────
  const { rows: perTournament } = await pool.query(`
    SELECT
      t.id,
      t.name,
      t.completed_at::date AS date,
      COUNT(*)                                                      AS total,
      COUNT(*) FILTER (WHERE m.player1_score IS NOT NULL
                         AND m.player2_score IS NOT NULL)           AS both_set,
      COUNT(*) FILTER (WHERE (m.player1_score IS NULL) <>
                             (m.player2_score IS NULL))             AS one_null,
      COUNT(*) FILTER (WHERE m.player1_score IS NULL
                         AND m.player2_score IS NULL)               AS both_null
    FROM matches m
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.source = 'startgg'
      AND t.series = 'ha'
      AND m.state = 'complete'
    GROUP BY t.id, t.name, t.completed_at
    ORDER BY t.completed_at ASC NULLS LAST, t.id ASC
  `);

  // ── Print ──────────────────────────────────────────────────────────────
  function pct(n, total) {
    if (!total) return '   - ';
    return `${((n / total) * 100).toFixed(1).padStart(5)}%`;
  }
  function row(label, n, total) {
    return `${label.padEnd(12)} ${String(n).padStart(6)}  (${pct(n, total)})`;
  }

  console.log('\n🎯 start.gg score backfill — DB state');
  console.log('═'.repeat(56));

  console.log('\nAll start.gg matches');
  console.log('─'.repeat(40));
  console.log(row('total',     overall.total,    overall.total));
  console.log(row('both_set',  overall.both_set, overall.total));
  console.log(row('one_null',  overall.one_null, overall.total));
  console.log(row('both_null', overall.both_null, overall.total));

  console.log("\nHeaven's Arena only");
  console.log('─'.repeat(40));
  console.log(row('total',     ha.total,    ha.total));
  console.log(row('both_set',  ha.both_set, ha.total));
  console.log(row('one_null',  ha.one_null, ha.total));
  console.log(row('both_null', ha.both_null, ha.total));

  console.log("\nPer-event breakdown (Heaven's Arena)");
  console.log('─'.repeat(76));
  console.log(
    'id'.padEnd(5) +
    'date'.padEnd(12) +
    'event'.padEnd(28) +
    'both'.padStart(6) +
    'one'.padStart(6) +
    'none'.padStart(6) +
    ' total'
  );
  for (const r of perTournament) {
    const name = (r.name || '').slice(0, 26).padEnd(28);
    const date = r.date ? String(r.date).slice(0, 10).padEnd(12) : '—'.padEnd(12);
    console.log(
      String(r.id).padEnd(5) +
      date +
      name +
      String(r.both_set).padStart(6) +
      String(r.one_null).padStart(6) +
      String(r.both_null).padStart(6) +
      String(r.total).padStart(6)
    );
  }

  // ── Characterise the remaining NULL rows ───────────────────────────────
  //
  // Goal: figure out whether the leftover NULLs are walkovers/byes/DQs
  // (start.gg's `score.value` is null when a set wasn't actually played)
  // vs. real data we should be fetching but aren't.
  //
  // For one-null rows the question is "is the side that's NULL always the
  // loser?" If yes, it's the DQ pattern and we should write loser_score = 0
  // in the importer.
  //
  // For both-null rows the question is "does the set have a winner_id at
  // all?" If yes → walkover/bye (winner advanced but no game played). If
  // no → genuinely empty, should be excluded earlier.
  const { rows: oneNullSample } = await pool.query(`
    SELECT m.id, t.name AS event, m.round, m.bracket_section,
           m.player1_id, m.player2_id, m.winner_id,
           m.player1_score, m.player2_score,
           CASE
             WHEN m.player1_score IS NULL AND m.winner_id = m.player2_id THEN 'null side LOST'
             WHEN m.player2_score IS NULL AND m.winner_id = m.player1_id THEN 'null side LOST'
             WHEN m.player1_score IS NULL AND m.winner_id = m.player1_id THEN 'null side WON (!)'
             WHEN m.player2_score IS NULL AND m.winner_id = m.player2_id THEN 'null side WON (!)'
             ELSE '?'
           END AS null_role
    FROM matches m
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.source = 'startgg' AND t.series = 'ha'
      AND m.state = 'complete'
      AND (m.player1_score IS NULL) <> (m.player2_score IS NULL)
    ORDER BY t.completed_at ASC NULLS LAST, m.id ASC
    LIMIT 10
  `);

  const { rows: bothNullSummary } = await pool.query(`
    SELECT
      COUNT(*)                                       AS total,
      COUNT(*) FILTER (WHERE m.winner_id IS NOT NULL) AS with_winner,
      COUNT(*) FILTER (WHERE m.winner_id IS NULL)     AS no_winner
    FROM matches m
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.source = 'startgg' AND t.series = 'ha'
      AND m.state = 'complete'
      AND m.player1_score IS NULL AND m.player2_score IS NULL
  `);

  const { rows: bothNullSample } = await pool.query(`
    SELECT m.id, t.name AS event, m.round, m.bracket_section,
           m.player1_id, m.player2_id, m.winner_id
    FROM matches m
    JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.source = 'startgg' AND t.series = 'ha'
      AND m.state = 'complete'
      AND m.player1_score IS NULL AND m.player2_score IS NULL
    ORDER BY t.completed_at ASC NULLS LAST, m.id ASC
    LIMIT 10
  `);

  console.log('\nOne-null sample (winner has a score, loser is NULL)');
  console.log('─'.repeat(76));
  if (oneNullSample.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of oneNullSample) {
      console.log(
        `  m${String(r.id).padEnd(6)} ${String(r.event).slice(0, 22).padEnd(24)} ` +
        `r${String(r.round ?? '-').padStart(3)} ${String(r.bracket_section || '-').padEnd(8)} ` +
        `p1=${r.player1_score ?? 'NULL'} p2=${r.player2_score ?? 'NULL'}  ${r.null_role}`
      );
    }
  }

  console.log('\nBoth-null breakdown');
  console.log('─'.repeat(40));
  const bn = bothNullSummary[0];
  console.log(row('total',       bn.total,       bn.total));
  console.log(row('with_winner', bn.with_winner, bn.total));
  console.log(row('no_winner',   bn.no_winner,   bn.total));

  console.log('\nBoth-null sample');
  console.log('─'.repeat(76));
  if (bothNullSample.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of bothNullSample) {
      console.log(
        `  m${String(r.id).padEnd(6)} ${String(r.event).slice(0, 22).padEnd(24)} ` +
        `r${String(r.round ?? '-').padStart(3)} ${String(r.bracket_section || '-').padEnd(8)} ` +
        `winner=${r.winner_id ?? 'NULL'}`
      );
    }
  }

  console.log('');
  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
