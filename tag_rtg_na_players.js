#!/usr/bin/env node
// One-time (re-runnable) backfill: tag players who participated in any
// Road to Greatness NA tournament with region='NA'.
//
// Source of truth for participation is tournament_placements — covers every
// entrant, not just match participants. Players whose region is already set
// (any non-NULL value) are left alone, mirroring the COALESCE semantics in
// the importOneTonamel JP auto-tag.
//
// Flags:
//   --dry-run   Print counts only, no UPDATE.

require('dotenv').config({ path: 'backend/.env' });
const { Pool } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const { rows: candidates } = await db.query(`
      SELECT DISTINCT p.id, p.display_name, p.challonge_username, p.region
      FROM players p
      JOIN tournament_placements tp ON tp.player_id = p.id
      JOIN tournaments t ON t.id = tp.tournament_id
      WHERE t.series = 'rtg_na'
      ORDER BY p.display_name
    `);

    const willTag = candidates.filter(p => p.region === null);
    const alreadySet = candidates.filter(p => p.region !== null);
    const alreadyNA = alreadySet.filter(p => p.region === 'NA');
    const conflicts = alreadySet.filter(p => p.region !== 'NA');

    console.log(`Total RTG NA participants: ${candidates.length}`);
    console.log(`  → will tag NA (region IS NULL): ${willTag.length}`);
    console.log(`  → already NA: ${alreadyNA.length}`);
    console.log(`  → already tagged with another region (left alone): ${conflicts.length}`);

    if (conflicts.length > 0) {
      console.log('\nNon-NA tagged players found in RTG NA tournaments:');
      for (const p of conflicts) {
        console.log(`  ${p.display_name} (${p.challonge_username}) → ${p.region}`);
      }
    }

    if (DRY_RUN) {
      console.log('\n--dry-run set — no UPDATE executed.');
      return;
    }

    if (willTag.length === 0) {
      console.log('\nNothing to update.');
      return;
    }

    const ids = willTag.map(p => p.id);
    const { rowCount } = await db.query(
      `UPDATE players SET region = 'NA' WHERE id = ANY($1) AND region IS NULL`,
      [ids]
    );

    console.log(`\nUpdated ${rowCount} player(s) → region='NA'.`);
  } finally {
    await db.end();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
