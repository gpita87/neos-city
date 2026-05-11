#!/usr/bin/env node
/**
 * cleanup-worktrees.js — sweep merged .claude/worktrees/ directories and their branches.
 *
 * Usage:
 *   node cleanup-worktrees.js              # dry-run: list what would be removed
 *   node cleanup-worktrees.js --apply      # actually remove them
 *   node cleanup-worktrees.js --strict     # only treat strict ancestors of main as safe
 *   node cleanup-worktrees.js --all        # also consider unmerged worktrees (use with care)
 *
 * What it does:
 *   1. Lists every git worktree under .claude/worktrees/ (harness-spawned sandboxes).
 *      Skips the current worktree, neos-city-worktrees/* (those use merge-worktree.js),
 *      and the main worktree itself.
 *   2. Classifies each branch:
 *        merged     — strict ancestor of main
 *        patch-eq   — every unique commit has a patch-equivalent on main
 *                     (cherry-picked or rebased onto main; via `git cherry`)
 *        same-tree  — tip's tree SHA equals main's (identical files)
 *        N-ahead    — N unique commits not in main (the real WIP bucket)
 *      Default safe-to-remove set: merged + patch-eq + same-tree.
 *      --strict narrows this to just `merged`.
 *   3. In dry-run, prints each N-ahead branch's unique commit subjects and
 *      its last-commit age, so you can eyeball what would be lost before
 *      deciding whether to --all-nuke it.
 *   4. In --apply mode: runs `git worktree remove --force` then `git branch -D`.
 *      Failures from OS file locks (a Claude Code session is still open in
 *      that directory) are reported per-line, not fatal — the script keeps
 *      going with the rest.
 *   5. Runs `git worktree prune` at the end to sweep admin records for any
 *      directories nuked outside of git.
 *
 * Why this exists:
 *   .claude/worktrees/ is ephemeral and gitignored — the Claude Code harness
 *   creates one per session. They accumulate quickly and most are already
 *   merged into main (or never had commits that mattered). This clears the
 *   dead ones in one pass.
 *
 * If a worktree won't delete because of an OS file lock, find the Claude Code
 * session whose CWD is that path, end it, and re-run with --apply.
 *
 * See AGENT_CONTEXT.md "Multi-agent worktree workflow" for context.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname);

function die(msg, code = 1) {
  console.error('\nError:', msg);
  process.exit(code);
}

function runCapture(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || REPO_ROOT, encoding: 'utf8' }).trim();
}

function tryCapture(cmd, cwd) {
  try { return runCapture(cmd, cwd); } catch (_) { return null; }
}

function tryRun(cmd, cwd) {
  try {
    execSync(cmd, { cwd: cwd || REPO_ROOT, stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    const stdout = e.stdout ? e.stdout.toString() : '';
    return { ok: false, error: (stderr || stdout || e.message).trim() };
  }
}

// ---- arg parsing ----

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const all = args.includes('--all');
const strict = args.includes('--strict');

const KNOWN_FLAGS = new Set(['--apply', '--all', '--strict']);
if (args.some(a => a.startsWith('-') && !KNOWN_FLAGS.has(a))) {
  die(`Unknown flag in: ${args.join(' ')}\nUsage: node cleanup-worktrees.js [--apply] [--strict] [--all]`);
}

// ---- preflight: must run from main worktree ----

const dotGit = path.join(REPO_ROOT, '.git');
if (!fs.existsSync(dotGit)) die(`No .git at ${REPO_ROOT}. Is this the project root?`);
if (!fs.statSync(dotGit).isDirectory()) {
  die(`cleanup-worktrees.js must run from the MAIN worktree. ${REPO_ROOT} looks like a linked worktree (.git is a file).`);
}

// ---- parse worktree list (--porcelain format) ----

function parseWorktrees() {
  const out = runCapture('git worktree list --porcelain');
  const blocks = out.split(/\n\n+/).filter(Boolean);
  const worktrees = [];
  for (const block of blocks) {
    const wt = {};
    for (const line of block.split('\n')) {
      if (!line) continue;
      const sp = line.indexOf(' ');
      const key = sp === -1 ? line : line.slice(0, sp);
      const val = sp === -1 ? '' : line.slice(sp + 1);
      if (key === 'worktree') wt.path = val;
      else if (key === 'HEAD') wt.head = val;
      else if (key === 'branch') wt.branch = val.replace(/^refs\/heads\//, '');
      else if (key === 'bare') wt.bare = true;
      else if (key === 'detached') wt.detached = true;
      else if (key === 'locked') wt.locked = true;
    }
    if (wt.path) worktrees.push(wt);
  }
  return worktrees;
}

const allWorktrees = parseWorktrees();

// ---- filter to .claude/worktrees/* candidates ----

const norm = p => path.resolve(p).replace(/\\/g, '/').toLowerCase();
const CLAUDE_PREFIX = norm(path.join(REPO_ROOT, '.claude', 'worktrees')) + '/';
const CWD_NORM = norm(process.cwd());
const REPO_NORM = norm(REPO_ROOT);

const candidates = allWorktrees.filter(wt => {
  if (wt.bare) return false;
  const wtNorm = norm(wt.path);
  if (wtNorm === REPO_NORM) return false;             // skip the main worktree
  if (wtNorm === CWD_NORM) return false;              // skip current
  return wtNorm.startsWith(CLAUDE_PREFIX);             // only .claude/worktrees/*
});

if (candidates.length === 0) {
  console.log('No .claude/worktrees/ candidates found.');
  process.exit(0);
}

// ---- classify ----

// NOTE on shell escaping: avoid `^` anywhere in command strings — on Windows,
// cmd.exe (used by execSync) eats `^` as its escape character. `--not <ref>`
// replaces `^<ref>`, and `%T` / `%ct` give us tree SHA / commit time without
// needing `<ref>^{tree}` syntax.

function unmergedCount(branch) {
  const out = tryCapture(`git rev-list --count ${branch} --not main`);
  if (out === null) return null;
  const n = parseInt(out, 10);
  return Number.isFinite(n) ? n : null;
}

function patchEquivalentToMain(branch) {
  // `git cherry main <branch>` prints one line per commit on <branch> not in main:
  //   `+ <sha>`  no patch-equivalent commit on main → unique work
  //   `- <sha>`  has patch-equivalent on main (cherry-picked or rebased)
  // All `-` lines → branch's content is fully represented on main.
  const out = tryCapture(`git cherry main ${branch}`);
  if (out === null) return null;
  if (out === '') return true;                       // no unique commits — also patch-equivalent
  return out.split('\n').every(l => l.startsWith('-'));
}

const MAIN_TREE = tryCapture(`git log -1 --format=%T main`);

function sameTreeAsMain(branch) {
  if (!MAIN_TREE) return null;
  const t = tryCapture(`git log -1 --format=%T ${branch}`);
  return t === null ? null : (t === MAIN_TREE);
}

function relAge(branch) {
  const out = tryCapture(`git log -1 --format=%ct ${branch}`);
  if (out === null) return null;
  const ts = parseInt(out, 10);
  if (!Number.isFinite(ts)) return null;
  const days = Math.floor((Date.now() / 1000 - ts) / 86400);
  if (days < 1) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function uniqueCommits(branch, max = 5) {
  // Tab-separated to avoid quoting `%h %s` for cmd.exe.
  const out = tryCapture(`git log --format=%h%x09%s ${branch} --not main`);
  if (!out) return { shown: [], more: 0 };
  const lines = out.split('\n');
  return {
    shown: lines.slice(0, max).map(l => l.replace('\t', '  ')),
    more: Math.max(0, lines.length - max),
  };
}

const rows = candidates.map(wt => {
  const branch = wt.branch || null;
  let status = null, ahead = null;
  if (wt.locked) {
    status = 'locked';
  } else if (!branch) {
    status = 'detached';
  } else {
    ahead = unmergedCount(branch);
    if (ahead === null) {
      status = 'no-branch';
    } else if (ahead === 0) {
      status = 'merged';
    } else if (!strict && patchEquivalentToMain(branch)) {
      status = 'patch-eq';
    } else if (!strict && sameTreeAsMain(branch)) {
      status = 'same-tree';
    } else {
      status = `${ahead}-ahead`;
    }
  }
  return { ...wt, status, ahead };
});

// ---- report ----

const SAFE_STATUSES = new Set(['merged', 'patch-eq', 'same-tree']);
const safe = rows.filter(r => SAFE_STATUSES.has(r.status));
const unsafe = rows.filter(r => !SAFE_STATUSES.has(r.status));

const counts = {};
for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

console.log(`\n.claude/worktrees/ candidates: ${rows.length}`);
console.log(`  Merged (strict ancestor):  ${counts.merged || 0}`);
if (!strict) {
  console.log(`  Patch-equivalent to main:  ${counts['patch-eq'] || 0}   (cherry-picked / rebased)`);
  console.log(`  Same tree as main:         ${counts['same-tree'] || 0}`);
}
console.log(`  Unique commits not on main:${' '.repeat(2)}${unsafe.length}\n`);

const dirCol = Math.max(...rows.map(r => path.basename(r.path).length));
for (const r of rows) {
  const dir = path.basename(r.path).padEnd(dirCol);
  const safeRow = SAFE_STATUSES.has(r.status);
  const action = (safeRow || all) ? '✓ remove' : '  skip  ';
  const tag = r.status.padEnd(10);
  const branchTag = r.branch ? `[${r.branch}]` : '[detached]';
  console.log(`  ${tag}  ${action}  ${dir}  ${branchTag}`);
}

// Show unique work for branches the user might want to inspect before deciding.
if (!apply && unsafe.length > 0) {
  console.log(`\nBranches with unique work (would NOT be removed by default):`);
  for (const r of unsafe) {
    const dir = path.basename(r.path);
    const age = r.branch ? relAge(r.branch) : null;
    const meta = [r.status, age].filter(Boolean).join(', ');
    console.log(`\n  ${dir}  [${meta}]`);
    if (r.branch) {
      const { shown, more } = uniqueCommits(r.branch);
      for (const line of shown) console.log(`    + ${line}`);
      if (more > 0) console.log(`    + ... and ${more} more`);
    }
  }
}

const targets = all ? rows : safe;

if (targets.length === 0) {
  console.log('\nNothing to clean.');
  process.exit(0);
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to remove ${targets.length} worktree(s).`);
  if (!all && unsafe.length > 0) {
    console.log(`Pass --all to also remove the ${unsafe.length} branch(es) with unique commits (those commits get deleted with the branch).`);
  }
  process.exit(0);
}

// ---- apply ----

console.log(`\nRemoving ${targets.length} worktree(s)...\n`);

const failed = [];
const removed = [];

for (const r of targets) {
  const dir = path.basename(r.path);
  const wtRes = tryRun(`git worktree remove "${r.path}" --force`);
  if (!wtRes.ok) {
    const looksLikeLock = /in use|locked|access is denied|busy|cannot|permission denied|being used by another process/i.test(wtRes.error);
    const note = looksLikeLock ? 'IN USE (Claude session still open?)' : 'remove failed';
    console.log(`  ✗  ${dir}  — ${note}`);
    if (process.env.DEBUG) console.log(`     ${wtRes.error.split('\n')[0]}`);
    failed.push({ dir, error: wtRes.error });
    continue;
  }
  if (r.branch) {
    const brRes = tryRun(`git branch -D ${r.branch}`);
    if (!brRes.ok) {
      console.log(`  ~  ${dir}  — worktree removed, branch ${r.branch} kept (${brRes.error.split('\n')[0]})`);
    } else {
      console.log(`  ✓  ${dir}  — worktree + branch ${r.branch} removed`);
    }
  } else {
    console.log(`  ✓  ${dir}  — worktree removed (was detached)`);
  }
  removed.push(dir);
}

console.log('\nRunning git worktree prune...');
tryRun('git worktree prune');

console.log(`\nDone. Removed: ${removed.length}. Failed: ${failed.length}.`);
if (failed.length > 0) {
  console.log(`\nTo retry failed entries:`);
  console.log(`  1. Find the Claude Code session whose CWD is the worktree (check open terminals).`);
  console.log(`  2. End that session.`);
  console.log(`  3. Re-run:  node cleanup-worktrees.js --apply`);
  console.log(`\nRun with DEBUG=1 to see the raw error from git:`);
  console.log(`  DEBUG=1 node cleanup-worktrees.js --apply       (bash)`);
  console.log(`  $env:DEBUG=1; node cleanup-worktrees.js --apply (PowerShell)`);
}
