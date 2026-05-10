#!/usr/bin/env node
/**
 * find_offline_events_missing_placements.js — Read-only audit.
 *
 * Lists every offline tournament in the DB with how many placements it has.
 * The Liquipedia Prize Pool table on each event page is the source of truth
 * for top-8 (with ties); offline_import.js only seeds rank-1 + rank-2.
 *
 * Output groups events by placement count:
 *   • 0–2 placements   → backfill candidates (only winner/runner-up known)
 *   • 3–7 placements   → partial — bracket import landed but didn't fill top 8
 *   • 8+ placements    → full top-8 (the ones we already fixed, e.g. BAM 12)
 *
 * Run from the neos-city directory (NOT from a .claude/worktrees/ slug):
 *   node find_offline_events_missing_placements.js
 *
 * Optional flags:
 *   --threshold N   Only show events with ≤ N placements (default 2)
 *   --all           Print every offline event regardless of count
 *   --json          Emit JSON instead of the human-readable table
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : (args[i + 1] || fallback);
};
const has = (name) => args.includes(name);

const THRESHOLD = parseInt(flag('--threshold', '2'), 10);
const SHOW_ALL  = has('--all');
const AS_JSON   = has('--json');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT
      t.id,
      t.name,
      t.completed_at,
      t.location,
      t.participants_count,
      t.series                                            AS tier,
      t.liquipedia_url,
      t.liquipedia_slug,
      (SELECT COUNT(*)::int FROM tournament_placements tp
        WHERE tp.tournament_id = t.id)                    AS placement_count,
      (SELECT COUNT(*)::int FROM matches m
        WHERE m.tournament_id = t.id)                     AS match_count
    FROM tournaments t
    WHERE t.is_offline = TRUE
    ORDER BY t.completed_at DESC NULLS LAST, t.id
  `);

  const filtered = SHOW_ALL ? rows : rows.filter(r => r.placement_count <= THRESHOLD);

  if (AS_JSON) {
    console.log(JSON.stringify(filtered, null, 2));
    await pool.end();
    return;
  }

  // Bucket all rows for the summary header (independent of filter)
  const buckets = { '0-2 (only winner/runner-up)': [], '3-7 (partial)': [], '8+ (full top-8)': [] };
  for (const r of rows) {
    if (r.placement_count <= 2)      buckets['0-2 (only winner/runner-up)'].push(r);
    else if (r.placement_count <= 7) buckets['3-7 (partial)'].push(r);
    else                              buckets['8+ (full top-8)'].push(r);
  }

  console.log(`\nOffline tournaments: ${rows.length} total`);
  for (const [label, group] of Object.entries(buckets)) {
    console.log(`  ${label.padEnd(34)} ${group.length}`);
  }
  console.log('');

  if (filtered.length === 0) {
    console.log(`No events match the filter (threshold=${THRESHOLD}, all=${SHOW_ALL}).`);
    await pool.end();
    return;
  }

  console.log(SHOW_ALL
    ? `Listing all ${filtered.length} offline events:`
    : `Listing ${filtered.length} events with ≤ ${THRESHOLD} placements:`);
  console.log('─'.repeat(120));

  const fmtDate = (d) => d ? new Date(d).toISOString().slice(0, 10) : '   —      ';
  for (const r of filtered) {
    const lpKnown = r.liquipedia_url ? '✓' : (r.liquipedia_slug ? '~' : '·');
    const tier = (r.tier || '—').padEnd(8);
    const ents = r.participants_count != null ? String(r.participants_count).padStart(3) : '  ?';
    console.log([
      `id=${String(r.id).padStart(5)}`,
      fmtDate(r.completed_at),
      `tier=${tier}`,
      `n=${ents}`,
      `pl=${String(r.placement_count).padStart(2)}`,
      `m=${String(r.match_count).padStart(3)}`,
      `lp=${lpKnown}`,
      r.name,
    ].join('  '));
  }

  console.log('');
  console.log('Legend:');
  console.log('  pl   — placement rows in DB (we want 8 for a full top-8 with ties)');
  console.log('  m    — match rows in DB (0 = no bracket import has run)');
  console.log('  lp   — Liquipedia link status:  ✓ url set    ~ slug only    · neither');
  console.log('');
  console.log('Next step: pick events from this list and add a record like BAM 12');
  console.log('to a backfill script (POST /api/tournaments/import-liquipedia-placements).');

  await pool.end();
}

main().catch(err => {
  console.error('find_offline_events_missing_placements failed:', err.message);
  process.exit(1);
});
