#!/usr/bin/env node
/**
 * merge-worktree.js — stage an agent worktree branch into main for IDE review.
 *
 * Usage:
 *   node merge-worktree.js <agent-name>
 *
 * What it does:
 *   1. Verifies both the main worktree and the agent worktree are clean.
 *   2. Prints WORKTREE_SUMMARY.md from the agent's worktree (it's gitignored,
 *      so it won't be part of the merge — purely informational).
 *   3. Shows `git diff --stat` between main and agent/<agent-name>, then offers full diff.
 *   4. On confirmation: runs `git merge --squash` so all changes appear STAGED
 *      in main for review in IntelliJ. Does NOT commit, does NOT remove the worktree,
 *      does NOT delete the branch — Gabriel does those after reviewing.
 *
 * Why squash + stop: lets you review the merge in your IDE Changes panel,
 * edit/amend if needed, and commit on your terms. The worktree stays around
 * until you confirm everything landed correctly, so you can re-inspect the
 * agent's branch state if the review surfaces a question.
 *
 * Run from the MAIN worktree:
 *   cd C:\Users\pitag\Documents\neos-city
 *   node merge-worktree.js <agent-name>
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname);
const WORKTREES_PARENT = path.resolve(REPO_ROOT, '..', 'neos-city-worktrees');

function die(msg, code = 1) {
  console.error('\nError:', msg);
  process.exit(code);
}

function run(cmd, cwd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: cwd || REPO_ROOT });
}

function runCapture(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || REPO_ROOT, encoding: 'utf8' }).trim();
}

function tryCapture(cmd, cwd) {
  try { return runCapture(cmd, cwd); } catch (_) { return null; }
}

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const agentName = process.argv[2];
  if (!agentName) die('Usage: node merge-worktree.js <agent-name>');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(agentName)) {
    die(`agent-name must be alphanumeric or dashes only (got: ${agentName})`);
  }

  const branchName = `agent/${agentName}`;
  const worktreePath = path.join(WORKTREES_PARENT, agentName);

  // Must run from main worktree.
  const dotGit = path.join(REPO_ROOT, '.git');
  if (!fs.existsSync(dotGit) || !fs.statSync(dotGit).isDirectory()) {
    die(`merge-worktree.js must run from the MAIN worktree (${REPO_ROOT}).`);
  }

  // Worktree and branch must exist.
  if (!fs.existsSync(worktreePath)) die(`No worktree at ${worktreePath}`);
  if (!tryCapture(`git rev-parse --verify ${branchName}`)) {
    die(`Branch '${branchName}' does not exist`);
  }

  // Both sides must be clean. (WORKTREE_SUMMARY.md is gitignored, so untracked
  // copies of it don't count as dirty — git status --porcelain skips them.)
  const agentDirty = runCapture('git status --porcelain', worktreePath);
  if (agentDirty) {
    console.error(`\nAgent worktree has uncommitted changes:`);
    console.error(agentDirty);
    die(`Have the agent commit (or discard) before merging.`);
  }
  const mainDirty = runCapture('git status --porcelain');
  if (mainDirty) {
    console.error(`\nMain worktree has uncommitted changes:`);
    console.error(mainDirty);
    die(`Commit, stash, or discard on main before merging.`);
  }

  // Show summary (informational — it's gitignored, won't enter the merge).
  const summaryPath = path.join(worktreePath, 'WORKTREE_SUMMARY.md');
  if (fs.existsSync(summaryPath)) {
    console.log('\n========== WORKTREE_SUMMARY.md ==========\n');
    console.log(fs.readFileSync(summaryPath, 'utf8'));
    console.log('========== end summary ==========\n');
  } else {
    console.log('\n(No WORKTREE_SUMMARY.md found — agent did not leave a writeup.)\n');
  }

  // Show diff stat.
  console.log(`\n========== diff --stat: main..${branchName} ==========\n`);
  try {
    run(`git diff --stat main..${branchName}`);
  } catch (e) {
    die('Could not produce diff. Aborting.');
  }

  // Refuse if no diff.
  const diffSize = runCapture(`git diff main..${branchName}`).length;
  if (diffSize === 0) {
    die(`No changes between main and ${branchName} — nothing to merge.`);
  }

  const wantFull = (await ask(`\nShow full diff? [y/N] `)).toLowerCase().startsWith('y');
  if (wantFull) run(`git --no-pager diff main..${branchName}`);

  const ok = (await ask(`\nStage ${branchName} into main for review? [y/N] `)).toLowerCase().startsWith('y');
  if (!ok) { console.log('Aborted.'); process.exit(0); }

  // Squash merge — applies all changes to main's index without committing.
  // If main has changes that conflict, git refuses cleanly.
  console.log();
  try {
    run(`git merge --squash ${branchName}`);
  } catch (e) {
    die(`git merge --squash failed. Resolve conflicts or run 'git reset --merge' to abandon.`);
  }

  console.log(`\n✅ Changes from ${branchName} are now STAGED in main for review.`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review in IntelliJ (Changes panel) or run 'git diff --cached' / 'git diff'.`);
  console.log(`  2. When happy, commit:    git commit -m "Merge ${branchName}"`);
  console.log(`  3. Push:                  git push`);
  console.log(`  4. Clean up the worktree and branch:`);
  console.log(`        git worktree remove "${worktreePath}" --force`);
  console.log(`        git branch -D ${branchName}`);
  console.log(`\nTo abandon the merge instead (un-stage everything):`);
  console.log(`        git reset --hard HEAD`);
  console.log(`     (the agent worktree and branch will still be there to retry)\n`);
}

main().catch(err => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
