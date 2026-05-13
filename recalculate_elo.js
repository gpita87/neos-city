#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// NEOS CITY — ELO Recalculation Script (v4 — bulk I/O)
// Run from the neos-city directory:  node recalculate_elo.js
//
// Architecture: fetch everything → compute in memory → write back in bulk.
// Total DB round-trips: ~15 (instead of ~15,000+).
//
// 1. Bulk-fetch all tables (players, tournaments, matches, placements).
// 2. Replay every completed match in strict chronological order (in memory).
// 3. Apply placement bonuses (in memory).
// 4. Rebuild all player aggregate stats (in memory).
// 5. Pass 1 achievements — stat-based (in memory).
// 6. Pass 2 achievements — match + meta (in memory).
// 7. Bulk-write everything back (ELO, stats, history, achievements).
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });

const db = require('./backend/src/db');
const { calculateNewRatings, placementBonus, STARTING_ELO } = require('./backend/src/services/elo');
const {
  checkAchievementsPass1,
  checkAchievementsPass2Pure,
} = require('./backend/src/services/achievements');

function fmt(n) { return String(n).padStart(4); }

const ALL_SERIES = ['ffc', 'rtg_na', 'rtg_eu', 'dcm', 'tcc', 'eotr', 'nezumi', 'nezumi_rookies', 'ha'];
const OFFLINE_TIERS = ['worlds', 'major', 'regional', 'other'];
const OFFLINE_WEIGHTS = {
  worlds:   { wins: 100, runner_up: 60, top4: 35, top8: 20 },
  major:    { wins: 50,  runner_up: 30, top4: 18, top8: 10 },
  regional: { wins: 25,  runner_up: 15, top4: 9,  top8: 5 },
  other:    { wins: 10,  runner_up: 6,  top4: 3,  top8: 2 },
};

(async () => {
  console.log('♻️   Neos City — ELO Recalculation (v4 — bulk I/O)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── Step 0: Pre-flight column check ────────────────────────────────────
  process.stdout.write('🔍  Checking required DB columns … ');

  const REQUIRED_PLAYER_COLUMNS = [
    'total_match_wins', 'total_match_losses', 'tournaments_entered',
    'tournament_wins', 'runner_up_finishes', 'top4_finishes', 'top8_finishes',
    'current_win_streak', 'longest_win_streak',
    'games_played', 'peak_elo', 'elo_rating',
    'games_taken_from_champions', 'comebacks',
    ...ALL_SERIES.flatMap(s => [`${s}_entered`, `${s}_top8`, `${s}_top4`, `${s}_runner_up`, `${s}_wins`]),
    'offline_wins', 'offline_top2', 'offline_score',
    ...OFFLINE_TIERS.flatMap(t => [
      `offline_${t}_wins`, `offline_${t}_runner_up`, `offline_${t}_top4`, `offline_${t}_top8`
    ]),
  ];

  const { rows: existingCols } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'players'
  `);
  const existingSet = new Set(existingCols.map(r => r.column_name));
  const missing = REQUIRED_PLAYER_COLUMNS.filter(c => !existingSet.has(c));

  if (missing.length > 0) {
    console.log('FAILED\n');
    console.error(`❌  Missing ${missing.length} column(s) on the "players" table:`);
    console.error(`   ${missing.join(', ')}`);
    console.error(`\n💡  Run the appropriate migration(s) first. Likely candidates:`);
    console.error(`   node run_migration.js backend/src/db/migrations/achievement_revamp.sql`);
    console.error(`   node run_migration.js backend/src/db/migrations/add_offline_tier_stats.sql`);
    console.error(`   node run_migration.js backend/src/db/migrations/add_tonamel_support.sql`);
    console.error(`   node run_migration.js backend/src/db/migrations/add_ha_series.sql`);
    await db.end?.();
    process.exit(1);
  }
  console.log(`OK (${existingSet.size} columns found, all ${REQUIRED_PLAYER_COLUMNS.length} required present)`);

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 1: BULK FETCH — pull all relevant data into memory
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n📥  Fetching all data from DB …');
  const t0 = Date.now();

  const [
    { rows: dbPlayers },
    { rows: dbTournaments },
    { rows: dbMatches },
    { rows: dbPlacements },
  ] = await Promise.all([
    db.query(`SELECT * FROM players`),
    db.query(`SELECT id, name, series, participants_count, completed_at, is_offline
              FROM tournaments ORDER BY completed_at ASC NULLS FIRST, id ASC`),
    db.query(`SELECT id, tournament_id, player1_id, player2_id, winner_id, round,
                     player1_score, player2_score, state, played_at
              FROM matches`),
    db.query(`SELECT player_id, tournament_id, final_rank
              FROM tournament_placements`),
  ]);

  console.log(`   ${dbPlayers.length} players, ${dbTournaments.length} tournaments, ${dbMatches.length} matches, ${dbPlacements.length} placements`);
  console.log(`   Fetched in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ── Index everything ──────────────────────────────────────────────────
  // Matches by tournament (only complete ones with both players + winner)
  const matchesByTournament = {};
  for (const m of dbMatches) {
    if (m.state !== 'complete' || !m.player1_id || !m.player2_id || !m.winner_id) continue;
    if (!matchesByTournament[m.tournament_id]) matchesByTournament[m.tournament_id] = [];
    matchesByTournament[m.tournament_id].push(m);
  }
  // Sort each tournament's matches by round then id
  for (const tid of Object.keys(matchesByTournament)) {
    matchesByTournament[tid].sort((a, b) => {
      const ra = a.round ?? Infinity, rb = b.round ?? Infinity;
      return ra - rb || a.id - b.id;
    });
  }

  // Placements by tournament
  const placementsByTournament = {};
  for (const p of dbPlacements) {
    if (!placementsByTournament[p.tournament_id]) placementsByTournament[p.tournament_id] = [];
    placementsByTournament[p.tournament_id].push(p);
  }

  // Placements by player
  const placementsByPlayer = {};
  for (const p of dbPlacements) {
    if (!placementsByPlayer[p.player_id]) placementsByPlayer[p.player_id] = [];
    placementsByPlayer[p.player_id].push(p);
  }

  // Tournament lookup
  const tournamentById = {};
  for (const t of dbTournaments) tournamentById[t.id] = t;

  // Player state map (mutable, used for ELO replay + stat rebuild)
  const playerState = {};
  for (const p of dbPlayers) {
    playerState[p.id] = {
      id: p.id,
      elo: STARTING_ELO,
      peak_elo: STARTING_ELO,
      games_played: 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 2: IN-MEMORY COMPUTATION
  // ═══════════════════════════════════════════════════════════════════════

  // ── Step 1: Replay every tournament (ELO) ─────────────────────────────
  console.log('\n⚔️   Replaying matches for ELO …');
  let totalMatches = 0;
  const allHistoryRows = []; // [player_id, old_elo, new_elo, delta, reason]

  for (let ti = 0; ti < dbTournaments.length; ti++) {
    const t = dbTournaments[ti];
    const dateStr = t.completed_at ? new Date(t.completed_at).toISOString().slice(0, 10) : 'no date';
    const matches = matchesByTournament[t.id] || [];

    if (matches.length === 0) {
      process.stdout.write(`   [${fmt(ti + 1)}/${fmt(dbTournaments.length)}]  ${dateStr}  ${t.name.slice(0, 40).padEnd(40)} (no matches)\n`);
      continue;
    }

    const placements = placementsByTournament[t.id] || [];
    const totalEntrants = t.participants_count || placements.length || 0;

    for (const m of matches) {
      // Ensure both players are in playerState (handles edge case of match without player row)
      if (!playerState[m.player1_id]) playerState[m.player1_id] = { id: m.player1_id, elo: STARTING_ELO, peak_elo: STARTING_ELO, games_played: 0 };
      if (!playerState[m.player2_id]) playerState[m.player2_id] = { id: m.player2_id, elo: STARTING_ELO, peak_elo: STARTING_ELO, games_played: 0 };

      const pA = playerState[m.player1_id];
      const pB = playerState[m.player2_id];
      const result = m.winner_id === m.player1_id ? 1 : 0;
      const { playerA, playerB } = calculateNewRatings(
        { elo: pA.elo, games_played: pA.games_played },
        { elo: pB.elo, games_played: pB.games_played },
        result
      );

      allHistoryRows.push(
        [m.player1_id, pA.elo, playerA.newElo, playerA.delta, `Match in ${t.name}`],
        [m.player2_id, pB.elo, playerB.newElo, playerB.delta, `Match in ${t.name}`]
      );

      pA.elo = playerA.newElo; pA.games_played++;
      pB.elo = playerB.newElo; pB.games_played++;
      pA.peak_elo = Math.max(pA.peak_elo, pA.elo);
      pB.peak_elo = Math.max(pB.peak_elo, pB.elo);
    }

    // Placement bonuses
    for (const p of placements) {
      if (!p.final_rank) continue;
      const bonus = placementBonus(p.final_rank, totalEntrants);
      if (bonus <= 0) continue;
      if (!playerState[p.player_id]) playerState[p.player_id] = { id: p.player_id, elo: STARTING_ELO, peak_elo: STARTING_ELO, games_played: 0 };
      const state = playerState[p.player_id];
      allHistoryRows.push(
        [p.player_id, state.elo, state.elo + bonus, bonus, `Top ${p.final_rank} bonus in ${t.name}`]
      );
      state.elo += bonus;
      state.peak_elo = Math.max(state.peak_elo, state.elo);
    }

    totalMatches += matches.length;
    process.stdout.write(`   [${fmt(ti + 1)}/${fmt(dbTournaments.length)}]  ${dateStr}  ${t.name.slice(0, 40).padEnd(40)} ${fmt(matches.length)} matches\n`);
  }
  console.log(`   Total: ${totalMatches} matches replayed, ${allHistoryRows.length} history entries`);

  // ── Step 2: Rebuild aggregate player stats (in memory) ────────────────
  console.log('\n📊  Rebuilding player stats …');

  // Index all complete matches by player for stat computation
  const completeMatchesByPlayer = {};
  for (const m of dbMatches) {
    if (m.state !== 'complete' || !m.player1_id || !m.player2_id || !m.winner_id) continue;
    if (!completeMatchesByPlayer[m.player1_id]) completeMatchesByPlayer[m.player1_id] = [];
    if (!completeMatchesByPlayer[m.player2_id]) completeMatchesByPlayer[m.player2_id] = [];
    completeMatchesByPlayer[m.player1_id].push(m);
    completeMatchesByPlayer[m.player2_id].push(m);
  }

  // Build champion lookup: tournament_id → Set<player_id> who won (rank=1)
  const champsByTournament = {};
  for (const p of dbPlacements) {
    if (p.final_rank === 1) {
      if (!champsByTournament[p.tournament_id]) champsByTournament[p.tournament_id] = new Set();
      champsByTournament[p.tournament_id].add(p.player_id);
    }
  }

  // Compute stats per player entirely in memory
  const playerUpdates = {}; // playerId → { all stat fields }

  for (const p of dbPlayers) {
    const pid = p.id;
    const myMatches = completeMatchesByPlayer[pid] || [];
    const myPlacements = placementsByPlayer[pid] || [];

    // Global match stats
    let wins = 0, losses = 0;
    const tournamentsInMatches = new Set();
    for (const m of myMatches) {
      tournamentsInMatches.add(m.tournament_id);
      if (m.winner_id === pid) wins++;
      else losses++;
    }

    // Placement stats
    let tWins = 0, runnerUp = 0, top4 = 0, top8 = 0;
    // Per-series placement stats
    const seriesStats = {};
    for (const s of ALL_SERIES) seriesStats[s] = { entered: 0, top8: 0, top4: 0, runner_up: 0, wins: 0 };
    // Offline per-tier stats
    const offlineStats = {};
    for (const t of OFFLINE_TIERS) offlineStats[t] = { wins: 0, runner_up: 0, top4: 0, top8: 0 };
    let offlineWins = 0, offlineTop2 = 0;

    for (const pl of myPlacements) {
      const rank = pl.final_rank;
      if (rank === 1) tWins++;
      if (rank === 2) runnerUp++;
      if (rank <= 4) top4++;
      if (rank <= 8) top8++;

      // Series stats
      const tourney = tournamentById[pl.tournament_id];
      if (tourney && tourney.series) {
        const ss = seriesStats[tourney.series];
        if (ss) {
          // Count distinct tournaments entered (using a set would be ideal, but
          // since each placement row is one per player-tournament, this is fine)
          ss.entered++;
          if (rank <= 8) ss.top8++;
          if (rank <= 4) ss.top4++;
          if (rank === 2) ss.runner_up++;
          if (rank === 1) ss.wins++;
        }

        // Offline tier stats
        if (tourney.is_offline) {
          if (rank === 1) offlineWins++;
          if (rank <= 2) offlineTop2++;
          const ot = offlineStats[tourney.series];
          if (ot) {
            if (rank === 1) ot.wins++;
            if (rank === 2) ot.runner_up++;
            if (rank <= 4) ot.top4++;
            if (rank <= 8) ot.top8++;
          }
        }
      }
    }

    // Win streak (most recent matches first)
    const sortedMatches = [...myMatches].sort((a, b) => {
      const da = a.played_at || '', db2 = b.played_at || '';
      return da < db2 ? 1 : da > db2 ? -1 : b.id - a.id;
    });
    let currentStreak = 0, longestStreak = 0, streak = 0;
    let foundFirst = false;
    for (const m of sortedMatches) {
      if (m.winner_id === pid) {
        streak++;
        if (streak > longestStreak) longestStreak = streak;
      } else {
        if (!foundFirst) { currentStreak = streak; foundFirst = true; }
        streak = 0;
      }
    }
    if (!foundFirst) currentStreak = streak;

    // Games taken from champions
    let champGames = 0;
    for (const m of myMatches) {
      if (m.winner_id === pid) continue; // I lost this match
      const champs = champsByTournament[m.tournament_id];
      if (!champs || !champs.has(m.winner_id)) continue;
      const myScore = m.player1_id === pid ? m.player1_score : m.player2_score;
      if (myScore >= 1) champGames++;
    }

    // Comebacks (won match but opponent had at least 1 game)
    let comebacks = 0;
    for (const m of myMatches) {
      if (m.winner_id !== pid) continue;
      if (m.player1_score == null || m.player2_score == null) continue;
      const myScore = m.player1_id === pid ? parseInt(m.player1_score) : parseInt(m.player2_score);
      const oppScore = m.player1_id === pid ? parseInt(m.player2_score) : parseInt(m.player1_score);
      if (myScore > oppScore && oppScore > 0) comebacks++;
    }

    // Compute offline score
    let offlineScore = 0;
    for (const [tier, w] of Object.entries(OFFLINE_WEIGHTS)) {
      const os = offlineStats[tier];
      const pureTop4 = Math.max(0, os.top4 - os.wins - os.runner_up);
      const pureTop8 = Math.max(0, os.top8 - os.top4);
      offlineScore += os.wins * w.wins + os.runner_up * w.runner_up + pureTop4 * w.top4 + pureTop8 * w.top8;
    }

    const ps = playerState[pid] || { elo: STARTING_ELO, peak_elo: STARTING_ELO, games_played: 0 };

    playerUpdates[pid] = {
      elo_rating: ps.elo,
      peak_elo: ps.peak_elo,
      games_played: ps.games_played,
      total_match_wins: wins,
      total_match_losses: losses,
      tournaments_entered: tournamentsInMatches.size,
      tournament_wins: tWins,
      runner_up_finishes: runnerUp,
      top4_finishes: top4,
      top8_finishes: top8,
      current_win_streak: currentStreak,
      longest_win_streak: longestStreak,
      games_taken_from_champions: champGames,
      comebacks,
      // Per-series
      ...Object.fromEntries(ALL_SERIES.flatMap(s => [
        [`${s}_entered`, seriesStats[s].entered],
        [`${s}_top8`, seriesStats[s].top8],
        [`${s}_top4`, seriesStats[s].top4],
        [`${s}_runner_up`, seriesStats[s].runner_up],
        [`${s}_wins`, seriesStats[s].wins],
      ])),
      // Offline
      offline_wins: offlineWins,
      offline_top2: offlineTop2,
      offline_score: offlineScore,
      ...Object.fromEntries(OFFLINE_TIERS.flatMap(t => [
        [`offline_${t}_wins`, offlineStats[t].wins],
        [`offline_${t}_runner_up`, offlineStats[t].runner_up],
        [`offline_${t}_top4`, offlineStats[t].top4],
        [`offline_${t}_top8`, offlineStats[t].top8],
      ])),
    };
  }
  console.log(`   Stats computed for ${Object.keys(playerUpdates).length} players`);

  // ── Step 3: Pass 1 achievements (stat-based, in memory) ───────────────
  console.log('\n🏅  Pass 1: Awarding stat-based achievements …');

  // Build "fake" player stat rows that checkAchievementsPass1 expects
  // (it reads column names like tournament_wins, ffc_entered, etc.)
  const pass1Rows = [];
  for (const p of dbPlayers) {
    const updates = playerUpdates[p.id];
    if (!updates) continue;
    // Merge original player row with computed updates (updates override)
    const fakeStats = { ...p, ...updates };
    const newOnes = checkAchievementsPass1(fakeStats);
    for (const achId of newOnes) {
      pass1Rows.push({ player_id: p.id, achievement_id: achId });
    }
  }
  console.log(`   ${pass1Rows.length} Pass 1 achievements computed`);

  // ── Step 4: Pass 2 achievements (match + meta, in memory) ─────────────
  console.log('🎖️   Pass 2: Awarding match-based & meta achievements …');

  // Index all matches with winner by player (for Pass 2)
  const wonMatchesByPlayer = {};
  for (const m of dbMatches) {
    if (!m.winner_id || !m.player1_id || !m.player2_id) continue;
    if (!wonMatchesByPlayer[m.player1_id]) wonMatchesByPlayer[m.player1_id] = [];
    if (!wonMatchesByPlayer[m.player2_id]) wonMatchesByPlayer[m.player2_id] = [];
    wonMatchesByPlayer[m.player1_id].push(m);
    wonMatchesByPlayer[m.player2_id].push(m);
  }

  // Build global achievement map from Pass 1
  const globalOppAchMap = {};
  for (const r of pass1Rows) {
    if (!globalOppAchMap[r.player_id]) globalOppAchMap[r.player_id] = new Set();
    globalOppAchMap[r.player_id].add(r.achievement_id);
  }

  // Build match.id → tournament.series for the scope-aware Pass 2.
  // For online tournaments series is 'ffc', 'rtg_na', etc.; for offline it's
  // 'worlds', 'major', 'regional', 'other'. Meta achievements at non-global
  // scopes use this to restrict which matches count toward unique opponents.
  const matchSeriesById = {};
  for (const m of dbMatches) {
    const t = tournamentById[m.tournament_id];
    if (t && t.series) matchSeriesById[m.id] = t.series;
  }

  const pass2Rows = [];
  const contributorRows = [];

  for (const p of dbPlayers) {
    const playerMatches = wonMatchesByPlayer[p.id] || [];
    const alreadyUnlocked = globalOppAchMap[p.id] ? [...globalOppAchMap[p.id]] : [];

    const newOnes = checkAchievementsPass2Pure(p.id, playerMatches, globalOppAchMap, alreadyUnlocked, matchSeriesById);
    for (const ach of newOnes) {
      // Keep contributors attached to the row so we can derive unlocked_at later
      pass2Rows.push({
        player_id: p.id,
        achievement_id: ach.id,
        contributors: ach.contributors || [],
      });
      if (ach.contributors && ach.contributors.length > 0) {
        for (const c of ach.contributors) {
          contributorRows.push({
            player_id: p.id,
            achievement_id: ach.id,
            opponent_id: c.opponent_id,
            match_id: c.match_id || null,
          });
        }
      }
    }
  }
  console.log(`   ${pass2Rows.length} Pass 2 achievements + ${contributorRows.length} contributor records computed`);

  // ── Step 4.5: Derive unlocked_at per achievement ──────────────────────
  // Without this, every achievement reverts to NOW() at insert time and old
  // achievements (e.g. Stephmicky's circa-2018 wins) appear in the "Recent
  // Achievements" feed. Here we walk each player's placement / match history
  // chronologically and record the date they actually crossed each threshold.
  console.log('🕒  Computing unlocked_at for each achievement …');

  const REGION_THRESHOLDS_MAP = {
    kanto: 1, johto: 3, hoenn: 5, sinnoh: 10,
    unova: 20, kalos: 40, alola: 80, galar: 150, paldea: 250,
  };

  // Sort each player's placements (online AND offline) by tournament completed_at
  // ASC. Pre-attach the tournament row for cheap lookup.
  //
  // Offline placements are included because offline-tier placement achievements
  // now exist (worlds_gym_leader_*, major_champion_*, etc.) and global stats
  // count offline placements too — so deriveUnlockedAt needs access to them to
  // date a global achievement earned via offline play.
  //
  // We require completed_at to be non-null. A NULL completed_at (sometimes
  // produced by importer edge cases on round-robin or never-finished events)
  // used to anchor filtered[0] in deriveUnlockedAt — `null || ''` sorts before
  // any real date — which made the truthiness fallback chain return the
  // player's most-recent placement date as the "unlock" date for every
  // threshold. Filtering them out here means an undated placement simply
  // doesn't count toward the chronology; the achievement gets dated from the
  // player's earliest *dated* qualifying placement instead.
  const placementsByPlayerSorted = {};
  for (const pid of Object.keys(placementsByPlayer)) {
    placementsByPlayerSorted[pid] = placementsByPlayer[pid]
      .map(pl => ({ ...pl, _t: tournamentById[pl.tournament_id] }))
      .filter(pl => pl._t && pl._t.completed_at)
      .sort((a, b) => {
        const da = a._t.completed_at;
        const db_ = b._t.completed_at;
        return da < db_ ? -1 : da > db_ ? 1 : a._t.id - b._t.id;
      });
  }

  // Most-recent tournament date per player — fallback when a precise crossing
  // date can't be derived.
  const lastTourneyDateByPlayer = {};
  for (const pid of Object.keys(placementsByPlayerSorted)) {
    const list = placementsByPlayerSorted[pid];
    if (list.length > 0) lastTourneyDateByPlayer[pid] = list[list.length - 1]._t.completed_at;
  }

  // Match lookup by id (for match-based achievements that store match_ids in contributors)
  const matchById = {};
  for (const m of dbMatches) matchById[m.id] = m;

  // For meta achievements: the date player X first defeated opponent Y.
  // Same NULL-date guard as placementsByPlayerSorted above — a match attached
  // to a tournament with no completed_at can't tell us when the defeat
  // happened, so it's dropped rather than allowed to anchor the timeline.
  const firstDefeatByPlayer = {};
  for (const pid of Object.keys(wonMatchesByPlayer)) {
    const map = {};
    const matches = wonMatchesByPlayer[pid]
      .filter(m => m.winner_id === Number(pid))
      .map(m => ({ m, t: tournamentById[m.tournament_id] }))
      .filter(x => x.t && x.t.completed_at)
      .sort((a, b) => {
        const da = a.t.completed_at;
        const db_ = b.t.completed_at;
        return da < db_ ? -1 : da > db_ ? 1 : a.m.id - b.m.id;
      });
    for (const { m, t } of matches) {
      const opp = m.player1_id === Number(pid) ? m.player2_id : m.player1_id;
      if (!opp) continue;
      if (!map[opp]) map[opp] = t.completed_at;
    }
    firstDefeatByPlayer[pid] = map;
  }

  function deriveUnlockedAt(playerId, achievementId, contributors = []) {
    // Region threshold (last underscore-segment of the id is the region key)
    const idParts = String(achievementId).split('_');
    const region = idParts[idParts.length - 1];
    const threshold = REGION_THRESHOLDS_MAP[region];

    // Special: World Traveler — the date the player first entered their 2nd series
    if (achievementId === 'multi_series') {
      const placements = placementsByPlayerSorted[playerId] || [];
      const seriesFirst = {};
      for (const pl of placements) {
        const s = pl._t.series;
        if (!s) continue;
        if (!seriesFirst[s]) seriesFirst[s] = pl._t.completed_at;
      }
      const dates = Object.values(seriesFirst).filter(Boolean).sort();
      return dates[1] || dates[0] || null;
    }

    // (Reserved for future count-scaled match achievements — currently empty.
    //  When something new lives here, the date logic is "Nth contributor's
    //  tournament date".)
    const matchPrefixes = [];
    if (matchPrefixes.length && matchPrefixes.some(pre => achievementId.startsWith(pre))) {
      if (!threshold) return lastTourneyDateByPlayer[playerId] || null;
      const dates = (contributors || [])
        .map(c => {
          const m = c.match_id ? matchById[c.match_id] : null;
          if (!m) return null;
          const t = tournamentById[m.tournament_id];
          return t ? t.completed_at : null;
        })
        .filter(Boolean)
        .sort();
      return dates[threshold - 1] || dates[dates.length - 1] || lastTourneyDateByPlayer[playerId] || null;
    }

    // Meta (opponent-tier-scaled) — every Pass-2 achievement now lives here:
    //   • eight_badges / elite_trainer            — N=8 / 4 unique opponents defeated
    //   • rival_battle / smell_ya_later           — N=1 qualifying Rival
    //   • foreshadowing / dark_horse              — N=1 qualifying Champion
    //
    // Meta achievements are now scope-prefixed for non-global scopes
    // (e.g. `ffc_eight_badges_kanto`, `worlds_dark_horse_johto`), so we match
    // on substring rather than prefix. Global meta keeps the bare form
    // (`eight_badges_kanto`) for back-compat — `_eight_badges_` doesn't
    // start-anchor it, hence the includes check below normalizes both.
    //
    // Each contributor carries match_id (preferred — gives the precise
    // tournament date). The opponent_id firstDefeats fallback covers
    // match-mode metas (8 Badges, Elite Trainer, Smell Ya Later, Dark Horse).
    // Game-mode metas (Rival Battle, Foreshadowing) can be earned in matches
    // the player LOST, so the match_id path is the only reliable source.
    const metaTokens = [
      'eight_badges_', 'elite_trainer_',
      'rival_battle_', 'smell_ya_later_',
      'foreshadowing_', 'dark_horse_',
    ];
    const isMeta = metaTokens.some(t => achievementId.startsWith(t) || achievementId.includes(`_${t}`));
    if (isMeta) {
      if (!threshold) return lastTourneyDateByPlayer[playerId] || null;
      const firstDefeats = firstDefeatByPlayer[playerId] || {};
      const dates = (contributors || [])
        .map(c => {
          if (c.match_id) {
            const m = matchById[c.match_id];
            if (m) {
              const t = tournamentById[m.tournament_id];
              if (t && t.completed_at) return t.completed_at;
            }
          }
          return firstDefeats[c.opponent_id] || null;
        })
        .filter(Boolean)
        .sort();

      let required = 1;
      if      (achievementId.includes('eight_badges_'))    required = 8;
      else if (achievementId.includes('elite_trainer_'))   required = 4;
      // foreshadowing / dark_horse / rival_battle / smell_ya_later stay at 1

      return dates[required - 1] || dates[dates.length - 1] || lastTourneyDateByPlayer[playerId] || null;
    }

    // Placement / participation: parse tier and scope from the id
    let tier = null;
    let scope = null;
    const tierTokens = ['gym_leader', 'elite_four', 'rival', 'champion', 'participation'];
    for (const tt of tierTokens) {
      const marker = `_${tt}_`;
      if (achievementId.includes(marker)) {
        tier = tt;
        scope = achievementId.substring(0, achievementId.indexOf(marker));
        break;
      }
    }
    if (!tier || !threshold) return lastTourneyDateByPlayer[playerId] || null;

    const placements = placementsByPlayerSorted[playerId] || [];
    const filtered = placements.filter(pl => {
      // Scope: 'global' = any series; otherwise tournament series must match
      if (scope !== 'global' && pl._t.series !== scope) return false;
      const rank = pl.final_rank;
      if (tier === 'gym_leader')    return rank > 0 && rank <= 8;
      if (tier === 'elite_four')    return rank > 0 && rank <= 4;
      if (tier === 'rival')         return rank === 2;
      if (tier === 'champion')      return rank === 1;
      if (tier === 'participation') return true;
      return false;
    });

    return filtered[threshold - 1]?._t?.completed_at
      || filtered[filtered.length - 1]?._t?.completed_at
      || lastTourneyDateByPlayer[playerId]
      || null;
  }

  // Attach unlocked_at to every achievement row
  for (const r of pass1Rows) {
    r.unlocked_at = deriveUnlockedAt(r.player_id, r.achievement_id, []);
  }
  for (const r of pass2Rows) {
    r.unlocked_at = deriveUnlockedAt(r.player_id, r.achievement_id, r.contributors);
  }
  const datedCount = [...pass1Rows, ...pass2Rows].filter(r => r.unlocked_at).length;
  console.log(`   Dated ${datedCount}/${pass1Rows.length + pass2Rows.length} achievements (others fall back to NOW())`);

  // ═══════════════════════════════════════════════════════════════════════
  //  PHASE 3: BULK WRITE — push everything back to DB
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n📤  Writing results back to DB …');
  const t1 = Date.now();

  // Chunk size for unnest-based bulk INSERTs — kept under Postgres'
  // 65535-parameter ceiling. Hoisted up here so the revoke block below
  // (which predates the elo_history writer) can reuse it.
  const CHUNK = 5000;

  // ── Clear old computed data + revoke stale achievements ──────────────
  // elo_history is wiped wholesale — ELO is recomputed from scratch every
  // run, so leftover rows would double-count.
  //
  // player_achievements and achievement_defeated_opponents are pruned to
  // exactly the freshly-computed Pass 1 + Pass 2 set:
  //   - Stale rows (placements corrected, alias re-routed a player's
  //     matches elsewhere, threshold no longer holds) are DELETEd.
  //   - Surviving rows keep their existing first_seen_at and have their
  //     unlocked_at re-asserted by the INSERT … ON CONFLICT DO UPDATE
  //     below. first_seen_at is never written in the conflict path, so
  //     "first time we ever saw this unlock" stays stable; unlocked_at
  //     gets refreshed from deriveUnlockedAt (COALESCEd so a NULL date
  //     this run doesn't clobber a known-good one).
  await db.query(`DELETE FROM elo_history`);

  // Build the authoritative set of (player_id, achievement_id) pairs that
  // should exist post-recalc, then materialize it as a temp table so the
  // DELETEs can join against it cheaply.
  const validAchRows = [];
  const seenValid = new Set();
  for (const r of pass1Rows) {
    const key = `${r.player_id}|${r.achievement_id}`;
    if (seenValid.has(key)) continue;
    seenValid.add(key);
    validAchRows.push([r.player_id, r.achievement_id]);
  }
  for (const r of pass2Rows) {
    const key = `${r.player_id}|${r.achievement_id}`;
    if (seenValid.has(key)) continue;
    seenValid.add(key);
    validAchRows.push([r.player_id, r.achievement_id]);
  }

  await db.query(`
    CREATE TEMP TABLE _valid_ach (
      player_id INTEGER,
      achievement_id TEXT,
      PRIMARY KEY (player_id, achievement_id)
    )
  `);

  for (let i = 0; i < validAchRows.length; i += CHUNK) {
    const chunk = validAchRows.slice(i, i + CHUNK);
    const pids = chunk.map(r => r[0]);
    const aids = chunk.map(r => r[1]);
    await db.query(
      `INSERT INTO _valid_ach (player_id, achievement_id)
       SELECT unnest($1::int[]), unnest($2::text[])
       ON CONFLICT DO NOTHING`,
      [pids, aids]
    );
  }

  const { rowCount: revokedAch } = await db.query(`
    DELETE FROM player_achievements pa
    WHERE NOT EXISTS (
      SELECT 1 FROM _valid_ach v
      WHERE v.player_id = pa.player_id
        AND v.achievement_id = pa.achievement_id
    )
  `);
  const { rowCount: revokedContrib } = await db.query(`
    DELETE FROM achievement_defeated_opponents ado
    WHERE NOT EXISTS (
      SELECT 1 FROM _valid_ach v
      WHERE v.player_id = ado.player_id
        AND v.achievement_id = ado.achievement_id
    )
  `);
  await db.query(`DROP TABLE _valid_ach`);

  console.log(`   Cleared elo_history; revoked ${revokedAch} stale player_achievements + ${revokedContrib} orphaned contributor rows`);

  // ── Write ELO history (chunked to avoid param limit) ──────────────────
  let histWritten = 0;
  for (let i = 0; i < allHistoryRows.length; i += CHUNK) {
    const chunk = allHistoryRows.slice(i, i + CHUNK);
    const pids = chunk.map(r => r[0]);
    const olds = chunk.map(r => r[1]);
    const news = chunk.map(r => r[2]);
    const deltas = chunk.map(r => r[3]);
    const reasons = chunk.map(r => r[4]);
    await db.query(
      `INSERT INTO elo_history (player_id, old_elo, new_elo, delta, reason)
       SELECT unnest($1::int[]), unnest($2::int[]), unnest($3::int[]), unnest($4::int[]), unnest($5::text[])`,
      [pids, olds, news, deltas, reasons]
    );
    histWritten += chunk.length;
  }
  console.log(`   Wrote ${histWritten} elo_history rows (${Math.ceil(allHistoryRows.length / CHUNK)} chunks)`);

  // ── Write player stats + ELO (one UPDATE per player, but pipelined) ───
  // We build all the SET fields dynamically and run them in a single transaction
  const statFields = [
    'elo_rating', 'peak_elo', 'games_played',
    'total_match_wins', 'total_match_losses', 'tournaments_entered',
    'tournament_wins', 'runner_up_finishes', 'top4_finishes', 'top8_finishes',
    'current_win_streak', 'longest_win_streak',
    'games_taken_from_champions', 'comebacks',
    ...ALL_SERIES.flatMap(s => [`${s}_entered`, `${s}_top8`, `${s}_top4`, `${s}_runner_up`, `${s}_wins`]),
    'offline_wins', 'offline_top2', 'offline_score',
    ...OFFLINE_TIERS.flatMap(t => [`offline_${t}_wins`, `offline_${t}_runner_up`, `offline_${t}_top4`, `offline_${t}_top8`]),
  ];

  // Use a temp table approach for bulk UPDATE
  // 1. Create temp table with player_id + all stat columns
  // 2. INSERT all computed values into temp table
  // 3. UPDATE players FROM temp table

  const colDefs = statFields.map(f => `${f} INTEGER`).join(', ');
  await db.query(`CREATE TEMP TABLE _player_bulk (player_id INTEGER, ${colDefs})`);

  // Insert into temp table in chunks
  const playerIds = Object.keys(playerUpdates).map(Number);
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const pidArr = chunk;
    const colArrays = statFields.map(f => chunk.map(pid => playerUpdates[pid][f] ?? 0));

    // Build unnest clause
    const unnestParts = [`unnest($1::int[])`];
    const params = [pidArr];
    for (let fi = 0; fi < statFields.length; fi++) {
      unnestParts.push(`unnest($${fi + 2}::int[])`);
      params.push(colArrays[fi]);
    }

    await db.query(
      `INSERT INTO _player_bulk (player_id, ${statFields.join(', ')})
       SELECT ${unnestParts.join(', ')}`,
      params
    );
  }

  // Bulk UPDATE from temp table
  const setClauses = statFields.map(f => `${f} = b.${f}`).join(', ');
  await db.query(`
    UPDATE players p SET ${setClauses}, updated_at = NOW()
    FROM _player_bulk b WHERE p.id = b.player_id
  `);
  await db.query(`DROP TABLE _player_bulk`);
  console.log(`   Updated ${playerIds.length} player rows (temp table bulk UPDATE)`);

  // ── Write achievements ────────────────────────────────────────────────
  const allAchRows = [...pass1Rows, ...pass2Rows];
  if (allAchRows.length > 0) {
    for (let i = 0; i < allAchRows.length; i += CHUNK) {
      const chunk = allAchRows.slice(i, i + CHUNK);
      const pids = chunk.map(r => r.player_id);
      const aids = chunk.map(r => r.achievement_id);
      // Pass NULL when we couldn't derive a date. The schema now allows
      // unlocked_at IS NULL, and the /recent endpoint filters those out so
      // undated achievements don't masquerade as "just unlocked today".
      // (Previously this used COALESCE(d, NOW()), which surfaced old
      //  achievements in the recent feed every time the recalc ran.)
      const dates = chunk.map(r => r.unlocked_at || null);
      await db.query(
        `INSERT INTO player_achievements (player_id, achievement_id, unlocked_at)
         SELECT u.pid, u.aid, u.d
         FROM unnest($1::int[], $2::text[], $3::timestamptz[]) AS u(pid, aid, d)
         ON CONFLICT (player_id, achievement_id) DO UPDATE
         SET unlocked_at = COALESCE(EXCLUDED.unlocked_at, player_achievements.unlocked_at)`,
        [pids, aids, dates]
      );
    }
  }
  console.log(`   Wrote ${allAchRows.length} achievements (Pass 1: ${pass1Rows.length}, Pass 2: ${pass2Rows.length})`);

  // ── Write contributor/evidence rows ───────────────────────────────────
  if (contributorRows.length > 0) {
    for (let i = 0; i < contributorRows.length; i += CHUNK) {
      const chunk = contributorRows.slice(i, i + CHUNK);
      const pids = chunk.map(r => r.player_id);
      const aids = chunk.map(r => r.achievement_id);
      const oids = chunk.map(r => r.opponent_id);
      const mids = chunk.map(r => r.match_id);
      await db.query(
        // Upsert with COALESCE-protected match_id: if an existing row was
        // written by an older recalc with NULL match_id, this run fills it
        // in. Existing non-null match_ids are never overwritten. Without
        // this, NULL match_id rows stay frozen and the modal can't link the
        // qualifying match.
        `INSERT INTO achievement_defeated_opponents (player_id, achievement_id, opponent_id, match_id)
         SELECT unnest($1::int[]), unnest($2::text[]), unnest($3::int[]), unnest($4::int[])
         ON CONFLICT (player_id, achievement_id, opponent_id) DO UPDATE
           SET match_id = COALESCE(achievement_defeated_opponents.match_id, EXCLUDED.match_id)`,
        [pids, aids, oids, mids]
      );
    }
  }
  console.log(`   Wrote ${contributorRows.length} contributor records`);

  const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`   All writes completed in ${elapsed}s`);


  // ── Done ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🏁  DONE');
  console.log(`    Tournaments replayed : ${dbTournaments.length}`);
  console.log(`    Matches processed    : ${totalMatches}`);
  console.log(`    Players updated      : ${playerIds.length}`);
  console.log(`    ELO history rows     : ${allHistoryRows.length}`);
  console.log(`    Achievements awarded : ${pass1Rows.length} (Pass 1) + ${pass2Rows.length} (Pass 2)`);
  console.log('\n✨  ELO and achievements are now up to date!');

  await db.end?.();
})().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
