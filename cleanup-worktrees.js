#!/usr/bin/env node
/**
 * cleanup-worktrees.js — sweep merged .claude/worktrees/ directories and their branches.
 *
 * Usage:
 *   node cleanup-worktrees.js              # dry-run: list what would be removed
 *   node cleanup-worktrees.js --apply      # actually remove them
 *   node cleanup-worktrees.js --all        # also consider unmerged worktrees (still dry-run unless --apply)
 *
 * What it does:
 *   1. Lists every git worktree under .claude/worktrees/ (harness-spawned sandboxes).
 *      Skips the current worktree, neos-city-worktrees/* (those use merge-worktree.js),
 *      and the main worktree itself.
 *   2. For each, checks whether the branch's commits are all reachable from main
 *      (`git log <branch> ^main` is empty → fully merged).
 *   3. In --apply mode: runs `git worktree remove --force` then `git branch -D`.
 *      Failures from OS file locks (a Claude Code session is still open in that
 *      directory) are reported per-line, not fatal — the script continues with
 *      the rest.
 *   4. Runs `git worktree prune` at the end to sweep admin records for any
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

if (args.some(a => a.startsWith('-') && a !== '--apply' && a !== '--all')) {
  die(`Unknown flag in: ${args.join(' ')}\nUsage: node cleanup-worktrees.js [--apply] [--all]`);
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

// ---- classify: merged vs unmerged ----

function unmergedCount(branch) {
  // `git log <branch> ^main` lists commits in branch but NOT in main.
  // Empty output → branch is fully reachable from main.
  const out = tryCapture(`git log --oneline ${branch} ^main`);
  if (out === null) return null;             // branch missing or other error
  if (out === '') return 0;
  return out.split('\n').length;
}

const rows = candidates.map(wt => {
  const branch = wt.branch || null;
  let status, ahead = null;
  if (wt.locked) {
    status = 'locked';
  } else if (!branch) {
    status = 'detached';
  } else {
    ahead = unmergedCount(branch);
    if (ahead === null) status = 'no-branch';
    else if (ahead === 0) status = 'merged';
    else status = `${ahead}-ahead`;
  }
  return { ...wt, status, ahead };
});

// ---- report ----

const merged = rows.filter(r => r.status === 'merged');
const unmerged = rows.filter(r => r.status !== 'merged');

console.log(`\n.claude/worktrees/ candidates: ${rows.length}`);
console.log(`  Merged into main:  ${merged.length}`);
console.log(`  NOT merged:        ${unmerged.length}\n`);

const dirCol = Math.max(...rows.map(r => path.basename(r.path).length));
for (const r of rows) {
  const dir = path.basename(r.path).padEnd(dirCol);
  const action = (r.status === 'merged' || all) ? '✓ remove' : '  skip  ';
  const tag = r.status.padEnd(10);
  const branchTag = r.branch ? `[${r.branch}]` : '[detached]';
  console.log(`  ${tag}  ${action}  ${dir}  ${branchTag}`);
}

const targets = all ? rows : merged;

if (targets.length === 0) {
  console.log('\nNothing to clean.');
  process.exit(0);
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to remove ${targets.length} worktree(s).`);
  if (!all && unmerged.length > 0) {
    console.log(`Pass --all to also consider the ${unmerged.length} unmerged worktree(s) (use with care — branches with unique commits get deleted too).`);
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
