/**
 * Neos City ELO Rating System
 * Starting rating: 1200
 * K-factor: 32 (new players, <30 games), 24 (established), 16 (top players, >2000)
 */

const STARTING_ELO = 1200;

function getKFactor(rating, gamesPlayed) {
  if (gamesPlayed < 30) return 32;
  if (rating >= 2000) return 16;
  return 24;
}

// Expected score for player A vs player B
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// Calculate new ratings after a match
// result: 1 = playerA wins, 0 = playerB wins, 0.5 = draw
function calculateNewRatings(playerA, playerB, result) {
  const kA = getKFactor(playerA.elo, playerA.games_played);
  const kB = getKFactor(playerB.elo, playerB.games_played);

  const expectedA = expectedScore(playerA.elo, playerB.elo);
  const expectedB = 1 - expectedA;

  const scoreA = result;       // 1, 0, or 0.5
  const scoreB = 1 - result;

  const newEloA = Math.round(playerA.elo + kA * (scoreA - expectedA));
  const newEloB = Math.round(playerB.elo + kB * (scoreB - expectedB));

  return {
    playerA: { newElo: newEloA, delta: newEloA - playerA.elo },
    playerB: { newElo: newEloB, delta: newEloB - playerB.elo }
  };
}

// Placement bonuses — disabled.
// Previously awarded +50/+30/+20/+10/+5 based on final rank, but this caused
// massive ELO inflation (ratings reaching 7000+). Pure match-based ELO now.
function placementBonus(placement, totalParticipants) {
  return 0;
}

// Process all matches from a completed tournament and return ELO updates
function processTournamentResults(matches, participants) {
  // Build a map: challonge_participant_id -> player data
  const playerMap = new Map();
  for (const p of participants) {
    playerMap.set(p.challonge_participant_id, {
      id: p.id,
      elo: p.elo_rating,
      games_played: p.games_played
    });
  }

  const eloUpdates = []; // { player_id, old_elo, new_elo, delta }

  for (const match of matches) {
    if (!match.winner_id) continue; // skip incomplete matches

    const pA = playerMap.get(match.player1_challonge_id);
    const pB = playerMap.get(match.player2_challonge_id);
    if (!pA || !pB) continue;

    const result = match.winner_challonge_id === match.player1_challonge_id ? 1 : 0;
    const { playerA, playerB } = calculateNewRatings(pA, pB, result);

    const oldEloA = pA.elo;
    const oldEloB = pB.elo;

    pA.elo = playerA.newElo;
    pA.games_played++;
    pB.elo = playerB.newElo;
    pB.games_played++;

    eloUpdates.push(
      { player_id: pA.id, old_elo: oldEloA, new_elo: pA.elo, delta: playerA.delta },
      { player_id: pB.id, old_elo: oldEloB, new_elo: pB.elo, delta: playerB.delta }
    );
  }

  // Apply placement bonuses
  for (const p of participants) {
    if (!p.final_rank || !p.total_in_tournament) continue;
    const bonus = placementBonus(p.final_rank, p.total_in_tournament);
    if (bonus > 0) {
      const player = playerMap.get(p.challonge_participant_id);
      if (player) {
        eloUpdates.push({
          player_id: player.id,
          old_elo: player.elo,
          new_elo: player.elo + bonus,
          delta: bonus,
          reason: `Top ${p.final_rank} placement bonus`
        });
        player.elo += bonus;
      }
    }
  }

  return { eloUpdates, playerMap };
}

module.exports = {
  STARTING_ELO,
  calculateNewRatings,
  placementBonus,
  processTournamentResults
};
