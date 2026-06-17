# Worktree Summary — players-cup

**Branch:** `agent/players-cup`
**Base:** `main`
**Worktree path:** `C:\Users\pitag\Documents\neos-city-worktrees\players-cup`
**Created:** 2026-06-17

## Goal
Add the **Pokémon Players Cup** (Pokkén Tournament DX) as a new display-only series
`players_cup`, and import the 3 editions that ran Pokkén (PPC I, III, IV) with their
**verified** Global Finals matches + authoritative placements.

Decisions locked with Gabriel this session:
- **Verified matches only** — no guessed matches (they feed stored ELO). Incomplete
  brackets stay incomplete.
- **New `players_cup` series** (NOT online ELO), modeled on the MTM "display-only"
  pattern: own badge/color, no achievement track, no per-series stat columns.
- Imported as **`is_offline = TRUE`** so it never enters the online ladder or Online
  tab. (Offline bracket matches DO still feed the UI-hidden stored ELO — same as
  every existing Liquipedia offline bracket. Consistent + acceptable; ELO is hidden.)

## Changes (committed on this branch)
1. `backend/src/services/achievements.js`
   - `SERIES.PLAYERS_CUP = 'players_cup'`
   - `SERIES_NAMES.players_cup = 'Pokémon Players Cup'`
   - `detectOfflineTier()` returns `players_cup` for names containing `PLAYERS CUP`
     (checked first). Syntax-checked; nothing else touched.
2. `players_cup_data.js` (worktree root) — the **verified dataset**: 3 events, explicit
   authoritative placements, verified matches, per-player `canonical` dedup names,
   source citations + confidence notes. Syntax-checked.

### Why no DB migration
`series` is free-text, so `'players_cup'` is just a new value. Deliberately NOT added
to `OFFLINE_TIERS` / `ALL_SERIES` in `recalculate_elo.js`, so no `offline_players_cup_*`
columns are generated and no schema change is needed (recalc's `if (ss)`/`if (ot)`
guards no-op unknown keys). Placements still feed generic `offline_wins`/`offline_top2`
and global achievements.

## How to verify (after the TODO + deploy below)
- Tournaments → Offline tab shows a "Pokémon Players Cup" group with 3 events.
- Winners/runners-up correct: Shadowcat/Jukem (I), Jukem/Shadowcat (III), Wise/TEC (IV).
- `players_cup` does NOT appear on the online leaderboard or Online tab.
- No duplicate "Kira" player; "Wise" maps to the intended existing record.

## Known gaps / follow-ups (NOT done here — need decisions / live DB)

### A. Import mechanism (main remaining build)
`import-liquipedia-bracket` auto-derives placements from match order — wrong here
(PPC IV: 2 verified matches, known top 3). Placements must be set **explicitly**.
Recommended: a small `POST /import-players-cup` route + `players_cup_import.js` that
per event upserts the tournament (`is_offline=TRUE`, `series='players_cup'`), inserts
the explicit placement rows, and inserts the verified matches — mirror
`importOneLiquipediaBracket`'s match/ELO/player plumbing but take placements from the
payload. **Player upsert MUST key on the `canonical` field, not the display name.**

### B. Frontend — Offline tab grouping + color
`frontend/src/pages/Tournaments.jsx` groups offline events by tier with a color map —
add a `players_cup` group (suggest above Worlds; gold/official theme). Grep `worlds`
in `frontend/src`; optionally extend SERIES_META in `Home.jsx`/`Calendar.jsx` and the
tier-label maps in `OfflinePlacementsModal.jsx` / `AchievementTournamentsModal.jsx`.

### C. Deploy (Gabriel runs on MAIN after merge — can't run from a worktree)
```powershell
cd C:\Users\pitag\Documents\neos-city
# backend restart picks up achievements.js
node players_cup_import.js     # once route+script from (A) exist
node recalculate_elo.js        # ELO + stats + achievements
node check_import_status.js
```
No SQL migration required.

## ⚠ Player-merge hazards (no alias system — handle at import time)
- **Two distinct "Kira" players**: Kira Péniquaud (FR) vs Kira Pallazzoni (Sandy, EU),
  both in PPC IV. `players_cup_data.js` disambiguates via `canonical` (`'Kira FR'` vs
  `'Kira Sandy'`). A naive display-name key WILL merge them — don't.
- **"Wise"** = FFC organizer (online slug `wise_`). Decide canonical row before import.
- **Jukem / Shadowcat / TEC / Deity Light** already exist from Liquipedia brackets
  under those exact strings — merge cleanly.
- **"Allister"** vs Bulbapedia "Allsiter" — pick one spelling.

## Data confidence (full matches in players_cup_data.js)
All three editions are ✅ COMPLETE — full 14-match double-elim brackets + ranks 1-8,
transcribed from official broadcast Global Finals bracket graphics. A few
Winners/Losers/Grand-Finals boxes were blank on the captures; those winners are fixed
by verified recaps + bracket logic (`score: ''` = result certain, game score unknown).
- **PPC I (2020-08-16)** — ✅ COMPLETE (1 Shadowcat, 2 Jukem, 3 Deity Light).
- **PPC III (2021-04-25)** — ✅ COMPLETE (1 Jukem, 2 Shadowcat, 3 Allister). A separate
  PPC III **NA qualifier** graphic also exists (different phase) — not imported.
- **PPC IV (2021-08-01)** — ✅ COMPLETE (1 Wise, 2 TEC, 3 Shadowcat).

## Merge command
```powershell
cd C:\Users\pitag\Documents\neos-city
node merge-worktree.js players-cup
```
