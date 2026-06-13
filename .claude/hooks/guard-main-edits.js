#!/usr/bin/env node
/*
 * PreToolUse guard: prompt before any Write/Edit/NotebookEdit that targets the
 * MAIN checkout directly.
 *
 * Why this exists: agents kept editing files in the main working tree, which
 * leaves uncommitted changes that block `git cherry-pick`. The supported flow
 * is to edit inside a worktree and land changes on main only on request. This
 * hook makes "edit main" an explicit, approve-per-edit action instead of the
 * silent default.
 *
 * Behavior:
 *   - Target file is inside the main checkout (and NOT a worktree)  -> ask
 *   - Target file is inside a worktree, or anywhere else            -> allow silently
 *
 * "ask" surfaces a permission prompt to Gabriel. The default response is to
 * back out and redirect the work into a worktree — approve a main edit ONLY
 * when Gabriel raised main first this session and asked for it to land now.
 *
 * Detection is purely path-based and tied to this machine's layout:
 *   MAIN       = C:\Users\pitag\Documents\neos-city
 *   harness wt = C:\Users\pitag\Documents\neos-city\.claude\worktrees\<slug>\   (excluded)
 *   spawn   wt = C:\Users\pitag\Documents\neos-city-worktrees\<name>\           (sibling, never matches MAIN)
 */

const MAIN = 'c:/users/pitag/documents/neos-city';
const HARNESS_WORKTREES = MAIN + '/.claude/worktrees/';

function norm(p) {
  if (!p) return '';
  let s = String(p).replace(/\\/g, '/').toLowerCase();
  // git-bash style //c/users/... -> c:/users/...
  s = s.replace(/^\/\/([a-z])\//, '$1:/');
  // msys style /c/users/... -> c:/users/...
  s = s.replace(/^\/([a-z])\//, '$1:/');
  return s;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch (_) { /* malformed -> allow, fail open */ }

  const ti = data.tool_input || {};
  const target = norm(ti.file_path || ti.notebook_path || ti.path || '');

  // A worktree at neos-city-worktrees/<name> normalizes to a path that starts
  // with `${MAIN}-worktrees/`, which does NOT start with `${MAIN}/`, so it is
  // correctly treated as "not main".
  const inMain =
    target.startsWith(MAIN + '/') && !target.startsWith(HARNESS_WORKTREES);

  if (inMain) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          'This edits the MAIN checkout (' + (ti.file_path || ti.notebook_path || ti.path) +
          ') directly. Default is to work in a worktree (see AGENT_CONTEXT.md). ' +
          'Agent: do NOT ask to approve this — back out and redirect the work ' +
          'into a worktree (node spawn-worktree.js <name>, or commit in the ' +
          'harness worktree and hand off a cherry-pick). Approve ONLY if Gabriel ' +
          'raised main first this session and asked for the change to land now.'
      }
    }));
  }
  // Non-main targets: emit nothing + exit 0 -> normal permission flow.
  process.exit(0);
});
