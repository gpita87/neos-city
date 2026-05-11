#!/usr/bin/env node
// Inline ADMIN_TOKEN from backend/.env into a console script and copy the
// populated text to the Windows clipboard. Then paste into DevTools with Ctrl+V.
//
// Usage:
//   node prep_console.js tonamel_import_console.js
//   node prep_console.js liquipedia_import_console.js
//   node prep_console.js harvest_console.js
//   node prep_console.js batch_import_console.js
//
// Flags:
//   --print   Print to stdout instead of copying. Useful when running under WSL
//             or any environment where clip.exe isn't on PATH.

require('dotenv').config({ path: 'backend/.env' });

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const PRINT = args.includes('--print');
const target = args.find(a => !a.startsWith('--'));

if (!target) {
  console.error('Usage: node prep_console.js <script-name> [--print]');
  process.exit(1);
}

const token = process.env.ADMIN_TOKEN;
if (!token) {
  console.error('ADMIN_TOKEN not set in backend/.env');
  process.exit(1);
}

const filePath = path.resolve(target);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const src = fs.readFileSync(filePath, 'utf8');
const populated = src.replace(
  /const\s+ADMIN_TOKEN\s*=\s*(['"])\s*\1\s*;/,
  `const ADMIN_TOKEN = '${token}';`
);

if (populated === src) {
  console.error(`No empty \`const ADMIN_TOKEN = '';\` declaration found in ${target}`);
  console.error('Either it already has a value, or it uses a different pattern.');
  process.exit(1);
}

if (PRINT) {
  process.stdout.write(populated);
  process.exit(0);
}

const clip = spawnSync('clip', [], { input: populated });
if (clip.status !== 0) {
  console.error('clip.exe failed. Re-run with --print to dump to stdout.');
  if (clip.stderr) console.error(clip.stderr.toString());
  process.exit(1);
}

console.log(`✅ Copied ${path.basename(target)} to clipboard with ADMIN_TOKEN inlined.`);
console.log(`   Paste into DevTools console (Ctrl+V) and press Enter.`);
