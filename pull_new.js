#!/usr/bin/env node
// ===========================================================================
// NEOS CITY - One-shot tournament import orchestrator
// Run from the neos-city directory:  node pull_new.js
//
// Replaces the multi-step manual import workflow with a single command:
//   1. Verify the backend is reachable.
//   2. Optionally refresh harvested_tournaments.txt via harvest_new.js.
//   3. Run batch_import.js (Challonge + start.gg, date-sorted).
//   4. Prompt for any browser-console steps the user still needs to do
//      (Tonamel and Liquipedia brackets - those need a real Chrome session).
//   5. Run recalculate_elo.js so Pass-2 achievements and full ELO are correct.
//   6. Run check_import_status.js for a final sanity check.
//   7. Run backup_db.js for a logical Supabase dump under neos-city/backups/.
// ===========================================================================

const http        = require('http');
const path        = require('path');
const fs          = require('fs');
const readline    = require('readline');
const { spawn }   = require('child_process');

const API_HOST = 'localhost';
const API_PORT = 3001;
const ROOT     = __dirname;

// Read ADMIN_TOKEN from backend/.env without pulling in dotenv. Returns null
// if the file is absent or the line isn't there.
function readAdminToken() {
  const envPath = path.join(ROOT, 'backend', '.env');
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^\s*ADMIN_TOKEN\s*=\s*['"]?([^'"\r\n]+?)['"]?\s*$/m);
  return match ? match[1] : null;
}

// Pipe text to the Windows clipboard via `clip`. Rejects with a useful error
// on non-Windows platforms so the caller can fall back to a manual-copy hint.
function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error(`clipboard copy not implemented for ${process.platform}`));
      return;
    }
    const proc = spawn('clip');
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`clip exited with code ${code}`));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

// Offer to copy a browser-console import script to clipboard, with the
// ADMIN_TOKEN line pre-filled from backend/.env, and print the target URL
// (rendered on its own line so Windows Terminal auto-links it).
async function offerConsoleImport({ label, script, targetUrl, blurb }) {
  console.log(`\n  ${label} - ${blurb}`);
  const ans = await ask(`  Import new ${label} events now? (Y/n): `);
  if (ans === 'n' || ans === 'no' || ans === 'skip') {
    console.log(`  Skipping ${label}.`);
    return;
  }

  const scriptPath = path.join(ROOT, script);
  let content;
  try {
    content = fs.readFileSync(scriptPath, 'utf8');
  } catch (err) {
    console.error(`  Could not read ${script}: ${err.message}`);
    return;
  }

  const token = readAdminToken();
  if (token) {
    content = content.replace(
      /^(const ADMIN_TOKEN\s*=\s*)['"]['"]\s*;?\s*$/m,
      (_, prefix) => `${prefix}${JSON.stringify(token)};`
    );
  }

  try {
    await copyToClipboard(content);
    const tokenNote = token ? ' (with ADMIN_TOKEN pre-filled)' : ' (ADMIN_TOKEN not found in backend/.env — set it manually before running)';
    console.log(`  Copied ${script} to clipboard${tokenNote}.`);
  } catch (err) {
    console.error(`  Could not copy to clipboard: ${err.message}`);
    console.log(`  Open ${scriptPath} manually and copy its contents.`);
  }

  console.log(`\n  Open this page in Chrome, then F12 -> Console -> paste -> Enter:`);
  console.log(`  ${targetUrl}\n`);
  await ask(`  Press Enter when the ${label} import is finished: `);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function checkBackend() {
  return new Promise(resolve => {
    const req = http.get(
      { hostname: API_HOST, port: API_PORT, path: '/api/health', timeout: 3000 },
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve(res.statusCode === 200));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ROOT, scriptName);
    console.log(`\n--- Running ${scriptName} ---`);
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited with code ${code}`));
    });
  });
}

function banner(title) {
  const bar = '='.repeat(Math.max(60, title.length + 4));
  console.log(`\n${bar}\n  ${title}\n${bar}`);
}

(async () => {
  banner('NEOS CITY - Pull New Tournament Info');

  // 1. Backend health check
  console.log('\nStep 1/7: Checking that the backend is running...');
  const ok = await checkBackend();
  if (!ok) {
    console.error(`\n  Backend is NOT reachable at http://${API_HOST}:${API_PORT}/api/health`);
    console.error('  Start it first:  cd backend; npm run dev');
    process.exit(1);
  }
  console.log('  Backend is up.');

  // 2. Optionally refresh harvested_tournaments.txt with new URLs from organizer pages
  console.log('\nStep 2/7: Refresh harvested_tournaments.txt');
  console.log('  - harvest_new.js     walks each Pokken organizer\'s Challonge profile');
  console.log('  - harvest_startgg.js queries start.gg for past Pokken (videogameId 447) tournaments');
  console.log('  Both append newly-discovered URLs to harvested_tournaments.txt.');
  const harvestAnswer = await ask('  Run both harvest scripts now? (Y/n): ');
  if (harvestAnswer === 'n' || harvestAnswer === 'no') {
    console.log('  Skipping harvest. Importing only URLs already in the file.');
  } else {
    try {
      await runScript('harvest_new.js');
    } catch (err) {
      console.error(`\n  harvest_new.js failed: ${err.message}`);
      const cont = await ask('  Continue with start.gg harvest + import? (Y/n): ');
      if (cont === 'n' || cont === 'no') process.exit(1);
    }
    try {
      await runScript('harvest_startgg.js');
    } catch (err) {
      console.error(`\n  harvest_startgg.js failed: ${err.message}`);
      const cont = await ask('  Continue with import using existing file? (Y/n): ');
      if (cont === 'n' || cont === 'no') process.exit(1);
    }
  }

  // 3. Run batch_import.js
  console.log('\nStep 3/7: Importing Challonge + start.gg URLs from harvested_tournaments.txt');
  console.log('          (URLs will be date-sorted via /preview-dates before import)');
  try {
    await runScript('batch_import.js');
  } catch (err) {
    console.error(`\n  batch_import.js failed: ${err.message}`);
    const cont = await ask('  Continue with the rest of the workflow anyway? (y/N): ');
    if (cont !== 'y' && cont !== 'yes') process.exit(1);
  }

  // 4. Browser-console steps (manual, not automatable from Node)
  console.log('\nStep 4/7: Browser-console imports (manual)');
  console.log('  These sources need a real Chrome tab to run their scrapers.');
  console.log('  For each one I can copy the script (with ADMIN_TOKEN pre-filled) to');
  console.log('  your clipboard and print the page to open.');

  await offerConsoleImport({
    label:    'Tonamel',
    script:   'tonamel_import_console.js',
    targetUrl: 'https://tonamel.com/organization/OhUc2?game=pokken',
    blurb:    'Imports ねずみ杯 / Mouse Cup / Rookies events. New JP players auto-tagged.',
  });

  await offerConsoleImport({
    label:    'Liquipedia',
    script:   'liquipedia_import_console.js',
    targetUrl: 'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament/Tournaments',
    blurb:    'Imports offline bracket data for events already created by offline_import.js.',
  });

  // 5. Full ELO + Pass-2 achievement recalculation
  console.log('\nStep 5/7: Recalculating ELO and re-running achievements');
  console.log('          (idempotent; this corrects ordering and runs Pass 2)');
  const recalcAnswer = await ask('  Run recalculate_elo.js now? (Y/n): ');
  if (recalcAnswer === 'n' || recalcAnswer === 'no') {
    console.log('  Skipping recalc. Remember: Pass-2 achievements stay stale until you run it.');
  } else {
    try {
      await runScript('recalculate_elo.js');
    } catch (err) {
      console.error(`\n  recalculate_elo.js failed: ${err.message}`);
    }
  }

  // 6. Status check
  console.log('\nStep 6/7: Sanity check');
  try {
    await runScript('check_import_status.js');
  } catch (err) {
    console.error(`\n  check_import_status.js failed: ${err.message}`);
  }

  // 7. DB backup (logical dump via Supabase CLI)
  console.log('\nStep 7/7: Database backup');
  console.log('  Writes a timestamped logical dump under neos-city/backups/.');
  console.log('  Uses pg_dump directly (requires PostgreSQL 17 client tools on PATH).');
  const backupAnswer = await ask('  Run backup_db.js now? (Y/n): ');
  if (backupAnswer === 'n' || backupAnswer === 'no') {
    console.log('  Skipping backup. You can run it later with:  node backup_db.js');
  } else {
    try {
      await runScript('backup_db.js');
    } catch (err) {
      console.error(`\n  backup_db.js failed: ${err.message}`);
      console.error('  Your import is fine - this is just the backup step.');
      console.error('  Re-run later with:  node backup_db.js');
    }
  }

  banner('DONE');
  console.log('\nReload http://localhost:5173 to see the new tournaments.');
  console.log('If anything looks off, the per-step output above is the place to start debugging.\n');
})().catch(err => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
