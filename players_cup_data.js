/**
 * Pokémon Players Cup — Pokkén Tournament DX — verified Global Finals dataset
 * ===========================================================================
 *
 * Research-derived, transcription-only. Compiled 2026-06-17.
 *
 * Scope decision (Gabriel, this session):
 *   • "Verified matches only" — every match below is sourced from a written
 *     recap. NOTHING is guessed. Incomplete brackets stay incomplete rather
 *     than fabricated, because these feed the stored (UI-hidden) ELO.
 *   • New display-only series 'players_cup' (NOT in ONLINE_SERIES / not an
 *     achievement track) — see WORKTREE_SUMMARY.md. Imported as is_offline=TRUE
 *     so they never enter the online Challonge/start.gg ladder or tab.
 *
 * What this is: the official Play! Pokémon online championship (The Pokémon
 * Company). 3 of the 4 editions ran a Pokkén Tournament DX bracket (PPC II did
 * not). Only the 8-player GLOBAL FINALS are recoverable in writing; the
 * regional qualifier brackets were never archived anywhere and are lost.
 *
 * IMPORTANT — placements are AUTHORITATIVE and set explicitly. Do NOT derive
 * them from match order (PPC IV has only 2 verified matches but a known top 3).
 *
 * Sources per edition are listed inline.
 *
 * ── PLAYER-MERGE HAZARDS (read before importing — no alias system exists) ──
 *   • TWO different players both named "Kira" appear across editions:
 *       - "Kira Péniquaud" (France)  — PPC I & IV   → canonical: 'Kira FR'
 *       - "Kira Pallazzoni" (Sandy, EU) — PPC IV     → canonical: 'Kira Sandy'
 *     A naive name-key import WILL collapse them into one player. They are
 *     disambiguated below via the `canonical` field — import MUST key on that,
 *     not the display name.
 *   • "Wise" (Richard Rennehan, Canada) is your FFC organizer. The online
 *     record keys on Challonge slug `wise_`; this offline entry is display
 *     name "Wise". Decide the canonical player BEFORE import or you get a dup.
 *   • Jukem, Shadowcat, TEC, Deity Light already exist in the DB from the
 *     Liquipedia offline brackets (exact display strings) — these merge cleanly.
 *   • "Allister" (Allister Singh) is spelled "Allsiter" on Bulbapedia — pick one.
 */

const PLAYERS_CUP_EVENTS = [
  // ───────────────────────────────────────────────────────────────────────
  {
    key: 'players_cup_1',
    name: 'Pokémon Players Cup — Pokkén Tournament DX Global Finals',
    date: '2020-08-16',
    location: 'Online',
    prize_pool: '$5,000',
    participants_count: 8,
    confidence: 'HIGH — near-complete double-elim bracket recovered in writing',
    source: 'https://upcomer.com/shadowcat-wins-pokken-tournament-dx-at-pokemon-players-cup-finals/',
    // final_rank → { display, canonical, country }
    placements: [
      { final_rank: 1, display: 'Shadowcat',  canonical: 'Shadowcat',  country: 'US' },
      { final_rank: 2, display: 'Jukem',      canonical: 'Jukem',      country: 'US' },
      { final_rank: 3, display: 'Deity Light', canonical: 'Deity Light', country: 'US' },
      { final_rank: 4, display: 'Fabilous',   canonical: 'Fabilous',   country: 'DE' },
      { final_rank: 5, display: 'Wingtide',   canonical: 'Wingtide',   country: 'DE' },
      { final_rank: 5, display: 'Kira',       canonical: 'Kira FR',    country: 'FR' },
      { final_rank: 7, display: 'Antwerp',    canonical: 'Antwerp',    country: 'AU' },
      { final_rank: 7, display: 'SoulGuitarist', canonical: 'SoulGuitarist', country: 'US' },
    ],
    // weight = bracket order proxy; higher = later/more important. Used only if
    // an importer wants a round hint — placements above are authoritative.
    // section: 'W' winners, 'L' losers, 'GF' grand finals. score = games.
    matches: [
      { section: 'W',  round: 1, winner: 'Shadowcat',   loser: 'Kira FR',     score: '3-0' },
      { section: 'W',  round: 1, winner: 'Deity Light',  loser: 'Jukem',       score: '3-1' }, // sends Jukem to losers
      { section: 'W',  round: 2, winner: 'Shadowcat',   loser: 'Fabilous',    score: '3-2' },
      { section: 'W',  round: 3, winner: 'Shadowcat',   loser: 'Deity Light', score: '3-0' }, // winners finals
      { section: 'L',  round: 1, winner: 'Jukem',       loser: 'Wingtide',    score: '3-2' },
      { section: 'L',  round: 2, winner: 'Jukem',       loser: 'Kira FR',     score: '3-1' },
      { section: 'L',  round: 3, winner: 'Jukem',       loser: 'Fabilous',    score: '3-0' },
      { section: 'L',  round: 4, winner: 'Jukem',       loser: 'Deity Light', score: '3-2' }, // losers finals
      { section: 'GF', round: 5, winner: 'Shadowcat',   loser: 'Jukem',       score: '3-2' }, // grand finals (no reset)
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    key: 'players_cup_3',
    name: 'Pokémon Players Cup III — Pokkén Tournament DX Global Finals',
    date: '2021-04-25',
    location: 'Online',
    prize_pool: '$5,000',
    participants_count: 8,
    confidence: 'MEDIUM — top 4 firm, grand finals + Jukem losers run verified; '
              + 'the rest of the winners bracket + ranks 5-8 are NOT in any text '
              + 'source (live only in the VOD).',
    source: 'https://dotesports.com/pokemon/news/jukem-wins-pokken-tournament-pokemon-players-cup-iii-championship-over-shadowcat',
    placements: [
      { final_rank: 1, display: 'Jukem',     canonical: 'Jukem',     country: 'US' },
      { final_rank: 2, display: 'Shadowcat', canonical: 'Shadowcat', country: 'US' },
      { final_rank: 3, display: 'Allister',  canonical: 'Allister',  country: 'US' }, // "Allsiter" on Bulbapedia
      { final_rank: 4, display: 'Rokso',     canonical: 'Rokso',     country: 'US' }, // Anthony Paratore
      // 5th: Goreson (Umberto Tagliafierro, IT) — eliminated by Jukem earlier in
      // losers; exact rank vs other unknowns not confirmed, left out to avoid guessing.
    ],
    matches: [
      { section: 'W',  round: 2, winner: 'Allister', loser: 'Jukem',   score: '3-1' }, // winners semis; sends Jukem to losers
      { section: 'L',  round: 2, winner: 'Jukem',    loser: 'Goreson', score: '3-1' },
      { section: 'L',  round: 3, winner: 'Jukem',    loser: 'Rokso',   score: '3-2' },
      { section: 'L',  round: 4, winner: 'Jukem',    loser: 'Allister', score: '3-0' }, // losers finals
      { section: 'GF', round: 5, winner: 'Jukem',    loser: 'Shadowcat', score: 'sets 2-1' }, // Jukem won set1 3-1, lost set2, won set3 3-0
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    key: 'players_cup_4',
    name: 'Pokémon Players Cup IV — Pokkén Tournament DX Global Finals',
    date: '2021-08-01',
    location: 'Online',
    prize_pool: '$5,000',
    participants_count: 8,
    confidence: 'LOW-MEDIUM — top 3 firm and all 8 finalists known, but only the '
              + 'final + losers final are verified in writing; sources conflict on '
              + "Wise's path. Full bracket needs VOD review.",
    source: 'https://www.pokemon.com/us/play-pokemon/pokemon-players-cup-iv/pokken-tournament-dx-finals-preview '
          + '(finalists) + https://www.ginx.tv/en/pokemon/ (top 3)',
    placements: [
      { final_rank: 1, display: 'Wise',      canonical: 'Wise',      country: 'CA' }, // Richard Rennehan — see merge hazard re: wise_
      { final_rank: 2, display: 'TEC',       canonical: 'TEC',       country: 'US' }, // Dawson Trepanier
      { final_rank: 3, display: 'Shadowcat', canonical: 'Shadowcat', country: 'US' },
      // Ranks 4-8 unconfirmed. Remaining finalists (rank TBD, do NOT assign):
      //   PuppyHavoc (Milton Castillo, US), Niet (Adam Haskell, EU),
      //   Kira Sandy (Sandy Pallazzoni, EU), Kira FR (Kira Péniquaud, FR),
      //   Santa (Frederick Seidl, Oceania).
    ],
    // Non-placement finalists recorded so they can be created as players (entered,
    // no rank). Import should add an 'entrants' notion or skip — see summary.
    entrants_unranked: [
      { display: 'PuppyHavoc', canonical: 'PuppyHavoc', country: 'US' },
      { display: 'Niet',       canonical: 'Niet',       country: 'GB' },
      { display: 'Kira',       canonical: 'Kira Sandy', country: 'EU' }, // ⚠ distinct from Kira FR
      { display: 'Kira',       canonical: 'Kira FR',    country: 'FR' }, // ⚠ distinct from Kira Sandy
      { display: 'Santa',      canonical: 'Santa',      country: 'AU' },
    ],
    matches: [
      { section: 'L',  round: 4, winner: 'TEC',  loser: 'Shadowcat', score: 'verified, score n/a' }, // losers finals
      { section: 'GF', round: 5, winner: 'Wise', loser: 'TEC',       score: 'verified, score n/a' }, // final
    ],
  },
];

module.exports = { PLAYERS_CUP_EVENTS };
