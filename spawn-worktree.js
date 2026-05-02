#!/usr/bin/env node
/**
 * spawn-worktree.js — create an isolated worktree for an agent to work in.
 *
 * Usage:
 *   node spawn-worktree.js <agent-name> [base-branch]
 *
 * What it does:
 *   1. Creates a new branch `agent/<agent-name>` off [base-branch] (default: main).
 *   2. Adds a sibling worktree at C:\Users\pitag\Documents\neos-city-worktrees\<agent-name>.
 *   3. Drops WORKTREE_SUMMARY.md inside the worktree (template the agent fills in).
 *   4. Runs `npm install` in /, /backend, and /frontend so the worktree is runnable.
 *   5. Prints the absolute path to mount in a new Cowork session.
 *
 * See AGENT_CONTEXT.md "Multi-agent worktree workflow" for the full convention.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname);
const WORKTREES_PARENT = path.resolve(REPO_ROOT, '..', 'neos-city-worktrees');

function die(msg, code = 1) {
  console.error('\nError:', msg);
  process.exit(code);
}

function run(cmd, cwd) {
  console.log(`> ${cmd}${cwd && cwd !== REPO_ROOT ? `   (in ${cwd})` : ''}`);
  execSync(cmd, { stdio: 'inherit', cwd: cwd || REPO_ROOT });
}

function runCapture(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || REPO_ROOT, encoding: 'utf8' }).trim();
}

function tryCapture(cmd, cwd) {
  try { return runCapture(cmd, cwd); } catch (_) { return null; }
}

// ---- arg parsing ----

const agentName = process.argv[2];
const baseBranch = process.argv[3] || 'main';

if (!agentName) die('Usage: node spawn-worktree.js <agent-name> [base-branch]');
if (!/^[a-z0-9][a-z0-9-]*$/i.test(agentName)) {
  die(`agent-name must be alphanumeric or dashes only (got: ${agentName})`);
}

// ---- preflight checks ----

// .git must be a directory here — i.e. we're in the MAIN worktree, not in a sub-worktree.
const dotGit = path.join(REPO_ROOT, '.git');
if (!fs.existsSync(dotGit)) die(`No .git at ${REPO_ROOT}. Is this the project root?`);
if (!fs.statSync(dotGit).isDirectory()) {
  die(`spawn-worktree.js must run from the MAIN worktree. ${REPO_ROOT} looks like a linked worktree (.git is a file).`);
}

// Base branch must exist.
if (!tryCapture(`git rev-parse --verify ${baseBranch}`)) {
  die(`Base branch '${baseBranch}' does not exist. Run 'git fetch' or pick a different branch.`);
}

// Branch must not already exist.
if (tryCapture(`git branch --list ${`agent/${agentName}`}`)) {
  die(`Branch 'agent/${agentName}' already exists. Pick a different agent name or delete it first.`);
}

// Worktree path must not exist.
const worktreePath = path.join(WORKTREES_PARENT, agentName);
if (fs.existsSync(worktreePath)) {
  die(`Path already exists: ${worktreePath}`);
}

// Warn (don't fail) if main has uncommitted changes — the new worktree branches
// from the last commit, not the in-progress state.
const mainDirty = runCapture('git status --porcelain');
if (mainDirty) {
  console.warn('\n⚠️  Main worktree has uncommitted changes:');
  console.warn(mainDirty.split('\n').slice(0, 10).map(l => '   ' + l).join('\n'));
  console.warn(`   ...\n`);
  console.warn(`The new worktree branches from the LAST COMMIT of ${baseBranch}, not your current state.`);
  console.warn(`If the agent needs your in-progress changes, commit (or stash + apply in the worktree) first.\n`);
}

// ---- create worktree ----

const branchName = `agent/${agentName}`;

fs.mkdirSync(WORKTREES_PARENT, { recursive: true });

console.log(`\nCreating worktree '${branchName}' at ${worktreePath}...`);
run(`git worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`);

// ---- write WORKTREE_SUMMARY.md template ----

const summary = `# Worktree Summary — ${agentName}

**Branch:** \`${branchName}\`
**Base:** \`${baseBranch}\`
**Worktree path:** \`${worktreePath}\`
**Created:** ${new Date().toISOString()}

> Agent: keep this file current as you work. Gabriel reads it before merging.
> See \`AGENT_CONTEXT.md\` → "Multi-agent worktree workflow" for the rules.

## Goal

(What this worktree was spawned to do.)

## Changes

(Files changed and the high-level reason for each.)

## How to verify

(Commands to run, UI spots to check, queries to spot-check, etc.)

## Known gaps / follow-ups

(Anything left undone. Things Gabriel should test against the live DB before merging.)

## Merge command

\`\`\`powershell
cd C:\\Users\\pitag\\Documents\\neos-city
node merge-worktree.js ${agentName}
\`\`\`
`;
fs.writeFileSync(path.join(worktreePath, 'WORKTREE_SUMMARY.md'), summary, 'utf8');
console.log(`Wrote WORKTREE_SUMMARY.md template.`);

// ---- npm install in /, /backend, /frontend ----

const installTargets = [worktreePath, path.join(worktreePath, 'backend'), path.join(worktreePath, 'frontend')];
for (const target of installTargets) {
  if (!fs.existsSync(path.join(target, 'package.json'))) continue;
  console.log(`\nInstalling dependencies in ${target}...`);
  try {
    run('npm install --no-audit --no-fund', target);
  } catch (e) {
    console.warn(`\n⚠️  npm install failed in ${target}. Worktree exists but is half-built.`);
    console.warn(`   Re-run manually:  cd "${target}" && npm install`);
  }
}

// ---- done ----

console.log(`\n✅ Worktree ready.`);
console.log(`\nMount this folder in a new Cowork session:`);
console.log(`   ${worktreePath}`);
console.log(`\nWhen the agent is done:`);
console.log(`   node merge-worktree.js ${agentName}`);
console.log();
