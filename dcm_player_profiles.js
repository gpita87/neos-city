#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — DCM player Challonge profiles
// Run from the neos-city directory:  node dcm_player_profiles.js
//
// Prints the real Challonge profile handles (players.challonge_profile_slug) of
// every player who appeared in a DCM-series tournament. Feed this list into
// harvest_participation_console.js (paste it in as USERNAMES) to discover the
// "locals" those players have competed in — tournaments run by organizers we
// don't already track.
//
// Only players with a non-NULL challonge_profile_slug are returned, because
// that column is populated ONLY from the v1 API's real `challonge_username`
// field (see tournaments.js importOne) — i.e. it's a genuine, scrapeable
// `/users/<handle>` profile. Guest entries, start.gg, Tonamel and offline
// players have NULL here and can't be crawled.
//
// READ-ONLY — does not write to the DB. Safe to run anytime.
// ===========================================================================

require('dotenv').config({ path: './backend/.env' });

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set in backend/.env');
  process.exit(1);
}

const DCM_SERIES = 'dcm';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Players in any DCM tournament, via placements OR matches (covers entrants
    // who have a placement row and any edge case where only match rows exist).
    const { rows } = await pool.query(
      `SELECT DISTINCT p.challonge_profile_slug AS slug, p.display_name
         FROM players p
        WHERE p.challonge_profile_slug IS NOT NULL
          AND p.id IN (
            SELECT tp.player_id
              FROM tournament_placements tp
              JOIN tournaments t ON t.id = tp.tournament_id
             WHERE t.series = $1
            UNION
            SELECT m.player1_id
              FROM matches m
              JOIN tournaments t ON t.id = m.tournament_id
             WHERE t.series = $1
            UNION
            SELECT m.player2_id
              FROM matches m
              JOIN tournaments t ON t.id = m.tournament_id
             WHERE t.series = $1
          )
        ORDER BY p.challonge_profile_slug`,
      [DCM_SERIES]
    );

    const slugs = rows.map(r => r.slug).filter(Boolean);

    console.log(`\n${slugs.length} DCM player(s) with a scrapeable Challonge profile.\n`);
    console.log('Paste this into harvest_participation_console.js as USERNAMES:\n');
    // One slug per line keeps the array diff-friendly and easy to trim by hand.
    console.log('const USERNAMES = [');
    for (const s of slugs) console.log(`  ${JSON.stringify(s)},`);
    console.log('];\n');
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
