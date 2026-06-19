/**
 * cleanup_reimport_dupes.js
 *
 * One-off cleanup for the damage caused by a full FORCE_REIMPORT run of
 * liquipedia_import_console.js (2026-06-19):
 *
 *   A. Duplicate MATCHES. The bracket importer's external_id was built from
 *      player NAME strings (liq_{tid}_{round}_{section}_{p1name}_{p2name}). When
 *      a name's spelling differed between the original import and the re-import,
 *      the same logical match got a different external_id, so the ON CONFLICT
 *      dedup missed it and the match was inserted twice. ~19 offline events have
 *      doubled matches (verified: total vs distinct by
 *      (tournament_id, player1_id, player2_id, round, bracket_section)).
 *      Fix: keep MIN(id) per group, delete the rest.
 *
 *   B. Duplicate ROWS. Five events that previously existed as metadata-only rows
 *      (offline_import.js winner+runner-up, with a liquipedia_slug but no
 *      liquipedia_url) got a SECOND row created by the re-import (with a
 *      liquipedia_url + suffixed Liquipedia title + canonical placements/matches),
 *      because the importer's name match couldn't bridge "CEO 2017" ↔
 *      "CEO 2017 - Pokken". Fix: keep the new (richer) row, move the old row's
 *      liquipedia_slug onto it, delete the old row. offline_import.js (run after
 *      this) then restores the clean name by slug.
 *
 * Idempotent. Dry-run by default; pass --apply to execute (single transaction).
 *
 *   node cleanup_reimport_dupes.js            # dry run — report only
 *   node cleanup_reimport_dupes.js --apply    # execute
 *
 * After --apply:  node offline_import.js   (restore clean names by slug)
 *                 node recalculate_elo.js  (rebuild ELO/stats from clean matches)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
const db = require('./backend/src/db');

const APPLY = process.argv.includes('--apply');

// Duplicate event pairs to merge, identified by a stable liquipedia_slug. For
// each slug there are two rows: one carries the slug, the other carries a
// liquipedia_url (+ the richer bracket/placement data) but no slug. We keep the
// url/data row and move the slug onto it, dropping the slug-only row.
//
//  - First 5: metadata-only rows that the FORCE_REIMPORT created a richer
//    partner for ("CEO 2017" vs "CEO 2017 - Pokken", etc.).
//  - Last 3: the REVERSE shape — offline_import.js (run during recovery) keys on
//    liquipedia_slug, so for events whose only row had a url-but-no-slug it
//    inserted a fresh slug-only metadata row. Verified true duplicates (same
//    winner+runner-up+date): FF XIV (Jukem/Rokso), FF XV (Mewtater/TEC),
//    Final Round 2019 (Jukem/Raikel). The "Side Tournaments" suffix is just the
//    Liquipedia page title where FF's Pokkén bracket lives — same event.
// The keep/drop logic is symmetric (drop the slug-only row, keep the url row),
// so both shapes are handled identically.
const DUP_SLUGS = ['ceo_2017', 'final_round_20', 'frosty_faustings_9', 'ncr_2017', 'nec_18',
                   'frosty_faustings_14', 'frosty_faustings_15', 'final_round_2019'];

const norm = s => (s || '').toLowerCase()
  .replace(/\s*[-–]\s*pokk[eé]n\s*dx$/i, '')
  .replace(/\s*[-–]\s*pokken(dx)?$/i, '')
  .replace(/\s*[-–]\s*pokk[eé]n$/i, '')
  .replace(/\s+side tournaments?$/i, '')
  .replace(/\s*[-–]\s*t7$/i, '')
  .replace(/\s*[-–]\s*$/, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

(async () => {
  console.log(`\n🧹 Re-import duplicate cleanup  (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);

  // ── A. Duplicate matches ────────────────────────────────────────────────────
  const { rows: dupGroups } = await db.query(`
    SELECT m.tournament_id, t.name, m.player1_id, m.player2_id,
           COALESCE(m.round, -1) AS round, COALESCE(m.bracket_section, '') AS section,
           COUNT(*) AS n, MIN(m.id) AS keep_id
      FROM matches m
      JOIN tournaments t ON t.id = m.tournament_id
     WHERE t.is_offline = TRUE
     GROUP BY m.tournament_id, t.name, m.player1_id, m.player2_id,
              COALESCE(m.round, -1), COALESCE(m.bracket_section, '')
    HAVING COUNT(*) > 1`);

  const extraMatches = dupGroups.reduce((s, g) => s + (Number(g.n) - 1), 0);
  const affectedEvents = new Set(dupGroups.map(g => g.tournament_id));
  console.log(`A. Duplicate matches: ${extraMatches} extra rows across ${affectedEvents.size} events`);

  // ── B. Duplicate rows ───────────────────────────────────────────────────────
  const pairs = [];
  for (const slug of DUP_SLUGS) {
    const { rows: [oldRow] } = await db.query(
      `SELECT * FROM tournaments WHERE is_offline = TRUE AND liquipedia_slug = $1`, [slug]);
    if (!oldRow) { console.log(`   (slug ${slug}: no metadata row found — skipping)`); continue; }
    const { rows: cands } = await db.query(
      `SELECT * FROM tournaments
        WHERE is_offline = TRUE AND id <> $1
          AND (liquipedia_slug IS NULL OR liquipedia_slug <> $2)`,
      [oldRow.id, slug]);
    const newRow = cands.find(c => norm(c.name) === norm(oldRow.name));
    if (!newRow) { console.log(`   (slug ${slug}: no duplicate partner found — skipping)`); continue; }
    pairs.push({ slug, oldRow, newRow });
  }
  console.log(`\nB. Duplicate rows to merge: ${pairs.length}`);
  for (const p of pairs) {
    console.log(`   keep id=${p.newRow.id} "${p.newRow.name}"  ← drop id=${p.oldRow.id} "${p.oldRow.name}" (move slug '${p.slug}')`);
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to execute.');
    await db.end();
    return;
  }

  // ── Execute (single transaction) ────────────────────────────────────────────
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // A. delete duplicate matches (keep MIN(id) per group)
    const delA = await client.query(`
      DELETE FROM matches m USING (
        SELECT m2.tournament_id, m2.player1_id, m2.player2_id,
               COALESCE(m2.round, -1) AS round, COALESCE(m2.bracket_section, '') AS section,
               MIN(m2.id) AS keep_id
          FROM matches m2
          JOIN tournaments t ON t.id = m2.tournament_id
         WHERE t.is_offline = TRUE
         GROUP BY m2.tournament_id, m2.player1_id, m2.player2_id,
                  COALESCE(m2.round, -1), COALESCE(m2.bracket_section, '')
        HAVING COUNT(*) > 1
      ) d
      WHERE m.tournament_id = d.tournament_id
        AND m.player1_id    = d.player1_id
        AND m.player2_id    = d.player2_id
        AND COALESCE(m.round, -1)            = d.round
        AND COALESCE(m.bracket_section, '')  = d.section
        AND m.id <> d.keep_id`);
    console.log(`\n✅ A. Deleted ${delA.rowCount} duplicate match rows`);

    // B. merge duplicate rows: delete OLD first (frees the unique slug), then
    //    move the slug onto the kept NEW row.
    for (const p of pairs) {
      await client.query(`DELETE FROM tournaments WHERE id = $1`, [p.oldRow.id]);
      await client.query(
        `UPDATE tournaments SET liquipedia_slug = $2 WHERE id = $1`, [p.newRow.id, p.slug]);
      console.log(`✅ B. Merged "${p.newRow.name}": dropped id=${p.oldRow.id}, slug '${p.slug}' → id=${p.newRow.id}`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Committed.');
    console.log('Next: node offline_import.js   (restore clean names)');
    console.log('      node recalculate_elo.js  (rebuild ELO + stats)');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n❌ Rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
