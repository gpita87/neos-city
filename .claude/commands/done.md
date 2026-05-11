---
description: Wrap up a .claude/worktrees/ session — spawn a detached background cleaner that deletes this worktree directory once OS locks release.
---

When the user invokes `/done`, follow these steps. The user has already confirmed that any commits they care about are taken care of — do not commit, push, or merge anything yourself.

## 1. Verify we are inside a harness worktree.

Run `git rev-parse --show-toplevel`. The result must contain `.claude/worktrees/` (or `.claude\worktrees\` — git outputs forward slashes on Windows but either matches).

If it does NOT, reply with exactly this and stop:

> `/done` only runs inside a `.claude/worktrees/<slug>/` worktree — the current directory is not one. Aborting.

## 2. Spawn the detached cleaner.

Run this PowerShell command exactly (single tool call, no modifications):

```powershell
$wt = (git rev-parse --show-toplevel) -replace '/','\'
$cmd = '& { for ($i=0; $i -lt 60; $i++) { Start-Sleep -Seconds 5; if (-not (Test-Path -LiteralPath "WT_PATH")) { exit 0 }; try { Remove-Item -LiteralPath "WT_PATH" -Recurse -Force -ErrorAction Stop; exit 0 } catch {} } }'.Replace('WT_PATH', $wt)
Start-Process powershell -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command', $cmd -WindowStyle Hidden
Write-Output "spawned cleaner for $wt"
```

This launches a hidden detached `powershell.exe` that polls every 5 seconds for up to 5 minutes, removing the worktree directory the moment Windows releases the CWD/handle lock. The detached process survives this CC session's exit.

## 3. Reply with a single confirmation message.

Capture the worktree directory's basename (the slug after `.claude/worktrees/`) and report:

> Detached cleaner spawned. Close this session whenever — the directory will self-delete within ~5–30 seconds after CC exits. The branch `claude/<slug>` is preserved in `.git`; merge or cherry-pick to `main` if you haven't already. The next `node cleanup-worktrees.js --apply` run from `main` will prune the admin record and drop the branch if it's merged/patch-equivalent.

Replace `<slug>` with the actual basename.

## 4. Do nothing else.

- Do not commit, push, or run `git worktree remove` — the user takes responsibility for commit state, and `git worktree remove` would re-acquire the CWD lock and fail.
- Do not wait for the cleanup to finish — it runs detached and you'd be blocked.
- Do not retry if the user re-invokes `/done` in the same session; the cleaner is already running.
