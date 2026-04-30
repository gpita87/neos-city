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
const readline    = require('readline');
const { spawn }   = require('child_process');

const API_HOST = 'localhost';
const API_PORT = 3001;
const ROOT     = __dirname;

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
  console.log('  Walks each Pokken organizer\'s Challonge profile and appends any');
  console.log('  newly-discovered tournaments to harvested_tournaments.txt.');
  const harvestAnswer = await ask('  Run harvest_new.js now? (Y/n): ');
  if (harvestAnswer === 'n' || harvestAnswer === 'no') {
    console.log('  Skipping harvest. Importing only URLs already in the file.');
  } else {
    try {
      await runScript('harvest_new.js');
    } catch (err) {
      console.error(`\n  harvest_new.js failed: ${err.message}`);
      const cont = await ask('  Continue without a fresh harvest? (Y/n): ');
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
  console.log('  These sources need a real Chrome tab to run their scrapers:');
  console.log('    - Tonamel    -> tonamel_import_console.js   (paste in any Tonamel bracket page)');
  console.log('    - Liquipedia -> liquipedia_import_console.js (paste on any liquipedia.net page)');

  const tonamelAnswer = await ask('  Have you imported new Tonamel events this session? (y/n/skip): ');
  if (tonamelAnswer === 'n' || tonamelAnswer === 'no') {
    console.log('  Skipping Tonamel import. If you need new events later, see AGENT_CONTEXT.md.');
  } else if (tonamelAnswer === 'y' || tonamelAnswer === 'yes') {
    console.log('  Tonamel imports already done - new JP players auto-tagged via importOneTonamel().');
  }

  const liquipediaAnswer = await ask('  Have you imported new Liquipedia bracket data this session? (y/n/skip): ');
  if (liquipediaAnswer === 'n' || liquipediaAnswer === 'no') {
    console.log('  Skipping Liquipedia bracket import.');
  } else if (liquipediaAnswer === 'y' || liquipediaAnswer === 'yes') {
    console.log('  Liquipedia bracket data already imported.');
  }

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
