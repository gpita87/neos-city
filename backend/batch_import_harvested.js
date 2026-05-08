#!/usr/bin/env node
// One-time script: bulk-import all harvested Pokken tournament URLs
// Run from: backend/   (so dotenv loads .env)
// Usage: node batch_import_harvested.js

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const challonge = require('./src/services/challonge');
const { detectSeries } = require('./src/services/achievements');
const db = require('./src/db');

const FILE = path.resolve(__dirname, '../harvested_tournaments.txt');
const DELAY_BETWEEN = 800;   // ms between each tournament fetch
const LOG_FILE = path.resolve(__dirname, '../import_log.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Mirrors the importOne logic from routes/tournaments.js
async function importOne(challonge_id) {
  const [tourneyData, participantsData, matchesData] = await Promise.all([
    challonge.getTournament(challonge_id),
    challonge.getParticipants(challonge_id),
    challonge.getMatches(challonge_id, { state: 'all' }),
  ]);

  const t = tourneyData.data?.attributes || tourneyData.tournament || tourneyData;
  const tournamentName = t.name || challonge_id;
  const series = detectSeries(challonge_id, tournamentName);

  const completedAt = t.completed_at
    || t.ends_at
    || t.updated_at
    || t.created_at
    || null;

  const { rows: [tournament] } = await db.query(
    `INSERT INTO tournaments
       (challonge_id, name, series, completed_at, participants_count, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (challonge_id) DO UPDATE SET
       name               = EXCLUDED.name,
       series             = EXCLUDED.series,
       completed_at       = EXCLUDED.completed_at,
       participants_count = EXCLUDED.participants_count,
       raw_data           = EXCLUDED.raw_data
     RETURNING *`,
    [
      challonge_id,
      tournamentName,
      series,
      completedAt,
      t.participants_count || t.participants?.length || 0,
      JSON.stringify(tourneyData),
    ]
  );

  // ── Participants ──────────────────────────────────────────────────────────
  const participants = participantsData.data || participantsData.participants || participantsData || [];
  const idMap = {}; // challonge participant id → our db player id

  for (const p of participants) {
    const attrs = p.attributes || p.participant || p;
    const challongeUserId = String(attrs.challonge_username_and_suggested_events || attrs.username || attrs.name || attrs.display_name || `anon_${attrs.id}`).toLowerCase().trim();
    const displayName = attrs.display_name || attrs.name || challongeUserId;
    const challongePartId = String(attrs.id || p.id || '');

    const { rows: [player] } = await db.query(
      `INSERT INTO players (challonge_username, display_name)
       VALUES ($1, $2)
       ON CONFLICT (challonge_username) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, players.display_name)
       RETURNING id`,
      [challongeUserId, displayName]
    );
    if (challongePartId) idMap[challongePartId] = player.id;
  }

  // ── Placements ────────────────────────────────────────────────────────────
  for (const p of participants) {
    const attrs = p.attributes || p.participant || p;
    const challongeUserId = String(attrs.challonge_username_and_suggested_events || attrs.username || attrs.name || attrs.display_name || `anon_${attrs.id}`).toLowerCase().trim();
    const finalRank = attrs.final_rank || attrs.seed || null;
    const challongePartId = String(attrs.id || p.id || '');
    const playerId = idMap[challongePartId];
    if (!playerId) continue;

    await db.query(
      `INSERT INTO tournament_placements (tournament_id, player_id, final_rank)
       VALUES ($1, $2, $3)
       ON CONFLICT (tournament_id, player_id) DO UPDATE SET
         final_rank = EXCLUDED.final_rank`,
      [tournament.id, playerId, finalRank]
    );
  }

  // ── Matches ───────────────────────────────────────────────────────────────
  const matches = matchesData.data || matchesData.matches || matchesData || [];
  for (const m of matches) {
    const attrs = m.attributes || m.match || m;
    if (attrs.state !== 'complete') continue;

    const p1Id = idMap[String(attrs.player1_id || '')] || null;
    const p2Id = idMap[String(attrs.player2_id || '')] || null;
    const winnerId = idMap[String(attrs.winner_id || '')] || null;
    if (!p1Id || !p2Id || !winnerId) continue;

    const scores = attrs.scores_csv || '';
    await db.query(
      `INSERT INTO matches (tournament_id, player1_id, player2_id, winner_id, scores, round)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [tournament.id, p1Id, p2Id, winnerId, scores, attrs.round || 0]
    );
  }

  return { id: tournament.id, name: tournamentName, series };
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`File not found: ${FILE}`);
    process.exit(1);
  }

  const urls = fs.readFileSync(FILE, 'utf8')
    .split('\n').map(s => s.trim()).filter(Boolean);

  console.log(`📋 Loaded ${urls.length} URLs`);

  // Extract slugs
  const slugs = [...new Set(urls.map(u => {
    const s = u.replace(/^https?:\/\/challonge\.com\//i, '');
    const parts = s.split('/').filter(Boolean);
    return parts[parts.length - 1]?.split('#')[0] || '';
  }).filter(Boolean))];

  console.log(`🔑 ${slugs.length} unique slugs after dedup`);

  // Skip already-imported
  const { rows: existing } = await db.query(`SELECT challonge_id FROM tournaments`);
  const existingIds = new Set(existing.map(r => r.challonge_id));
  const toImport = slugs.filter(s => !existingIds.has(s));
  console.log(`📦 ${toImport.length} to import (${existingIds.size} already in DB)\n`);

  const log = { imported: [], skipped: slugs.filter(s => existingIds.has(s)), errors: [] };
  let i = 0;

  for (const slug of toImport) {
    i++;
    process.stdout.write(`[${i}/${toImport.length}] ${slug}… `);
    try {
      const result = await importOne(slug);
      console.log(`✅ ${result.name} (${result.series})`);
      log.imported.push({ slug, name: result.name, series: result.series });
    } catch (err) {
      const msg = err.response?.data?.errors?.[0]?.detail || err.response?.data?.error || err.message;
      console.log(`❌ ${msg}`);
      log.errors.push({ slug, error: msg });
    }
    if (i < toImport.length) await sleep(DELAY_BETWEEN);
  }

  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));

  console.log('\n🏁 DONE!');
  console.log(`   ✅ Imported:  ${log.imported.length}`);
  console.log(`   ⏭️  Skipped:   ${log.skipped.length} (already in DB)`);
  console.log(`   ❌ Errors:    ${log.errors.length}`);
  console.log(`\nFull log → import_log.json`);

  await db.end?.();
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
