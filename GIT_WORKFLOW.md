# Git Workflow — Neos City

Short reference for keeping the project backed up.

## First-time setup (run once)

```powershell
cd C:\Users\pitag\Documents\neos-city
.\setup_git.ps1
```

That script handles `git init`, the baseline commit, and prints the next steps for connecting a private GitHub repo. It refuses to commit if `.env` or `node_modules` somehow ended up staged — read its output before doing anything else.

## Day-to-day

Manual commits (chosen workflow). The cycle is:

```powershell
git status                    # see what's changed
git diff                      # review unstaged edits
git diff --cached             # review staged edits
git add <file> ...            # or `git add -A` to stage everything
git commit -m "Short summary"
git push                      # push to GitHub
```

Useful aliases (optional — add to your global git config):

```powershell
git config --global alias.s  status
git config --global alias.lg "log --oneline --graph --decorate -20"
```

## What's tracked vs. ignored

Tracked: source (`backend/`, `frontend/`, top-level scripts), `package.json`, `package-lock.json`, `AGENT_CONTEXT.md`, `README.md`, `.env.example` files.

Ignored (see `.gitignore`):
- `node_modules/` everywhere
- `.env` everywhere — secrets stay local
- Build output (`dist/`, `build/`)
- IDE per-user files (`.idea/workspace.xml` is already handled by the existing `.idea/.gitignore`)
- OS junk, log files, Office lock files
- Backup files left by mid-edit recoveries (`*.before_repair`, `*.before_iframe`, `*.bak`)

## If a commit fails or git refuses to push

- "Updates were rejected" — someone (you, on another machine) pushed first. Run `git pull --rebase` then `git push`.
- "Permission denied (publickey)" — the GitHub remote uses SSH but no key is set up. Either switch to HTTPS (`git remote set-url origin https://github.com/<you>/neos-city.git`) or add an SSH key.
- An accidental commit of `.env` — see "Recovery" below.

## Recovery: secret accidentally committed

If a credential lands in a commit:

1. **Rotate the credential immediately** (Challonge, Supabase, start.gg) — even if you remove it from history, assume it leaked.
2. Update `backend/.env` with the new value.
3. Remove from history. If the bad commit hasn't been pushed yet:
   ```powershell
   git reset HEAD~1
   # edit / move the secret out
   git add -A
   git commit -m "..."
   ```
   If it's already pushed, use `git filter-repo` (or BFG Repo-Cleaner) and force-push. Don't try to "fix it forward" — the secret is in the blob forever otherwise.

## Recovery: file got truncated mid-edit (the original reason for setting this up)

`tournaments.js` was previously truncated mid-edit and recovered by hand. With git, the recovery becomes:

```powershell
git status                                # confirms the file is modified
git diff backend\src\routes\tournaments.js   # see exactly what changed
git checkout -- backend\src\routes\tournaments.js   # revert to last commit
```

Or, more surgically, `git stash` to set the broken state aside while you investigate.

This is the entire reason the project is now under version control.

## A note for future agents

If you're an agent reading this: before any non-trivial edit to a tracked file, check `git status` first so you know what the user already had committed vs. what you're about to change. Encourage Gabriel to commit before you start risky multi-file work — a clean baseline makes `git diff` definitive.

Never commit `.env`. The `.gitignore` should catch it but the `setup_git.ps1` script also has an explicit guard — don't disable the guard.
