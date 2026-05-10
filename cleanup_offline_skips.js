/**
 * cleanup_offline_skips.js
 *
 * Resolves the 7 duplicate offline-tournament pairs that
 * merge_offline_duplicates.js skipped (3 differing-slug + 4 top-2-mismatch).
 *
 *   node cleanup_offline_skips.js          # dry run (default)
 *   node cleanup_offline_skips.js --apply  # actually do it
 *
 * After this lands, the DB should have exactly 80 offline tournaments
 * (87 currently − 7 dropped duplicates).
 *
 * Decisions per pair:
 *
 *  EASY 3 — delete the bracket-import row, KEEP's offline_import top-2 wins.
 *  These DROP rows came from the buggy placements-only scraper; nothing of
 *  value is lost.
 *    · NEC 18         drop id=786   (16 placements, all wrong)
 *    · NorCal 2017    drop id=787   (8 placements, all wrong)
 *    · Frosty Faustings IX  drop id=784  (16 placements, wrong)
 *
 *  CEO 2017 — Liquipedia confirms KEEP (Suicune Master / Thulius). DROP's
 *  22 matches must be misparsed (different page or tier section), since
 *  its top-2 (slippingbug / Double) don't match Liquipedia's authoritative
 *  table.  Drop the entire DROP row.
 *    · CEO 2017       drop id=634
 *
 *  FR20 vs FR2019 — corrupted-slug pair. id=586 has slug `final_round_2019`
 *  but its name and bracket data are FR20 (per the URL). Worse, the bracket
 *  parse top-2 (Thulius / Coach Steve) don't match Liquipedia's authoritative
 *  FR20 table (Twixxie / Zyflair). The KEEP row at id=618 already has the
 *  correct FR20 top-2.  FR2019 already exists as a separate row in the DB
 *  (the "Final Round 2019 - PokkenDX" entry — distinct from id=586). So we
 *  simply delete id=586; FR20 stays at id=618, FR2019 stays at its other row.
 *    · drop id=586
 *
 *  FF11 vs FF14 — corrupted-slug pair, but the bracket data IS FF11's
 *  (Liquipedia confirms FF11 top-2 = Wingtide / ThankSwalot, both rows
 *  show Wingtide / Jukem where Jukem aliases ThankSwalot). Move id=571's
 *  bracket data to id=590 (canonical FF11), then delete id=571. FF14 main
 *  bracket no longer has a DB row after this — re-import from Liquipedia
 *  later if needed; the existing "Frosty Faustings XIV Side Tournaments"
 *  row is unaffected.
 *
 *  FFX vs FF15 — same shape as FF11/FF14. Move id=565's bracket data to
 *  id=605 (canonical FFX), then delete id=565.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const APPLY = process.argv.includes('--apply');
const pool  = new Pool({ connectionString: process.env.DATABASE_URL });

// IDs frozen from the May 9 dry-run topology. Re-confirm via the BEFORE
// snapshot below before --apply.
const SIMPLE_DELETES = [
  { id: 786, label: 'NEC 18 — DROP (buggy scrape)'           },
  { id: 787, label: 'NorCal 2017 — DROP (buggy scrape)'      },
  { id: 784, label: 'Frosty Faustings IX — DROP (buggy scrape)' },
  { id: 634, label: 'CEO 2017 — DROP (misparsed bracket)'    },
  { id: 586, label: 'FR20 — DROP (corrupted slug, junk bracket data)' },
];

const MOVE_AND_DELETE = [
  {
    label:  'FF11 / FF14',
    fromId: 571,   // corrupted-slug row, has FF11's bracket data
    toId:   590,   // canonical FF11 row, has only top-2 from offline_import
  },
  {
    label:  'FFX / FF15',
    fromId: 565,   // corrupted-slug row, has FFX's bracket data
    toId:   605,   // canonical FFX row, has only top-2 from offline_import
  },
];

async function snapshot(client, ids, header) {
  const { rows } = await client.query(`
    SELECT t.id, t.name, t.completed_at::date AS date,
           t.liquipedia_slug AS slug, t.liquipedia_url AS url,
           (SELECT COUNT(*) FROM matches               WHERE tournament_id = t.id) AS matches,
           (SELECT COUNT(*) FROM tournament_placements WHERE tournament_id = t.id) AS placements,
           (SELECT COUNT(*) FROM player_achievements   WHERE tournament_id = t.id) AS achievements,
           (SELECT p.display_name FROM tournament_placements tp JOIN players p ON p.id = tp.player_id
              WHERE tp.tournament_id = t.id AND tp.final_rank = 1 LIMIT 1) AS rank1,
           (SELECT p.display_name FROM tournament_placements tp JOIN players p ON p.id = tp.player_id
              WHERE tp.tournament_id = t.id AND tp.final_rank = 2 LIMIT 1) AS rank2
    FROM tournaments t
    WHERE t.id = ANY($1)
    ORDER BY t.id
  `, [ids]);

  console.log(`\n── ${header} ──`);
  for (const r of rows) {
    const date = r.date ? String(r.date).padEnd(10) : '?'.padEnd(10);
    console.log(`  id=${String(r.id).padStart(3)}  ${date}  "${r.name}"`);
    console.log(`           slug=${r.slug || '-'}  url=${r.url || '-'}`);
    console.log(`           matches=${r.matches}  placements=${r.placements}  achievements=${r.achievements}`);
    console.log(`           rank1=${r.rank1 || '-'}  rank2=${r.rank2 || '-'}`);
  }
  if (rows.length === 0) console.log('  (none — already cleaned up?)');
}

async function applySimpleDelete(client, { id, label }) {
  // CASCADE will sweep matches and tournament_placements.
  // player_achievements.tournament_id is ON DELETE SET NULL, but per the
  // dry-run all targeted rows have achievement_count=0, so nothing to lose.
  const { rowCount } = await client.query(`DELETE FROM tournaments WHERE id = $1`, [id]);
  console.log(`  → DELETE id=${id}  (${rowCount} row${rowCount===1?'':'s'} removed)  ${label}`);
}

async function applyMoveAndDelete(client, { label, fromId, toId }) {
  // 1. Capture FROM's metadata before delete (URL/location/prize) so we
  //    can carry them forward onto TO.
  const { rows: [fromRow] } = await client.query(`
    SELECT liquipedia_url, location, prize_pool, participants_count
    FROM tournaments WHERE id = $1
  `, [fromId]);
  if (!fromRow) throw new Error(`expected row id=${fromId} (${label}) to exist`);

  // 2. Re-point matches FROM → TO.
  const matchesRes = await client.query(
    `UPDATE matches SET tournament_id = $1 WHERE tournament_id = $2`,
    [toId, fromId]
  );

  // 3. Replace placements: drop TO's offline_import 2-row, then move
  //    FROM's bracket-derived placements over.
  await client.query(`DELETE FROM tournament_placements WHERE tournament_id = $1`, [toId]);
  const placementsRes = await client.query(
    `UPDATE tournament_placements SET tournament_id = $1 WHERE tournament_id = $2`,
    [toId, fromId]
  );

  // 4. Re-point any player_achievements.tournament_id (FK is ON DELETE SET
  //    NULL). Per the dry-run, all targeted rows have count=0, but harmless
  //    to run defensively.
  const achievementsRes = await client.query(
    `UPDATE player_achievements SET tournament_id = $1 WHERE tournament_id = $2`,
    [toId, fromId]
  );

  // 5. Carry FROM's URL/location/prize/participants_count onto TO where TO
  //    is missing them. (TO's name/date/slug are already canonical for the
  //    event the bracket data actually represents.)
  await client.query(`
    UPDATE tournaments SET
      liquipedia_url     = COALESCE(liquipedia_url,     $2),
      location           = COALESCE(location,           $3),
      prize_pool         = COALESCE(prize_pool,         $4),
      participants_count = COALESCE(participants_count, $5)
    WHERE id = $1
  `, [toId, fromRow.liquipedia_url, fromRow.location, fromRow.prize_pool, fromRow.participants_count]);

  // 6. NULL out FROM's liquipedia_url BEFORE delete to avoid hitting the
  //    tournaments_liquipedia_url_lower_unique index later if anything
  //    re-creates a row with that URL. Belt-and-braces; not strictly needed
  //    since we're about to delete the row.
  await client.query(`UPDATE tournaments SET liquipedia_url = NULL WHERE id = $1`, [fromId]);

  // 7. DELETE FROM. Cascades touch matches/placements but those are now empty.
  await client.query(`DELETE FROM tournaments WHERE id = $1`, [fromId]);

  console.log(`  → ${label}: moved ${matchesRes.rowCount} match${matchesRes.rowCount===1?'':'es'}, `
    + `${placementsRes.rowCount} placement${placementsRes.rowCount===1?'':'s'}, `
    + `${achievementsRes.rowCount} achievement-link${achievementsRes.rowCount===1?'':'s'} `
    + `from id=${fromId} → id=${toId}; deleted id=${fromId}`);
}

async function main() {
  console.log(APPLY
    ? '🔧 APPLY mode — changes WILL be persisted.'
    : '🔍 DRY RUN — no changes will be made. Pass --apply to execute.');

  const allIds = [
    ...SIMPLE_DELETES.map(s => s.id),
    ...MOVE_AND_DELETE.flatMap(m => [m.fromId, m.toId]),
  ];

  const client = await pool.connect();
  try {
    await snapshot(client, allIds, 'BEFORE');

    if (!APPLY) {
      console.log('\nPlanned actions:');
      for (const s of SIMPLE_DELETES) {
        console.log(`  · DELETE id=${s.id}  — ${s.label}`);
      }
      for (const m of MOVE_AND_DELETE) {
        console.log(`  · ${m.label}: move bracket data id=${m.fromId} → id=${m.toId}, then DELETE id=${m.fromId}`);
      }
      console.log('\nRe-run with --apply to execute. (Single transaction; all-or-nothing.)');
      return;
    }

    await client.query('BEGIN');
    console.log('\nApplying simple deletes:');
    for (const s of SIMPLE_DELETES) {
      await applySimpleDelete(client, s);
    }
    console.log('\nApplying move-and-delete:');
    for (const m of MOVE_AND_DELETE) {
      await applyMoveAndDelete(client, m);
    }
    await client.query('COMMIT');

    const remainingIds = MOVE_AND_DELETE.map(m => m.toId);
    await snapshot(client, remainingIds, 'AFTER');

    // Final tally check.
    const { rows: [{ count }] } = await client.query(
      `SELECT COUNT(*)::int AS count FROM tournaments WHERE is_offline = TRUE`
    );
    console.log(`\nTotal offline tournaments now: ${count}  (target: 80)`);
    if (count !== 80) {
      console.log('⚠️  Count differs from target. Re-run check_offline_tiers.js to investigate.');
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
