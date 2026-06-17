#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — joltaru / Thunderdome import (run on main)
//
//   node thunderdome_import.js            # validate + preview only (no writes to DB)
//   node thunderdome_import.js --import   # validate, then POST to batch-import
//
// joltaru's tournaments import as PLAIN ONLINE Challonge events with NO series
// (detectSeries() won't match the slugs — that's intentional). They count
// normally toward ELO and global player records. No migration, no seed.
//
// This script is the validation half of the harvest: harvest_joltaru_console.js
// scrapes the candidate URLs in the browser (the profile listing 403s from
// Node), you paste them into thunderdome_urls.txt, and this script fetches each
// one via the v1 API — which DOES work from Node — to confirm it's actually
// Pokkén before import. Non-Pokkén tournaments joltaru also ran are dropped.
//
// What it does, every run:
//   1. Reads thunderdome_urls.txt (http lines; '#' comments and blanks ignored).
//   2. For each slug, GET v1 /tournaments/<slug>.json and decide Pokkén vs not,
//      using the same looksLikePokkenTournament() the rest of the app uses.
//   3. Prints a table: slug | game | name | date | KEEP/DROP/ERROR.
//   4. Rewrites thunderdome_urls.txt to the KEPT urls (date-sorted), with the
//      dropped ones preserved as '# DROPPED' comments for the record.
//   With --import it then POSTs the KEPT urls to /api/tournaments/batch-import.
//
// After --import, run:  node recalculate_elo.js   (perfect ELO + Pass-2 achievements)
// ===========================================================================

const fs   = require('fs');
const http = require('http');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const challonge = require('./backend/src/services/challonge');

const DO_IMPORT   = process.argv.includes('--import');
const URLS_PATH   = path.join(__dirname, 'thunderdome_urls.txt');
const API_HOST    = 'localhost';
const API_PORT    = 3001;
const CHUNK_SIZE  = 50;
const VALIDATE_DELAY_MS = 150; // politeness between v1 calls (matches validatePokkenSlugs)

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!process.env.CHALLONGE_V1_KEY) {
  console.error('CHALLONGE_V1_KEY is not set in backend/.env — cannot validate via the v1 API.');
  process.exit(1);
}

if (!fs.existsSync(URLS_PATH)) {
  console.error(`thunderdome_urls.txt not found at ${URLS_PATH}`);
  console.error('Run harvest_joltaru_console.js in the browser first and paste the URLs in.');
  process.exit(1);
}

// ── Read candidate URLs ─────────────────────────────────────────────────────
const rawLines = fs.readFileSync(URLS_PATH, 'utf8').split('\n').map(l => l.trim());
const urls = rawLines.filter(l => l.startsWith('http'));

if (urls.length === 0) {
  console.error('No http URLs found in thunderdome_urls.txt (only comments/placeholder?).');
  console.error('Paste the harvested URLs in first, then re-run.');
  process.exit(1);
}

// Map URL -> slug, dedupe by slug (preserve first-seen order)
const seen = new Set();
const candidates = [];
for (const url of urls) {
  const slug = challonge.extractSlugFromUrl(url);
  if (!slug || seen.has(slug)) continue;
  seen.add(slug);
  candidates.push({ url: `https://challonge.com/${slug}`, slug });
}

// ── HTTP helper for the batch-import POST ───────────────────────────────────
function postJson(apiPath, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: API_HOST, port: API_PORT, path: apiPath, method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-admin-token':  ADMIN_TOKEN || '',
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Validate one slug against the Pokkén keyword/game check ─────────────────
async function classify(slug) {
  try {
    const data = await challonge.getTournament(slug);
    const meta = data?.tournament || data?.data?.attributes || data || {};
    const isPokken = challonge.looksLikePokkenTournament(meta);
    return {
      verdict: isPokken ? 'KEEP' : 'DROP',
      game: meta.game_name || '',
      name: meta.name || '',
      date: meta.started_at || meta.completed_at || null,
    };
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) return { verdict: 'DROP', game: '', name: '', date: null, note: '404 not found' };
    // Transient error — keep defensively (matches validatePokkenSlugs) but flag it.
    return { verdict: 'ERROR-KEEP', game: '', name: '', date: null, note: err.message };
  }
}

(async () => {
  console.log(`Validating ${candidates.length} candidate slug(s) against the Pokkén check…\n`);

  const rows = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const r = await classify(c.slug);
    rows.push({ ...c, ...r });
    const tag = r.verdict.padEnd(10);
    const date = r.date ? String(r.date).slice(0, 10) : '——';
    console.log(`  [${tag}] ${c.slug.padEnd(28)} ${date}  game="${r.game}"  name="${r.name}"${r.note ? `  (${r.note})` : ''}`);
    if (i < candidates.length - 1) await sleep(VALIDATE_DELAY_MS);
  }

  const kept    = rows.filter(r => r.verdict === 'KEEP' || r.verdict === 'ERROR-KEEP');
  const dropped = rows.filter(r => r.verdict === 'DROP');

  // Date-sort kept (undated to the tail) so import order keeps live ELO close.
  kept.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });

  console.log(`\n─── ${kept.length} kept, ${dropped.length} dropped ───`);

  // ── Rewrite thunderdome_urls.txt as the clean record ──────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  out.push(`# joltaru / Thunderdome — plain online Challonge tournaments, NO series.`);
  out.push(`# Validated ${today} via thunderdome_import.js (game/name matched the Pokkén check).`);
  out.push(`# ${kept.length} kept below. Import: node thunderdome_import.js --import  then  node recalculate_elo.js`);
  if (dropped.length) {
    out.push(`#`);
    out.push(`# Dropped as non-Pokkén (for the record — NOT imported):`);
    for (const d of dropped) out.push(`#   ${d.slug}  game="${d.game}"  name="${d.name}"${d.note ? `  (${d.note})` : ''}`);
  }
  out.push('');
  for (const k of kept) out.push(k.url);
  out.push('');
  fs.writeFileSync(URLS_PATH, out.join('\n'));
  console.log(`Rewrote ${path.basename(URLS_PATH)} with the ${kept.length} kept URL(s)` +
              `${dropped.length ? ` (+${dropped.length} dropped recorded as comments)` : ''}.`);

  if (rows.some(r => r.verdict === 'ERROR-KEEP')) {
    console.log('\n⚠️  Some slugs errored (not a clean 404) and were KEPT defensively. ' +
                'Re-run to retry, or check them manually before importing.');
  }
  if (dropped.length) {
    console.log('\nℹ️  If any DROPPED row is actually a real Pokkén event (e.g. an untagged ' +
                'bracket whose name has no Pokkén keyword), add its URL back to thunderdome_urls.txt ' +
                'by hand before importing — the keyword check only knows game_name + the name list.');
  }

  if (!DO_IMPORT) {
    console.log(`\nPreview only. Re-run with --import to POST the ${kept.length} kept URL(s) to the backend.`);
    return;
  }

  if (kept.length === 0) {
    console.log('\nNothing to import.');
    return;
  }

  if (!ADMIN_TOKEN) {
    console.error('\nADMIN_TOKEN is not set in backend/.env — the batch-import route is admin-gated. Aborting.');
    process.exit(1);
  }

  // Quick health check so a down backend gives a clear message, not a stack trace.
  console.log(`\nImporting ${kept.length} URL(s) via POST /api/tournaments/batch-import…`);
  const keptUrls = kept.map(k => k.url);
  const totals = { imported: 0, skipped: 0, errors: 0 };
  const failures = [];

  for (let i = 0; i < keptUrls.length; i += CHUNK_SIZE) {
    const chunk = keptUrls.slice(i, i + CHUNK_SIZE);
    try {
      const { status, body } = await postJson('/api/tournaments/batch-import', { urls: chunk });
      if (status !== 200) {
        console.log(`  HTTP ${status}: ${JSON.stringify(body).slice(0, 120)}`);
        totals.errors += chunk.length;
        continue;
      }
      const imp = body.imported || 0, skip = body.skipped || 0, errs = body.errors || 0;
      totals.imported += imp; totals.skipped += skip; totals.errors += errs;
      if (body.detail?.errors) failures.push(...body.detail.errors);
      console.log(`  chunk ${i / CHUNK_SIZE + 1}: ${imp} imported / ${skip} skipped / ${errs} errors`);
    } catch (err) {
      console.error(`  NETWORK ERROR: ${err.message}`);
      console.error('  Is the backend running on localhost:3001? (cd backend && npm run dev)');
      totals.errors += chunk.length;
    }
  }

  console.log('\n===========================================================');
  console.log('DONE');
  console.log(`    Imported : ${totals.imported}`);
  console.log(`    Skipped  : ${totals.skipped}   (already in DB)`);
  console.log(`    Errors   : ${totals.errors}`);
  if (failures.length) {
    console.log('\nFailed entries:');
    for (const f of failures) console.log(`    ${f.url || f.slug || f}: ${f.error || ''}`);
  }
  console.log('\nNext: node recalculate_elo.js   (perfect ELO replay + Pass-2 achievements)');
})().catch(err => { console.error('Unhandled error:', err); process.exit(1); });
