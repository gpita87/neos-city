#!/usr/bin/env node
/**
 * backfill_merge_aliases.js — Recreate player_aliases rows for merges run
 * BEFORE merge_players.js learned to write them.
 *
 * Context: every `node merge_players.js <old> <canonical>` invocation prior
 * to commit 2fbcc98 ("merge_players: write player_aliases row to close
 * re-emergence loop") deleted the old player row without recording an
 * alias. The next time a tournament import slugified that same handle, a
 * fresh fallback row got created — the duplicate the dupe finder keeps
 * resurfacing. This script writes those missing alias rows in one pass so
 * the re-emergence loop closes retroactively.
 *
 * Safety:
 *   - Defaults to PREVIEW. Pass --apply to actually write.
 *   - For each (old, canonical) pair below:
 *       * Skip if @old still exists in players (merge didn't happen, or
 *         a fresh fallback row was already created and needs another
 *         merge_players.js run first — don't paper over real data).
 *       * Skip if @canonical doesn't exist in players (typo or removed).
 *       * Otherwise write/update the alias inside a transaction.
 *   - Idempotent. Re-running after --apply is a no-op except for any new
 *     pairs that became eligible since the last run.
 *
 * Usage (from neos-city directory):
 *   node backfill_merge_aliases.js            # preview
 *   node backfill_merge_aliases.js --apply    # commit
 *
 * After --apply, restart the backend so resolveAlias()'s 5-minute cache
 * flushes immediately. Otherwise the new aliases land on the next flush.
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');

const APPLY = process.argv.includes('--apply');

// Every merge ever suggested in this cleanup pass, in the direction the
// merge actually ran. Order doesn't matter — each row is checked
// independently. Add new pairs at the bottom; the script's per-pair
// self-check makes it safe to leave the whole history in place.
const PAIRS = [
  // ── First Q1 + Tier-1 batch ─────────────────────────────────────────
  ['darren',              'lolyousaidtheefword'],
  ['godofhay',            'jammyjamjaml'],
  ['neo sinanju',         'neo_sinanju'],
  ['o',                   'o__'],
  ['tres_leches',         '3rd_steady'],
  ['classyfennekin',      'classyfenn'],
  ['princessknight',      'princessknight9'],
  ['yaboy',               'yaboypokken'],
  ['devlinhart',          'devlinhartfgc'],
  ['toes_|_virtigris',    'virtigris'],
  ['pfq_|_niet',          'niet_dev'],

  // ── Tier-2 batch ────────────────────────────────────────────────────
  ['aldrake',             'aldrakefgc'],
  ['elucid',              'elucid_fgc'],
  ['utah',                'utahvgc'],
  ['dragonboi_uwu',       'dragon_boi'],
  ['roksothesavage',      'rokso'],
  ['inc_flegar',          'flegar'],
  ['obscure',             'ng-obscure'],
  ['comboster7',          'comboster'],
  ['combo',               'comboster'],
  ['ytcomboster7',        'comboster'],

  // ── Fuzzy 5 ─────────────────────────────────────────────────────────
  ['alpha',               'alphaflower16'],
  ['dev',                 'devlinhartfgc'],
  ['gyl',                 'gylergin'],
  ['lemon',               'lemongrenade'],
  ['jin',                 'jinbyasharin'],

  // ── Most-recent Q1 batch ────────────────────────────────────────────
  ['actias',              'deleted2516035'],
  ['allister',            'allisterfgc'],
  ['brooksggst',          'babelfgc'],
  ['empurror',            'catfight'],
  ['enigma',              'enigmaaaa'],
  ['jukem',               'thankswalot1'],
  ['kamaal',              'sixonesix'],
  ['oreo',                'oreokm'],
  ['peachyumbreon',       'gogurtpeachy'],
  ['tamn_son!',           'komunchlax'],
  ['tapucocoa',           'tapucocoafgc'],
  ['wes',                 'clifit'],

  // ── Cloud / Niet / one-offs ─────────────────────────────────────────
  ['cloud',               'm2cloud'],
  ['m_cloud_2',           'm2cloud'],
  ['niet',                'niet_dev'],
  ['pfq_niet',            'niet_dev'],
  ['ouroboro',            'ouroboro_san'],
  ['kachu',               'happykachu'],
];

async function ensureAliasTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS player_aliases (
      id                 SERIAL PRIMARY KEY,
      alias_username     TEXT UNIQUE NOT NULL,
      canonical_username TEXT NOT NULL,
      created_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_player_aliases_alias ON player_aliases (alias_username)`
  );
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await ensureAliasTable(client);

    // Build a single set of "does this handle exist" answers in one query.
    const allKeys = new Set();
    for (const [a, b] of PAIRS) { allKeys.add(a); allKeys.add(b); }
    const { rows: existing } = await client.query(
      `SELECT challonge_username FROM players WHERE challonge_username = ANY($1)`,
      [[...allKeys]]
    );
    const inPlayers = new Set(existing.map(r => r.challonge_username));

    // And an inventory of current aliases so we don't print "WRITE" for rows
    // that are already correctly aliased.
    const { rows: existingAliases } = await client.query(
      `SELECT alias_username, canonical_username FROM player_aliases
        WHERE alias_username = ANY($1)`,
      [PAIRS.map(([old]) => old)]
    );
    const aliasMap = new Map(
      existingAliases.map(r => [r.alias_username, r.canonical_username])
    );

    let toWrite = [];
    let alreadyOk = 0;
    let skipped = [];

    // For each PAIRS entry, find the surviving handle and treat the missing
    // one as the merged-away alias. PAIRS is a "candidate dupe" list — the
    // direction in code is just a starting suggestion; if I guessed wrong
    // and the user ran the merge the other way, we still want the alias.
    for (const [a, b] of PAIRS) {
      const aGone = !inPlayers.has(a);
      const bGone = !inPlayers.has(b);

      let oldHandle, canonHandle, flipped = false;
      if (aGone && !bGone) {
        oldHandle = a; canonHandle = b;
      } else if (bGone && !aGone) {
        oldHandle = b; canonHandle = a; flipped = true;
      } else if (aGone && bGone) {
        skipped.push({ a, b, reason: 'both handles missing — no surviving canonical to alias to' });
        continue;
      } else {
        skipped.push({ a, b, reason: 'both handles still in players — merge did not happen for this pair' });
        continue;
      }

      const existingCanon = aliasMap.get(oldHandle);
      if (existingCanon === canonHandle) {
        alreadyOk++;
        continue;
      }
      toWrite.push({ oldHandle, canonHandle, replacing: existingCanon || null, flipped });
    }

    console.log('');
    console.log(`Mode: ${APPLY ? 'APPLY (writes will commit)' : 'PREVIEW (no writes — re-run with --apply)'}`);
    console.log(`Pairs proposed: ${PAIRS.length}`);
    console.log(`  to write:     ${toWrite.length}`);
    console.log(`  already ok:   ${alreadyOk}`);
    console.log(`  skipped:      ${skipped.length}`);
    console.log('');

    if (toWrite.length > 0) {
      console.log('To write:');
      for (const r of toWrite) {
        const tag = r.flipped ? ' [direction flipped vs PAIRS]' : '';
        const replace = r.replacing
          ? `  (was → ${r.replacing}, redirecting)`
          : '';
        console.log(`  ${r.oldHandle.padEnd(30)} → ${r.canonHandle}${tag}${replace}`);
      }
      console.log('');
    }

    if (skipped.length > 0) {
      console.log('Skipped:');
      for (const r of skipped) {
        console.log(`  ${r.a.padEnd(30)} ↔ ${r.b.padEnd(30)}   (${r.reason})`);
      }
      console.log('');
    }

    if (!APPLY) {
      console.log('Preview only — re-run with --apply to commit the writes above.');
      return;
    }

    if (toWrite.length === 0) {
      console.log('Nothing to write. Done.');
      return;
    }

    await client.query('BEGIN');
    for (const { oldHandle, canonHandle } of toWrite) {
      // Re-route any aliases that previously pointed AT this old handle as
      // a canonical (chained-merge case) BEFORE inserting the new alias.
      await client.query(
        `UPDATE player_aliases SET canonical_username = $1 WHERE canonical_username = $2`,
        [canonHandle, oldHandle]
      );
      await client.query(
        `INSERT INTO player_aliases (alias_username, canonical_username)
         VALUES ($1, $2)
         ON CONFLICT (alias_username) DO UPDATE SET canonical_username = EXCLUDED.canonical_username`,
        [oldHandle, canonHandle]
      );
    }
    await client.query('COMMIT');
    console.log(`Committed ${toWrite.length} alias write(s).`);
    console.log('Restart the backend so resolveAlias()\'s 5-minute cache picks them up immediately.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('backfill_merge_aliases failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
