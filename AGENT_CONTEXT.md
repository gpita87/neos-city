# Neos City — Agent Context

This file captures decisions, constraints, and community knowledge that aren't obvious from reading the code. Read this before touching anything.

---

## For Agents: Setup & Handoff Rules

**Harness:** Claude Code (CLI). `CLAUDE.md` at the project root `@`-includes this file, so the full context loads automatically when Claude Code starts in this directory. `.claude/settings.json` (also checked in) pre-allows read-only diagnostics and pre-denies DB-mutating scripts and the dev server — see that file for the exact lists.

**Project directory:** `C:\Users\pitag\Documents\neos-city`
- Start Claude Code from this directory (`cd` here first, or pass `--cwd`). All file edits happen here.
- For parallel work, see the **Multi-agent worktree workflow** section below — each parallel session starts from its own worktree path, not the main directory. The supported flow is `node spawn-worktree.js <name>` → work in `neos-city-worktrees/<name>/`. **Do not** treat Claude Code's auto-created `.claude/worktrees/<slug>/` directories as a long-term home for your work — they're ephemeral and gitignored.

**Version control:** the project is under git (set up 2026-04-30 — see `GIT_WORKFLOW.md`). Before any non-trivial multi-file edit, ask Gabriel to commit so `git diff` is meaningful. Never commit `backend/.env` or anything matching the `.gitignore` patterns. If a credential accidentally lands in a commit, rotate it immediately — see GIT_WORKFLOW.md "Recovery" section.

**Thread size — handoff protocol.** Claude Code auto-compacts long conversations, but compaction loses fidelity, so the handoff log in this file is still the source of truth between sessions.
- Before the conversation gets long enough to risk compaction, **stop before starting any new task**.
- Append a handoff update at the bottom of the `## ⚡ NEXT AGENT` section. Include: what was just completed, what's in progress (if anything), and what the next step is.
- Tell Gabriel the thread is getting large and suggest a fresh session — the new agent picks up from this file.

---

## Multi-agent worktree workflow

**Default: work on `main`.** Edit files directly in the main worktree (`C:\Users\pitag\Documents\neos-city`). Spin up an agent worktree ONLY when `main` has pending uncommitted changes you don't want to disturb — e.g. Gabriel is mid-edit, or a previous agent's work hasn't been committed yet. First thing to do at session start: run `git status` from the main directory. If the tree is clean, work there. If it's dirty, follow the worktree flow below so the in-progress changes stay isolated from your edits.

**The problem worktrees solve.** Running two agents against the same working directory at once has caused repeated mid-edit truncation — files losing their tail, then surgical repairs producing duplicate-tail follow-ons. The diagnosed cause is shared Windows-mount I/O between sandboxes (mount-layer write buffering, NTFS metadata contention, Defender real-time scanning), not file-level contention. So when isolation is needed, the rule is: **don't run two agents against the same on-disk path**. Each agent that needs isolation gets its own worktree.

**Two kinds of worktree exist on this machine — only one is supported for real work.**

| Path                                  | Created by                                  | Purpose                          | Use for handoff work? |
|---------------------------------------|---------------------------------------------|----------------------------------|------------------------|
| `neos-city-worktrees/<name>`          | `node spawn-worktree.js <name>` (Gabriel)   | The supported parallel-agent flow | **YES — this is the default** |
| `.claude/worktrees/<random-slug>`     | Claude Code harness, automatic per session  | Ephemeral session sandbox        | **NO** |

`.claude/worktrees/` is gitignored (`192a102`) and the harness creates one per Claude Code invocation when isolation is on. Treat any work that lands in there as **disposable**: don't write `WORKTREE_SUMMARY.md`, deploy plans, or other "next agent reads this" docs into a `.claude/worktrees/<slug>/`, because the slug is unguessable, the directory may be cleaned up by Claude Code, and Gabriel has no `merge-worktree.js`-equivalent for it. For routine edits (one or two files, a quick fix, no need to leave a handoff doc behind), just do the work in place and commit + push your branch — the change survives in git history regardless of what happens to the directory, and Gabriel can cherry-pick it onto `main` in one command. Only escalate to `spawn-worktree.js` when the work is non-trivial enough that you'd otherwise want a `WORKTREE_SUMMARY.md` to hand it off, or when you'd be touching enough files that reviewing the squashed diff in IntelliJ matters.

**Handoff rule (read this before writing your final message).** A deploy command of the form `cd C:\Users\pitag\Documents\neos-city; node <script> <path>` only works if `<path>` exists on `main`. If you're in a `.claude/worktrees/<slug>/` and you created or modified `<path>` this session, the file lives on the harness branch (e.g. `claude/<slug>`) — `main`'s working tree doesn't have it yet. Your final message MUST get the files onto `main` BEFORE any command that uses them.

Git worktrees share `.git`, so the harness branch is already visible from `main` as a local ref — Gabriel doesn't need a `git push` / `git fetch` to land it. He merges the local branch directly. The reliable pattern:

1. From the worktree, commit (don't push): `git add -A; git commit -m "<summary>"`.
2. Before writing the handoff, check whether `main` has moved since this session started. From the worktree:
   ```
   git log --oneline main ^HEAD
   ```
   If empty → `main` is at the worktree's base; suggest `git merge --ff-only claude/<slug>` (one new commit, linear history).
   If non-empty → `main` has new commits the worktree doesn't have; `--ff-only` will fail. Do `git merge-tree --write-tree HEAD main` to confirm no conflicts, then suggest **`git cherry-pick claude/<slug>`** (clean single commit on top of main) or `git merge --squash claude/<slug>` followed by `git commit` (mirrors what `merge-worktree.js` does for the supported flow). If `merge-tree` produced conflict markers, surface them in the handoff — Gabriel will resolve them in IntelliJ before running the migration.
3. Only AFTER step 2's merge command does the `node run_migration.js …` / `node recalculate_elo.js` / etc. command appear in your handoff.

Mentally check before sending: "is every path I'm about to ask Gabriel to run actually on `main` right now?" If you can't answer yes, the handoff is broken and step 2 is missing.

A `git push` of the harness branch is optional and only useful as a backup of the work — it does not affect Gabriel's ability to merge locally. Don't push without explicit user approval.

The rest of this section describes the supported flow.

**Setup at the start of a parallel session.** From the main worktree:

```powershell
cd C:\Users\pitag\Documents\neos-city
node spawn-worktree.js <agent-name>
```

This creates branch `agent/<agent-name>` off `main`, materializes a worktree at `C:\Users\pitag\Documents\neos-city-worktrees\<agent-name>`, runs `npm install` in /, /backend, and /frontend, and writes a `WORKTREE_SUMMARY.md` template. The script prints the worktree path — start the parallel Claude Code session from THAT folder (`cd <worktree-path>` or `--cwd <worktree-path>`), not the main directory. The checked-in `.claude/settings.json` is shared across all worktrees automatically (git worktrees share the working tree's tracked files), so the deny list still protects you.

**Rules when you (the agent) are running inside a worktree.** Detect with `git rev-parse --show-toplevel`. If the result is anything under `neos-city-worktrees/`, you are in a worktree, and:

- **Commit your work to your own branch** (`agent/<name>`). Never push, never merge into main yourself — Gabriel reviews the SUMMARY and runs `merge-worktree.js`.
- **Keep `WORKTREE_SUMMARY.md` up to date** as you go. It's what Gabriel reads before merging. Sections: Goal, Changes, How to verify, Known gaps.
- **Do NOT run the dev server** (`npm run dev` in `backend/` or `frontend/`). Ports 3001 and 5173 are bound by whichever worktree is the "live" one — usually main. If you need to test something live, ask Gabriel to do it from main, or describe what to spot-check in the SUMMARY.
- **Do NOT run migrations, `recalculate_elo.js`, `pull_new.js`, `seed_*.js`, or anything that mutates the Supabase DB.** The DB is shared across all worktrees — there is no "branch isolation" for state. Flag DB-mutating work in the SUMMARY's "How to verify" section so Gabriel can run it after the merge.
- **Static analysis only:** `node -c <file>` for syntax, `node --check` for parsing, reading code, writing code. Anything that hits the network or the DB belongs on the main worktree.

**Merging back.** When the worktree is ready, Gabriel runs (from the main directory):

```powershell
node merge-worktree.js <agent-name>
```

That script verifies both sides are clean, prints the SUMMARY (which is gitignored, so it never lands in main's history), shows `git diff --stat`, optionally the full diff, then on confirmation runs `git merge --squash`. The changes appear STAGED in main's working tree so Gabriel can review them in IntelliJ before committing. The script does NOT commit, does NOT remove the worktree, and does NOT delete the branch — it prints the cleanup commands for Gabriel to run after he's satisfied with the merge:

```powershell
git commit -m "Merge agent/<agent-name>"
git push
git worktree remove ..\neos-city-worktrees\<agent-name> --force
git branch -D agent/<agent-name>
```

To abandon the merge instead, `git reset --hard HEAD` un-stages everything; the worktree and branch are still around to retry.

**If `main` is dirty when you go to merge.** `merge-worktree.js` refuses to run unless both sides are clean. Preferred fix: commit the WIP on `main` first (even a throwaway `git commit -am "wip"` is fine — amend or squash it later) so history stays linear and nothing can get lost. Alternative: `git stash push -m "wip"` → run `merge-worktree.js` → commit the merge → `git stash pop`. Don't try to merge on top of unstaged changes — the squash-merge will tangle them with the worktree's diff and you won't be able to tell which hunks came from where.

**Why local squash and not PRs.** This project is solo (Gabriel) with no CI and no reviewers. Pushing each worktree branch and opening a GitHub PR adds a network round-trip and review ceremony for no gain — IntelliJ's staged-diff view is the review. If a collaborator ever joins, switching to a PR-based merge is a small edit to `merge-worktree.js`. Until then, local squash → push from main is the workflow.

**If something goes wrong.** Worktrees are cheap. If a worktree is in a confused state, `git worktree remove --force <path>` followed by `git branch -D agent/<name>` resets cleanly — the main repo and other worktrees are untouched. The mitigation pattern recommended elsewhere in this file (`git checkout -- <file>` for truncation recovery) still applies inside a worktree.

---

## What This App Is

A community hub for **Pokkén Tournament** (a Pokémon fighting game). It pulls tournament data from Challonge, assigns ratings and achievements to players, and tracks career stats. The intended audience is the competitive Pokkén community — players who know each other, care about records, and have been competing for years.

**Named after Neos City**, a location in Pokkén Tournament's story mode.

---

## The Community & Tournament Series

There are eight tracked series. Each has its own color coding, achievement track, and slug patterns:

| Key               | Full Name                    | Organizer(s)              | Region | Notes |
|-------------------|------------------------------|---------------------------|--------|-------|
| `ffc`             | Ferrum Fist Challenge        | `wise_`, `rickythe3rd`    | NA     | Sometimes titled "Fighting for Cheese" on Challonge. Achievements use "Ferrum Faithful" branding. |
| `rtg_na`          | Road to Greatness NA         | `shean96`, `rigz_`        | NA     | Two co-organizers |
| `rtg_eu`          | Road to Greatness EU         | `__chepestoopid`          | EU     | Note double underscore prefix |
| `dcm`             | DCM                          | `devlinhartfgc`           | NA     | |
| `tcc`             | The Croissant Cup            | `__auradiance`            | EU     | Note double underscore prefix |
| `eotr`            | End of the Road              | (multiple / historical)   | NA     | Legacy series |
| `nezumi`          | ポッ拳ねずみ杯 オンライン    | ねずみ杯 org (Tonamel)    | JP     | Mouse Cup — 25 events as of Mar 2026. Source: Tonamel. |
| `nezumi_rookies`  | ポッ拳ねずみ杯Rookies        | ねずみ杯 org (Tonamel)    | JP     | Rookies division — 7 events. Same org as Mouse Cup. |

Series detection happens in `achievements.js` via `detectSeries(slug, name)` — it checks slug regex patterns and name keywords. Tonamel series are identified by name keywords (`ねずみ杯`) since they don't use Challonge slugs.

---

## Rating System Design Decisions

### ELO
- **No ELO floor** — the floor at 1200 was removed. Ratings can now drop freely below the starting value based on match results.
- K-factor adjusts based on player experience (higher K early, lower later).
- Placement bonuses on top of standard ELO delta for top finishes.
- ELO is computed and stored but hidden from the UI (see "Front page revamp" below).

### Career Points (removed 2026-05-07)
The career points system (1st=10, 2nd=7, top4=5, top8=3, attended=1) was removed. The values were arbitrary and the player record + achievements already convey participation and accomplishment. Migration: `backend/src/db/migrations/remove_career_points.sql` drops `players.career_points`, `tournament_placements.career_points`, and `idx_players_career_pts`.

---

## Achievement Design Intent

Achievements are meant to feel earned and personal, not just grind metrics. Key principles:

- **Series achievements are separate tracks** — a player can be a champion of FFC without ever playing RTG. Each series has: debut → regular → veteran → elite_four → champion → grand_champion.
- **grand_champion** = win 3+ tournaments in a series. **champion** = win 1. These were specifically requested.
- **No achievements that expose embarrassing stats** — no "lost 10 in a row" type achievements, no ELO floor exposure. Achievements should feel like celebrations, not gotchas.
- Participation/longevity achievements exist alongside competitive ones by design.

---

## Challonge API — What Works and What Doesn't

This is the most important thing to understand before touching the sync/import code.

### Credential setup (UPDATED — fully investigated)

> **Where the secrets live:** all credentials are in `backend/.env` (gitignored). `backend/.env.example` documents the variable names. Never commit literal tokens to this file.

There are three apps in the Challonge Developer Portal (`connect.challonge.com`):
- **Neos City** (OAuth app) — `CHALLONGE_CLIENT_ID` / `CHALLONGE_CLIENT_SECRET` in `.env`
- **Migrated APIv1 Key** (MAK app) — has its own client_id/secret, plus the `api_v1_key` field which is what we actually use as `CHALLONGE_V1_KEY` in `.env`

The **v1 API key** is the personal account API key found in the MAK app's `api_v1_key` form field. It is NOT the client_id or client_secret. It's referenced everywhere as `CHALLONGE_V1_KEY` and read from `backend/.env`.

### What works ✅
- **Challonge v1 API** — `GET /v1/tournaments/{slug}.json?api_key=KEY` fetches any public tournament by any organizer. This is now how `getTournament`, `getParticipants`, and `getMatches` work in `challonge.js`. The v1 key is set in `.env` as `CHALLONGE_V1_KEY`.
- **OAuth client credentials token** — `POST /oauth/token` works and returns a valid JWT. Used as fallback in `getApiHeaders()` if CHALLONGE_V1_KEY is unset.

### What doesn't work ❌
- **`GET /v2.1/tournaments/{slug}`** with OAuth Bearer token returns **404** for tournaments that aren't connected to the Neos City app. The v2.1 API only serves tournaments belonging to your app — it is NOT a general-purpose public API.
- **`GET /v2.1/application/tournaments`** — Returns 401. Requires user-level OAuth (authorization_code flow), not app-level client_credentials.
- **`Authorization-Type: v1` header with MAK client_id or client_secret** — Returns 401 on individual tournament fetches. The v1 header auth is for v2.1 endpoints, which still have the "app-connected tournaments only" restriction.

### Current import approach
`challonge.js` now uses the **v1 API** for all tournament data: `v1Get('/tournaments/SLUG.json')`, `v1Get('/tournaments/SLUG/participants.json')`, `v1Get('/tournaments/SLUG/matches.json')`. The v1 API response format is `{tournament: {...}}` / `[{participant: {...}}]` / `[{match: {...}}]` — the `importOne()` parser in `tournaments.js` already handles both v1 and v2 formats.

### Discovery approach (unchanged)
`scrapeUserTournaments(username)` scrapes `challonge.com/users/USERNAME/tournaments` (HTML page) to find slugs. Falls back to RSS feed on 403. See code for details. The harvested_tournaments.txt file (518 URLs) was produced by previous scraping runs.

### Batch import (the reliable approach)
`POST /api/tournaments/batch-import` accepts `{urls: [...]}`. This is the primary way to import the harvested_tournaments.txt. A ready-to-use console script is at `neos-city/batch_import_console.js`. A Node.js CLI version is at `neos-city/batch_import.js` — run `node batch_import.js` from the neos-city directory.

---

## Database

**Supabase PostgreSQL.** Connection string in `backend/.env` as `DATABASE_URL` — see `backend/.env.example` for the format.

We use the **Session pooler** (IPv4-proxied), not the direct connection. The hostname looks like `aws-<region>.pooler.supabase.com:5432` and the user portion is `postgres.<project_ref>` rather than plain `postgres`. Free-tier
projects expose `db.<ref>.supabase.co` as IPv6-only, which fails with
`getaddrinfo ENOTFOUND` on machines without working IPv6 to AWS — particularly
after a project is paused and restored. The Session pooler hostname
(`aws-1-us-east-1.pooler.supabase.com`) is IPv4-friendly. The user portion
becomes `postgres.<project_ref>` instead of plain `postgres`.

Migrations can be run via `node run_migration.js <path-to-sql-file>` from the neos-city directory, or pasted into Supabase's SQL editor. Key migration files:
- `backend/src/db/schema.sql` — full schema v2, run this on a fresh DB
- `backend/src/db/migrations/add_series.sql` — adds series columns
- `backend/src/db/migrations/add_organizers_eotr.sql` — adds organizers table + eotr columns
- `backend/src/db/seed_achievements.sql` — full achievement catalog
- `backend/src/db/seed_organizers.sql` — the 6 organizers above

One gotcha: the `achievements` table needs a `series TEXT` column that wasn't in the original schema. It was added via `ALTER TABLE achievements ADD COLUMN IF NOT EXISTS series TEXT;` in add_series.sql.

### Database Backups

Logical Postgres dumps live under `neos-city/backups/<timestamp>/` (gitignored). They're produced by `backup_db.js`, which calls `pg_dump` directly.

**Prereq:** PostgreSQL 17 client tools (for `pg_dump.exe`). One-time install on Windows:
```powershell
winget install PostgreSQL.PostgreSQL.17
```
Then close and reopen PowerShell so `pg_dump` is on PATH. The "Command Line Tools" component is the only piece needed — the server itself can stay disabled.

(Earlier attempts used the Supabase CLI (`npx supabase db dump`), but Supabase CLI v2 runs `pg_dump` inside a Docker container, which requires Docker Desktop. Calling `pg_dump` directly skips that prerequisite — same tool, fewer dependencies.)

```powershell
cd neos-city
node backup_db.js                # full backup: schema + data
node backup_db.js --schema-only  # only the schema dump
node backup_db.js --data-only    # only the data dump
node backup_db.js --keep 10      # also prune to the 10 most recent dumps
```

Each run creates `backups/YYYY-MM-DD_HHmm/` containing `schema.sql`, `data.sql`, and a small `manifest.json`. Both dumps use `--no-owner --no-privileges` so they replay cleanly against any target Postgres. Data is dumped as `--column-inserts` for human-readable INSERT statements.

`pull_new.js` ends with a `Step 7/7: Database backup` prompt that runs this script after every import + recalc, so a fresh dump is always available alongside any new tournament data.

**Restoring** (against an empty Postgres):
```bash
psql "$NEW_DB_URL" -f schema.sql
psql "$NEW_DB_URL" -f data.sql
```

For Supabase-tier-level info: free tier has no automatic backups; Pro keeps 7 days, Team 14, Enterprise 30. Even on a paid tier, keeping local dumps is the actual disaster-recovery insurance — Supabase's managed backups live in their infrastructure, so a billing/account/retention-window issue could still leave you stranded.

---

## Pulling New Tournament Info

The fastest path is the one-shot orchestrator:

```powershell
cd neos-city
node pull_new.js
```

It (1) verifies the backend at `localhost:3001/api/health`, (2) runs
`batch_import.js`, (3) prompts about Tonamel and Liquipedia browser-console
imports (those still need a real Chrome tab), (4) runs `recalculate_elo.js`
so Pass-2 achievements + ELO are correct, (5) runs `check_import_status.js`.

`batch_import.js` no longer imports in file order. It calls
`POST /api/tournaments/preview-dates` first to look up each URL's tournament
date, then walks the URLs chronologically. Consecutive same-source URLs are
chunked into the matching batch endpoint, so cross-source ordering is
preserved without losing the existing chunk-of-50 + 1.5s-delay rhythm. URLs
the backend can't date are pushed to the tail in file order.

**Slug validation:** `scrapeUserTournaments()` itself still returns the raw
slug list, but `discoverUserTournaments()` now runs `validatePokkenSlugs()`
by default before returning. Validation hits the v1 API for each slug and
keeps only those whose `game_name` or `name` matches a Pokkén keyword list
(`pokken`, `pokkén`, `ferrum`, `road to greatness`, `croissant`, `dcm`,
`end of the road`, `heaven's arena`, `mouse cup`, `ねずみ`, etc.). 404s are
dropped, transient errors keep the slug defensively. Pass `{ validate: false }`
to bypass for diagnostics.

## Running the App

User is on **Windows with PowerShell**. PowerShell doesn't support `&&` for chaining commands — give separate lines.

```
# Backend (port 3001)
cd neos-city/backend
npm run dev

# Frontend (port 5173)
cd neos-city/frontend
npm run dev
```

Frontend proxies `/api` to `localhost:3001` via Vite config.

Backend uses `nodemon` for hot reload. Changes to `.js` files in `backend/src/` auto-restart.

---

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS. Dark theme, indigo accents. Font: `font-display` for headings (tracked widest, uppercase). Slate color palette for body text.
- **Backend**: Node.js + Express. CommonJS (`require`, not `import`).
- **DB**: PostgreSQL via Supabase + `pg` npm package.
- **API**: Challonge v2.1 OAuth.
- **No test suite** — manual testing only.

---

## ⚡ NEXT AGENT: What to Do First

### Current state (as of May 10 2026 — DEPLOYED TO RENDER + offline-row fetch fix)

#### What this session shipped

Neos City is live in production on Render:
- **Frontend (static site, free tier):** https://neos-city-web.onrender.com
- **Backend (web service, Starter $7/mo):** https://neos-city-api.onrender.com

Auto-deploy is on: any push to `main` rebuilds both services. No CI, no staging branch, no preview env — `main` IS prod.

Admin auth is wired end-to-end. Every mutating route is gated behind `ADMIN_TOKEN` (12 POSTs in `tournaments.js`, 4 mutating routes in `organizers.js`). [requireAdmin.js](backend/src/middleware/requireAdmin.js) fails closed: 503 if `ADMIN_TOKEN` is unset on the server, 401 on a missing/wrong client header, timing-safe compare otherwise. Smoke tests against prod confirmed 401 without token and a successful import with token. Frontend reads the token from `localStorage.admin_token` (set via `localStorage.setItem('admin_token', '...')` in DevTools — no UI yet) and the axios interceptor in [api.js](frontend/src/lib/api.js) attaches it as `x-admin-token` on every request.

#### Where secrets live

`ADMIN_TOKEN`, `DATABASE_URL`, `CHALLONGE_V1_KEY`, `CHALLONGE_CLIENT_ID`, `CHALLONGE_CLIENT_SECRET`, `STARTGG_TOKEN`, `JWT_SECRET`, `NODE_ENV=production`, `FRONTEND_URL` — Render env vars on `neos-city-api`, mirrored in Gabriel's local `backend/.env`. `VITE_API_URL` — Render env var on `neos-city-web`, baked into the JS bundle at build time. There is no recovery flow: if `ADMIN_TOKEN` is lost from one store, copy from the other. If lost from both, generate a new one and update both; existing browser localStorage values become stale and users have to paste the new token.

#### The offline-row fetch bug (fixed in `dd0ad21`)

After deploy, `/tournaments?tab=offline` rendered with blank winner/runner-up columns. Root cause: `OfflineRow` in [Tournaments.jsx](frontend/src/pages/Tournaments.jsx) used a raw `fetch('/api/tournaments/${id}')` with a relative URL. That worked in dev via Vite's proxy but in prod hit the static-site origin, where Render's SPA rewrite served `index.html` for the unknown path → JSON parse failed silently → empty placements. Fix: route through the existing `getTournament` helper from `lib/api.js`, which uses the configured `${VITE_API_URL}/api` baseURL like the rest of the app. **Worth a one-time grep** — `grep -r "fetch('/api" frontend/src` — to catch any sibling slips that bypass the axios client.

#### Known imperfections to clean up

1. **`/api/health/challonge` returns `challonge_ok: false`** even though imports work fine. The diagnostic checks `/v2.1/application/tournaments`, which is documented elsewhere in this file as known-broken (requires user OAuth, not client_credentials). False alarm — prod uses v1 API via `CHALLONGE_V1_KEY`. Worth rewriting to hit a v1 endpoint instead.

2. **`/api/players?region=NA` returns `[]` in prod** — no players have `region='NA'` set. NA/EU region tagging requires manual SQL (only JP is auto-tagged via Tonamel imports). Pre-existing gap, surfaced during smoke test. Could be auto-derived from organizer associations (FFC/RTG-NA/DCM/EOTR → NA; RTG-EU/TCC → EU).

3. **Junk tournament in the DB: "X-Division Championship".** Imported when I tested the admin gate locally with `challonge_id: "x"` — that slug happens to match a real non-Pokkén tournament. 44 participants, 43 matches. Should be cleaned up; verify cascade across `matches`, `tournament_placements`, `player_achievements` before a raw `DELETE FROM tournaments WHERE challonge_id = 'x'`.

4. **`DEPLOYMENT_RUNBOOK.md` and `DEPLOY_HANDOFF.md` are uncommitted in `.claude/worktrees/elegant-wescoff-f6aa32/`** — exactly the failure mode this file warns about. They guided this session but will vanish on the next harness cleanup. Worth committing to `main` (root or `docs/`) so the deploy story stays findable.

5. **Supabase free-tier pauses after 7 days of inactivity.** The API will 503 until manually unpaused. Either upgrade Supabase or set up a tiny GitHub Action that pings `/api/health` daily.

#### Reminders for future agents

- **Push to main = deploy to prod.** No staging. Test locally; if uncertain, ask before pushing.
- **Region for Render services is `ohio`** (us-east) to match Supabase's `aws-1-us-east-1.pooler.supabase.com`. Don't change to Oregon without migrating Supabase too.
- **Frontend env vars are baked at build time.** Changing `VITE_API_URL` requires a redeploy of the static site, not just a service restart.
- **CORS in prod requires `FRONTEND_URL` to be set** — `app.js` does `process.exit(1)` if it's missing. If the API service won't start, that's the first thing to check.

---

### Current state (as of May 10 2026 — offline duplicate cleanup complete + root-cause patches landed)

#### What this session shipped

The 21 duplicate offline-tournament rows the prior May 9 entry flagged are
resolved. DB is at **80 offline tournaments** (10 worlds, 54 major, 15
regional, 1 other) with no duplicate (name, date) pairs. Root-cause patches
in [tournaments.js](backend/src/routes/tournaments.js) also landed today
(`2423b3c`) so re-running the Liquipedia bracket import won't recreate the
mess.

**Cleanup commits (May 10 window):**

- `d172424` [verify_merge_winners.js](verify_merge_winners.js) — read-only
  pre-flight check for `merge_offline_duplicates.js`. Prints KEEP vs DROP
  rank-1/rank-2 per queued pair so mismatched ones (where DROP would
  overwrite KEEP's authoritative offline_import winner) can be spotted
  before `--apply`.
- `89da510` [merge_offline_duplicates.js](merge_offline_duplicates.js) —
  auto-skip pairs whose top-2 disagree. Durable safety net for future
  re-imports that recreate similar mismatches.
- `a788f98` `merge_offline_duplicates.js` — reorder `applyMerge` to DELETE
  DROP before backfilling KEEP's metadata. The unique index on
  `liquipedia_url` rejected the original COALESCE order.
- `f836ec0` Tier classification — tightened the migration in
  [add_offline_tiers.sql](backend/src/db/migrations/add_offline_tiers.sql)
  and the matching `detectOfflineTier` in
  [achievements.js](backend/src/services/achievements.js). Five events
  that had been stuck in `regional` due to strict-equality name matching
  (Toryuken 8, Winter Brawl 12, The Fall Classic 2017, SoCal Regionals
  2017, Summer Jam XI) are now correctly `major`. Pattern is now
  word-boundary regex `^X( |-|$)` so trailing suffixes like " - PokkenDX"
  are tolerated without false-matching longer-numbered siblings (e.g.
  "Summer Jam XI" no longer matches "Summer Jam XII").
- `6aac308` + `7de596f` [cleanup_offline_skips.js](cleanup_offline_skips.js)
  — resolves the 7 pairs `merge_offline_duplicates.js` correctly skips
  (3 differing-slug corruption + 4 top-2 mismatches from buggy
  placements-scraper data). Single transaction; `--apply` gates execution.
  Follow-up commit fixed an ordering bug: DELETE FROM before COALESCEing
  URL onto TO so the unique index doesn't reject mid-transaction.
- `2423b3c` (this session) Tournaments: anchor ILIKE name match +
  classify tier on create-new branch — see [tournaments.js:1710](backend/src/routes/tournaments.js:1710)
  and [tournaments.js:1735](backend/src/routes/tournaments.js:1735) for
  the bracket importer, plus the parallel fixes in
  `importOneLiquipediaPlacements`. Now uses anchored prefix
  `LOWER(name) LIKE LOWER($1) || '%'` and calls `detectOfflineTier(name)`
  on the create-new branch so freshly-inserted bracket rows get classified
  rather than defaulting to `'other'`.

**Other work in the same window** (not part of the cleanup but commits land
between the dupes you'll see here):
- `f36043f` `/players` lookup page (search + alphabetical index).
- `da24aba` + `59e6898` Avatar backfill — `backfill_challonge_avatars.js`
  populates `players.avatar_url` from the Challonge v1 API; PlayerProfile
  renders it with a crossed-swords fallback.

#### Known data trade-offs from the cleanup

- FF14 main bracket and FF15 main bracket no longer have DB rows. The
  "Frosty Faustings XIV Side Tournaments" and "Frosty Faustings XV Side
  Tournaments" rows (separate Liquipedia entries) are unaffected. Re-import
  the main brackets from Liquipedia anytime — the slugs `frosty_faustings_14`
  and `frosty_faustings_15` are now free.
- FR20 (id=618) and FR2019 retain only winner+runner-up placements, no
  full bracket. Same deal — re-import anytime.
- CEO 2017 lost its 22 bracket matches (top-2 didn't match Liquipedia, so
  the parse was suspect). Winner+runner-up correct from offline_import seed.
- NEC 18, NorCal 2017, FF IX lost their placements-only scraper output
  (8–16 placements that were the buggy "one player per tier" kind).
  offline_import seed's winner+runner-up is what remains.

#### Files added this session window

- [verify_merge_winners.js](verify_merge_winners.js) — read-only safety
  check before `merge_offline_duplicates.js --apply`.
- [cleanup_offline_skips.js](cleanup_offline_skips.js) — resolves the 7
  SKIPped pairs from the merge script.

#### Root-cause patches (now landed)

The two bugs in `importOneLiquipediaBracket` that produced the duplicate-row
mess have been fixed (commit `2423b3c`). Same fixes applied to the parallel
`importOneLiquipediaPlacements` since it had the same lookup logic. Without
these, the next bracket-import run would recreate similar duplicates and
mis-classify any newly-created rows. If you see this section grow back into
"still open", something has regressed.

---

### Current state (as of May 4 2026 — offline placements: parser still dropping tied players, HANDOFF)

#### Symptom

Tournament 554 (Vortex Gallery at Frosty Faustings XVIII) has 24 entrants. Liquipedia's canonical Prize Pool table ties them as 1, 2, 3, 4, 5–6, 7–8, 9–12, 13–16, 17–24. After running the new placements importer (added this session), the DB has 9 rows for the tournament — one per tier, each with a single player — instead of the expected 24 with proper ties:

```
rank  1  Jukem               ← correct
rank  2  Shadowcat           ← correct
rank  3  Jin                 ← correct
rank  4  Kamaal              ← correct
rank  5  Virtigris           ← missing pitaguy
rank  7  Super EpicGuy       ← missing NxD
rank  9  Oreo                ← missing Mins, Rina the Stampede, Alpha
rank 13  Oltownbonkrs        ← missing Wes, Son_Dula, Zenkuri
rank 17  ProdiiJey           ← missing Stars, Santa, GARZON, The Librarian, Juice, Blueshift, Smoothie
```

The leaked `place 9 to 24` expander row from the first iteration is gone — the regex/anchor filter took care of it. What remains is that every tied tier ends up with exactly one survivor, and not consistently the alphabetically first one. We don't yet know which row of Liquipedia's HTML the parser is actually picking up for those tiers.

#### What's wired up vs broken

Working:
- `importOneLiquipediaBracket` deletes existing placements before INSERT (no more duplicate rank-1/2 from old buggy parses).
- `reset_bracket_placements.js` wipes ALL ranks (rank-1/2 included).
- New backend route `POST /api/tournaments/import-liquipedia-placements` and exported `importOneLiquipediaPlacements` (find-or-create tournament, upsert players with alias resolution, DELETE-then-INSERT placements, refresh per-player offline tier stats).
- New `liquipedia_import_console.js` flow: per event it fetches BOTH the main page (placements table) AND `/Bracket` (matches), POSTs to both endpoints. Skip cache only applies to the bracket pass.
- New `reapply_placements_from_matches.js`: derives placements from the matches table when the import path can't be re-run. Caveat below.
- New `diagnose_tournament.js`: prints tournament row + placements + match summary for one tournament. Use this every time you change something to see actual DB state.

Broken / lossy:
- The placements scraper in `liquipedia_import_console.js` (`findPlacementRows` / `extractPlayerNames` / `reducePlacements`) returns one player per tied tier and we don't know why. The two failure modes I worked through this session were the `place 9 to 24` expander leak (fixed) and `querySelector('.csstable-widget-cell-content')` returning only the first wrapper (changed to `cells[cells.length - 1]`). Neither change fully solved it.
- `reapply_placements_from_matches.js` runs the v2 algorithm against the matches table and produces distinct ranks for everyone — it can't reconstruct ties because the legacy bracket parser flattened the bracket structure into sequential round numbers (every match has `bracket_section='winners'`, `round = 1..N` in DOM order). The matches table is genuinely lossy here. Don't expect this script to give canonical placements for legacy-parsed events; it's a fallback.
#### Why I'm flagging this as a circle

I changed two things that should have moved the needle (anchor filter + last-cell pick) and the symptom is the same shape (one player per tier) with a different "winner" each time, suggesting the parser's row-selection is wrong, not just the cell-selection. Without DOM access (Liquipedia is on the fetch-block list — see the `web_fetch` failure earlier in this thread's history), I'm guessing at the structure.

#### Concrete next steps for whoever picks this up

1. Get the actual HTML. Ask Gabriel to paste the outerHTML of the `.csstable-widget` block from `https://liquipedia.net/fighters/Vortex_Gallery/2026/Frosty_Faustings/PokkenDX` — specifically one tied tier (e.g. `9th-12th`). Or have him add a `console.log(modern.outerHTML.substring(0, 5000))` to `findPlacementRows` and re-run with one event. The selector strategy currently assumes one of two structures; the real DOM may be neither.
2. Once the DOM is known, the simpler patch may be to switch from fetched HTML + DOMParser to navigating the live tab. If the page renders tied tiers via JS into the live DOM (and Liquipedia uses lazy expanders for `9 to 24`), `fetch()` of the page source won't have what we need. The fix is either (a) navigate the tab to each event URL and read `document` directly, or (b) call Liquipedia's MediaWiki API (`https://liquipedia.net/fighters/api.php?action=parse&page=...&prop=text`) which renders the page server-side.
3. Hardcoded fallback. `offline_import.js` already has authoritative winner/runner_up per event. Extending its records with a `placements: [{rank, players}]` array and routing that through `importOneLiquipediaPlacements` from the Node.js side eliminates the parser entirely. Tedious for 76 events, but reliable, and makes the "one tournament page is wrong" issue trivially fixable in code review without a live browser. Best for events where the table format is unusual or pre-2020 wiki markup.
4. Verbose-debug pass. Before next iteration, add a per-tier `console.log` inside `reducePlacements` printing `(rank, players.length, players)` so the next person can immediately see whether the parser is producing one row per tier with N players, or N rows per tier with one player each. The right fix for those two cases is different and we currently can't tell which it is.
5. After the parser actually works on FF XVIII, re-run `node reset_bracket_placements.js && node offline_import.js`, then paste the console importer with `FORCE_REIMPORT = true`, then `node recalculate_elo.js`. Spot-check via `node diagnose_tournament.js 554`.

#### Files touched this session

- `backend/src/routes/tournaments.js` — DELETE-before-INSERT in `importOneLiquipediaBracket`; new `importOneLiquipediaPlacements` + `POST /api/tournaments/import-liquipedia-placements`.
- `liquipedia_import_console.js` — added placements scraper (parsePlaceString, extractPlayerNames, findPlacementRows, reducePlacements); main loop now does main-page + /Bracket fetches per event and POSTs to both endpoints.
- `liquipedia_placements_console.js` — standalone placements-only console script created mid-session before merging into the main one. Redundant; safe to delete with `Remove-Item C:\Users\pitag\Documents\neos-city\liquipedia_placements_console.js`.
- `reset_bracket_placements.js` — wipes all ranks (not just > 2); doc + console output rewritten to reflect the new workflow.
- `reapply_placements_from_matches.js` — new repair script that derives placements from the matches table. Useful when the import flow can't be re-run, but produces distinct ranks (no ties) for legacy-parsed brackets.
- `diagnose_tournament.js` — read-only diagnostic helper. Use whenever you're sanity-checking a single tournament's DB state.

---

### Current state (as of May 4 2026 — duplicate offline placements fix)

#### What just shipped this session

Frosty Faustings XVIII (and presumably the other 15 bracket-imported offline events) was rendering with two players at rank 1 (Jukem + Twixxie) and two at rank 2 (Shadowcat + slippingbug). Root cause: the original `reset_bracket_placements.js` preserved rank ≤ 2 on the assumption those rows came from `offline_import.js`, but the buggy pre-v2 bracket parser had ALSO written its own rank-1/rank-2 rows for *different* `player_id`s on the same tournaments. The `(tournament_id, player_id)` upsert had no way to clean those up, so post-reset events kept the duplicates.

Two changes:

1. **`backend/src/routes/tournaments.js`** — `importOneLiquipediaBracket` now `DELETE FROM tournament_placements WHERE tournament_id = $1` immediately before the placement INSERT loop. Bracket data covers every entrant (we just upserted players for every name in `matches[]`), so the delete + insert is a complete repopulation. Future bracket re-imports are now self-cleaning regardless of what was in the table before.

2. **`reset_bracket_placements.js`** — wipes ALL placements on candidate tournaments (rank 1 and 2 included). Header comment, console output, and post-script instructions all updated to reflect the new workflow.

**Run this to actually fix the live data:**

```powershell
cd C:\Users\pitag\Documents\neos-city
node reset_bracket_placements.js          # wipes placements for the ~16 bracket-imported offline events
node offline_import.js                    # restores canonical winner/runner-up for every offline event
# then in Chrome on liquipedia.net:
# paste liquipedia_import_console.js with FORCE_REIMPORT = true
node recalculate_elo.js                   # picks up the corrected placements
```

Spot-check after: `/tournaments/<id>` for Frosty Faustings XVIII should show one rank-1 (Jukem), one rank-2 (Shadowcat), and the rest of the 24-player bracket distributed across ranks 3–24 with no duplicates.

---

### Current state (as of May 2 2026 — meta achievement modal redesign)

#### What just shipped this session

A targeted fix for the meta-achievement modal. Two bugs were entangled: meta achievements opened from a player profile rendered via the wrong code path AND the contributor table held stale rows from earlier qualifier logic. Symptom: opening Kalos Dark Horse on `/players/:id` listed opponents who weren't Kalos+ Champions; opening Kalos Elite Trainer said "No contributing tournaments on file."

Four parts:

1. **`frontend/src/pages/PlayerProfile.jsx`** — the `setOpenAchievement` call dropped `category`. Added it back. The modal's `isMeta = achievement.category === 'meta'` check now actually fires for meta achievements opened from a player profile, instead of silently falling through to the placement view.

2. **`backend/src/routes/achievements.js`** — the meta branch of `GET /:id/tournaments` now returns a structured `meta` payload alongside the legacy `tournaments` array. Per opponent: their qualifying tier+region (highest match for the achievement's target tier), their `highest_regions` across all four placement tiers, and the qualifying match (tournament/score/bracket link). Stale opponents — those who no longer hold a qualifying achievement — are filtered out at query time, so even uncleaned DB data doesn't surface in the UI. `meta.stale_filtered` counts how many were hidden.

3. **`backend/src/db/migrations/cleanup_stale_meta_contributors.sql`** — one-shot cleanup that DELETEs rows from `achievement_defeated_opponents` whose opponent doesn't currently hold a qualifying tier+region achievement. Uses `regexp_replace` + `split_part` to decompose the achievement_id (avoids LIKE/`_` wildcard pitfalls). Idempotent. Belt-and-braces with the query-time filter in (2).

4. **`frontend/src/components/AchievementTournamentsModal.jsx`** — meta view rebuilt to consume `data.meta.opponents`. Each opponent row shows: index → name → big "👑 Kalos Champion" qualifying chip; full highest-region pills (gym leader / elite four / rival / champion) underneath; the qualifying match below that with score, series badge, bracket link. New `MetaExplainer` reads from `data.meta` instead of parsing the achievement ID locally, so the verb / kind / region phrasing comes from one source of truth on the backend. Aggregate mode and non-meta achievements continue to use the existing `tournaments[]` rendering path.

**Deploy order:**
```powershell
cd C:\Users\pitag\Documents\neos-city
node run_migration.js backend/src/db/migrations/cleanup_stale_meta_contributors.sql
node run_migration.js backend/src/db/migrations/backfill_meta_match_ids.sql
# restart backend (npm run dev)
# frontend hot-reload should pick up automatically
```

The first migration drops stale opponents (the dark_horse_kalos contributor entries the user flagged disappear). The second fills in NULL match_id values so the modal can link the qualifying match for each opponent — Elite Trainer was a clear offender, every opponent rendered "Match context unavailable" because match_id was never written for those rows. Both migrations are idempotent.

Going forward `recalculate_elo.js` upserts contributor rows with `ON CONFLICT (player_id, achievement_id, opponent_id) DO UPDATE SET match_id = COALESCE(...)` so NULL match_ids self-heal on subsequent recalcs without overwriting good data.

Optional follow-up: open Pitaguy's profile, click `Kalos Dark Horse` and `Kalos Elite Trainer`. Dark Horse should list only Kalos+ Champion opponents with the qualifying match linked; Elite Trainer should now show the qualifying match per opponent instead of "Match context unavailable."

#### Known gap: aggregate (no-player) view

When the modal is opened from `/achievements` (no `player_id`), meta achievements still use the legacy `tournaments[]` path. The aggregate query joins `pa.tournament_id` directly, so each row is "player X unlocked this achievement at tournament Y" — opponent-level enrichment isn't relevant there. If we ever want a "show me everyone who qualifies and how" aggregate view, that's a separate, larger query and modal layout.

### Current state (as of Apr 30 2026 — Recent Achievements feed cleaned up)

#### What just shipped this session

Two related fixes for the "Recent Achievements" feed on the home page.

**Bug 1 — undated unlocks surfaced as "just unlocked today".** When the recalc couldn't derive a real `unlocked_at` from a tournament date, it stamped `NOW()`.

**Bug 2 — every recalc made every achievement look "recent".** The recalc was wiping `player_achievements` and reinserting them, so even old unlocks (e.g. TEC_XX's Kanto Trainer dated Apr 26) surfaced in the feed after each recalc.

The fix has four parts:

1. **`backend/src/db/migrations/nullable_unlocked_at.sql`** — drops `NOT NULL` on `unlocked_at` and nulls fake-recent rows (rows where `unlocked_at` is within last 7 days but the player has no `tournament_placement` on that calendar date — the signature of a NOW() fallback). Idempotent.

2. **`backend/src/db/migrations/add_first_seen_at.sql`** — adds `first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` to `player_achievements`, indexed for sorting. Backfills existing rows to `COALESCE(unlocked_at, '2000-01-01')` so they look "old". Idempotent (the backfill UPDATE is gated on `first_seen_at >= NOW() - INTERVAL '5 minutes'` so re-runs no-op).

3. **`recalculate_elo.js`** — two changes:
   - The `DELETE FROM player_achievements` and `DELETE FROM achievement_defeated_opponents` lines are gone. The recalc is now ADDITIVE — INSERTs use `ON CONFLICT DO NOTHING`, so existing rows keep their `first_seen_at` and `unlocked_at`. Only `elo_history` still gets wiped (must be, ELO is recomputed from scratch).
   - Achievement INSERT now writes `u.d` directly instead of `COALESCE(u.d, NOW())`, allowing NULL for undated unlocks.
   - Trade-off: data corrections that should REVOKE an achievement won't auto-revoke. Rare; manual cleanup if it happens.

4. **`backend/src/routes/achievements.js`** — `GET /recent` filters on `pa.unlocked_at IS NOT NULL AND pa.first_seen_at >= NOW() - INTERVAL '30 days'` and orders by `first_seen_at DESC`. So only rows actually inserted in the last 30 days appear, and re-derivations of old unlocks stay invisible.

Other endpoints (`/holders`, `/leaderboard`, `/:id/tournaments`) untouched. Player profiles still show all unlocked achievements; `formatDate('—')` handles NULL `unlocked_at`.

**Deploy order:**
```powershell
cd C:\Users\pitag\Documents\neos-city
node run_migration.js backend/src/db/migrations/nullable_unlocked_at.sql
node run_migration.js backend/src/db/migrations/add_first_seen_at.sql
# restart backend
```
No need to re-run `recalculate_elo.js` — the migrations clean up existing data. Future recalcs will be additive.

#### Heads-up — recalculate_elo.js truncated TWICE this session, both repaired via bash

Same Windows-mount truncation pattern as the prior `tournaments.js` incident, hit on consecutive Edits to the achievement INSERT block and the DELETE block. Each time the file lost the `})().catch(err => { ... })` tail (and once also the "Done" log block). Repaired by `head -n N`-truncating to a known-good line and appending the missing tail via heredoc. Final file is 761 lines, `node -c` clean, and `diff` against the last git blob (`836f4de:recalculate_elo.js`) shows ONLY the three intentional edits.

The earlier recommendation in this doc — that committed git history is the only reliable recovery — held up: I diffed against the HEAD blob via Python+zlib (because `git` itself can't run from the Linux sandbox here due to a Windows-mount config-read error) and confirmed no drift. If you continue editing `recalculate_elo.js` in this session, watch for the same truncation pattern after every Edit.

---

### Current state (as of Apr 29 2026 — import pipeline overhaul, mid-run handoff)

#### What just shipped this session

Four import-pipeline improvements landed. All four files syntax-check; nothing has been visually tested in the browser yet, and the import run kicked off via `node pull_new.js` was still in progress at handoff (made it through Run 1/11 and started Run 2/11 of `batch_import.js`).

1. **Auto-region for Tonamel imports** (`backend/src/routes/tournaments.js`, in `importOneTonamel()` around the player upsert).
   - INSERT now writes `region = 'JP'`, ON CONFLICT uses `COALESCE(players.region, 'JP')` so existing non-NULL regions are preserved.
   - Removes the manual JP-region SQL step from the post-import workflow.

2. **`POST /api/tournaments/preview-dates`** (new route in `tournaments.js`, around line 429).
   - Accepts `{urls: [...]}`, returns `[{url, source, slug?, phase_group_id?, date}]` per URL with no DB writes.
   - Calls `challonge.getTournament()` (v1) or `startgg.getPhaseGroup()` to read the date.
   - Errors → `{date: null, error: ...}`.

3. **`batch_import.js` rewrite** — calls `/preview-dates` first, sorts URLs chronologically, walks the sorted list grouping consecutive same-source URLs into chunks (CHUNK_SIZE = 50, DELAY_MS = 1500). Switches batch endpoints when source changes. Undated URLs go to the tail in file order.

4. **`backend/src/services/challonge.js`** — added `validatePokkenSlugs(slugs, {sleepMs})` and `looksLikePokkenTournament(meta)`. `discoverUserTournaments(username, {pages, validate=true})` runs validation by default. Keyword list checks `game_name` (regex `/pokk[eé]n/i`) and `name` against `pokken|pokkén|ferrum|fighting for cheese|neos|road to greatness|rtg|croissant|dcm|end of the road|eotr|heaven's arena|heavens arena|mouse cup|ねずみ`. 404s rejected, transient errors keep slug defensively. Both helpers exported.

5. **`pull_new.js`** (new file at project root) — one-shot orchestrator. Health-checks `localhost:3001/api/health`, runs `batch_import.js`, prompts about Tonamel/Liquipedia browser-console steps, prompts to run `recalculate_elo.js`, then runs `check_import_status.js`. Subprocesses use `stdio: 'inherit'` so output streams live.

#### IMPORTANT: tournaments.js was truncated mid-edit and surgically repaired

During the preview-dates Edit, the on-disk `backend/src/routes/tournaments.js` was truncated at 1751 lines (73492 bytes), ending mid-template-literal at `... DO UPDATE SET final_`. Most likely cause: Windows lock-screen interrupted I/O through the agent mount, leaving the Edit's last buffered chunk unwritten.

**The repair:** appended 52 lines covering the rest of the `ON CONFLICT` clause, the offline-stats loop, `importOneLiquipediaBracket`'s `return {...}`, the `/import-liquipedia-bracket` route handler, and all five `module.exports` lines. Sourced from the Read tool's pre-truncation cache. Final file is 1803 lines, syntax-clean.

**Backup of the truncated state** is at `backend/src/routes/tournaments.js.before_repair` (1751 lines, ends mid-line). Safe to delete via PowerShell once you've confirmed `importOneLiquipediaBracket` works:
```powershell
Remove-Item C:\Users\pitag\Documents\neos-city\backend\src\routes\tournaments.js.before_repair
```

**How to verify the repair is byte-faithful:** start the backend, POST a Liquipedia bracket payload to `/api/tournaments/import-liquipedia-bracket` (or paste `liquipedia_import_console.js` for any one event you've already imported). If matches and placements come back correct, the function body is fine. If `liquipediaUrl`, `importedMatches`, or `playerMap` ReferenceErrors appear, the reconstruction missed a variable name and the function needs another look.

**Recommendation regardless:** `git init` the project. Loss of byte-level history is what made this scary — a baseline commit would have made `git diff` definitive. ~30 seconds to set up, prevents this category of incident permanently.
**Update 2026-04-30:** done. See `GIT_WORKFLOW.md`. Any future truncation can now be recovered with `git checkout -- <file>`.

#### Top follow-up: make `/preview-dates` skip already-imported slugs

Identified during the import run. Right now `/preview-dates` hits Challonge once per URL regardless of DB state. With 518 harvested URLs and most already imported, that's ~500 wasted Challonge calls (and ~1–3 minutes of probe time) on every `pull_new.js` re-run.

Fix: at the top of the `/preview-dates` route, batch-load known dates from the DB and use them in place of the API call:

```js
const challongeSlugs = urls
  .filter(u => !String(u).includes('start.gg'))
  .map(u => challonge.extractSlugFromUrl(String(u).trim()))
  .filter(Boolean);
const { rows } = await db.query(
  'SELECT challonge_id, started_at FROM tournaments WHERE challonge_id = ANY($1)',
  [challongeSlugs]
);
const known = new Map(rows.map(r => [r.challonge_id, r.started_at]));

// Then in the per-URL loop, before hitting Challonge:
if (known.has(slug)) {
  results.push({ url, source: 'challonge', slug, date: known.get(slug), cached: true });
  continue;
}
```

Same shape for start.gg (key on `startgg_phase_group_id`, read `started_at`). After the fix, the probe phase on a stable harvested file should drop from minutes to seconds.

**Re-harvest (now automated via `harvest_new.js`).**

`harvested_tournaments.txt` is a static snapshot — the Apr 29 run found its latest URL dated Apr 1. To grow the file, run `harvest_new.js` from the project root. It loops over the seven known organizers (`wise_`, `rickythe3rd`, `shean96`, `rigz_`, `__chepestoopid`, `devlinhartfgc`, `__auradiance`), uses `challonge.discoverUserTournaments(username, { validate: false })` to scrape each profile, dedupes candidates against the harvested file *and* the DB, and only validates the genuinely new slugs against the Pokkén keyword list before appending. New URLs are written grouped by organizer with a date comment.

`pull_new.js` now offers `harvest_new.js` as Step 2/6, so the default flow refreshes the harvested file before importing. start.gg URLs are still manual-paste (no public list-by-organizer API). Tonamel and Liquipedia events live on separate pipelines (`tonamel_import_console.js`, `offline_import.js` + `liquipedia_import_console.js`) and need their own freshness checks.

**When an organizer's profile is 403-blocked from Node** (Challonge bot detection — has hit `rigz_` so far), use `harvest_console.js` instead. Paste it in DevTools while on the organizer's `https://challonge.com/users/USERNAME/tournaments` page. The browser session bypasses the IP/UA block, scrapes the URLs in-DOM, and POSTs to `POST /api/tournaments/append-harvest`. The backend dedupes against `harvested_tournaments.txt` + DB, runs `validatePokkenSlugs()` to drop non-Pokkén entries, and appends new validated URLs to the file. `https://challonge.com` is in the CORS allow list (`backend/src/app.js`).

Lower-priority follow-ups also worth flagging:

- **No per-tournament progress in `batch_import.js`.** A 50-URL chunk holds the HTTP request open for 5–15 minutes with no output — looks frozen even when working. Either reduce CHUNK_SIZE to 10 or add SSE/chunked-response progress to the backend route. Not urgent; users now know to watch the backend window for `✅ Batch imported` lines.
- **Pass-2 achievements still don't run on single-tournament imports** (known gap from prior sessions, item 1 under "What still needs testing"). The orchestrator's Step 4 (`recalculate_elo.js`) is the workaround.
- **`runner_up_finishes` and `{series}_top8` / `{series}_runner_up` still only populated by `recalculate_elo.js`** — same root cause, same workaround.

#### Things to verify when the import run finishes

1. `node check_import_status.js` output looks sensible (counts go up).
2. `recalculate_elo.js` finishes without errors (Pass-2 achievement step is the most likely failure point).
3. New JP players from any Tonamel events imported this session have `region = 'JP'` set without manual SQL — query: `SELECT COUNT(*) FROM players WHERE region = 'JP' AND created_at > '2026-04-29'`.
4. Reload `http://localhost:5173` and spot-check the home page for any new tournament cards.

---

### Prior state (as of Apr 7 2026 — front page revamp, ELO hidden, leaderboard removed from nav)

#### Front page revamp — DONE (Apr 7 2026)

**What changed:**
The home page no longer shows leaderboards. It's now an activity feed centered on recent online tournament results.

**Files changed:**
- `frontend/src/pages/Home.jsx` — REWRITTEN. Now shows:
  - **Recent Results**: Cards for each online tournament from the last 30 days, each showing top-8 placements with series color coding, player links, region flags.
  - **Sidebar**: Latest Events list (last 5 tournaments with series badges), Recent Achievements (last 8 unlocks), and Explore quick-links (Calendar, Achievements, All Tournaments, Live Match).
  - Removed: TOP TRAINERS leaderboard, TOP OFFLINE PLAYERS section, RECENT MATCHES section.
- `frontend/src/App.jsx` — Removed "Leaderboard" from nav. Route `/leaderboard` still works (accessible by direct URL).
- `frontend/src/pages/PlayerProfile.jsx` — Removed ELO display from header (big number + rank label), removed ELO History chart. Removed recharts/getRankLabel imports. Profile icon is now a static ⚔️ instead of rank-based icon.
- `frontend/src/lib/api.js` — Added `getRecentPlacements(days)` function.
- `backend/src/routes/tournaments.js` — Added `GET /api/tournaments/recent-placements` endpoint. Returns online tournaments from the last N days with their top-8 placements (player name, rank, region, career points). Query params: `?days=30&limit=8`.

**Design decisions:**
- ELO is **hidden from all UI** but still computed and stored in the backend. It can be re-exposed later if desired.
- Leaderboard page (`Leaderboard.jsx`) is **not deleted** — just removed from nav. Accessible at `/leaderboard` directly.
- The `getRankLabel()` util and the Leaderboard page still reference ELO internally — they're untouched since they're hidden.
- Series color coding uses `SERIES_META` object in Home.jsx with per-series border, accent, background, and badge colors matching the Calendar/Organizers color schemes.

**Not yet tested in browser** — code changes are syntactically clean but need visual testing on Gabriel's Windows machine.

#### Future work for next agents

**1. Recent Achievements on home page (frontend only)**
The home page sidebar already shows recent achievements. A future agent could:
- Expand this into a more prominent section (not just sidebar)
- Add achievement category icons/grouping
- Consider a "feed" style combining tournament results + achievement unlocks chronologically
- The backend endpoint `GET /api/achievements/recent?limit=N` already exists and works.

**2. Offline tournaments — recent top 8s (similar to online revamp)**
The home page currently shows NO offline tournament data. A future agent should:
- Add an "OFFLINE RESULTS" section similar to the online "RECENT RESULTS" cards
- Reuse the `TournamentCard` pattern but with amber/gold theming (consistent with existing offline styling)
- Backend: A similar endpoint to `recent-placements` is needed for offline — `GET /api/tournaments/recent-offline-placements`. The query would filter `WHERE is_offline = TRUE` instead.
- Note: Offline tournaments use the `series` column for tier (worlds/major/regional/other) — the card should show tier badge instead of series badge.
- The `tournament_placements` table already has offline tournament placements (from `offline_import.js` + `liquipedia_import_console.js` bracket data).
- Top 8 data is available for the 16 events that had bracket imports; the other 58 offline events only have winner + runner-up (final_rank 1 and 2).

**3. ELO re-exposure (if desired later)**
ELO is fully intact in the backend. To re-expose:
- `PlayerProfile.jsx` still has the ELO history query in the backend `/api/players/:id` route — just needs the chart component re-added to the frontend.
- The `getRankLabel()` util is untouched and ready.
- The Leaderboard page works as-is at `/leaderboard`.

---

### Prior state (as of Mar 29 2026 — calendar page added, achievement revamp still needs migration + testing)

#### Calendar page — DONE (Mar 29 2026)

**New page: `/calendar`** — a tournament calendar with monthly and weekly views.

**Files added/changed:**
- `frontend/src/pages/Calendar.jsx` — NEW. Full calendar page with:
  - **Monthly grid view** — traditional calendar, click a day to jump to weekly view for that week
  - **Weekly view** — time-slot grid (10:00–23:00 UTC) for seeing exactly when tournaments happen
  - **Series color coding** — each series has its own color (FFC=purple, RTG NA=blue, RTG EU=green, DCM=orange, TCC=pink, EOTR=yellow, Nezumi=rose, Rookies=amber, HA=cyan). Offline tiers also color-coded.
  - **Recurring placeholders** — dashed-outline pills for future scheduled events, generated from `SERIES_SCHEDULES` array at top of file. Currently set to: FFC biweekly Sat, RTG NA weekly Sat, RTG EU biweekly Sat, DCM monthly Sat, TCC biweekly Sat, Nezumi monthly Sun. **These patterns are Gabriel's best guess and may need tuning.**
  - **Series filter** — toggle buttons to show/hide specific series
  - **Past events link** to `/tournaments/:id`; placeholders are non-clickable
  - **Today highlight** — indigo circle in month view, column highlight in week view
  - **Timezone note** — "Times shown in UTC. Timezone-aware display coming soon." Future work: adapt to user's local timezone when hosted.
- `frontend/src/App.jsx` — Added `import Calendar` and:
  - Nav link "Calendar" between "Tournaments" and "Achievements"
  - Route: `<Route path="/calendar" element={<Calendar />} />`

**No backend changes needed** — calendar fetches all tournaments via existing `getTournaments(false)` + `getTournaments(true)` and indexes them by date.

**No new dependencies** — pure React + Tailwind, uses existing api.js exports.

**Not yet tested in browser** — code compiles cleanly (verified via esbuild syntax check + full bundle build). Couldn't test visually because the sandbox can't reach Supabase DB. Gabriel needs to test on his Windows machine.

**Future calendar enhancements to consider:**
- Timezone-aware display (store event times in UTC, convert to user's local TZ)
- Manual future event entries (for offline events or one-offs)
- iCal export / "add to calendar" links
- Heaven's Arena (HA) recurring schedule (needs anchor date from Gabriel)

---

#### Achievement revamp — code written, NOT deployed (from prior session)

**ACHIEVEMENT REVAMP — code is written, not yet deployed.** This was a full redesign of the achievement system. All code changes are saved to disk but the DB migration has NOT been run and nothing has been tested yet.

#### What the revamp changes

The old system had 74 flat achievements (debut/regular/veteran/elite_four/champion/grand_champion per series). The new system uses a **Pokémon region progression model**:

- **Placement tiers:** Gym Leader (top 8), Elite Four (top 4), Rival (2nd), Champion (1st)
- **Region tiers:** Kanto (1×) → Johto (3×) → Hoenn (5×) → Sinnoh (10×) → Unova (20×) → Kalos (40×) → Alola (80×) → Galar (150×)
- **Scopes:** Global + 8 online series (FFC, RTG NA/EU, DCM, TCC, EOTR, Nezumi, HA). **Nezumi Rookies excluded from achievements** (stats still tracked).
- **Match-based (Pass 2):** Rival Battle!, Smell Ya Later!, Foreshadowing, Dark Horse — region-tiered. Depend on opponent having Rival/Champion achievements.
- **Meta (Pass 2):** 8 Badges! (defeat 8 unique Gym Leaders at region+), Elite Trainer (defeat 4 unique Elite Four at region+) — region-tiered.
- **Multi-series:** "World Traveler" — participate in 2+ distinct series.
- **Auto-cascade:** Getting a higher region tier auto-grants lower ones (naturally via threshold checks: if you have 5 wins, you pass >=1, >=3, >=5).
- **Two-pass system:** Pass 1 = stat-based (after each player's stats update). Pass 2 = query-based (after ALL players' Pass 1 achievements are committed, checks opponent achievements).
- **~409 total achievements** (288 placement + 72 participation + 32 match-based + 16 meta + 1 special).
- **Offline achievements are deferred** — Gabriel said offline will have "a different system that's more literal."

#### Files changed this session

**Backend:**
- `backend/src/services/achievements.js` — COMPLETE REWRITE. Programmatic generation of all achievements. Exports: `checkAchievementsPass1(stats)`, `checkAchievementsPass2(playerId, db, alreadyUnlocked)`, `computeMetaProgress(playerId, db, alreadyUnlocked)`, `highestRegions(achievementIds)`. Also keeps `detectSeries()`, `detectOfflineTier()` unchanged.
- `backend/src/routes/achievements.js` — Rewritten. New endpoints: `GET /recent` (recent unlocks across all players), `GET /holders?achievement_id=X` (who has an achievement — supports future "what players are elite four in johto?" queries), `GET /leaderboard` (enriched with highest_regions). GET `/` now supports query params: `?category=&scope=&tier=&region=`.
- `backend/src/routes/players.js` — Updated. `GET /api/players` now enriches each player with `highest_regions` (best region tier per placement). `GET /api/players/:id` now includes `highest_regions` and `meta_progress` (partial progress toward 8 Badges / Elite Trainer).
- `backend/src/db/migrations/achievement_revamp.sql` — Adds 17 new columns: `runner_up_finishes` (global) + `{series}_top8` and `{series}_runner_up` for all 8 series. Also clears old achievement data (DELETE FROM player_achievements; DELETE FROM achievements).

**Scripts:**
- `recalculate_elo.js` — REWRITTEN. Now tracks per-series top8/runner_up in addition to existing stats. Has a 7-step flow: reset ELO → replay matches → placement bonuses → write ELO → rebuild stats → Pass 1 achievements → Pass 2 achievements. Uses dynamic SET clause to handle all 9 series × 5 stat fields.
- `seed_achievements_v3.js` — NEW. Node.js script that reads `ACHIEVEMENTS` from achievements.js and upserts all ~409 rows into the DB achievements table. Run with `node seed_achievements_v3.js`.

**Frontend:**
- `frontend/src/lib/api.js` — Added `getRecentAchievements(limit)` and `getAchievementHolders(achievement_id)`.
- `frontend/src/pages/Home.jsx` — Added `RegionBadges` component showing highest Gym Leader/Elite Four/Champion tiers next to top trainers. Added "RECENT ACHIEVEMENTS" section showing latest 8 unlocks.
- `frontend/src/pages/PlayerProfile.jsx` — Complete achievement section revamp: achievements grouped by category, hover tooltips showing descriptions, region tier badges in header, meta-achievement progress bars (8 Badges / Elite Trainer showing e.g. "5/8" with progress bar). Region tiers have color-coded badges (Kanto=red, Johto=purple, Hoenn=emerald, etc.).
- `frontend/src/pages/Achievements.jsx` — Complete catalog revamp: category navigation buttons, tier×region grid view (rows = tiers, columns = Kanto→Galar with thresholds), hover for descriptions. Series-specific views show the same grid but scoped.

#### Immediate next steps — deploy the revamp

```powershell
# Step 1: Run the achievement revamp migration (adds columns, clears old achievements)
cd neos-city
node run_migration.js backend/src/db/migrations/achievement_revamp.sql

# Step 2: Also run the offline tiers migration if not done yet
node run_migration.js backend/src/db/migrations/add_offline_tiers.sql

# Step 3: Seed the new achievements into the DB
node seed_achievements_v3.js

# Step 4: Start the backend
cd neos-city/backend
npm run dev

# Step 5: Run full ELO recalculation (also awards all achievements)
cd neos-city
node recalculate_elo.js

# Step 6: Start frontend and verify
cd neos-city/frontend
npm run dev
```

#### What still needs testing / may need fixes

1. **The `tournaments.js` import route** — the `updatePlayerStatsAndAchievements` function still references the old `checkAchievements()` which is now aliased to `checkAchievementsPass1`. It needs updating to also run Pass 2 after all players in a tournament are processed. Currently it only does Pass 1 per-player inline. **This is a known gap** — the recalculate_elo script handles both passes correctly, but single-tournament imports won't trigger Pass 2 achievements until the next recalculation.
2. **New stat columns in tournaments.js UPDATE query** — the `updatePlayerStatsAndAchievements` function's UPDATE query doesn't yet include the new `runner_up_finishes`, `{series}_top8`, `{series}_runner_up` columns. These only get populated by `recalculate_elo.js` currently. For live imports to work fully, the tournaments.js UPDATE query needs to be extended.
3. **Frontend testing** — none of the frontend changes have been viewed in a browser yet. May have rendering issues.
4. **Edge cases** — the `oppHasTier()` function in achievements.js checks if an achievement ID contains `_rival_` or `_champion_` patterns to determine if an opponent is a Rival/Champion. This should work but needs validation with real data.
5. **Achievement count** — verify `node seed_achievements_v3.js` reports the expected ~409 count.

#### Still pending from prior sessions

- **Bracket import still partially done** — 16/76 Liquipedia events have bracket match data. Legacy parser is written but the full import run hasn't been completed.
- **Offline tiers migration may not have been run yet** — check with `SELECT series, COUNT(*) FROM tournaments WHERE is_offline = true GROUP BY series`.

**Prior session changes (offline tiers):**
- `tournaments.js`: `importOneOffline()` now auto-classifies via `detectOfflineTier()` and writes to `series` column
- `Tournaments.jsx`: Offline tab now groups by tier (Worlds → Majors → Regionals → Locals) instead of by year
- `add_offline_tiers.sql`: Migration to retroactively tag existing offline tournaments
- `run_migration.js`: Reusable utility to run any SQL migration from the CLI

**Backend changes from prior sessions:**
- `app.js` CORS now allows `https://liquipedia.net` and `https://tonamel.com`
- Rate limit bumped from 100 to 500 requests per 15 min

---

### What was completed across previous sessions

- ✅ **Calendar page** — `/calendar` route with monthly grid + weekly time-slot views, series color coding, recurring future event placeholders, series filter toggles. `Calendar.jsx` + App.jsx route/nav changes.
- ✅ **Tonamel migration** — `add_tonamel_support.sql` run in Supabase
- ✅ **Nezumi achievements seeded** — 10 new rows in `seed_achievements.sql`
- ✅ **Tonamel import complete** — 31/33 tournaments imported (2 skipped: `iJhJJ` and `mdmSf` are round-robin format with no bracket matches)
- ✅ **JP region tagging** — all players who appeared in Tonamel tournaments have `region = 'JP'`
- ✅ **`recalculate_elo.js` updated** — now computes `nezumi_entered/top4/wins` and `nezumi_rookies_entered/top4/wins` per-player stats
- ✅ **Region split on leaderboard** — `Leaderboard.jsx` has All / NA / EU / JP tabs
- ✅ **Offline tournament support built** — `add_offline_support.sql` migration, `offline_import.js` (74 events → 87 in DB), Online/Offline tabs in `Tournaments.jsx`
- ✅ **Liquipedia bracket import built** — `add_liquipedia_url.sql` migration, `POST /api/tournaments/import-liquipedia-bracket` backend route, `liquipedia_import_console.js` browser console script (76 events)
- ✅ **Bracket import partially run** — 16/76 events imported with 364 matches (new-style brackets only)
- ✅ **`check_import_status.js` created** — diagnostic script to check import progress from CLI

### Skipped Tonamel tournaments

`iJhJJ` (6th Rookies) and `mdmSf` (4th Rookies) use round-robin format. The DOM bracket parser finds zero matches for them. They are not importable without a different approach. The org page shows them as real events with participants — they just don't have a standard bracket.

### Tonamel import counts

- **nezumi** (Mouse Cup): 25 imported
- **nezumi_rookies** (Rookies): 6 imported (2 round-robin skipped)
- **other** (ポッ拳バズイー杯): 0 imported (it's a single one-off; if needed, re-run tonamel_import_console.js)

---

## start.gg Integration

### Setup (run migration first)
Before importing any start.gg tournaments, run `backend/src/db/migrations/add_startgg_support.sql`
in the Supabase SQL editor. This makes `challonge_id` nullable and adds:
- `source TEXT DEFAULT 'challonge'` — tracks whether a tournament came from Challonge or start.gg
- `startgg_slug TEXT` — the tournament slug (e.g. `heaven-s-arena-20`)
- `startgg_phase_group_id TEXT UNIQUE` — the bracket's phase group ID (the second number in the `/brackets/PHASE/PHASEGROUP` URL)

### Token
`STARTGG_TOKEN` in `backend/.env` holds a personal access token created at:
`start.gg → Admin → Developer Settings → Personal Access Tokens`
Token name: "Neos City Tournament Importer"

### API endpoint
`https://api.start.gg/gql/alpha` — standard GraphQL, `Authorization: Bearer TOKEN`

### URL format
`https://www.start.gg/tournament/{slug}/events/{event}/brackets/{phaseId}/{phaseGroupId}/overview`
The **phaseGroupId** (second number) is the key identifier. It's unique per bracket.

### Import flow
- `backend/src/services/startgg.js` — GQL helper, `getPhaseGroup()`, `getAllSets()`, `parseStartggUrl()`
- `importOneStartgg(phaseGroupId)` in `tournaments.js` — mirrors `importOne()` for Challonge
- `POST /api/tournaments/import-startgg` — single bracket import: `{ url }` or `{ phase_group_id }`
- `POST /api/tournaments/batch-import-startgg` — bulk: `{ urls: [...] }`

### Player deduplication
start.gg entrant names are lowercased and used as `challonge_username` keys. A player named
"pitaguy" on start.gg will merge with an existing Challonge player named "pitaguy". No prefix added.

### Dates
`tournament.startAt` and `tournament.endAt` from start.gg are Unix timestamps (seconds).
The import converts them: `new Date(startAt * 1000).toISOString()` → stored in `started_at` / `completed_at`.
This lets all tournaments (Challonge + start.gg) be sorted together chronologically.

### Batch script
`batch_import.js` now auto-detects URLs: lines containing `start.gg` go to the start.gg endpoint,
everything else goes to the Challonge endpoint. Run `node batch_import.js` as before.

### Import order & ELO correctness
The batch script does **not** sort by date — it imports Challonge first, then start.gg, in file order.
This is intentional. After all imports are complete, run the ELO recalculation script:

```
node recalculate_elo.js
```

This script (`neos-city/recalculate_elo.js`):
- Resets all `elo_rating` to 1200 and clears `elo_history`
- Replays every completed match across all tournaments, sorted by `completed_at ASC` then `round ASC`
- Applies placement bonuses after each tournament
- Rebuilds all player aggregate stats (wins, losses, streaks, per-series stats, etc.)
- Is fully idempotent — safe to re-run anytime (e.g. after adding more tournaments)

---

## Region Separation (Leaderboard)

Players now have a `region TEXT` column (`'NA'`, `'EU'`, `'JP'`, or `NULL`).

- **Frontend:** `Leaderboard.jsx` has four tabs: All 🌐, NA 🇺🇸, EU 🇪🇺, Japan 🇯🇵.
  Selecting a tab filters the API request: `GET /api/players?region=JP`.
- **Backend:** `GET /api/players` accepts optional `?region=NA|EU|JP` query param.
  All-regions view returns every player regardless of region (including NULL).
- **Setting a player's region:** No UI yet — set it directly in Supabase SQL:
  ```sql
  UPDATE players SET region = 'NA' WHERE challonge_username = 'pitaguy';
  UPDATE players SET region = 'EU' WHERE challonge_username = 'someeuname';
  UPDATE players SET region = 'JP' WHERE challonge_username = 'nezumiusername';
  ```
  All existing Tonamel players already have `region = 'JP'`.
  **Newly imported Tonamel players are now auto-tagged `region = 'JP'`** by
  `importOneTonamel()` in `tournaments.js` (uses `INSERT ... ON CONFLICT DO UPDATE
  SET region = COALESCE(players.region, 'JP')` so existing non-NULL regions are
  preserved). The bulk-fix SQL below is only needed for back-filling players
  imported before the auto-tag landed:
  ```sql
  UPDATE players SET region = 'JP'
  WHERE id IN (
    SELECT DISTINCT m.player1_id FROM matches m
    JOIN tournaments t ON m.tournament_id = t.id WHERE t.tonamel_id IS NOT NULL
    UNION
    SELECT DISTINCT m.player2_id FROM matches m
    JOIN tournaments t ON m.tournament_id = t.id WHERE t.tonamel_id IS NOT NULL
  ) AND region IS NULL;
  ```
- **Flag icons** appear next to player names on the All-regions leaderboard once region is set.

---

## Tonamel Integration (ポッ拳ねずみ杯 — Mouse Cup)

### Overview

Tonamel is a Japanese tournament platform. The ポッ拳ねずみ杯 オンライン org runs two series:
- **ねずみ杯** (Mouse Cup) — main series, 25 events (Feb 2024 – Mar 2026)
- **ねずみ杯 Rookies** — rookies division, 7 events (Apr 2024 – Feb 2026)
- **ポッ拳バズイー杯** — one-off event (Aug 2024)

Tonamel org page: `https://tonamel.com/organization/OhUc2?game=pokken`

### Series keys
| Series key        | Description                      |
|-------------------|----------------------------------|
| `nezumi`          | ポッ拳ねずみ杯 オンライン         |
| `nezumi_rookies`  | ポッ拳ねずみ杯Rookies オンライン  |

### How the importer works

Tonamel uses a GraphQL API that requires session cookies — it can't be called from a plain Node.js HTTP request without a browser session. Instead:

1. The bracket data is scraped from the **public DOM** of each tournament's bracket page (`/competition/{id}/tournament`)
2. The browser console script does the scraping and POSTs the parsed data to the backend
3. The backend's `importOneTonamel()` function processes it identically to Challonge/start.gg

**No Tonamel account is required** — all bracket pages are publicly viewable.

### DB schema additions (migration: `add_tonamel_support.sql`)

```sql
ALTER TABLE players ADD COLUMN IF NOT EXISTS region TEXT;  -- 'NA', 'EU', 'JP'
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_entered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_top4 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_rookies_entered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_rookies_top4 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS nezumi_rookies_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tonamel_id TEXT;
```

Run `backend/src/db/migrations/add_tonamel_support.sql` in Supabase SQL editor **before** importing.

### How to import Tonamel tournaments

1. Start the backend: `cd neos-city/backend && npm run dev`
2. Open Chrome, navigate to any Tonamel bracket page
   (e.g. `https://tonamel.com/competition/Sbekx/tournament`)
3. Open DevTools Console, paste the contents of `neos-city/tonamel_import_console.js`, press Enter
4. The script will navigate to each of the 33 tournaments, parse the bracket DOM, and POST to the backend
5. Leave the tab open — it takes ~5-8 seconds per tournament (~4-5 min total)

### Achievements

Mouse Cup achievements: `nezumi_debut`, `nezumi_regular`, `nezumi_veteran`, `nezumi_elite_four`, `nezumi_champion`, `nezumi_grand_champion`

Rookies achievements: `nezumi_rookies_debut`, `nezumi_rookies_elite_four`, `nezumi_rookies_champion`, `nezumi_rookies_grand_champion`

All seeded via `seed_achievements.sql` — re-run that after the migration to add the new achievement rows.

### Placement algorithm

Tonamel uses double-elimination. Match IDs encode the bracket position: `#W3-1` (Winners R3 M1), `#L2-1` (Losers R2 M1). The importer derives placements using a weight function: W-round n = weight `2n-1`, L-round n = weight `2n`, so rounds interleave correctly (W1 < L1 < W2 < L2 ...). The player who wins the highest-weight match gets 1st; all others are ranked by the weight of their last appearance (descending).

### Backend routes
- `POST /api/tournaments/import-tonamel` — single event, body = `{ tonamel_id, name, series, date, participants_count, matches }`
- `POST /api/tournaments/batch-import-tonamel` — batch, body = `{ tournaments: [...] }`

---

## Offline Tournament Support (Liquipedia)

Real-world offline events are stored separately from the online tournament data. They do **not** affect ELO — the competitive leaderboard stays online-only. Offline results are a historical record.

### DB additions (migration: `add_offline_support.sql`)

```sql
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS is_offline BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS prize_pool TEXT,
  ADD COLUMN IF NOT EXISTS liquipedia_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tournaments_liquipedia_slug_unique
  ON tournaments (liquipedia_slug) WHERE liquipedia_slug IS NOT NULL;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS offline_wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offline_top2 INTEGER NOT NULL DEFAULT 0;
```

Run `backend/src/db/migrations/add_offline_support.sql` in Supabase **before** importing.

### How to import offline tournaments

1. Start the backend: `cd neos-city/backend && npm run dev`
2. Run: `node offline_import.js` from the `neos-city` directory
3. The script imports all 74 Pokkén offline events (2016–2026) from the hardcoded Liquipedia data
4. Safe to re-run — already-imported slugs are skipped

### Backend routes

- `POST /api/tournaments/import-offline` — single event: `{ name, date, location, prize_pool, participants_count, winner, runner_up, liquipedia_slug }`
- `POST /api/tournaments/batch-import-offline` — batch: `{ tournaments: [...] }`
- `GET /api/tournaments?is_offline=true` — returns only offline events
- `GET /api/tournaments?is_offline=false` — returns only online events (used by the Online tab)

### Offline Tiers

Offline tournaments are classified into four tiers via the `series` column (reusing the existing field). Detection is name-based via `detectOfflineTier(name)` in `achievements.js`.

| Tier       | Series value | What it covers |
|------------|-------------|----------------|
| `worlds`   | `'worlds'`  | World Championships, International Championships (NA/EU/OCE) |
| `major`    | `'major'`   | EVO, CEO, DreamHack, Frosty Faustings/Vortex Gallery, Genesis, Curtain Call, Final Boss, Destiny, Frostfire, NEC (full series), Final Round (full series), NorCal Regionals (full series), Defend the North (full series), and specific events: Winter Brawl 12, Winter Brawl 3D 2019, SoCal Regionals 2017, Summer Jam XI, Toryuken 8, Eye of the Storm 2018, The Fall Classic 2017, Smash Conference LXIX |
| `regional` | `'regional'`| Winter Brawl (other years), SoCal Regionals (other years), Summer Jam (other years), BAM, OzHadou, Revolution, Toryuken (other), Kumite In Tennessee, Eye of the Storm (other), The Fall Classic (other), Canada Cup, All In Together, FightClub Championship |
| `other`    | `'other'`   | Everything else (locals / one-offs). Texas Showdown 2016 demoted here 2026-05-08. |

Migration: `backend/src/db/migrations/add_offline_tiers.sql` — retroactively tags existing offline tournaments.
Run with: `node run_migration.js backend/src/db/migrations/add_offline_tiers.sql`

The `run_migration.js` utility script (in the neos-city root) runs any SQL file against the Supabase DB. Usage: `node run_migration.js <path-to-sql-file>`. It loads credentials from `backend/.env` automatically.

New offline imports are auto-classified by `importOneOffline()` which calls `detectOfflineTier()` and writes to the `series` column.

### Frontend

- `Tournaments.jsx` now has two tabs: **🎮 Online** (existing import grid) and **🏆 Offline** (Liquipedia table)
- Offline tab groups events by tier (Worlds → Majors → Regionals → Locals), each with a distinct color and count badge
- No region filter on the offline tab — offline Pokkén is one global scene
- Winner/runner-up are fetched per-row via `GET /api/tournaments/:id` (returns placements)

### Player stats

- `offline_wins` — how many offline events they won (1st place)
- `offline_top2` — how many times they finished 1st or 2nd
- These update automatically on each import

### Data source

`neos-city/offline_import.js` — 74 tournaments, 2016–2026, sourced from:
https://liquipedia.net/fighters/Pokkén_Tournament/Tournaments

---

## Liquipedia Bracket Import (Full Match Data + ELO)

This is separate from the basic offline import above. The bracket import pulls **all individual match results** from Liquipedia bracket pages and feeds them into the ELO system.

### When to use this vs. `offline_import.js`

| Script | What it imports | ELO? |
|---|---|---|
| `offline_import.js` | 74 tournaments — name, date, location, prize, winner, runner-up only | ❌ No |
| `liquipedia_import_console.js` | All bracket matches for any event that has a bracket page | ✅ Yes |

The two scripts work together: `offline_import.js` first creates the tournament rows and fills in the metadata. Then `liquipedia_import_console.js` finds those same rows (by `liquipedia_url` or ILIKE name match) and enriches them with full match data.

### Additional DB migration (`add_liquipedia_url.sql`)

Before running the bracket import, apply this migration:

```sql
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS liquipedia_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_liquipedia_url_unique
  ON tournaments (liquipedia_url) WHERE liquipedia_url IS NOT NULL;
```

File: `backend/src/db/migrations/add_liquipedia_url.sql`
Run it in Supabase SQL editor (it's idempotent — safe to re-run).

### How to import bracket data

1. Start the backend: `cd neos-city/backend && npm run dev`
2. Open Chrome, navigate to **any page on `liquipedia.net`** (important: must be on liquipedia.net so the `fetch()` calls are same-origin and bypass CORS)
3. Open DevTools Console, paste the full contents of `neos-city/liquipedia_import_console.js`, press Enter
4. The script fetches all 76 Pokken bracket pages in sequence, parses them with `DOMParser`, and POSTs to the backend
5. Adds 800ms delay between fetches — respectful crawling. Total time: ~10–15 minutes
6. Reports summary at the end: `imported / no bracket / skipped / errors`

The script is **idempotent** — already-imported brackets (matched by `liquipedia_url`) are skipped automatically.

### How the bracket importer works (technical)

- **Same-origin fetch trick**: The script fetches all bracket pages as HTML strings using `fetch()` while on a liquipedia.net tab — no navigation, no tab switching, no CORS issues
- **DOMParser parsing**: Each response is parsed with `new DOMParser().parseFromString(html, 'text/html')` — no layout/pixel info, DOM order is used as round proxy
- **Match parsing**: Finds `.brkts-match` elements, extracts player names and scores, determines winner by higher numeric score (handles W/DQ walkovers)
- **Weight assignment**: Match DOM order is used as a proxy for bracket round/position. Upper bracket match `i` → weight `i+1`. Player winning highest-weight match = 1st place.
- **Tournament linkup**: Uses `liquipedia_url` (URL path minus `/fighters/` prefix and `/Bracket` suffix, lowercased) to find the existing offline tournament row. Falls back to ILIKE name match. Creates a new row if neither matches.
- **ELO computation**: Full ELO is computed inline for all imported matches (same K-factor / placement bonus system as Challonge/start.gg/Tonamel)
- **Deduplication key**: Matches get an `external_id` of `liq_{tournamentId}_{round}_{section}_{p1}_{p2}` — safe to re-run

### Backend route

`POST /api/tournaments/import-liquipedia-bracket` — body:
```json
{
  "bracketUrl": "https://liquipedia.net/fighters/Frostfire/2022/Pokken/Bracket",
  "name": "Frostfire 2022 - Pokkén",
  "date": "2022-01-15",
  "location": "Online",
  "prize_pool": null,
  "participants_count": 32,
  "matches": [
    { "round": 1, "section": "W", "player1": "Jukem", "player2": "TEC", "score1": 2, "score2": 0, "winner": "Jukem" }
  ]
}
```

### After import

Run `node recalculate_elo.js` to replay all matches chronologically and correct ELO ordering.

### Order of operations (full fresh import)

1. Run `add_offline_support.sql` in Supabase
2. Run `add_liquipedia_url.sql` in Supabase
3. `node offline_import.js` — creates 74 tournament rows with metadata
4. Paste `liquipedia_import_console.js` in Chrome DevTools on liquipedia.net — enriches with bracket matches + ELO
5. `node recalculate_elo.js` — fixes chronological ELO ordering

---

## Known Issues / TODOs

1. **Scraper fragility** — if Challonge changes their HTML structure, `scrapeUserTournaments` will silently return bad slugs. A future improvement would be to add a slug validation step (check that the fetched tournament has a known Pokken-related name before importing).

2. **Duplicate player detection** — Players are matched by Challonge display name. If a player changes their Challonge name between tournaments, they'll get two separate player records. No deduplication or alias system exists yet.

3. **Live rooms** — `backend/src/routes/live.js` exists and has room creation + score reporting, but there's no persistent storage for rooms (they're in-memory). A server restart wipes all active rooms.

4. **ELO history** — Schema has `elo_history` tracked but the frontend player profile may not be fully displaying the chart yet.

5. **Achievements seeding** — After running `seed_achievements.sql`, verify with `SELECT COUNT(*) FROM achievements;`. Should return a count in the 40–60 range across all series.

---

## What Gabriel Cares About

- The community is small and tight-knit. The app should feel like it's made *for* them, not just *about* them.
- He wants players to feel celebrated, not ranked into irrelevance.
- The achievement names and flavor text should feel like inside jokes or references that the community would recognize.
- "FFC" = Ferrum Fist Challenge. The "Fighting for Cheese" name is a recurring bit that wise_ uses on Challonge sometimes — don't surface it prominently in the UI.
- Start.gg also has some Pokkén events. Integration is now live — see start.gg section below.

## Agent Preferences

- **Do NOT run Supabase SQL queries via Chrome automation without asking Gabriel first.** Instead, create a Node.js script in the `neos-city` directory and give him the command to run it himself.
- For quick DB diagnostics, use `check_import_status.js` or similar one-off scripts rather than the Supabase SQL editor.
