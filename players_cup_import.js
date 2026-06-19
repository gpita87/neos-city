/**
 * players_cup_import.js
 *
 * Imports the Pokémon Players Cup — Pokkén Tournament DX Global Finals
 * (PPC I, III, IV) from players_cup_data.js into Neos City.
 *
 * These are the official Play! Pokémon online championship Global Finals.
 * They are imported as the display-only series 'players_cup' with
 * is_offline=TRUE, so they never enter the online ladder or Online tab.
 * Placements (ranks 1-8) are authoritative and set explicitly — the backend
 * route does NOT derive them from match order.
 *
 * Run from the neos-city directory with the backend running:
 *   node players_cup_import.js
 *
 * Idempotent — dedup is on exact tournament name, placements are wiped +
 * repopulated, and matches dedup on a stable external_id. Re-running converges
 * to the same state. After running, run `node recalculate_elo.js` so global
 * ELO ordering is correct.
 */

const axios = require('axios');
const path  = require('path');

require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const { PLAYERS_CUP_EVENTS } = require('./players_cup_data');

const BACKEND_URL = 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.error('ADMIN_TOKEN is not set. Add it to backend/.env (see .env.example).');
  process.exit(1);
}

async function main() {
  console.log(`\n🏆 Neos City — Pokémon Players Cup Importer`);
  console.log(`📡 Backend: ${BACKEND_URL}`);
  console.log(`📋 Events to import: ${PLAYERS_CUP_EVENTS.length}\n`);

  // Health check
  try {
    await axios.get(`${BACKEND_URL}/api/health`);
  } catch (err) {
    console.error(`❌ Cannot reach backend at ${BACKEND_URL}. Is it running?`);
    console.error(`   Start it with: cd neos-city/backend && npm run dev`);
    process.exit(1);
  }

  let imported = 0, failed = 0;
  for (const event of PLAYERS_CUP_EVENTS) {
    const payload = {
      key:                event.key,
      name:               event.name,
      date:               event.date,
      location:           event.location,
      prize_pool:         event.prize_pool,
      participants_count: event.participants_count,
      placements:         event.placements,
      matches:            event.matches,
    };

    try {
      const { data } = await axios.post(
        `${BACKEND_URL}/api/tournaments/import-players-cup`,
        payload,
        { headers: { 'x-admin-token': ADMIN_TOKEN } }
      );
      imported++;
      console.log(`✅ ${data.tournament}`);
      console.log(`     placements: ${data.placements}  matches imported: ${data.matches_imported}  participants: ${data.participants}`);
    } catch (err) {
      failed++;
      const msg = err.response?.data?.error || err.message;
      console.error(`❌ ${event.name}: ${msg}`);
    }
  }

  console.log(`\n✅ Imported: ${imported}    ❌ Failed: ${failed}`);
  console.log('\nNext: run `node recalculate_elo.js` to fix global ELO ordering.');
  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
