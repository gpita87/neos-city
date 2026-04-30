#!/usr/bin/env node
/**
 * backup_db.js - Logical backup of the Supabase Postgres DB via pg_dump.
 *
 * Usage (from neos-city directory):
 *   node backup_db.js                       # full backup (schema + data)
 *   node backup_db.js --schema-only         # only the schema dump
 *   node backup_db.js --data-only           # only the data dump
 *   node backup_db.js --keep N              # also prune to the N most recent dumps
 *
 * What it does:
 *   - Reads DATABASE_URL from backend/.env
 *   - Runs pg_dump twice: once schema-only, once data-only
 *   - Writes to neos-city/backups/<timestamp>/{schema,data}.sql + manifest.json
 *
 * Restore (against an empty Postgres):
 *   psql "$NEW_DB_URL" -f schema.sql
 *   psql "$NEW_DB_URL" -f data.sql
 *
 * Prereqs: PostgreSQL 17 client tools (pg_dump on PATH).
 *   Install on Windows:
 *     winget install PostgreSQL.PostgreSQL.17
 *   Then close and reopen PowerShell so pg_dump.exe is on PATH. The "Command
 *   Line Tools" component is the only piece you need; the server itself can
 *   stay disabled.
 *
 * Why not the Supabase CLI? Supabase CLI v2 runs pg_dump inside a Docker
 * container, which requires Docker Desktop. We bypass that by calling
 * pg_dump directly - same tool, fewer prerequisites.
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });

const fs              = require('fs');
const path            = require('path');
const { spawnSync, execSync } = require('child_process');

const ROOT       = __dirname;
const BACKUP_DIR = path.join(ROOT, 'backups');

// -------- arg parsing --------
const args       = process.argv.slice(2);
const schemaOnly = args.includes('--schema-only');
const dataOnly   = args.includes('--data-only');
const keepIdx    = args.indexOf('--keep');
const keepN      = keepIdx >= 0 ? parseInt(args[keepIdx + 1], 10) : null;

if (schemaOnly && dataOnly) {
  console.error('ERROR: --schema-only and --data-only are mutually exclusive.');
  process.exit(1);
}

// -------- preflight: DATABASE_URL --------
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('ERROR: DATABASE_URL is not set in backend/.env');
  process.exit(1);
}

// -------- preflight: locate pg_dump --------
function findPgDump() {
  // Try PATH
  try {
    const cmd = process.platform === 'win32' ? 'where pg_dump' : 'which pg_dump';
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (out) return out.split(/\r?\n/)[0]; // first hit on PATH
  } catch { /* not on PATH; fall through */ }

  // Common Windows install locations (newest version first)
  if (process.platform === 'win32') {
    for (let v = 17; v >= 13; v--) {
      const candidate = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

const pgDump = findPgDump();
if (!pgDump) {
  console.error('ERROR: pg_dump not found.');
  console.error('');
  console.error('Install PostgreSQL 17 client tools on Windows:');
  console.error('  winget install PostgreSQL.PostgreSQL.17');
  console.error('Then close and reopen PowerShell so the new PATH is picked up.');
  console.error('');
  console.error('Or download the installer from https://www.postgresql.org/download/windows/');
  console.error('You only need the "Command Line Tools" component - the server can stay');
  console.error('disabled.');
  process.exit(1);
}

console.log(`Using pg_dump at: ${pgDump}`);

// -------- preflight: pg_dump version >= server version (warn only) --------
try {
  const ver = execSync(`"${pgDump}" --version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  console.log(`Detected: ${ver}`);
  const m = ver.match(/(\d+)\.(\d+)/);
  if (m && parseInt(m[1], 10) < 17) {
    console.warn('');
    console.warn(`WARNING: pg_dump major version is ${m[1]}, but Supabase runs Postgres 17.`);
    console.warn('         pg_dump must be >= server version.');
    console.warn('         If you see a server-version-mismatch error, install PG 17 client tools and retry.');
    console.warn('');
  }
} catch { /* version check is best-effort */ }

// -------- output folder --------
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const now   = new Date();
const pad   = n => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
              `_${pad(now.getHours())}${pad(now.getMinutes())}`;
const outDir = path.join(BACKUP_DIR, stamp);
fs.mkdirSync(outDir, { recursive: true });

console.log(`\n=== Neos City DB backup ===`);
console.log(`Output: ${outDir}\n`);

// -------- runner --------
function runDump(label, extraArgs, outFile) {
  const fullPath = path.join(outDir, outFile);
  console.log(`-- ${label} -> ${outFile}`);
  // pg_dump accepts the connection string as a positional arg.
  // --no-owner / --no-privileges -> dumps replay against any target DB.
  const dumpArgs = [
    '--no-owner',
    '--no-privileges',
    ...extraArgs,
    '-f', fullPath,
    dbUrl,
  ];
  const res = spawnSync(pgDump, dumpArgs, {
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: ROOT,
  });
  if (res.error) {
    console.error(`   FAILED to spawn pg_dump: ${res.error.message}`);
    return false;
  }
  if (res.status !== 0) {
    console.error(`   FAILED (exit ${res.status})`);
    return false;
  }
  try {
    const sz = fs.statSync(fullPath).size;
    if (sz === 0) {
      console.error(`   WARNING: ${outFile} is 0 bytes`);
      return false;
    }
    console.log(`   OK (${formatBytes(sz)})`);
  } catch (e) {
    console.error(`   WARNING: could not stat ${outFile}: ${e.message}`);
    return false;
  }
  return true;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// -------- run dumps --------
const results = [];

if (!dataOnly) {
  results.push(['schema', runDump('schema', ['--schema-only'], 'schema.sql')]);
}
if (!schemaOnly) {
  results.push(['data', runDump('data', ['--data-only', '--column-inserts'], 'data.sql')]);
}

// -------- manifest --------
const manifest = {
  created_at: now.toISOString(),
  database_host: (() => { try { return new URL(dbUrl).host; } catch { return 'unknown'; } })(),
  pg_dump_path: pgDump,
  results: Object.fromEntries(results),
  notes: 'Restore order: schema -> data. Use psql -f for each.',
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// -------- prune --------
if (Number.isFinite(keepN) && keepN > 0) {
  const folders = fs.readdirSync(BACKUP_DIR)
    .map(name => ({ name, full: path.join(BACKUP_DIR, name) }))
    .filter(f => fs.statSync(f.full).isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const f of folders.slice(keepN)) {
    fs.rmSync(f.full, { recursive: true, force: true });
    console.log(`-- pruned old backup: ${f.name}`);
  }
}

// -------- summary --------
const failed = results.filter(([, ok]) => !ok).map(([name]) => name);
console.log('\n=== Summary ===');
for (const [name, ok] of results) {
  console.log(`  ${ok ? 'OK   ' : 'FAIL '} ${name}`);
}
if (failed.length === 0) {
  console.log(`\nBackup complete -> ${outDir}`);
  process.exit(0);
} else {
  console.error(`\nBackup INCOMPLETE - failed: ${failed.join(', ')}`);
  console.error(`Partial output is in ${outDir}`);
  process.exit(1);
}
