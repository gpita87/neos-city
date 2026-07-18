/**
 * merge_players.js — Merge duplicate player records into one.
 *
 * Reassigns all matches, placements, ELO history, achievements, and
 * defeated-opponent records from the DROP player to the KEEP (canonical)
 * player, deletes the drop row, AND writes a row to player_aliases so
 * future tournament imports of the dead handle route directly to the
 * canonical row instead of creating a fresh fallback.
 *
 * Closes the re-emergence loop: start.gg / offline / scraped imports that
 * slugify a participant's display_name into a `challonge_username` key
 * matching a previously-merged handle now hit `resolveAlias()` in
 * tournaments.js and land on the canonical row, leaving no breadcrumb
 * to re-merge later. Existing aliases that pointed AT the dead handle
 * are also forwarded to the new canonical, so chained merges stay
 * consistent.
 *
 * DRY RUN BY DEFAULT — every merge runs inside one transaction that is
 * rolled back unless --apply (or --yes) is passed. Eyeball the dry-run
 * output (names, counts, skips) before committing.
 *
 * SAFETY GUARD: if both players placed in the same tournament, or ever
 * played each other, the pair is SKIPPED with a warning — same-event
 * presence is evidence they are two different people, not a dupe.
 *
 * After --apply, run `node recalculate_elo.js` to rebuild all stats.
 *
 * Usage (from neos-city directory):
 *   node merge_players.js <keepId>:<dropId> [<keepId>:<dropId> ...] [--apply]
 *   node merge_players.js <old_username> <canonical_username> [--apply]
 *
 * Examples:
 *   node merge_players.js 4655:29961 13:30311        # dry run, two pairs
 *   node merge_players.js 4655:29961 --apply         # commit one pair
 *   node merge_players.js thankswalot jukem --apply  # legacy username form
 *                                                    # (old = drop, canonical = keep)
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');

// Defensive — link_offline_player.js also creates this table; the merge
// script doesn't want to crash if it's run before that has happened.
async function ensureAliasTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS player_aliases (
      id                 SERIAL PRIMARY KEY,
      alias_username     TEXT UNIQUE NOT NULL,
      canonical_username TEXT NOT NULL,
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_player_aliases_alias ON player_aliases (alias_username)
  `);
}

const APPLY = process.argv.includes('--apply') || process.argv.includes('--yes');
const args = process.argv.slice(2).filter(a => a !== '--apply' && a !== '--yes');

function usage() {
  console.error('Usage: node merge_players.js <keepId>:<dropId> [<keepId>:<dropId> ...] [--apply]');
  console.error('       node merge_players.js <old_username> <canonical_username> [--apply]');
  console.error('Examples:');
  console.error('  node merge_players.js 4655:29961 13:30311      # dry run');
  console.error('  node merge_players.js thankswalot jukem --apply');
  process.exit(1);
}

// Pair spec: {keepId, dropId} (id mode) or {oldUsername, canonUsername} (legacy).
const pairSpecs = [];
if (args.length > 0 && args.every(a => /^\d+:\d+$/.test(a))) {
  for (const a of args) {
    const [keepId, dropId] = a.split(':').map(Number);
    if (keepId === dropId) { console.error(`Bad pair "${a}" — keep and drop are the same id`); process.exit(1); }
    pairSpecs.push({ keepId, dropId });
  }
  const seen = new Set();
  for (const { keepId, dropId } of pairSpecs) {
    for (const id of [keepId, dropId]) {
      if (seen.has(id)) { console.error(`Id #${id} appears in more than one pair — run chained merges one at a time.`); process.exit(1); }
      seen.add(id);
    }
  }
} else if (args.length === 2 && args.every(a => !/^\d+:\d+$/.test(a))) {
  pairSpecs.push({ oldUsername: args[0], canonUsername: args[1] });
} else {
  usage();
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function lookupPair(client, spec) {
  const bySql = 'SELECT id, challonge_username, display_name, region, games_played, tournaments_entered FROM players WHERE ';
  let keep, drop;
  if (spec.keepId != null) {
    const { rows } = await client.query(bySql + 'id = ANY($1)', [[spec.keepId, spec.dropId]]);
    keep = rows.find(r => r.id === spec.keepId);
    drop = rows.find(r => r.id === spec.dropId);
    if (!keep) throw new Error(`KEEP player #${spec.keepId} not found`);
    if (!drop) throw new Error(`DROP player #${spec.dropId} not found`);
  } else {
    const { rows: o } = await client.query(bySql + 'challonge_username = $1', [spec.oldUsername.toLowerCase()]);
    const { rows: c } = await client.query(bySql + 'challonge_username = $1', [spec.canonUsername.toLowerCase()]);
    if (!o.length) throw new Error(`Player not found: "${spec.oldUsername}"`);
    if (!c.length) throw new Error(`Player not found: "${spec.canonUsername}"`);
    drop = o[0];
    keep = c[0];
  }
  return { keep, drop };
}

// Returns true if merged, false if skipped by the same-event guard.
async function mergePair(client, keep, drop) {
  const keepId = keep.id, dropId = drop.id;
  console.log(`\nKEEP #${keepId} "${keep.display_name}" (user=${keep.challonge_username}, region=${keep.region}, games=${keep.games_played}, tourneys=${keep.tournaments_entered})`);
  console.log(`DROP #${dropId} "${drop.display_name}" (user=${drop.challonge_username}, region=${drop.region}, games=${drop.games_played}, tourneys=${drop.tournaments_entered})`);

  // 0. Same-event guard: two entrants in one bracket are two people.
  const { rows: overlap } = await client.query(`
    SELECT t.name FROM tournament_placements ka
    JOIN tournament_placements da ON da.tournament_id = ka.tournament_id
    JOIN tournaments t ON t.id = ka.tournament_id
    WHERE ka.player_id = $1 AND da.player_id = $2
  `, [keepId, dropId]);
  const { rows: [h2h] } = await client.query(`
    SELECT COUNT(*)::int AS n FROM matches
    WHERE (player1_id = $1 AND player2_id = $2) OR (player1_id = $2 AND player2_id = $1)
  `, [keepId, dropId]);
  if (overlap.length || h2h.n) {
    if (overlap.length) console.warn(`  ⚠️  SKIPPED — both placed in: ${overlap.map(o => `"${o.name}"`).join(', ')}`);
    if (h2h.n) console.warn(`  ⚠️  SKIPPED — they played each other in ${h2h.n} match(es)`);
    console.warn('     Same-event presence = likely two different people. Not merging.');
    return false;
  }

  // 1. Reassign matches
  const r1 = await client.query(`UPDATE matches SET player1_id = $1 WHERE player1_id = $2`, [keepId, dropId]);
  const r2 = await client.query(`UPDATE matches SET player2_id = $1 WHERE player2_id = $2`, [keepId, dropId]);
  const r3 = await client.query(`UPDATE matches SET winner_id  = $1 WHERE winner_id  = $2`, [keepId, dropId]);
  console.log(`  matches: player1=${r1.rowCount}, player2=${r2.rowCount}, winner=${r3.rowCount} rows updated`);

  // 2. Reassign live_matches (if any)
  await client.query(`UPDATE live_matches SET player1_id = $1 WHERE player1_id = $2`, [keepId, dropId]);
  await client.query(`UPDATE live_matches SET player2_id = $1 WHERE player2_id = $2`, [keepId, dropId]);
  await client.query(`UPDATE live_matches SET winner_id  = $1 WHERE winner_id  = $2`, [keepId, dropId]);

  // 3. Reassign tournament_placements — conflict-free: the same-event guard
  //    above already skipped any pair that shares a tournament.
  const r4 = await client.query(`UPDATE tournament_placements SET player_id = $1 WHERE player_id = $2`, [keepId, dropId]);
  console.log(`  tournament_placements: ${r4.rowCount} rows moved`);

  // 4. Reassign ELO history
  const r5 = await client.query(`UPDATE elo_history SET player_id = $1 WHERE player_id = $2`, [keepId, dropId]);
  console.log(`  elo_history: ${r5.rowCount} rows moved`);

  // 5. Merge achievements. Where both hold the same achievement, keep the
  //    EARLIEST first_seen_at / unlocked_at on the canonical row (so old
  //    unlocks don't resurface in the Recent Achievements feed) before
  //    dropping the duplicate, then move the rest.
  const r5b = await client.query(`
    UPDATE player_achievements kp
    SET first_seen_at = LEAST(kp.first_seen_at, dp.first_seen_at),
        unlocked_at   = LEAST(kp.unlocked_at, dp.unlocked_at),
        tournament_id = COALESCE(kp.tournament_id, dp.tournament_id)
    FROM player_achievements dp
    WHERE dp.player_id = $2 AND kp.player_id = $1
      AND kp.achievement_id = dp.achievement_id
  `, [keepId, dropId]);
  await client.query(`
    DELETE FROM player_achievements
    WHERE player_id = $1
      AND achievement_id IN (SELECT achievement_id FROM player_achievements WHERE player_id = $2)
  `, [dropId, keepId]);
  const r6 = await client.query(`UPDATE player_achievements SET player_id = $1 WHERE player_id = $2`, [keepId, dropId]);
  console.log(`  player_achievements: ${r6.rowCount} rows moved, ${r5b.rowCount} merged (earliest timestamps kept)`);

  // 6. Merge defeated opponents tracking.
  // PK = (player_id, achievement_id, opponent_id). Both columns can collide
  // during the merge, so dedup on the full conflict key before each UPDATE
  // and clean self-rows after. (Earlier versions of this block keyed only
  // on opponent_id, which both over-deleted on the first step and missed
  // collisions on the second — triggering PK violations on opponent_id
  // rewrite. See link_offline_player.js for the parallel logic.)
  await client.query(`
    DELETE FROM achievement_defeated_opponents
    WHERE player_id = $1
      AND (achievement_id, opponent_id) IN (
        SELECT achievement_id, opponent_id
        FROM achievement_defeated_opponents WHERE player_id = $2
      )
  `, [dropId, keepId]);
  await client.query(`UPDATE achievement_defeated_opponents SET player_id  = $1 WHERE player_id  = $2`, [keepId, dropId]);
  await client.query(`
    DELETE FROM achievement_defeated_opponents
    WHERE opponent_id = $1
      AND (player_id, achievement_id) IN (
        SELECT player_id, achievement_id
        FROM achievement_defeated_opponents WHERE opponent_id = $2
      )
  `, [dropId, keepId]);
  await client.query(`UPDATE achievement_defeated_opponents SET opponent_id = $1 WHERE opponent_id = $2`, [keepId, dropId]);
  await client.query(
    `DELETE FROM achievement_defeated_opponents WHERE player_id = $1 AND opponent_id = $1`,
    [keepId]
  );

  // 6b. Re-point any account claim from the old player to the canonical one.
  // Without this, ON DELETE SET NULL on users.player_id would silently orphan
  // a user's claim when their player gets merged away. Guarded with to_regclass
  // so this still works on DBs predating the users table.
  const { rows: [reg] } = await client.query(`SELECT to_regclass('public.users') AS t`);
  if (reg.t) {
    // Re-point loser → canonical, but only if the canonical player isn't
    // already claimed (the one-user-per-player unique index forbids two).
    const repointed = await client.query(
      `UPDATE users SET player_id = $1, updated_at = NOW()
       WHERE player_id = $2
         AND NOT EXISTS (SELECT 1 FROM users WHERE player_id = $1)`,
      [keepId, dropId]
    );
    // Edge case — both duplicates were claimed: release whoever still points
    // at the loser rather than violate the unique index. Warn so it's visible.
    const released = await client.query(
      `UPDATE users SET player_id = NULL, updated_at = NOW() WHERE player_id = $1`,
      [dropId]
    );
    if (repointed.rowCount) console.log(`  users: re-pointed ${repointed.rowCount} account claim(s) to canonical`);
    if (released.rowCount) console.warn(`  users: released ${released.rowCount} claim(s) — canonical player was already claimed`);
  }

  // 6c. Region backfill — a NULL-region canonical inherits the drop's region
  // (e.g. keep predates region tagging, drop was auto-tagged on import).
  if (!keep.region && drop.region) {
    await client.query(`UPDATE players SET region = $1 WHERE id = $2`, [drop.region, keepId]);
    console.log(`  region: canonical inherits '${drop.region}'`);
  }

  // 7. Delete old player record
  await client.query(`DELETE FROM players WHERE id = $1`, [dropId]);
  console.log(`  Deleted old player record (id=${dropId})`);

  // 8. Write player_aliases so future imports route the dead handle to the
  //    canonical row instead of recreating a fallback. Two steps:
  //    a. Any existing aliases that pointed AT the drop handle (because some
  //       earlier merge made it canonical) get re-pointed to the keep handle.
  //    b. The drop handle itself becomes an alias for the keep handle.
  //       ON CONFLICT handles the case where an older alias row exists.
  //
  //    The alias key is drop.challonge_username verbatim (no normalization).
  //    resolveAlias() in tournaments.js does an exact map lookup keyed on the
  //    lowercased participant slug, which is exactly what's stored in
  //    players.challonge_username — normalizing here would silently miss
  //    handles with spaces (e.g. "neo sinanju" from start.gg).
  const oldKey = drop.challonge_username;
  const canonKey = keep.challonge_username;
  const r7 = await client.query(
    `UPDATE player_aliases SET canonical_username = $1 WHERE canonical_username = $2`,
    [canonKey, oldKey]
  );
  if (r7.rowCount > 0) {
    console.log(`  player_aliases: re-routed ${r7.rowCount} existing alias(es) "${oldKey}" → "${canonKey}"`);
  }
  await client.query(
    `INSERT INTO player_aliases (alias_username, canonical_username)
     VALUES ($1, $2)
     ON CONFLICT (alias_username) DO UPDATE SET canonical_username = EXCLUDED.canonical_username`,
    [oldKey, canonKey]
  );
  console.log(`  player_aliases: ${oldKey} → ${canonKey}`);
  return true;
}

async function main() {
  console.log(`🔀  Player merge — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (rolled back — pass --apply to commit)'}`);
  const client = await pool.connect();
  let merged = 0, skipped = 0;
  try {
    await client.query('BEGIN');
    await ensureAliasTable(client);

    for (const spec of pairSpecs) {
      const { keep, drop } = await lookupPair(client, spec);
      if (await mergePair(client, keep, drop)) merged++;
      else skipped++;
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\n✅  COMMITTED — ${merged} merged, ${skipped} skipped. Now run: node recalculate_elo.js`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\n🧪  DRY RUN rolled back — ${merged} would merge, ${skipped} skipped. Re-run with --apply to commit.`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Merge failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    pool.end();
  }
}

main();
