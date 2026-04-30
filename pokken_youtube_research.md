# Pokkén YouTube Channel Research

**Date:** 2026-04-24
**Method:** Chrome-driven YouTube searches across 8 query variants (English + Japanese), plus harvesting from in-video "suggested" panels on a popular Pokkén video. 120 unique channels enriched with subscriber counts, video totals, and latest-upload dates pulled by parsing each channel's `ytInitialData`.

Full data: see `pokken_youtube_channels.xlsx` in this folder.

---

## TL;DR

The YouTube algorithm is *not* meaningfully pushing Pokkén content to anyone right now. The biggest sub counts surfacing on "pokken" searches are **incidental** — IGN, Adult Swim, GameSpot, MandJTV, and the official Pokémon channel each have one or two videos from the 2016–2017 launch window and that's it. Strip those out and the actual Pokkén creator world is a small, mostly-dormant scene of sub-25K channels held up by a handful of consistently active operators.

This is good and bad for Neos City. Bad: there's no organic discovery wave to ride. Good: the discovery gap *is* the opportunity — there's no "Pokkén YouTube hub" right now, and the algorithm push is so weak that a directed community site can plausibly become the de-facto entry point.

---

## Who actually surfaces for "pokken" (by search appearances)

The channel that the algorithm consistently puts in front of pokken searchers is not who has the most subs:

| Rank | Channel | Subs | Search appearances | Note |
|---|---|---|---|---|
| 1 | Unrivaled Tournaments | 20.4K | 33 | Tournament org — by far the dominant pokken result |
| 2 | SonicNKnux | 3.55K | 11 | Long-tail pokken creator |
| 2 | Euclase's Pokkén Archives | 1.3K | 11 | Tournament VOD archive — community-critical |
| 4 | Pokémon Official (JP) | 3.97M | 8 | Launch-era trailers, nothing recent |
| 5 | Nathaniel Plays | 2.69K | 7 | Active pokken creator |
| 6 | MatchStick Melee | 5.8K | 6 | Active pokken commentator |
| 6 | Jukem | 4.51K | 6 | Player-creator overlap with Neos City project |
| 6 | BadIntent | 3.17K | 6 | Combo/guide content, dormant 3y+ |
| 6 | Pokémon Official (EN) | 6.89M | 6 | Launch-era trailers |

Of the channels surfacing in 5+ distinct queries, the ones still uploading recently are: **Unrivaled Tournaments**, **MatchStick Melee** (3 hours ago), **Nathaniel Plays** (1 month), **Hi! Buff Gigas Please?** (1mo), **Magpie Labs** (13 days), **zwiggo** (3 days, but mostly other content), **False Swipe Gaming** (3 days, multi-game), **Jimothy Cool** (12h, multi-game).

## The "huge subs but not actually pokken" pile

These channels show up in pokken searches because they made one or two pokken videos at launch. Don't mistake them for pokken creators:

- IGN (19.8M), Adult Swim (8.14M), GameSpot (5.67M), ProsafiaGaming (5.17M)
- The Official Pokémon channel EN/JP (6.89M / 3.97M), Nintendo JP (3.64M), Nintendo UK (565K)
- MandJTV (2.61M), Bandai Namco Entertainment (1.97M), GamingBolt (1.34M)
- LeftBurst (1.03M), NDY (876K), Nintendo Life (845K), Mayo (447K)
- Pedro Araujo (734K) and Cwitchy (710K) are large general gaming channels with some pokken content
- Asmongold Clips (1.75M), Titans Volleyball (2.03M) — appearance is incidental

## True Pokkén-focused active creators

These are the people actually still producing Pokkén content as a primary or major focus:

- **Unrivaled Tournaments** (20.4K, 12K vids, 6 days ago) — tournament organization
- **Hi! Buff Gigas Please?** (73K, 302 vids, 1mo) — character-focused, algorithmically suggested
- **MatchStick Melee** (5.8K, 1.9K vids, 3 hours ago) — most active right now, algorithmically suggested
- **Nathaniel Plays** (2.69K, 80 vids, 1mo) — Gengar.Believer handle
- **Magpie Labs** (13.3K, 78 vids, 13 days)
- **Jukem** (4.51K, 576 vids, 1y) — overlap with Neos City player base
- **Euclase's Pokkén Archives** (1.3K, 241 vids, 2 years) — irreplaceable tournament VOD archive even if dormant
- **Coro Usami Ch. (兎未 ころ)** (1.49K JP, 9 days) — algorithmically suggested
- **SonicNKnux** (3.55K, 1.1K vids) — dormant but extensive backlog
- **BadIntent** (3.17K, 632 vids) — dormant 3y, combo/guide reference

## Japanese Pokkén scene

The JP scene has its own distinct cluster, mostly tournament orgs and dedicated creators:

- **今日ポケch. / Kyou Poke ch.** (621K) — biggest active JP pokken-adjacent channel, 48 mins ago upload, algorithmically suggested
- **ねずみ / Nezumi** (197 subs) — Mouse Cup tournament organizer; matches the "Nezumi" series in your project
- **ポッ拳カントートーナメント / Pokken Kanto Tournament** (940) — tournament org, dormant 3y
- **がにこすチャンネル** (6.99K) — pokken player-creator
- **SOUL VIEW 大会放送ch.** (9.97K) — tournament broadcaster, 13h ago
- **ミタ** (163K), **れしむ** (40.9K), **エルム** (1.12K) — JP players with pokken content
- **Pokken Net** (101) and **Pokken Net JP** (13) — defunct community archives

## Names that overlap with Neos City project

Found while crawling — these are people already in your competitive scene with YouTube presence:

- **Shadowcat** (2.78K subs, dormant 2y) — `@Shadowcat95`
- **Mewtater** (587 subs, dormant 6y) — `@Mewtater`
- **Jukem** (4.51K subs, last upload 1y ago) — `@Jukem`
- **Nezumi / ねずみ** (197 subs) — Mouse Cup organizer channel

## Strategic read for Neos City

**The discovery problem.** The algorithm doesn't push pokken content to fresh viewers. A search for "pokken" surfaces a wall of incidental launch-era videos from huge channels, with the actual creators buried below. A new player landing on YouTube would have a hard time finding the people they should follow.

**The archive problem.** Euclase's Pokkén Archives is dormant 2y but holds the bulk of the historical tournament VODs. If that channel goes down, a chunk of the scene's history goes with it. Mirroring or formally cataloguing it is high-leverage.

**The activity signal.** Real-time activity is concentrated in ~6 creators — MatchStick Melee, Unrivaled Tournaments, Magpie Labs, Nathaniel Plays, Hi! Buff Gigas Please?, plus the JP channels Kyou Poke ch., Coro Usami, SOUL VIEW. A site that surfaces "what's happening this week" by aggregating these would be useful and not currently exist.

**The on-ramp gap.** There is no approachable, current English-language Pokkén tutorial channel. Hi! Buff Gigas Please? does character work but it's deep, not introductory. False Swipe Gaming did one beginner video and moved on. This is a content slot Neos City could fill or partner with someone to fill.

**Cross-promotion candidates.** The active English creators above are small enough that they would likely engage with a community site that drives traffic to them. Tournament series under your umbrella (FFC, RTG, DCM, TCC, EOTR, Nezumi) already have natural overlap — Unrivaled Tournaments and the Mouse Cup channel are the obvious starting partners.

## Caveats

- "Algorithm-suggested" only flags channels that appeared in YouTube's in-video sidebar during sampling — the panel only renders ~4 items at a time and depends on watch history; mark as a directional signal, not exhaustive.
- "Latest upload" is parsed as a relative string ("3 days ago", "1y ago") so granularity varies by what YouTube exposes.
- 2 channels (PizzamonkeyFGC, the Wolfey/Alpharad collab) returned blank metadata — likely deleted, restricted, or the URL on the search result was malformed.
- Heuristic Pokkén-Focused tagging (Yes / Likely / Maybe / No) is coarse — sort by Search Appearances in the spreadsheet for a finer cut.
