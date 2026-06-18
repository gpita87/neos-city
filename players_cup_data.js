/**
 * Pokémon Players Cup — Pokkén Tournament DX — Global Finals dataset
 * =================================================================
 *
 * Transcription-only, from official broadcast bracket graphics + verified
 * recaps. Compiled 2026-06-17. ALL THREE EDITIONS COMPLETE (full 14-match
 * double-elim brackets + ranks 1-8).
 *
 * Scope decision (Gabriel, this session):
 *   • "Verified matches only" — every match is sourced from an official
 *     broadcast bracket graphic and/or a written recap. NOTHING is guessed.
 *     These feed the stored (UI-hidden) ELO.
 *   • New display-only series 'players_cup' (NOT in ONLINE_SERIES / not an
 *     achievement track) — see WORKTREE_SUMMARY.md. Imported as is_offline=TRUE
 *     so they never enter the online Challonge/start.gg ladder or tab.
 *
 * What this is: the official Play! Pokémon online championship (The Pokémon
 * Company). 3 of the 4 editions ran a Pokkén Tournament DX bracket (PPC II did
 * not). We import the 8-player GLOBAL FINALS of PPC I, III, IV.
 *
 * IMPORTANT — placements are AUTHORITATIVE and set explicitly. Do NOT derive
 * them from match order.
 *
 * A few Winners-Finals / Losers-Finals / Grand-Finals boxes were still blank on
 * the captured graphics; those winners are fixed by verified recaps + bracket
 * logic and flagged inline (`score: ''` = result certain, game score unknown).
 *
 * ── PLAYER-MERGE HAZARDS (read before importing — no alias system exists) ──
 *   • TWO different players both named "Kira" — disambiguated by gamertag,
 *     confirmed on the PPC IV broadcast graphic:
 *       - "KIRA FR" = Kira Péniquaud (France)        — PPC I & IV
 *       - "KIRA_A"  = Kira Pallazzoni (Sandy, EU)     — PPC IV  (tag: "TK | KIRA_A")
 *     A naive name-key import WILL collapse them. Import MUST key on `canonical`.
 *   • "Wise" (Richard Rennehan, Canada) is your FFC organizer. The online record
 *     keys on Challonge slug `wise_`; this entry is display "Wise". Decide the
 *     canonical player BEFORE import or you get a dup.
 *   • Jukem, Shadowcat, TEC, Deity Light already exist in the DB from the
 *     Liquipedia offline brackets (exact display strings) — these merge cleanly.
 *   • "Allister" — broadcast graphics spell it "Allister" (Bulbapedia's
 *     "Allsiter" is a typo). Canonical: 'Allister'.
 *
 * Match fields: section 'W' winners | 'L' losers | 'GF' grand finals; round =
 * bracket depth; score = games won by winner-loser (Global Finals are Bo5 → 3-x).
 * country: null where the finalist's region is unconfirmed.
 */

const PLAYERS_CUP_EVENTS = [
  // ───────────────────────────────────────────────────────────────────────
  // PPC I — COMPLETE. Source: official "Pokkén Tournament DX | TOP 8" Global
  // Finals bracket graphic (2020-08-16). Full 14-match double-elim.
  {
    key: 'players_cup_1',
    name: 'Pokémon Players Cup — Pokkén Tournament DX Global Finals',
    date: '2020-08-16',
    location: 'Online',
    prize_pool: '$5,000',
    participants_count: 8,
    confidence: 'COMPLETE — full 14-match bracket + 1-8 from official broadcast graphic',
    source: 'Official Players Cup Global Finals broadcast — Pokkén DX "TOP 8" bracket graphic',
    placements: [
      { final_rank: 1, display: 'Shadowcat',     canonical: 'Shadowcat',     country: 'US' },
      { final_rank: 2, display: 'Jukem',         canonical: 'Jukem',         country: 'US' },
      { final_rank: 3, display: 'Deity Light',   canonical: 'Deity Light',   country: 'US' },
      { final_rank: 4, display: 'Fabilous',      canonical: 'Fabilous',      country: 'DE' },
      { final_rank: 5, display: 'Kira FR',       canonical: 'Kira FR',       country: 'FR' },
      { final_rank: 5, display: 'Wingtide',      canonical: 'Wingtide',      country: 'DE' },
      { final_rank: 7, display: 'SoulGuitarist', canonical: 'SoulGuitarist', country: 'US' },
      { final_rank: 7, display: 'Antwerp',       canonical: 'Antwerp',       country: 'AU' },
    ],
    matches: [
      { section: 'W',  round: 1, winner: 'Shadowcat',   loser: 'Kira FR',       score: '3-0' },
      { section: 'W',  round: 1, winner: 'Fabilous',    loser: 'SoulGuitarist', score: '3-0' },
      { section: 'W',  round: 1, winner: 'Jukem',       loser: 'Wingtide',      score: '3-2' },
      { section: 'W',  round: 1, winner: 'Deity Light', loser: 'Antwerp',       score: '3-1' },
      { section: 'W',  round: 2, winner: 'Shadowcat',   loser: 'Fabilous',      score: '3-2' },
      { section: 'W',  round: 2, winner: 'Deity Light', loser: 'Jukem',         score: '3-1' },
      { section: 'W',  round: 3, winner: 'Shadowcat',   loser: 'Deity Light',   score: '3-0' }, // winners finals
      { section: 'L',  round: 1, winner: 'Kira FR',     loser: 'SoulGuitarist', score: '3-1' },
      { section: 'L',  round: 1, winner: 'Wingtide',    loser: 'Antwerp',       score: '3-1' },
      { section: 'L',  round: 2, winner: 'Jukem',       loser: 'Kira FR',       score: '3-1' },
      { section: 'L',  round: 2, winner: 'Fabilous',    loser: 'Wingtide',      score: '3-2' },
      { section: 'L',  round: 3, winner: 'Jukem',       loser: 'Fabilous',      score: '3-0' }, // losers semis
      { section: 'L',  round: 4, winner: 'Jukem',       loser: 'Deity Light',   score: '3-2' }, // losers finals
      { section: 'GF', round: 5, winner: 'Shadowcat',   loser: 'Jukem',         score: '3-2' }, // grand finals (no reset)
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // PPC III — COMPLETE. Source: official Players Cup III "Pokkén Tournament DX
  // GLOBAL FINALS" bracket graphic (2021-04-25). Full 14-match double-elim.
  // WF (Shadowcat>Allister), LF (Jukem>Allister, recap 3-0), GF (Jukem>Shadowcat)
  // boxes were blank on the capture — winners fixed by recap + bracket logic.
  // (Separately, a PPC III NA QUALIFIER graphic also exists — different phase,
  // not imported.)
  {
    key: 'players_cup_3',
    name: 'Pokémon Players Cup III — Pokkén Tournament DX Global Finals',
    date: '2021-04-25',
    location: 'Online',
    prize_pool: '$5,000',
    participants_count: 8,
    confidence: 'COMPLETE — full 14-match bracket + 1-8 from official broadcast graphic '
              + '(WF/LF/GF winners from recap+logic; some game scores n/a).',
    source: 'Official Players Cup III Pokkén DX Global Finals bracket graphic + '
          + 'https://dotesports.com/pokemon/news/jukem-wins-pokken-tournament-pokemon-players-cup-iii-championship-over-shadowcat',
    placements: [
      { final_rank: 1, display: 'Jukem',     canonical: 'Jukem',     country: 'US' },
      { final_rank: 2, display: 'Shadowcat', canonical: 'Shadowcat', country: 'US' },
      { final_rank: 3, display: 'Allister',  canonical: 'Allister',  country: 'US' },
      { final_rank: 4, display: 'Rokso',     canonical: 'Rokso',     country: 'US' },
      { final_rank: 5, display: 'Goreson',   canonical: 'Goreson',   country: 'IT' }, // Umberto Tagliafierro
      { final_rank: 5, display: 'Iceburgy',  canonical: 'Iceburgy',  country: null },
      { final_rank: 7, display: 'Auramaster', canonical: 'Auramaster', country: null },
      { final_rank: 7, display: 'Boolerex',  canonical: 'Boolerex',  country: null },
    ],
    matches: [
      { section: 'W',  round: 1, winner: 'Shadowcat', loser: 'Goreson',    score: '3-2' },
      { section: 'W',  round: 1, winner: 'Rokso',     loser: 'Auramaster', score: '3-1' },
      { section: 'W',  round: 1, winner: 'Jukem',     loser: 'Boolerex',   score: '3-1' },
      { section: 'W',  round: 1, winner: 'Allister',  loser: 'Iceburgy',   score: '3-2' },
      { section: 'W',  round: 2, winner: 'Shadowcat', loser: 'Rokso',      score: '3-0' },
      { section: 'W',  round: 2, winner: 'Allister',  loser: 'Jukem',      score: '3-1' },
      { section: 'W',  round: 3, winner: 'Shadowcat', loser: 'Allister',   score: '' },    // winners finals — winner from logic, score n/a (blank on graphic)
      { section: 'L',  round: 1, winner: 'Goreson',   loser: 'Auramaster', score: '3-1' },
      { section: 'L',  round: 1, winner: 'Iceburgy',  loser: 'Boolerex',   score: '3-0' },
      { section: 'L',  round: 2, winner: 'Jukem',     loser: 'Goreson',    score: '3-1' },
      { section: 'L',  round: 2, winner: 'Rokso',     loser: 'Iceburgy',   score: '3-2' },
      { section: 'L',  round: 3, winner: 'Jukem',     loser: 'Rokso',      score: '3-2' }, // losers semis
      { section: 'L',  round: 4, winner: 'Jukem',     loser: 'Allister',   score: '3-0' }, // losers finals (recap-confirmed; blank on graphic)
      { section: 'GF', round: 5, winner: 'Jukem',     loser: 'Shadowcat',  score: 'sets 2-1' }, // GF bracket reset; Jukem set1 3-1, lost set2, won set3 3-0
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // PPC IV — COMPLETE. Source: official Players Cup IV Pokkén DX Global Finals
  // bracket graphic (2021-08-01). 14-match double-elim. WF/LF/GF boxes were
  // blank on the captured graphic; those 3 results are fixed by verified recaps
  // + bracket logic: Wise won WF over TEC → TEC dropped to LF, beat Shadowcat →
  // lost GF to Wise. Yields 1 Wise, 2 TEC, 3 Shadowcat (all recap-confirmed).
  {
    key: 'players_cup_4',
    name: 'Pokémon Players Cup IV — Pokkén Tournament DX Global Finals',
    date: '2021-08-01',
    location: 'Online',
    prize_pool: '$5,000',
    participants_count: 8,
    confidence: 'COMPLETE — full 14-match bracket + 1-8 from official graphic '
              + '(WF/LF/GF winners from verified recaps; their game scores n/a).',
    source: 'Official Players Cup IV Pokkén DX Global Finals bracket graphic + '
          + 'https://www.ginx.tv/en/pokemon/ (top 3) recaps',
    placements: [
      { final_rank: 1, display: 'Wise',       canonical: 'Wise',       country: 'CA' }, // see merge hazard re: wise_
      { final_rank: 2, display: 'TEC',        canonical: 'TEC',        country: 'US' },
      { final_rank: 3, display: 'Shadowcat',  canonical: 'Shadowcat',  country: 'US' },
      { final_rank: 4, display: 'Niet',       canonical: 'Niet',       country: 'GB' },
      { final_rank: 5, display: 'PuppyHavoc', canonical: 'PuppyHavoc', country: 'US' },
      { final_rank: 5, display: 'Kira FR',    canonical: 'Kira FR',    country: 'FR' },
      { final_rank: 7, display: 'Kira_A',     canonical: 'Kira_A',     country: 'EU' }, // ⚠ distinct from Kira FR
      { final_rank: 7, display: 'Santa',      canonical: 'Santa',      country: 'AU' },
    ],
    matches: [
      { section: 'W',  round: 1, winner: 'TEC',        loser: 'Kira_A',     score: '3-0' },
      { section: 'W',  round: 1, winner: 'Shadowcat',  loser: 'Niet',       score: '3-0' },
      { section: 'W',  round: 1, winner: 'Wise',       loser: 'Kira FR',    score: '3-1' },
      { section: 'W',  round: 1, winner: 'PuppyHavoc', loser: 'Santa',      score: '3-1' },
      { section: 'W',  round: 2, winner: 'TEC',        loser: 'Shadowcat',  score: '3-0' },
      { section: 'W',  round: 2, winner: 'Wise',       loser: 'PuppyHavoc', score: '3-1' },
      { section: 'W',  round: 3, winner: 'Wise',       loser: 'TEC',        score: '' },    // winners finals — winner from recap, score n/a
      { section: 'L',  round: 1, winner: 'Niet',       loser: 'Kira_A',     score: '3-1' },
      { section: 'L',  round: 1, winner: 'Kira FR',    loser: 'Santa',      score: '3-2' },
      { section: 'L',  round: 2, winner: 'Niet',       loser: 'PuppyHavoc', score: '3-1' },
      { section: 'L',  round: 2, winner: 'Shadowcat',  loser: 'Kira FR',    score: '3-1' },
      { section: 'L',  round: 3, winner: 'Shadowcat',  loser: 'Niet',       score: '3-0' }, // losers semis
      { section: 'L',  round: 4, winner: 'TEC',        loser: 'Shadowcat',  score: '' },    // losers finals — winner from recap, score n/a
      { section: 'GF', round: 5, winner: 'Wise',       loser: 'TEC',        score: '' },    // grand finals — winner from recap, score n/a
    ],
  },
];

module.exports = { PLAYERS_CUP_EVENTS };
