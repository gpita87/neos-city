#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — Curate flagged_locals.txt
// Run from the neos-city directory:  node curate_flagged_locals.js
//
// Takes the raw flag-locals output and produces a clean "true locals" review
// file, dropping everything Gabriel doesn't want to keep:
//
//   1. Known-series online events (FFC, RTG NA/EU, DCM, TCC, EOTR, HA, Nezumi,
//      MTM) — matched by NAME as well as slug, because these came in under
//      root/variant/hash slugs that detectSeries' slug patterns miss
//      (e.g. "Road To Greatness #11" with slug q4m4e2ez).
//   2. Wrong-game entries (the Smash "Heaven's Arena" brackets, etc.) — any
//      row whose game_name isn't Pokkén.
//   3. Likely duplicates already in the DB under a different slug — matched by
//      normalized name + date, or case-insensitive slug. (Skipped if the DB
//      isn't reachable; the run still curates on rules 1 & 2.)
//
// Team-format events (2v2 / 3v3 / crew) are KEPT but tagged for review, with a
// sample of their entrants printed so you can confirm the bracket is made of
// individual players (3v3 game mode) rather than multi-person teams.
//
// READ-ONLY against the DB and Challonge. It rewrites flagged_locals.txt in
// place, backing the original up to flagged_locals.backup.txt first.
// ===========================================================================

require('dotenv').config({ path: './backend/.env' });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
const challonge = require('./backend/src/services/challonge');

const FLAGGED = path.join(__dirname, 'flagged_locals.txt');
const BACKUP  = path.join(__dirname, 'flagged_locals.backup.txt');

const POKKEN_RE = /pokk[eé]n/i;
const TEAM_RE   = /\b\dv\d\b|\bcrew\b/i;

// Name/slug → known-series key, or null for a genuine local. Broader than
// achievements.js:detectSeries on purpose — matches series NAMES so variant
// and hash slugs still get caught.
function knownSeries(name = '', slug = '') {
  const n = name.toUpperCase();
  const s = slug.toUpperCase();
  if (/^FFC\d+/.test(s) || /FIGHTING FOR CHEESE|FIGHTING FOR CHAOS|FERRUM FIST/.test(n)) return 'ffc';
  if (/^RTGNA\d+/.test(s) || /^RTGEU\d+/.test(s)) return 'rtg';
  if (n.includes('ROAD TO GREATNESS') || n.includes('RTG EU') || n.includes('RTGEU')) return 'rtg';
  if (n.includes('END OF THE EU ROAD') || n.includes('EU ROAD')) return 'rtg_eu';
  if (/^DCMP?\d+/.test(s) || n.includes('DEVCORD COMMUNITY MONTHLY') || /\bDCM\b/.test(n)) return 'dcm';
  if (/^TCC[_-]?\d+/.test(s) || n.includes('CROISSANT CUP')) return 'tcc';
  if (n.includes('END OF THE ROAD')) return 'eotr';
  if (/HEAVEN.?S? ?ARENA/.test(n)) return 'ha';
  if (n.includes('NEZUMI') || n.includes('ねずみ')) return 'nezumi';
  if (/MID.?TIER.?MAYHEM/.test(n)) return 'mtm';
  return null;
}

// Parse a "#   Name | date | org:- | 8p | game:X" metadata comment. Parsed from
// the RIGHT so that names containing " | " (e.g. "Totally Legit #2 | #TLEFam")
// stay intact.
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

function normName(s = '') {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function loadDbTournaments() {
  if (!process.env.DATABASE_URL) {
    console.warn('  DATABASE_URL not set — skipping duplicate reconcile (rules 1 & 2 still apply).\n');
    return null;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      'SELECT name, started_at, challonge_id FROM tournaments'
    );
    const byNameDate = new Set();
    const bySlug     = new Set();
    for (const r of rows) {
      if (r.challonge_id) bySlug.add(String(r.challonge_id).toLowerCase());
      const d = r.started_at ? new Date(r.started_at).toISOString().slice(0, 10) : '';
      byNameDate.add(`${normName(r.name)}|${d}`);
    }
    return { byNameDate, bySlug };
  } catch (err) {
    console.warn(`  DB lookup failed (${err.message}) — skipping duplicate reconcile.\n`);
    return null;
  } finally {
    await pool.end();
  }
}

(async () => {
  if (!fs.existsSync(FLAGGED)) {
    console.error(`Not found: ${FLAGGED}`);
    process.exit(1);
  }

  // ── Parse raw file into records ────────────────────────────────────────────
  const lines = fs.readFileSync(FLAGGED, 'utf8').split('\n');
  const records = [];
  let pendingMeta = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (line.includes(' | ')) pendingMeta = parseMeta(line);
      continue; // section headers and any other comments
    }
    if (line.startsWith('http')) {
      const slug = challonge.extractSlugFromUrl(line);
      if (slug) records.push({ url: line, slug, meta: pendingMeta || {} });
      pendingMeta = null;
    }
  }

  // Dedupe by slug (defensive — flag-locals should already have)
  const seen = new Set();
  const unique = records.filter(r => (seen.has(r.slug) ? false : (seen.add(r.slug), true)));

  console.log(`Parsed ${unique.length} flagged tournament(s).\n`);

  const db = await loadDbTournaments();

  // ── Classify ───────────────────────────────────────────────────────────────
  const kept = [], droppedSeries = [], droppedGame = [], droppedDup = [], teamReview = [];

  for (const r of unique) {
    const { name = '', game = '', date = '' } = r.meta;

    // Rule 2: wrong game (game known and not Pokkén). '?' / blank = keep.
    if (game && game !== '?' && !POKKEN_RE.test(game)) { droppedGame.push({ ...r, why: game }); continue; }

    // Rule 1: known series (by name or slug)
    const series = knownSeries(name, r.slug);
    if (series) { droppedSeries.push({ ...r, why: series }); continue; }

    // Rule 3: duplicate already in DB under a different slug
    if (db) {
      const dupSlug = db.bySlug.has(r.slug.toLowerCase());
      const dupND   = db.byNameDate.has(`${normName(name)}|${date}`);
      if (dupSlug || dupND) { droppedDup.push({ ...r, why: dupSlug ? 'slug' : 'name+date' }); continue; }
    }

    if (TEAM_RE.test(name)) teamReview.push(r);
    kept.push(r);
  }

  // ── Team-event participant check (only the few that need it) ────────────────
  for (const r of teamReview) {
    try {
      const data = await challonge.getParticipants(r.slug);
      const list = Array.isArray(data) ? data : [];
      const names = list.map(p => (p.participant || p).name || (p.participant || p).display_name).filter(Boolean);
      const teamish = names.filter(nm => /[&/+,]| and | vs /i.test(nm));
      r.entrantSample = names.slice(0, 6);
      r.looksLikeTeams = teamish.length > names.length / 3;
    } catch (err) {
      r.entrantSample = [`(could not fetch: ${err.message})`];
      r.looksLikeTeams = null;
    }
  }

  // ── Rewrite flagged_locals.txt with only the kept locals ───────────────────
  if (!fs.existsSync(BACKUP)) fs.copyFileSync(FLAGGED, BACKUP);

  const out = [`# Curated by curate_flagged_locals.js on ${new Date().toISOString().slice(0, 10)}`,
               `# ${kept.length} local(s) kept. Dropped: ${droppedSeries.length} known-series, `
               + `${droppedGame.length} wrong-game, ${droppedDup.length} duplicate.`,
               ''];
  for (const r of kept) {
    const m = r.meta;
    const teamTag = TEAM_RE.test(m.name || '') ? '   ⚠ TEAM? verify entrants are individuals' : '';
    out.push(`#   ${m.name || '?'} | ${m.date || '?'} | ${m.participants || '?'}p | game:${m.game || '?'}${teamTag}`);
    out.push(r.url);
  }
  out.push('');
  fs.writeFileSync(FLAGGED, out.join('\n'));

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log('='.repeat(64));
  console.log(`KEPT (true locals):        ${kept.length}`);
  console.log(`dropped — known series:    ${droppedSeries.length}`);
  console.log(`dropped — wrong game:      ${droppedGame.length}`);
  console.log(`dropped — DB duplicate:    ${droppedDup.length}`);
  console.log('='.repeat(64));

  if (droppedGame.length) {
    console.log('\nWrong-game (removed):');
    for (const r of droppedGame) console.log(`  - ${r.meta.name}  [${r.why}]  ${r.url}`);
  }
  if (droppedDup.length) {
    console.log('\nLikely duplicates of existing DB rows (removed — verify if surprising):');
    for (const r of droppedDup) console.log(`  - ${r.meta.name} (${r.meta.date})  [${r.why}]  ${r.url}`);
  }
  if (teamReview.length) {
    console.log('\nTeam-format events KEPT — confirm entrants are individual players:');
    for (const r of teamReview) {
      const verdict = r.looksLikeTeams === true ? 'looks like TEAMS'
                    : r.looksLikeTeams === false ? 'looks like individuals'
                    : 'unknown';
      console.log(`  - ${r.meta.name}  [${verdict}]`);
      console.log(`      entrants: ${r.entrantSample.join(', ')}`);
      console.log(`      ${r.url}`);
    }
  }

  console.log(`\nflagged_locals.txt rewritten (${kept.length} locals). Original saved to flagged_locals.backup.txt.`);
  console.log('Review it, then copy the URL lines into harvested_tournaments.txt and run `node pull_new.js`.');
})().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
