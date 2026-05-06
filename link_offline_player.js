#!/usr/bin/env node
/**
 * link_offline_player.js — Interactive merge of an offline-import player
 * record into a canonical Challonge player record.
 *
 * Use case: an offline tournament was imported under a player's tag
 * (e.g. "ThankSwalot") that is the same human as an existing Challonge
 * account (e.g. "Jukem"). This script:
 *   1. Resolves both players (case-insensitive, accepts display name or
 *      challonge_username)
 *   2. Shows what will move and asks for confirmation
 *   3. Reassigns matches / placements / ELO / achievements from the
 *      offline player to the canonical player (transactional)
 *   4. Refreshes the canonical player's offline_* tier counts and
 *      offline_score column from tournament_placements
 *   5. Inserts/updates a player_aliases row so future imports auto-resolve
 *
 * Run from the neos-city directory:
 *   node link_offline_player.js
 *
 * Or non-interactively (positional args):
 *   node link_offline_player.js ThankSwalot Jukem
 *
 * Add `--yes` to skip the confirmation prompt:
 *   node link_offline_player.js ThankSwalot Jukem --yes
 *
 * Use `--display-name <value>` to also fix the canonical player's display
 * name. This is needed when an offline import has overwritten the canonical
 * player's display_name (e.g. @jukem ended up displaying as "ThankSwalot"
 * because the offline upsert ran AFTER the alias was in place):
 *   node link_offline_player.js magicrock jukem --display-name Jukem
 *
 * Idempotent: running twice with the same pair after the first merge is
 * a no-op (the alias already exists, the source player no longer exists).
 *
 * After running this you usually do NOT need to re-run recalculate_elo.js —
 * offline_score is recomputed in-place. Re-run recalculate_elo.js anyway
 * if the merged player had ELO history you want re-derived.
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');
const readline = require('readline');

const OFFLINE_TIERS = ['worlds', 'major', 'regional', 'other'];
const OFFLINE_WEIGHTS = {
  worlds:   { wins: 100, runner_up: 60, top4: 35, top8: 20 },
  major:    { wins: 50,  runner_up: 30, top4: 18, top8: 10 },
  regional: { wins: 25,  runner_up: 15, top4: 9,  top8: 5 },
  other:    { wins: 10,  runner_up: 6,  top4: 3,  top8: 2 },
};

// ─── CLI parsing ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const skipConfirm = args.includes('--yes') || args.includes('-y');

// --display-name <value>  → after the merge, set the canonical player's
// display_name to <value>. This is needed because importOneOffline() upserts
// players with ON CONFLICT DO UPDATE SET display_name = EXCLUDED.display_name,
// which means an offline import of "ThankSwalot" routed to @jukem will have
// overwritten @jukem.display_name to "ThankSwalot".
let cliDisplayName = null;
{
  const i = args.findIndex(a => a === '--display-name' || a === '--name');
  if (i !== -1 && args[i + 1] != null) cliDisplayName = args[i + 1];
}

const FLAGS_WITH_VALUES = new Set(['--display-name', '--name']);
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (FLAGS_WITH_VALUES.has(a)) { i++; continue; }
  if (a.startsWith('-')) continue;
  positional.push(a);
}
const cliFrom = positional[0] || null;
const cliTo   = positional[1] || null;

function normalize(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, ans => resolve(ans.trim())));
}

async function findPlayer(client, raw) {
  const norm = normalize(raw);
  if (!norm) return null;
  // Try challonge_username first (exact lowercase match), then display_name
  let { rows } = await client.query(
    `SELECT id, challonge_username, display_name
     FROM players
     WHERE LOWER(challonge_username) = $1
     LIMIT 1`,
    [norm]
  );
  if (rows.length === 0) {
    const { rows: byDisplay } = await client.query(
      `SELECT p.id, p.challonge_username, p.display_name,
              COALESCE(p.offline_score, 0) AS offline_score,
              (SELECT COUNT(*)::int FROM tournament_placements tp
                 JOIN tournaments t ON tp.tournament_id = t.id
                WHERE tp.player_id = p.id AND t.is_offline = TRUE) AS offline_placements,
              (SELECT COUNT(*)::int FROM tournament_placements tp
                 JOIN tournaments t ON tp.tournament_id = t.id
                WHERE tp.player_id = p.id AND t.is_offline = FALSE) AS online_placements
       FROM players p
       WHERE LOWER(p.display_name) = LOWER($1)`,
      [String(raw).trim()]
    );
    if (byDisplay.length === 1) return byDisplay[0];
    if (byDisplay.length > 1) {
      console.error(`Multiple players match display_name="${raw}":`);
      for (const p of byDisplay) {
        console.error(
          `   id=${p.id}  @${p.challonge_username}` +
          `  online=${p.online_placements}  offline=${p.offline_placements}  offline_score=${p.offline_score}`
        );
      }
      console.error('');
      console.error('Re-run with the exact challonge_username, e.g.:');
      console.error(`   node link_offline_player.js ${byDisplay[0].challonge_username} <canonical>`);
      return null;
    }
    return null;
  }
  return rows[0];
}

async function ensureAliasTable(client) {
  // Idempotent — safe to run on every invocation.
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

async function ensureDefeatedOpponentsTable(client) {
  // Soft-create — schema already does this elsewhere, but the merge script
  // shouldn't crash if the table doesn't exist on a partially-migrated DB.
  await client.query(`
    CREATE TABLE IF NOT EXISTS achievement_defeated_opponents (
      player_id      INTEGER NOT NULL,
      achievement_id TEXT    NOT NULL,
      opponent_id    INTEGER NOT NULL,
      match_id       INTEGER,
      PRIMARY KEY (player_id, achievement_id, opponent_id)
    )
  `);
}

// Recompute the canonical player's offline_* columns from tournament_placements.
// Mirrors backend/src/routes/tournaments.js:refreshOfflineStats so the merge
// is self-sufficient and doesn't require a follow-up recalc for offline tiers.
async function refreshOfflineStats(client, playerId) {
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

async function describeMove(client, srcId) {
  const counts = {};
  const tables = [
    { table: 'tournament_placements', col: 'player_id' },
    { table: 'matches',               col: 'player1_id' },
    { table: 'matches',               col: 'player2_id' },
    { table: 'matches',               col: 'winner_id' },
    { table: 'elo_history',           col: 'player_id' },
    { table: 'player_achievements',   col: 'player_id' },
  ];
  for (const { table, col } of tables) {
    try {
      const { rows: [{ c }] } = await client.query(
        `SELECT COUNT(*)::int AS c FROM ${table} WHERE ${col} = $1`, [srcId]
      );
      counts[`${table}.${col}`] = c;
    } catch {
      counts[`${table}.${col}`] = '(table not present)';
    }
  }
  return counts;
}

async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const closeRl = () => { try { rl.close(); } catch { /* ignore */ } };

  const fromRaw = cliFrom || await prompt(rl, 'Offline player to merge FROM (alias, e.g. ThankSwalot): ');
  const toRaw   = cliTo   || await prompt(rl, 'Canonical Challonge player to merge INTO (e.g. Jukem):  ');

  if (!fromRaw || !toRaw) {
    console.error('Both names are required. Aborting.');
    closeRl();
    process.exit(1);
  }
  if (normalize(fromRaw) === normalize(toRaw)) {
    console.error('Source and destination resolve to the same name. Nothing to merge.');
    closeRl();
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let inTx = false;

  try {
    await ensureAliasTable(client);
    await ensureDefeatedOpponentsTable(client);

    const src = await findPlayer(client, fromRaw);
    const dst = await findPlayer(client, toRaw);

    if (!src && !dst) {
      console.error(`Neither "${fromRaw}" nor "${toRaw}" exists in the players table.`);
      closeRl();
      process.exit(1);
    }

    if (!src) {
      // Source doesn't exist — likely already merged. Just make sure the
      // alias row is in place so future offline imports route to dst, and
      // honor any --display-name fix the user asked for.
      console.log(`No player found for "${fromRaw}". Either it was already merged, or the offline event hasn't been imported yet.`);
      if (dst) {
        await client.query(
          `INSERT INTO player_aliases (alias_username, canonical_username)
           VALUES ($1, $2)
           ON CONFLICT (alias_username) DO UPDATE SET canonical_username = EXCLUDED.canonical_username`,
          [normalize(fromRaw), dst.challonge_username]
        );
        console.log(`✓ Alias ensured: ${normalize(fromRaw)} → ${dst.challonge_username}`);
        if (cliDisplayName && cliDisplayName !== dst.display_name) {
          await client.query(
            `UPDATE players SET display_name = $1 WHERE id = $2`,
            [cliDisplayName, dst.id]
          );
          console.log(`✓ display_name on @${dst.challonge_username}: "${dst.display_name}" → "${cliDisplayName}"`);
        }
      }
      closeRl();
      return;
    }
    if (!dst) {
      console.error(`No canonical player found for "${toRaw}". Make sure the Challonge player exists first.`);
      closeRl();
      process.exit(1);
    }

    if (src.id === dst.id) {
      console.error('Source and destination resolve to the same player_id. Nothing to merge.');
      closeRl();
      process.exit(1);
    }

    console.log('');
    console.log('Merge plan:');
    console.log(`  FROM:  id=${src.id}  ${src.display_name}  (@${src.challonge_username})`);
    console.log(`  INTO:  id=${dst.id}  ${dst.display_name}  (@${dst.challonge_username})`);

    const counts = await describeMove(client, src.id);
    console.log('  Rows that will move from FROM → INTO:');
    for (const [k, v] of Object.entries(counts)) {
      console.log(`    ${k.padEnd(40)} ${v}`);
    }
    console.log(`  + insert/update player_aliases: ${normalize(src.challonge_username)} → ${dst.challonge_username}`);
    console.log(`  + DELETE players row id=${src.id} (after move)`);
    console.log(`  + recompute offline_* + offline_score on id=${dst.id}`);
    if (cliDisplayName && cliDisplayName !== dst.display_name) {
      console.log(`  + set display_name on id=${dst.id}: "${dst.display_name}" → "${cliDisplayName}"`);
    }

    if (!skipConfirm) {
      const ans = await prompt(rl, '\nProceed? [y/N] ');
      if (!/^y/i.test(ans)) {
        console.log('Aborted.');
        closeRl();
        return;
      }
    }
    closeRl();

    await client.query('BEGIN');
    inTx = true;

    // ── Reassign matches ─────────────────────────────────────────────────
    const m1 = await client.query(`UPDATE matches SET player1_id = $1 WHERE player1_id = $2`, [dst.id, src.id]);
    const m2 = await client.query(`UPDATE matches SET player2_id = $1 WHERE player2_id = $2`, [dst.id, src.id]);
    const m3 = await client.query(`UPDATE matches SET winner_id  = $1 WHERE winner_id  = $2`, [dst.id, src.id]);
    console.log(`  matches:                     player1=${m1.rowCount}  player2=${m2.rowCount}  winner=${m3.rowCount}`);

    // ── Reassign live_matches ────────────────────────────────────────────
    // Table is part of schema.sql; no need to guard for missing-table here.
    // (Wrapping in try/catch inside a transaction would swallow real errors
    // and leave the transaction aborted — see the merge logic in
    // merge_players.js for the no-guard precedent.)
    await client.query(`UPDATE live_matches SET player1_id = $1 WHERE player1_id = $2`, [dst.id, src.id]);
    await client.query(`UPDATE live_matches SET player2_id = $1 WHERE player2_id = $2`, [dst.id, src.id]);
    await client.query(`UPDATE live_matches SET winner_id  = $1 WHERE winner_id  = $2`, [dst.id, src.id]);

    // ── Reassign tournament_placements (drop dupes first) ────────────────
    await client.query(`
      DELETE FROM tournament_placements
      WHERE player_id = $1
        AND tournament_id IN (SELECT tournament_id FROM tournament_placements WHERE player_id = $2)
    `, [src.id, dst.id]);
    const tp = await client.query(`UPDATE tournament_placements SET player_id = $1 WHERE player_id = $2`, [dst.id, src.id]);
    console.log(`  tournament_placements:       moved=${tp.rowCount}`);

    // ── Reassign elo_history ─────────────────────────────────────────────
    const eh = await client.query(`UPDATE elo_history SET player_id = $1 WHERE player_id = $2`, [dst.id, src.id]);
    console.log(`  elo_history:                 moved=${eh.rowCount}`);

    // ── Merge achievements (drop dupes first) ────────────────────────────
    await client.query(`
      DELETE FROM player_achievements
      WHERE player_id = $1
        AND achievement_id IN (SELECT achievement_id FROM player_achievements WHERE player_id = $2)
    `, [src.id, dst.id]);
    const pa = await client.query(`UPDATE player_achievements SET player_id = $1 WHERE player_id = $2`, [dst.id, src.id]);
    console.log(`  player_achievements:         moved=${pa.rowCount}`);

    // ── Merge defeated-opponent rows ─────────────────────────────────────
    // ensureDefeatedOpponentsTable() above guarantees the table exists, so
    // this block can run un-guarded inside the transaction.
    await client.query(`
      DELETE FROM achievement_defeated_opponents
      WHERE player_id = $1
        AND (achievement_id, opponent_id) IN (
          SELECT achievement_id, opponent_id
          FROM achievement_defeated_opponents WHERE player_id = $2
        )
    `, [src.id, dst.id]);
    await client.query(`UPDATE achievement_defeated_opponents SET player_id  = $1 WHERE player_id  = $2`, [dst.id, src.id]);
    await client.query(`UPDATE achievement_defeated_opponents SET opponent_id = $1 WHERE opponent_id = $2`, [dst.id, src.id]);

    // ── Delete the now-empty source player ───────────────────────────────
    await client.query(`DELETE FROM players WHERE id = $1`, [src.id]);
    console.log(`  Deleted players row id=${src.id}`);

    // ── Insert / update player_aliases ───────────────────────────────────
    await client.query(`
      INSERT INTO player_aliases (alias_username, canonical_username)
      VALUES ($1, $2)
      ON CONFLICT (alias_username) DO UPDATE SET canonical_username = EXCLUDED.canonical_username
    `, [normalize(src.challonge_username), dst.challonge_username]);
    console.log(`  player_aliases:              ${normalize(src.challonge_username)} → ${dst.challonge_username}`);

    // ── Recompute offline stats for the canonical player ─────────────────
    await refreshOfflineStats(client, dst.id);
    console.log(`  offline stats refreshed on player_id=${dst.id}`);

    // ── Optional display_name fix on the canonical player ────────────────
    if (cliDisplayName && cliDisplayName !== dst.display_name) {
      await client.query(
        `UPDATE players SET display_name = $1 WHERE id = $2`,
        [cliDisplayName, dst.id]
      );
      console.log(`  display_name on @${dst.challonge_username}: "${dst.display_name}" → "${cliDisplayName}"`);
    }

    await client.query('COMMIT');
    inTx = false;
    console.log('\n✅  Merge complete.');
    console.log('   If you also care about ELO history attribution, you can re-run');
    console.log('   `node recalculate_elo.js` — but offline_* numbers are already correct.');
  } catch (err) {
    if (inTx) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    }
    console.error('\n❌  Merge failed, transaction rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
