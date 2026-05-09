/**
 * merge_offline_duplicates.js
 *
 * Merges duplicate offline-tournament rows that arose because
 * importOneLiquipediaBracket() created a new row instead of linking up
 * with the existing offline_import row.
 *
 *   node merge_offline_duplicates.js          # dry run (default)
 *   node merge_offline_duplicates.js --apply  # actually merge
 *
 * Per pair, the script:
 *   1. Picks the row with a liquipedia_slug as KEEP (offline-import row).
 *      The DROP row is the bracket-import row (has liquipedia_url + matches).
 *   2. Copies liquipedia_url, participants_count, prize_pool, location
 *      from DROP to KEEP wherever KEEP is missing the field.
 *   3. Re-points matches: UPDATE matches SET tournament_id = KEEP WHERE
 *      tournament_id = DROP. The challonge_match_id stays unchanged
 *      (still encodes the old DROP id, which keeps it unique).
 *   4. Replaces placements: DELETE KEEP's offline-import-only placements
 *      (winner + runner-up), then re-points DROP's bracket-derived
 *      placements (more complete) to KEEP.
 *   5. Re-points player_achievements.tournament_id from DROP to KEEP.
 *   6. DELETE the DROP row.
 *
 * Each pair runs in its own transaction. Skips ambiguous pairs (both rows
 * have a liquipedia_slug that differ — those are corruption cases that need
 * manual review).
 *
 * After --apply runs cleanly, run:
 *   node run_migration.js backend/src/db/migrations/add_offline_tiers.sql
 *   node check_offline_tiers.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log(APPLY
    ? '🔧 APPLY mode — merges WILL be executed.'
    : '🔍 DRY RUN — no changes will be made. Pass --apply to execute.');
  console.log('');

  const { rows: groups } = await pool.query(`
    SELECT name,
           completed_at::date    AS date,
           ARRAY_AGG(id ORDER BY id) AS ids
    FROM tournaments
    WHERE is_offline = TRUE
    GROUP BY name, completed_at::date
    HAVING COUNT(*) > 1
    ORDER BY date DESC
  `);

  if (groups.length === 0) {
    console.log('No duplicate offline tournament groups found. ✨');
    await pool.end();
    return;
  }

  let mergedCount = 0;
  let appliedCount = 0;
  let skippedCount = 0;

  for (const group of groups) {
    const { rows } = await pool.query(`
      SELECT t.id, t.name, t.series, t.liquipedia_slug, t.liquipedia_url,
             t.source, t.participants_count, t.prize_pool, t.location,
             (SELECT COUNT(*) FROM matches               WHERE tournament_id = t.id) AS match_count,
             (SELECT COUNT(*) FROM tournament_placements WHERE tournament_id = t.id) AS placement_count,
             (SELECT COUNT(*) FROM player_achievements   WHERE tournament_id = t.id) AS achievement_count
      FROM tournaments t
      WHERE t.id = ANY($1)
      ORDER BY t.id
    `, [group.ids]);

    console.log(`──── ${group.name} (${group.date}) ────`);
    for (const r of rows) {
      console.log(`  id=${r.id}  series=${r.series}  slug=${r.liquipedia_slug || '-'}  url=${r.liquipedia_url || '-'}`);
      console.log(`           matches=${r.match_count}  placements=${r.placement_count}  achievements=${r.achievement_count}`);
    }

    const plan = classifyPair(rows);
    if (plan.action === 'skip') {
      console.log(`  ⏭️  SKIP — ${plan.reason}`);
      skippedCount++;
    } else {
      console.log(`  ✅ MERGE — keep id=${plan.keepId}, drop id=${plan.dropId}`);
      console.log(`     ${plan.notes}`);
      mergedCount++;
      if (APPLY) {
        try {
          await applyMerge(plan);
          console.log(`     → applied`);
          appliedCount++;
        } catch (err) {
          console.log(`     ❌ FAILED — ${err.message}`);
        }
      }
    }
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────');
  console.log(`Found ${groups.length} duplicate group${groups.length===1?'':'s'}.`);
  console.log(`Plan: ${mergedCount} merge${mergedCount===1?'':'s'}, ${skippedCount} skipped.`);
  if (APPLY) {
    console.log(`Applied: ${appliedCount} of ${mergedCount}.`);
    if (appliedCount > 0) {
      console.log('');
      console.log('Recommended follow-up:');
      console.log('  node run_migration.js backend/src/db/migrations/add_offline_tiers.sql');
      console.log('  node check_offline_tiers.js');
    }
  } else if (mergedCount > 0) {
    console.log('Re-run with --apply to execute.');
  }

  await pool.end();
}

function classifyPair(rows) {
  if (rows.length !== 2) {
    return { action: 'skip', reason: `expected 2 rows in this group, got ${rows.length}` };
  }
  const [a, b] = rows;

  // Both have a slug and the slugs differ → corruption case (likely a bracket
  // import overwrote the wrong row's name/date).
  if (a.liquipedia_slug && b.liquipedia_slug && a.liquipedia_slug !== b.liquipedia_slug) {
    return {
      action: 'skip',
      reason: `both rows carry differing liquipedia_slug ("${a.liquipedia_slug}" vs "${b.liquipedia_slug}") — manual review required`,
    };
  }

  // Choose KEEP: prefer the row that has a liquipedia_slug (offline-import
  // origin). If both or neither have a slug, fall back to lower id.
  let keep, drop;
  if (a.liquipedia_slug && !b.liquipedia_slug)      { keep = a; drop = b; }
  else if (b.liquipedia_slug && !a.liquipedia_slug) { keep = b; drop = a; }
  else {
    keep = a.id < b.id ? a : b;
    drop = a.id < b.id ? b : a;
  }

  return {
    action: 'merge',
    keepId: keep.id,
    dropId: drop.id,
    keep,
    drop,
    notes: `keep has slug=${keep.liquipedia_slug || '(none)'}; drop contributes ${drop.match_count} match${drop.match_count===1?'':'es'}, ${drop.placement_count} placement${drop.placement_count===1?'':'s'}, ${drop.achievement_count} achievement-link${drop.achievement_count===1?'':'s'}, url=${drop.liquipedia_url || '(none)'}`,
  };
}

async function applyMerge(plan) {
  const { keepId, dropId, keep, drop } = plan;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Backfill missing metadata on KEEP from DROP.
    await client.query(`
      UPDATE tournaments SET
        liquipedia_url     = COALESCE(liquipedia_url,     $2),
        participants_count = COALESCE(participants_count, $3),
        prize_pool         = COALESCE(prize_pool,         $4),
        location           = COALESCE(location,           $5)
      WHERE id = $1
    `, [keepId, drop.liquipedia_url, drop.participants_count, drop.prize_pool, drop.location]);

    // 2. Re-point matches. challonge_match_id stays unchanged — the DROP
    //    row's match keys still encode dropId in their string but they're
    //    unique within the new (keepId, key) tuple.
    if (drop.match_count > 0) {
      await client.query(`UPDATE matches SET tournament_id = $1 WHERE tournament_id = $2`, [keepId, dropId]);
    }

    // 3. Replace placements. KEEP's placements are offline-import-only
    //    (winner + runner-up). DROP's placements are bracket-derived (full
    //    field). Prefer DROP's. If DROP has no placements, leave KEEP's
    //    intact.
    if (drop.placement_count > 0) {
      await client.query(`DELETE FROM tournament_placements WHERE tournament_id = $1`, [keepId]);
      await client.query(`UPDATE tournament_placements SET tournament_id = $1 WHERE tournament_id = $2`, [keepId, dropId]);
    }

    // 4. Re-point player_achievements.tournament_id (FK is ON DELETE SET
    //    NULL, so without this step deleting DROP would orphan those refs).
    if (drop.achievement_count > 0) {
      await client.query(`UPDATE player_achievements SET tournament_id = $1 WHERE tournament_id = $2`, [keepId, dropId]);
    }

    // 5. Drop the duplicate row. CASCADE on matches/placements is moot now
    //    that we've re-pointed everything.
    await client.query(`DELETE FROM tournaments WHERE id = $1`, [dropId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
