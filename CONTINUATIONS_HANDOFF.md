# Offline Tournament Continuations — Handoff & Next-Agent Prompt

_Written 2026-06-18. Two parts: (1) handoff context for whoever picks this up, and
(2) a self-contained prompt to paste into a fresh agent session._

---

## Part 1 — Handoff (where things stand)

### The source sheet
`C:\Users\pitag\Downloads\[OFFLINE] Pokken Tournament DX Major & Regional Tournament
Archives - Tournament Listing.csv` — **63 offline majors/regionals, 2017–2020 only.**
The sheet was compiled a while ago and **stops at early 2020** (last row: Winter Brawl 3D
2020, Feb 2020). Most events list a `BRACKET` of `SmashGG` (= start.gg) or `Challonge`.

### What this session did (offline-CSV reconciliation)
- Bucketed all 63 sheet rows vs the DB: **26 already have full brackets, 9 winner/RU only,
  28 not in DB.** (See `reconcile_offline_csv.js`.)
- Resolved start.gg slugs + phaseGroupIds + top-3 standings for the importable candidates
  (`review_startgg_candidates.js`).
- Confirmed the start.gg importer now self-labels offline and tiers correctly (commit
  `7774345`), then added tier patterns + a sponsor-prefix dedup fix (commit `80c55ca`,
  branch `agent/offline-tier-dedup` — **pending cherry-pick onto main**).

### DB state (offline)
- ~80 offline tournaments. The hardcoded seed list is in `offline_import.js` (74 events,
  2016–2026). 16-ish have full Liquipedia bracket matches; the rest are winner/RU only.
- Read-only status check: `node check_import_status.js`.

### How the start.gg importer behaves now (commit `7774345`)
- `importOneStartgg(pgId, { offline })` — if `offline` is unset, it **auto-derives** offline
  from start.gg's own `tournament.isOnline === false` (in-person LANs self-label). Offline
  events get a tier via `detectOfflineTier(name)` + a `location` from city/countryCode, and
  land in the Offline tab. Routes `/import-startgg`, `/import-startgg-event`,
  `/batch-import-startgg` all accept an optional `offline` override.
- **ELO is NOT gated on `is_offline`** — `recalculate_elo.js` still replays every
  tournament's matches, so offline events do affect the (UI-hidden) ELO. Deliberate; leave
  it unless told otherwise.

### Tooling inventory (all on main, all READ-ONLY, all must run on MAIN)
Worktrees cannot reach the DB or the network — run these from the main checkout.
- `node reconcile_offline_csv.js` — bucket the CSV rows vs DB (a/b/c). Reuses the real
  `detectOfflineTier`.
- `node search_startgg_offline.js` — broad search of past Pokkén (videogame **447**)
  start.gg tournaments. ⚠️ start.gg caps query complexity at 1000 objects, so `perPage` is
  forced to 15; the run hits a ~1200-result page cap and only reaches ~2018-07 onward. For
  earlier/older or specific events, use the slug-targeted enumerator instead.
- `node enumerate_startgg.js` — resolve a hardcoded list of tournament slugs → Pokkén
  bracket URLs (phaseId/phaseGroupId). Edit its `TOURNAMENT_SLUGS` array.
- `node review_startgg_candidates.js` — given known slugs or name searches, resolve the
  Pokkén singles bracket and print tier + entrants + **top-3 final standings**. Has a strict
  name+year guard so the name-search fallback can't grab a wrong-year/similar-named event.

### Key gotchas
- **STARTGG_TOKEN** + **DATABASE_URL** live in `backend/.env`. Pokkén videogame id = **447**.
- **Player dedup:** start.gg entrant names carry sponsor prefixes (`ZB | ThankSwalot`).
  Commit `80c55ca` strips to the final `|`-segment so they dedupe to the real gamertag row —
  but that's only on NEW imports. After any import, audit `players` created that day for
  duplicates and merge before `recalculate_elo.js`.
- **Tiering is a community-taste call.** `detectOfflineTier` (`achievements.js` ~line 75) is
  name-pattern based; new series need new patterns. Don't invent tiers — ask Gabriel or
  follow the "promote only large/notable fields" precedent.
- **Worktree-first.** Read the DB/network from main; do code edits in a worktree
  (`node spawn-worktree.js <name>` or `git worktree add`), commit on the branch, hand off a
  `git cherry-pick <sha>`. Never edit main directly.

### Pending action for Gabriel
`git cherry-pick 80c55ca` (tier patterns + dedup). Do it soon — main moves fast.

---

## Part 2 — Prompt for the next agent (paste into a fresh session)

> **Task: find "continuation" editions of the offline tournament series — later years not in
> the sheet — and identify which are importable.**
>
> Project: `C:\Users\pitag\Documents\neos-city`. Read `AGENT_CONTEXT.md` first (esp. the
> "Offline Tournament Support", "Liquipedia Bracket Import", and "start.gg Integration"
> sections), then `CONTINUATIONS_HANDOFF.md` Part 1 for the tooling and gotchas.
>
> **Why:** the source CSV (`C:\Users\pitag\Downloads\[OFFLINE] Pokken Tournament DX Major &
> Regional Tournament Archives - Tournament Listing.csv`) is an OLD snapshot — it stops at
> early 2020. Many of those tournament series kept running (2021–2026). We want the later
> editions that aren't in the DB yet.
>
> **Steps:**
> 1. **Extract the distinct series** from the sheet (one per recurring brand, not per year):
>    e.g. SoCal Regionals, NorCal Regionals, Revolution (UK), DreamHack (Denver/Austin/
>    Anaheim), Frosty Faustings, Frostfire, Winter Brawl / Winter Brawl 3D, Summer Jam,
>    Northeast Championship (NEC), Final Round, Defend the North, Toryuken, Battle Arena
>    Melbourne (BAM), EVO, CEO, Combo Breaker, Smash'N'Splash, SwitchFest, Eye of the Storm,
>    Genesis, Destiny, Calyptus Cup, Respawn, Nietplay, Heart of Battle, Thermodynamic
>    Throwdown, etc. (Also cross-check the 74-event list in `offline_import.js` for series
>    already partially tracked.)
> 2. **Find continuation editions** — for each series, search start.gg (videogame id 447) for
>    editions DATED AFTER the sheet's last entry for that series (and any the sheet skipped).
>    Use `search_startgg_offline.js` for the broad sweep and `enumerate_startgg.js` /
>    `review_startgg_candidates.js` (edit their slug/candidate lists) for targeted resolution.
>    All read-only, all run on MAIN. Mind the start.gg 1000-object complexity cap (small
>    `perPage`) and the ~1200-result page cap on the broad search. Also sanity-check
>    Liquipedia (`https://liquipedia.net/fighters/Pokkén_Tournament/Tournaments`) since some
>    offline brackets only live there.
> 3. **Cross-reference vs the DB** (read-only `pg` script keyed on name/date, like
>    `reconcile_offline_csv.js`) and bucket each continuation edition: (a) already in DB with
>    full bracket, (b) in DB winner/RU only, (c) not in DB.
> 4. **For importable start.gg candidates** (bucket b/c), capture tournament slug + Pokkén
>    event/phaseGroupId + top-3 standings + entrant count. Note that the importer now
>    auto-labels offline from start.gg `isOnline` and tiers via `detectOfflineTier`, so flag:
>    (i) does the event come back `isOnline:false`? (ii) what tier does `detectOfflineTier`
>    give its real name? (iii) does it need a NEW tier pattern (list the exact pattern)?
> 5. **Deliver:** a markdown table (series → latest edition in DB → newest edition found →
>    bucket → recommended action → tier), plus a ready start.gg URL list for the importable
>    ones, plus any `detectOfflineTier` patterns to add (with reasoning — tiering is Gabriel's
>    call, so recommend, don't decide).
>
> **Constraints:** Do NOT run imports, migrations, or `recalculate_elo.js` (DB-mutating).
> Do NOT edit `main` — deliver scripts/recommendations; if you write code (e.g. new tier
> patterns), do it in a worktree and hand off a cherry-pick. Read-only DB/network scripts run
> on main. **Player-merge note:** start.gg keys players on the lowercased gamertag (after
> sponsor-prefix strip, per commit `80c55ca`); flag newly-created players for manual dedup
> after any future import.
