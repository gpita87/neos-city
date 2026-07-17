#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — Participation harvest runner
// Run from the neos-city directory:  node harvest_participation.js
//
// One command for the "locals discovery" scan (see harvest_participation_console.js):
//   1. Verify the backend is reachable (the console script POSTs to it).
//   2. Inline ADMIN_TOKEN into harvest_participation_console.js and copy the
//      populated script to the clipboard (delegates to prep_console.js so we
//      share its UTF-16LE+BOM write — box-drawing chars otherwise paste as
//      mojibake).
//   3. Print the challonge.com page to open, on its own line so Windows
//      Terminal auto-links it.
//
// Then: open the link, F12 → Console → paste (Ctrl+V) → Enter. New Pokkén
// "locals" get written to flagged_locals.txt for review.
//
// The USERNAMES list lives inside harvest_participation_console.js. Refresh the
// DCM roster there with `node dcm_player_profiles.js` before running this.
// ===========================================================================

const http              = require('http');
const path              = require('path');
const { spawnSync }     = require('child_process');

const API_HOST   = 'localhost';
const API_PORT   = 3001;
const ROOT       = __dirname;
const SCRIPT     = 'harvest_participation_console.js';
const TARGET_URL = 'https://challonge.com/tournaments';

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

(async () => {
  console.log('\nNEOS CITY — Participation harvest\n');

  // 1. Backend health — warn only. The clipboard step still works if it's down,
  //    but the pasted script will fail its POSTs until the backend is up.
  const ok = await checkBackend();
  if (ok) {
    console.log('  Backend is up.');
  } else {
    console.warn(`  ⚠ Backend NOT reachable at http://${API_HOST}:${API_PORT}/api/health`);
    console.warn('    The pasted script POSTs there — start it first:  cd backend; npm run dev');
  }

  // 2. Inline token + copy to clipboard via prep_console.js.
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'prep_console.js'), SCRIPT],
    { cwd: ROOT, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`\n  prep_console.js failed; open ${path.join(ROOT, SCRIPT)} and copy it manually.`);
    process.exit(1);
  }

  // 3. Print the link for easy access (own line → auto-linked in the terminal).
  console.log('\n  Open this page in Chrome, then F12 → Console → paste (Ctrl+V) → Enter:');
  console.log(`  ${TARGET_URL}`);
  console.log('\n  Results land in flagged_locals.txt for review.\n');
})().catch(err => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
