#!/usr/bin/env node
// ===========================================================================
// NEOS CITY - Batch Import Script
// Run from the neos-city directory:  node batch_import.js
//
// Reads harvested_tournaments.txt, asks the backend to look up each
// tournament's date, then imports them in chronological order. Within a
// chronologically sorted run, consecutive URLs from the same source are
// grouped into chunks and posted to the matching batch endpoint:
//
//   Challonge : POST /api/tournaments/batch-import
//   start.gg  : POST /api/tournaments/batch-import-startgg
//
// Sorting by date keeps live ELO close to correct without requiring a full
// `node recalculate_elo.js` afterwards. URLs the backend can't date are
// pushed to the end and imported last in file order.
// ===========================================================================

const fs   = require('fs');
const http = require('http');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const API_HOST    = 'localhost';
const API_PORT    = 3001;
const CHUNK_SIZE  = 50;
const DELAY_MS    = 1500;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.error('ADMIN_TOKEN is not set. Add it to backend/.env (see .env.example).');
  process.exit(1);
}

// Read URLs from harvested_tournaments.txt
const txtPath = path.join(__dirname, 'harvested_tournaments.txt');
if (!fs.existsSync(txtPath)) {
  console.error('harvested_tournaments.txt not found in', __dirname);
  process.exit(1);
}

const allUrls = fs.readFileSync(txtPath, 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.startsWith('http'));

console.log(`Found ${allUrls.length} URLs total\n`);

// HTTP helper
function postJson(apiPath, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: API_HOST,
      port:     API_PORT,
      path:     apiPath,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-admin-token':  ADMIN_TOKEN,
      },
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectSource(url) {
  return url.includes('start.gg') ? 'startgg' : 'challonge';
}

// Sort URLs by date via the preview-dates endpoint
async function sortUrlsByDate(urls) {
  console.log(`Looking up dates for ${urls.length} URLs via /preview-dates...`);

  const PROBE_CHUNK = 100;
  const annotated = [];

  for (let i = 0; i < urls.length; i += PROBE_CHUNK) {
    const slice = urls.slice(i, i + PROBE_CHUNK);
    const range = `${i + 1}-${Math.min(i + PROBE_CHUNK, urls.length)}`;
    process.stdout.write(`   Probing ${range} of ${urls.length}... `);
    try {
      const { status, body } = await postJson('/api/tournaments/preview-dates', { urls: slice });
      if (status !== 200) {
        console.log(`HTTP ${status} - falling back to file order for this slice`);
        for (const url of slice) annotated.push({ url, date: null, source: detectSource(url) });
        continue;
      }
      console.log(`OK (${body.count} dated)`);
      for (const r of body.results) annotated.push(r);
    } catch (err) {
      console.log(`NETWORK ERROR: ${err.message} - falling back to file order for this slice`);
      for (const url of slice) annotated.push({ url, date: null, source: detectSource(url) });
    }
  }

  const dated   = annotated.filter(r => r.date);
  const undated = annotated.filter(r => !r.date);
  dated.sort((a, b) => new Date(a.date) - new Date(b.date));

  if (undated.length) {
    console.log(`   ${undated.length} URLs had no date - imported last in file order`);
  }

  return [...dated, ...undated];
}

// Build runs of consecutive same-source URLs
function groupSequentialBySource(sortedAnnotated) {
  const runs = [];
  let current = null;

  for (const item of sortedAnnotated) {
    const src = item.source || detectSource(item.url);
    if (!current || current.source !== src || current.urls.length >= CHUNK_SIZE) {
      current = { source: src, urls: [] };
      runs.push(current);
    }
    current.urls.push(item.url);
  }

  return runs;
}

// Send one run to its batch endpoint
async function sendRun(run, idx, totalRuns) {
  const apiPath = run.source === 'startgg'
    ? '/api/tournaments/batch-import-startgg'
    : '/api/tournaments/batch-import';

  const label = run.source === 'startgg' ? 'start.gg ' : 'Challonge';
  const preview = `${run.urls[0].split('/').pop()}...${run.urls[run.urls.length - 1].split('/').pop()}`;
  const tag = `Run ${String(idx + 1).padStart(2)}/${totalRuns}`;
  process.stdout.write(`   ${tag}  [${label}]  ${run.urls.length} URLs (${preview}) -> `);

  try {
    const { status, body } = await postJson(apiPath, { urls: run.urls });
    if (status !== 200) {
      console.log(`HTTP ${status}: ${JSON.stringify(body).slice(0, 80)}`);
      return { imported: 0, skipped: 0, errors: run.urls.length, failures: [] };
    }
    const imp  = body.imported  || 0;
    const skip = body.skipped   || 0;
    const errs = body.errors    || 0;
    const detail = body.detail?.errors || [];
    console.log(`${imp} imported / ${skip} skipped / ${errs} errors`);
    return { imported: imp, skipped: skip, errors: errs, failures: detail };
  } catch (err) {
    console.log(`NETWORK ERROR: ${err.message}`);
    return { imported: 0, skipped: 0, errors: run.urls.length, failures: [] };
  }
}

// Main
(async () => {
  if (allUrls.length === 0) {
    console.log('No URLs to process.');
    return;
  }

  const sorted = await sortUrlsByDate(allUrls);

  const firstDated = sorted.find(r => r.date);
  const lastDated  = [...sorted].reverse().find(r => r.date);
  if (firstDated && lastDated) {
    console.log(`\nImporting in chronological order: ${firstDated.date.slice(0, 10)} -> ${lastDated.date.slice(0, 10)}\n`);
  } else {
    console.log('\nNo URLs were dated - importing in file order.\n');
  }

  const runs = groupSequentialBySource(sorted);
  console.log(`${runs.length} runs queued (${sorted.length} URLs)\n`);

  const totals = { imported: 0, skipped: 0, errors: 0 };
  const failures = [];

  for (let i = 0; i < runs.length; i++) {
    const result = await sendRun(runs[i], i, runs.length);
    totals.imported += result.imported;
    totals.skipped  += result.skipped;
    totals.errors   += result.errors;
    failures.push(...result.failures);
    if (i < runs.length - 1) await delay(DELAY_MS);
  }

  console.log('\n===========================================================');
  console.log('DONE');
  console.log(`    Imported : ${totals.imported}`);
  console.log(`    Skipped  : ${totals.skipped}   (already in DB)`);
  console.log(`    Errors   : ${totals.errors}`);

  if (failures.length) {
    console.log('\nFailed entries:');
    for (const f of failures) {
      console.log(`    ${f.url || f.slug || f}: ${f.error || ''}`);
    }
  }

  console.log('\nImports were date-sorted, so ELO should be close to correct.');
  console.log('Run `node recalculate_elo.js` for a perfect rebuild + Pass-2 achievements.');
  console.log('\nReload http://localhost:5173 to see the results.');
})();
