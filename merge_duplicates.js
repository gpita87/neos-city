/**
 * merge_duplicates.js
 *
 * Merges duplicate tournament rows:
 *   1. Offline events: bracket importer created new rows instead of linking
 *      to the existing offline_import.js rows. Moves matches + metadata to
 *      the original row, deletes the duplicate.
 *   2. TCC: some events appear twice (e.g. #19 twice). RR variants are kept
 *      as separate events (they're legitimate round-robin side brackets).
 *
 * Usage: node merge_duplicates.js [--dry-run]
 */

require('dotenv').config({ path: './backend/.env' });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DRY_RUN = process.argv.includes('--dry-run');

// Known offline duplicate pairs: [bracket_import_id, original_id]
// From the diagnose output
const OFFLINE_DUPES = [
  { bracket: 644, original: 573, label: 'DreamHack Anaheim 2020' },
  { bracket: 648, original: 557, label: 'FightClub Championship V' },
  { bracket: 649, original: 633, label: 'Final Round 19' },
  { bracket: 650, original: 589, label: 'Frostfire 2019' },
  { bracket: 651, original: 572, label: 'Northeast Championship 21' },
  { bracket: 652, original: 560, label: 'OzHadou Nationals 17' },
  { bracket: 653, original: 610, label: 'SoCal Regionals 2017' },
  { bracket: 654, original: 596, label: 'SoCal Regionals 2018' },
  { bracket: 656, original: 578, label: 'Summer Jam 13' },
  { bracket: 655, original: 625, label: 'Summer Jam X' },
  { bracket: 657, original: 609, label: 'The Fall Classic 2017' },
  { bracket: 658, original: 582, label: 'Toryuken 8' },
  { bracket: 659, original: 619, label: 'Winter Brawl 11' },
];

// EVO bracket dupes (check these exist)
const EVO_DUPES = [
  // EVO 2016/2017/2018 bracket imports might also have dupes
  // We'll detect these dynamically
];

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // ─── Part 1: Merge known offline duplicates ─────────────────────────────
  console.log('\n--- OFFLINE DUPLICATE MERGES ---\n');

  for (const dupe of OFFLINE_DUPES) {
    // Verify both rows exist
    const { rows: [bracketRow] } = await pool.query(
      'SELECT id, name, liquipedia_url, participants_count FROM tournaments WHERE id = $1', [dupe.bracket]
    );
    const { rows: [originalRow] } = await pool.query(
      'SELECT id, name, liquipedia_url, participants_count FROM tournaments WHERE id = $1', [dupe.original]
    );

    if (!bracketRow || !originalRow) {
      console.log(`  SKIP ${dupe.label}: missing row (bracket=${!!bracketRow}, original=${!!originalRow})`);
      continue;
    }

    // Count matches on each
    const { rows: [{ count: bracketMatches }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM matches WHERE tournament_id = $1', [dupe.bracket]
    );
    const { rows: [{ count: originalMatches }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM matches WHERE tournament_id = $1', [dupe.original]
    );

    console.log(`  ${dupe.label}:`);
    console.log(`    Bracket row (id=${dupe.bracket}): "${bracketRow.name}" — ${bracketMatches} matches, liquipedia_url=${bracketRow.liquipedia_url || 'null'}`);
    console.log(`    Original row (id=${dupe.original}): "${originalRow.name}" — ${originalMatches} matches, liquipedia_url=${originalRow.liquipedia_url || 'null'}`);

    if (!DRY_RUN) {
      // Step 1: Move matches from bracket row to original row
      if (bracketMatches > 0) {
        const { rowCount } = await pool.query(
          'UPDATE matches SET tournament_id = $1 WHERE tournament_id = $2',
          [dupe.original, dupe.bracket]
        );
        console.log(`    → Moved ${rowCount} matches to original row`);
      }

      // Step 2: Copy liquipedia_url if original doesn't have one
      // Must clear it from bracket row first to avoid unique constraint violation
      if (bracketRow.liquipedia_url) {
        await pool.query('UPDATE tournaments SET liquipedia_url = NULL WHERE id = $1', [dupe.bracket]);
        if (!originalRow.liquipedia_url) {
          await pool.query(
            'UPDATE tournaments SET liquipedia_url = $1 WHERE id = $2',
            [bracketRow.liquipedia_url, dupe.original]
          );
          console.log(`    → Copied liquipedia_url to original`);
        }
      }

      // Step 3: Update participants_count on original if bracket had a higher count
      if (bracketRow.participants_count > (originalRow.participants_count || 0)) {
        await pool.query(
          'UPDATE tournaments SET participants_count = $1 WHERE id = $2',
          [bracketRow.participants_count, dupe.original]
        );
        console.log(`    → Updated participants_count to ${bracketRow.participants_count}`);
      }

      // Step 4: Move player_achievements referencing bracket tournament (if any)
      await pool.query(
        'UPDATE player_achievements SET tournament_id = $1 WHERE tournament_id = $2',
        [dupe.original, dupe.bracket]
      ).catch(() => {}); // table might not have tournament_id

      // Step 5: Delete the bracket duplicate row
      await pool.query('DELETE FROM tournaments WHERE id = $1', [dupe.bracket]);
      console.log(`    → Deleted bracket duplicate row (id=${dupe.bracket})`);
    } else {
      console.log(`    → Would move ${bracketMatches} matches, delete bracket row`);
    }
  }

  // ─── Part 2: Detect EVO duplicates dynamically ──────────────────────────
  console.log('\n--- CHECKING FOR EVO DUPLICATES ---\n');

  const evoNames = ['Evolution Championship Series 2016', 'Evolution Championship Series 2017', 'Evolution Championship Series 2018'];
  for (const evoName of evoNames) {
    const { rows } = await pool.query(`
      SELECT id, name, is_offline,
             (SELECT COUNT(*)::int FROM matches m WHERE m.tournament_id = t.id) AS match_count,
             liquipedia_url, liquipedia_slug, COALESCE(completed_at, started_at) AS dt
      FROM tournaments t
      WHERE name ILIKE $1
      ORDER BY id
    `, [`%${evoName}%`]);

    if (rows.length > 1) {
      console.log(`  ${evoName}: ${rows.length} rows found`);
      for (const r of rows) {
        console.log(`    id=${r.id}  "${r.name}"  matches=${r.match_count}  date=${r.dt?.toISOString().slice(0,10) || 'null'}  liq_url=${r.liquipedia_url || 'null'}  liq_slug=${r.liquipedia_slug || 'null'}`);
      }

      // If one has matches and one doesn't, or if one has a liquipedia_slug (from offline_import)
      // and the other has matches (from bracket import), merge them
      const withSlug = rows.find(r => r.liquipedia_slug);
      const withMatches = rows.find(r => r.match_count > 0 && !r.liquipedia_slug);

      if (withSlug && withMatches && withSlug.id !== withMatches.id) {
        console.log(`    → MERGE: keep id=${withSlug.id} (has slug), absorb matches from id=${withMatches.id}`);
        if (!DRY_RUN) {
          await pool.query('UPDATE matches SET tournament_id = $1 WHERE tournament_id = $2', [withSlug.id, withMatches.id]);
          if (withMatches.liquipedia_url && !withSlug.liquipedia_url) {
            await pool.query('UPDATE tournaments SET liquipedia_url = $1 WHERE id = $2', [withMatches.liquipedia_url, withSlug.id]);
          }
          await pool.query('DELETE FROM tournaments WHERE id = $1', [withMatches.id]);
          console.log(`    → Done: moved matches, deleted id=${withMatches.id}`);
        }
      }
    }
  }

  // ─── Part 3: Detect other offline dupes dynamically ─────────────────────
  console.log('\n--- CHECKING FOR OTHER OFFLINE DUPLICATES ---\n');

  // Find offline tournaments that share similar names (bracket import vs basic import)
  const { rows: offlineDupes } = await pool.query(`
    SELECT a.id AS id_a, a.name AS name_a,
           (SELECT COUNT(*)::int FROM matches m WHERE m.tournament_id = a.id) AS matches_a,
           a.liquipedia_slug AS slug_a, a.liquipedia_url AS url_a,
           b.id AS id_b, b.name AS name_b,
           (SELECT COUNT(*)::int FROM matches m WHERE m.tournament_id = b.id) AS matches_b,
           b.liquipedia_slug AS slug_b, b.liquipedia_url AS url_b
    FROM tournaments a
    JOIN tournaments b ON a.id < b.id AND a.is_offline = true AND b.is_offline = true
    WHERE (
      -- Same base name (before colon or "Side Tournaments")
      SPLIT_PART(a.name, ':', 1) = SPLIT_PART(b.name, ':', 1)
      OR SPLIT_PART(a.name, ' Side', 1) = SPLIT_PART(b.name, ' Side', 1)
      OR REPLACE(REPLACE(a.name, ': Pokken Bracket', ''), ': PokkenDX Bracket', '') =
         REPLACE(REPLACE(b.name, ': Pokken Bracket', ''), ': PokkenDX Bracket', '')
    )
    ORDER BY a.name
  `);

  if (offlineDupes.length > 0) {
    console.log(`Found ${offlineDupes.length} potential duplicate pairs:`);
    for (const d of offlineDupes) {
      console.log(`  "${d.name_a}" (id=${d.id_a}, ${d.matches_a} matches, slug=${d.slug_a || 'null'})`);
      console.log(`  "${d.name_b}" (id=${d.id_b}, ${d.matches_b} matches, slug=${d.slug_b || 'null'})`);
      console.log();
    }
  } else {
    console.log('No remaining offline duplicates found.');
  }

  // ─── Part 4: Check for TCC exact duplicates (same number, not RR) ──────
  console.log('\n--- CHECKING FOR TCC DUPLICATES ---\n');

  const { rows: tccAll } = await pool.query(`
    SELECT id, name, COALESCE(completed_at, started_at) AS dt,
           (SELECT COUNT(*)::int FROM matches m WHERE m.tournament_id = t.id) AS match_count
    FROM tournaments t
    WHERE name ILIKE '%Croissant Cup%'
    ORDER BY name
  `);

  // Group by number
  const tccByNum = {};
  for (const t of tccAll) {
    const m = t.name.match(/#(\d+)/);
    if (!m) continue;
    const num = m[1];
    const isRR = /RR|\(RR\)/i.test(t.name);
    const key = `${num}${isRR ? '_RR' : ''}`;
    if (!tccByNum[key]) tccByNum[key] = [];
    tccByNum[key].push(t);
  }

  let tccDupeCount = 0;
  for (const [key, events] of Object.entries(tccByNum)) {
    if (events.length > 1) {
      tccDupeCount++;
      console.log(`  TCC ${key}: ${events.length} rows`);
      for (const e of events) {
        console.log(`    id=${e.id}  "${e.name}"  date=${e.dt?.toISOString().slice(0,10) || 'null'}  matches=${e.match_count}`);
      }

      // If one has matches and one doesn't, merge
      const withMatches = events.filter(e => e.match_count > 0);
      const withoutMatches = events.filter(e => e.match_count === 0);

      if (withMatches.length === 1 && withoutMatches.length >= 1) {
        const keep = withMatches[0];
        for (const remove of withoutMatches) {
          console.log(`    → MERGE: keep id=${keep.id} (${keep.match_count} matches), delete id=${remove.id} (0 matches)`);
          if (!DRY_RUN) {
            await pool.query('DELETE FROM tournaments WHERE id = $1', [remove.id]);
            console.log(`    → Deleted id=${remove.id}`);
          }
        }
      } else if (withMatches.length > 1) {
        // Both have matches — keep the one with more matches, move from other
        withMatches.sort((a, b) => b.match_count - a.match_count);
        const keep = withMatches[0];
        for (let i = 1; i < withMatches.length; i++) {
          const remove = withMatches[i];
          console.log(`    → MERGE: keep id=${keep.id} (${keep.match_count} matches), absorb+delete id=${remove.id} (${remove.match_count} matches)`);
          if (!DRY_RUN) {
            await pool.query('UPDATE matches SET tournament_id = $1 WHERE tournament_id = $2', [keep.id, remove.id]);
            await pool.query('DELETE FROM tournaments WHERE id = $1', [remove.id]);
            console.log(`    → Moved matches, deleted id=${remove.id}`);
          }
        }
        // Also delete any 0-match dupes
        for (const remove of withoutMatches) {
          console.log(`    → DELETE empty dupe id=${remove.id}`);
          if (!DRY_RUN) {
            await pool.query('DELETE FROM tournaments WHERE id = $1', [remove.id]);
          }
        }
      } else if (withMatches.length === 0 && withoutMatches.length > 1) {
        // None have matches — keep the one with a date, delete rest
        const withDate = events.filter(e => e.dt);
        if (withDate.length >= 1) {
          const keep = withDate[0];
          for (const remove of events.filter(e => e.id !== keep.id)) {
            console.log(`    → DELETE empty dupe id=${remove.id} (keeping id=${keep.id})`);
            if (!DRY_RUN) {
              await pool.query('DELETE FROM tournaments WHERE id = $1', [remove.id]);
            }
          }
        }
      }
    }
  }

  if (tccDupeCount === 0) console.log('No TCC duplicates found.');

  // ─── Part 5: Check for other online series dupes ────────────────────────
  console.log('\n--- CHECKING FOR OTHER SERIES DUPLICATES ---\n');

  const seriesPatterns = [
    '%RTG EU%', '%RTG NA%', '%Ferrum Fist%', '%End of the Road%', '%DCM%'
  ];

  for (const pattern of seriesPatterns) {
    const { rows } = await pool.query(`
      SELECT id, name, COALESCE(completed_at, started_at) AS dt,
             (SELECT COUNT(*)::int FROM matches m WHERE m.tournament_id = t.id) AS match_count
      FROM tournaments t
      WHERE name ILIKE $1 AND is_offline IS NOT TRUE
      ORDER BY name
    `, [pattern]);

    const byNum = {};
    for (const t of rows) {
      const m = t.name.match(/#(\d+)/);
      if (!m) {
        const m2 = t.name.match(/\b(\d{1,3})\s*$/);
        if (!m2) continue;
        const key = m2[1];
        if (!byNum[key]) byNum[key] = [];
        byNum[key].push(t);
        continue;
      }
      const key = m[1];
      if (!byNum[key]) byNum[key] = [];
      byNum[key].push(t);
    }

    let found = false;
    for (const [num, events] of Object.entries(byNum)) {
      if (events.length > 1) {
        if (!found) { console.log(`  ${pattern}:`); found = true; }
        console.log(`    #${num}: ${events.length} rows`);
        for (const e of events) {
          console.log(`      id=${e.id}  "${e.name}"  date=${e.dt?.toISOString().slice(0,10) || 'null'}  matches=${e.match_count}`);
        }

        // Same logic: keep the one with matches
        const withMatches = events.filter(e => e.match_count > 0);
        const withoutMatches = events.filter(e => e.match_count === 0);

        if (withMatches.length >= 1 && withoutMatches.length >= 1) {
          const keep = withMatches[0];
          for (const remove of withoutMatches) {
            console.log(`      → DELETE empty dupe id=${remove.id} (keeping id=${keep.id})`);
            if (!DRY_RUN) {
              await pool.query('DELETE FROM tournaments WHERE id = $1', [remove.id]);
            }
          }
        } else if (withMatches.length === 0 && events.length > 1) {
          // All empty — keep one with date
          const withDate = events.filter(e => e.dt);
          if (withDate.length >= 1) {
            const keep = withDate[0];
            for (const remove of events.filter(e => e.id !== keep.id)) {
              console.log(`      → DELETE empty dupe id=${remove.id}`);
              if (!DRY_RUN) {
                await pool.query('DELETE FROM tournaments WHERE id = $1', [remove.id]);
              }
            }
          }
        }
      }
    }
  }

  // ─── Final count ────────────────────────────────────────────────────────
  const { rows: [{ count: totalTournaments }] } = await pool.query('SELECT COUNT(*)::int AS count FROM tournaments');
  const { rows: [{ count: noDateCount }] } = await pool.query('SELECT COUNT(*)::int AS count FROM tournaments WHERE started_at IS NULL AND completed_at IS NULL');
  const { rows: [{ count: totalMatches }] } = await pool.query('SELECT COUNT(*)::int AS count FROM matches');

  console.log('\n' + '='.repeat(60));
  console.log(`Total tournaments: ${totalTournaments}`);
  console.log(`Still no date: ${noDateCount}`);
  console.log(`Total matches: ${totalMatches}`);
  console.log('='.repeat(60));

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
