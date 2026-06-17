# start.gg Import Runbook — Battle at Lake Valor & Nietplay

Research + artifact prep, enumerated **2026-06-17** via `enumerate_startgg.js`
(read-only; hits the start.gg GraphQL API, no DB writes). No series-code changes made.

---

## 1. Enumerated Pokkén brackets

All data below is live from start.gg. "POKKÉN" = videogame id 447 (`Pokkén Tournament DX`).

| Tournament | Date (startAt) | start.gg `isOnline` | Venue | Event | Entrants | phaseGroupId | Bracket URL |
|---|---|---|---|---|---|---|---|
| Battle at Lake Valor | 2022-04-30 | **false** | Lansing, MI, US | Pokken 1v1 — Pool 1 | 39 (event) | 1691801 | `.../events/pokken-1v1/brackets/1083027/1691801` |
| Battle at Lake Valor | 2022-04-30 | **false** | Lansing, MI, US | Pokken 1v1 — Pool 2 | 39 (event) | 1704395 | `.../events/pokken-1v1/brackets/1083027/1704395` |
| Battle at Lake Valor | 2022-04-30 | **false** | Lansing, MI, US | Pokken 1v1 — **Top 8** | 39 (event) | 1733274 | `.../events/pokken-1v1/brackets/1113971/1733274` |
| Battle at Lake Valor 2 | 2023-05-20 | **false** | Hilliard, OH, US | Bracket | 16 | 1942618 | `.../events/bracket/brackets/1266551/1942618` |
| Nietplay Tournament | 2019-02-09 | **false** | Leeds, GB | Nietplay Tournament (1v1) | 18 | 832728 | `.../events/nietplay-tournament/brackets/473478/832728` |
| Nietplay Tournament | 2019-02-09 | **false** | Leeds, GB | 3v3 Team Battle *(side)* | 13 | 890216 | `.../events/3v3-side-bracket/brackets/521375/890216` |
| Nietplay 2 | 2019-07-06 | **false** | Marston Green/Birmingham, GB | Nietplay 2 (1v1) | 11 | 912143 | `.../events/nietplay-2/brackets/536419/912143` |
| Nietplay 2 | 2019-07-06 | **false** | Marston Green/Birmingham, GB | Smash Ultimate *(side, non-Pokkén id 1386)* | 7 | — | skip |
| Nietplay 2 | 2019-07-06 | **false** | Marston Green/Birmingham, GB | 3v3 *(side)* | 7 | 912146 | `.../events/side-bracket-3v3/brackets/536422/912146` |
| Nietplay 3 | 2020-05-30 | **false** | Leeds, GB | Nietplay 3 main (1v1) | **1** | 1199382 | `.../events/nietplay-3/brackets/747352/1199382` |
| Nietplay 3 | 2020-05-30 | **false** | Leeds, GB | Nietplay 3v3 *(side)* | **1** | 1199383 | `.../events/nietplay-3v3-side-event/brackets/747353/1199383` |

**Usable 1v1 Pokkén brackets:** Battle at Lake Valor (Top 8 / event), Battle at Lake Valor 2,
Nietplay Tournament main, Nietplay 2 main. Everything else is excluded (reasons below).

---

## 2. Classification — ⚠️ read before importing

**`importOneStartgg` / `batch-import-startgg` ALWAYS create online (`source='startgg'`) tournaments
that feed ELO.** There is no offline path in the start.gg importer. Offline events in this app come
from the Liquipedia pipeline (`import-offline` = winner/runner-up only; `import-liquipedia-bracket` =
full matches). So the online-vs-offline question matters: importing an offline event via start.gg
silently injects it into the ELO ladder.

### Battle at Lake Valor — task said "online", start.gg says OFFLINE
The task pre-classified these as online (ELO). But start.gg reports **`isOnline: false`** for both,
each with a concrete physical venue address (731 Brookside Dr, Lansing MI; 3570 Fishinger Blvd,
Hilliard OH). These are the exact slugs/URLs from the task (BLV2's bracket `1266551/1942618` matches),
so they are the intended events — they just appear to be **in-person LANs**, not online. Also note
BLV2 is **2023**, not 2022. **Decision needed from Gabriel:** treat as online anyway (the community
may consider them part of the online scene), or as offline. The same A/B/C options below apply.

### Nietplay — confirmed OFFLINE
All three are `isOnline: false` with UK venues, matching the CSV note ("in-person 2019"). These are
genuinely offline LANs.

> **✅ DECIDED & IMPLEMENTED (2026-06-17): Option A**, for BOTH sources (Lake Valor is offline too).
> The start.gg importer now takes an `offline` flag → `is_offline=TRUE` + offline tier + location.
> **ELO clarification:** Gabriel chose to let offline events still feed ELO. `recalculate_elo.js`
> already replays every tournament's matches regardless of `is_offline`, and that was left unchanged
> — so Option A here is *classification only* (Offline tab + tier + location), not ELO exclusion.
> Code lives on branch `agent/startgg-offline` (commit `21f2efe`); merge with
> `node merge-worktree.js startgg-offline` before running the import in §4.

### Options (original analysis — A was chosen; B/C kept for the record)

- **(A) Add an `is_offline` flag to `importOneStartgg`** *(recommended for keeping the ladder honest while preserving data).*
  Thread an `offline` boolean from `batch-import-startgg` → `importOneStartgg`, set `is_offline=TRUE`
  + a tier via `detectOfflineTier(name)`, and make `recalculate_elo.js` skip `is_offline` matches when
  replaying. Upside: full bracket/match detail retained, players still get offline stats, ELO stays
  online-only (matches the app's stated design). Downside: real code work in `tournaments.js` +
  `recalculate_elo.js` (and a check that nothing else assumes start.gg ⇒ ELO).

- **(B) Import as online anyway.** Zero code; just run the URLs through `batch-import-startgg`.
  Upside: trivial, full match data. Downside: pollutes ELO with in-person results — contradicts the
  "ELO is online-only" design and mixes a 2019 UK LAN into the same ladder as online series.

- **(C) Winner/runner-up only via `import-offline`.** Use the existing offline pipeline: one
  `POST /api/tournaments/import-offline` per event with `{name, date, location, winner, runner_up, ...}`.
  Upside: no code change, correctly offline. Downside: loses all match-level data (no bracket, no ELO,
  no per-match achievements) — only 1st/2nd recorded.

**Recommendation.**
- **Nietplay:** these are small one-off UK LANs with little bracket value beyond the result. Go with
  **(C)** unless you specifically want their matches — cheapest, and correct per the offline design.
- **Battle at Lake Valor:** first confirm whether the community treats it as online. If it's truly an
  in-person LAN with a real 39/16-player bracket worth preserving, **(A)** is the right long-term path
  (keeps the bracket, keeps ELO clean). If you just want it on the ladder and accept the design
  bend, **(B)**. If only the result matters, **(C)**.

---

## 3. The enumeration script (artifact)

`enumerate_startgg.js` (project root). Read-only, network-only, no DB. **Must run on `main`**
(worktrees forbid network calls). Re-run anytime to refresh the data above:

```powershell
cd C:\Users\pitag\Documents\neos-city
node enumerate_startgg.js
```

It loads `STARTGG_TOKEN` from `backend\.env`, queries each slug in `TOURNAMENT_SLUGS`, flags Pokkén
events (id 447), and prints a ready-to-import bracket URL per phase group. Add slugs to the
`TOURNAMENT_SLUGS` array to enumerate more tournaments.

---

## 4. Import runbook (Option A — offline import via start.gg)

Artifacts: `lakevalor_startgg_urls.txt`, `nietplay_startgg_urls.txt` (one bracket URL per line,
`#` comments ignored by `.startsWith('http')` readers).

**Step 0 — land the code on main first.** The `offline` flag lives on branch `agent/startgg-offline`
(commit `21f2efe`); without it, `offline: $true` in the body is ignored and events import online.
```powershell
cd C:\Users\pitag\Documents\neos-city
node merge-worktree.js startgg-offline   # review the staged diff in IntelliJ, then commit
```

1. **Backend running** (`cd backend; npm run dev` — port 3001) and `ADMIN_TOKEN` set.
2. **Battle at Lake Valor 1 is multi-phase** (pools + Top 8) — import the whole event as ONE offline
   row via the event route (do NOT feed its three phase-group URLs to the batch endpoint; each would
   become a separate row):
   ```powershell
   $token = (Get-Content backend\.env | Select-String '^ADMIN_TOKEN=').ToString().Split('=',2)[1]
   $body  = @{ url = 'https://www.start.gg/tournament/battle-at-lake-valor/events/pokken-1v1/brackets/1113971/1733274'; offline = $true } | ConvertTo-Json
   Invoke-RestMethod -Uri http://localhost:3001/api/tournaments/import-startgg-event -Method Post `
     -Headers @{ 'x-admin-token' = $token } -ContentType 'application/json' -Body $body
   ```
3. **Batch-import the remaining single-bracket URLs with `offline = $true`** (already-imported
   phaseGroupIds, incl. BLV1's Top 8 from step 2, are skipped automatically):
   ```powershell
   cd C:\Users\pitag\Documents\neos-city
   $token = (Get-Content backend\.env | Select-String '^ADMIN_TOKEN=').ToString().Split('=',2)[1]
   $urls  = Get-Content lakevalor_startgg_urls.txt | Where-Object { $_ -like 'http*' }
   Invoke-RestMethod -Uri http://localhost:3001/api/tournaments/batch-import-startgg -Method Post `
     -Headers @{ 'x-admin-token' = $token } -ContentType 'application/json' -Body (@{ urls = $urls; offline = $true } | ConvertTo-Json)
   # repeat with nietplay_startgg_urls.txt
   ```
   ⚠️ The `offline = $true` field is what routes these to the Offline tab. Omit it and they import
   online. (BLV2 and the Nietplay mains are single-bracket, so the batch endpoint handles them.)
4. **Spot-check classification** (node script or Supabase SQL — don't use Chrome SQL automation):
   ```sql
   SELECT name, series, is_offline, location, source FROM tournaments
   WHERE source = 'startgg' AND is_offline = TRUE ORDER BY id DESC;
   ```
   Expect `is_offline = true`, `series` ∈ (worlds/major/regional/**other**), `location` like `Leeds, GB`.
   These small LANs will classify as **`other`** (no major/worlds keyword match) — that's correct.
5. **Recalculate ELO + achievements** (replays all matches incl. these offline ones, per the ELO
   decision; fixes ordering; runs Pass-1 + Pass-2):
   ```powershell
   cd C:\Users\pitag\Documents\neos-city
   node recalculate_elo.js
   ```

---

## 5. Post-import: catch player aliases needing a manual merge

start.gg keys players on the lowercased entrant name. `importOneStartgg` (tournaments.js ~1051–1063)
has a fallback that reuses an existing `challonge_username` when an existing player's `display_name`
matches **case-insensitively** — so `"Rokso"` → merges into existing `rokso`. **But that fallback
does NOT handle:**
- **Sponsor tags** — `"TEC | Rokso"` becomes username `tec_|_rokso`, display `TEC | Rokso`; it will
  NOT match `Rokso` and creates a brand-new duplicate player.
- **Aliases / handle changes** — a player who entered under a different name on start.gg than their
  Challonge handle won't auto-merge.

After importing, list newly-created players and eyeball them for aliases of established players:

```sql
-- Players created during/after the import window
SELECT id, challonge_username, display_name, created_at
FROM players
WHERE created_at > NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC;
```

Run it via a quick node script (per project preference — don't use Supabase SQL automation), e.g.
`node check_import_status.js` style, or paste into the Supabase SQL editor manually. For each new row
that looks like an alias/sponsor-tagged version of an existing player (e.g. `tec_|_rokso` vs `rokso`,
or a known handle under a new spelling), do a manual merge: repoint that player's `matches` /
`tournament_placements` to the canonical `players.id`, then delete the duplicate, then re-run
`node recalculate_elo.js`. Flag anything ambiguous to Gabriel rather than guessing.

**Watch especially for** UK/EU regulars in the Nietplay brackets and NA regulars in the Lake Valor
brackets who already exist from Challonge under a plain handle — those are the likely sponsor-tag /
alias collisions.
