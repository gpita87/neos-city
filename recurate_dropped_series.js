#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — Re-curate the series events dropped by curate_flagged_locals.js
// Run from the neos-city directory:
//   node recurate_dropped_series.js            (dry-run — prints, writes nothing)
//   node recurate_dropped_series.js --apply    (appends keepers to harvested_tournaments.txt)
//
// WHY: the Jul 14 participation crawl flagged 215 events into
// flagged_locals.txt; curation (curate_flagged_locals.js) then dropped every
// event whose NAME matched a known series WITHOUT checking whether the event
// was already in the DB. Verified Jul 18: 129 of the 215 backup entries are
// still absent from the DB (63 FFC, 18 RTG NA 2021-era hash slugs, 16 RTG EU
// #56–70 + EOTEUR6, 13 DCM #1–3/#5–14, 5 TCC, EOTR #2, plus locals). This
// script recovers them from flagged_locals.backup.txt.
//
// RULES
//   keep  — every backup entry whose slug is NOT in the DB, matching
//           challonge_id exactly AND as the org-prefixed "<org>-<slug>" form.
//   drop  — entries already in the DB (either slug form);
//         — entries already queued in harvested_tournaments.txt;
//         — the explicit exclusion list below (2v2 team events, Smash
//           brackets, 1-player no-bracket stubs);
//         — anything whose recorded game is known and not Pokkén (safety net —
//           should only re-catch the Smash brackets).
//
// READ-ONLY against the DB. --apply only appends to harvested_tournaments.txt
// (with a dated comment header). Idempotent: re-running skips already-appended
// URLs via the harvested-file dedupe.
//
// After --apply, run the browser-console import (v1 quota is exhausted):
//   node prep_console.js challonge_import_console.js
//   → paste on a https://challonge.com tab, then recalculate_elo.js.
// ===========================================================================

require('dotenv').config({ path: './backend/.env' });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BACKUP    = path.join(__dirname, 'flagged_locals.backup.txt');
const HARVESTED = path.join(__dirname, 'harvested_tournaments.txt');
const APPLY     = process.argv.includes('--apply');

const POKKEN_RE = /pokk[eé]n/i;

// Legitimate drops from the Jul 16 curation — do NOT recover these.
const EXCLUDED_SLUGS = new Set([
  'ncr_2018_pokken_2v2',   // real 2-player teams (verified in browser)
  '2v2sacpokken2017',      // real 2-player teams (verified in browser)
  'ha_3', 'ha3',           // Smash Bros brackets sharing the "Heaven's Arena" name
  'aos_x_imp_weekly_4',    // Smash Bros bracket
  'vf9go0zc', 'tdome1',    // 1-player brackets — no bracket store, clean skips
]);

// Same right-anchored parse as curate_flagged_locals.js — names containing
// " | " stay intact.
function parseMeta(line) {
  const fields = line.replace(/^#\s*/, '').split(' | ');
  if (fields.length < 5) return null;
  const game         = fields.pop().replace(/^game:/, '').trim();
  const participants = fields.pop().replace(/p$/, '').trim();
  const org          = fields.pop().replace(/^org:/, '').trim();
  const date         = fields.pop().trim();
  const name         = fields.join(' | ').trim();
  return { name, date, org, participants, game };
}

function slugFromUrl(url) {
  const m = String(url).match(/^https?:\/\/(?:([a-z0-9_-]+)\.)?challonge\.com\/([^\s#?]+)/i);
  if (!m) return null;
  const parts = m[2].split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

(async () => {
  for (const f of [BACKUP, HARVESTED]) {
    if (!fs.existsSync(f)) { console.error(`Not found: ${f}`); process.exit(1); }
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set in backend/.env — cannot check DB presence. Aborting.');
    process.exit(1);
  }

  // ── Parse the backup into records ─────────────────────────────────────────
  const records = [];
  let pendingMeta = null;
  for (const raw of fs.readFileSync(BACKUP, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (line.includes(' | ')) pendingMeta = parseMeta(line);
      continue;
    }
    if (line.startsWith('http')) {
      const slug = slugFromUrl(line);
      if (slug) records.push({ url: line, slug, meta: pendingMeta || {} });
      pendingMeta = null;
    }
  }
  const seen = new Set();
  const unique = records.filter(r =>
    (seen.has(r.slug.toLowerCase()) ? false : (seen.add(r.slug.toLowerCase()), true)));
  console.log(`Parsed ${unique.length} backup entr(ies) from flagged_locals.backup.txt.\n`);

  // ── DB presence: exact challonge_id AND "<org>-<slug>" org-prefix form ────
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let dbIds;
  try {
    const { rows } = await pool.query(
      'SELECT challonge_id FROM tournaments WHERE challonge_id IS NOT NULL');
    dbIds = rows.map(r => String(r.challonge_id).toLowerCase());
  } finally {
    await pool.end();
  }
  const dbIdSet = new Set(dbIds);
  const inDb = (slug) => {
    const s = slug.toLowerCase();
    if (dbIdSet.has(s)) return true;
    const suffix = `-${s}`;
    return dbIds.some(id => id.endsWith(suffix));
  };

  // ── Already queued in harvested_tournaments.txt ───────────────────────────
  const harvestedSlugs = new Set();
  for (const raw of fs.readFileSync(HARVESTED, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.includes('start.gg')) continue;
    const slug = slugFromUrl(line);
    if (slug) harvestedSlugs.add(slug.toLowerCase());
  }

  // ── Classify ──────────────────────────────────────────────────────────────
  const kept = [], excluded = [], wrongGame = [], alreadyDb = [], alreadyQueued = [];
  for (const r of unique) {
    const s = r.slug.toLowerCase();
    const game = r.meta.game || '';
    if (EXCLUDED_SLUGS.has(s))                      { excluded.push(r);      continue; }
    if (game && game !== '?' && !POKKEN_RE.test(game)) { wrongGame.push(r);  continue; }
    if (inDb(r.slug))                               { alreadyDb.push(r);     continue; }
    if (harvestedSlugs.has(s))                      { alreadyQueued.push(r); continue; }
    kept.push(r);
  }

  console.log('='.repeat(64));
  console.log(`KEEP (absent from DB — will append): ${kept.length}`);
  console.log(`already in DB:                       ${alreadyDb.length}`);
  console.log(`already in harvested file:           ${alreadyQueued.length}`);
  console.log(`excluded (2v2 / Smash / 1-player):   ${excluded.length}`);
  console.log(`wrong game (safety net):             ${wrongGame.length}`);
  console.log('='.repeat(64));

  if (wrongGame.length) {
    console.log('\nWrong-game entries dropped (verify these are all Smash/non-Pokkén):');
    for (const r of wrongGame) console.log(`  - ${r.meta.name || r.slug}  [${r.meta.game}]  ${r.url}`);
  }

  console.log('\nKeepers:');
  for (const r of kept) {
    console.log(`  ${r.meta.date || '????-??-??'}  ${r.meta.name || '?'}  (${r.meta.participants || '?'}p)  ${r.url}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to append ${kept.length} URL(s) to harvested_tournaments.txt.`);
    return;
  }

  if (kept.length === 0) {
    console.log('\nNothing to append — harvested_tournaments.txt unchanged.');
    return;
  }

  const out = ['', `# Appended by recurate_dropped_series.js on ${new Date().toISOString().slice(0, 10)}`,
               `# (re-curation of flagged_locals.backup.txt — known-series events the Jul 16`,
               `#  curation dropped without checking DB presence; ${kept.length} recovered)`];
  for (const r of kept) {
    out.push(`#   ${r.meta.name || '?'} | ${r.meta.date || '?'} | ${r.meta.participants || '?'}p | game:${r.meta.game || '?'}`);
    out.push(r.url);
  }
  out.push('');
  fs.appendFileSync(HARVESTED, out.join('\n'));
  console.log(`\n✅ Appended ${kept.length} URL(s) to harvested_tournaments.txt.`);
  console.log('Next: node prep_console.js challonge_import_console.js → paste on a challonge.com tab.');
})().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
