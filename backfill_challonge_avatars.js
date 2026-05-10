#!/usr/bin/env node
// One-time (re-runnable) backfill: populate players.avatar_url from Challonge.
//
// Walks every online Challonge-sourced tournament, fetches its participants
// via the v1 API, and updates players.avatar_url keyed on the canonical
// (post-alias) lowercased challonge_username — the same key the import path
// uses, so aliased players (e.g. thankswalot → jukem) resolve correctly.
//
// Stores the URL verbatim. Challonge serves two flavours:
//   • https://user-assets.challonge.com/users/images/.../xlarge/<file>  — custom upload
//   • https://secure.gravatar.com/avatar/<hash>?...&d=...fireball...    — gravatar w/ fireball default
// The UI can decide whether to render a default-fireball gravatar or fall back
// to a generic icon — the URL pattern is enough to tell them apart.
//
// Flags:
//   --only-missing   Skip tournaments whose linked players already all have
//                    avatar_url set (cheap re-run guard).
//   --limit N        Process at most N tournaments (debug).
//   --dry-run        Don't UPDATE — just print what would change.
//   --sleep MS       Override per-request delay (default 250).
//
// Usage (from neos-city root):
//   node backfill_challonge_avatars.js
//   node backfill_challonge_avatars.js --only-missing
//   node backfill_challonge_avatars.js --limit 5 --dry-run

require('dotenv').config({ path: 'backend/.env' });
const { Pool } = require('pg');
const challonge = require('./backend/src/services/challonge');

const argv = process.argv.slice(2);
const ONLY_MISSING = argv.includes('--only-missing');
const DRY_RUN = argv.includes('--dry-run');
const limitIdx = argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(argv[limitIdx + 1], 10) || null : null;
const sleepIdx = argv.indexOf('--sleep');
const SLEEP_MS = sleepIdx >= 0 ? parseInt(argv[sleepIdx + 1], 10) || 250 : 250;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadAliases(db) {
  try {
    const { rows } = await db.query('SELECT alias_username, canonical_username FROM player_aliases');
    return new Map(rows.map(r => [r.alias_username, r.canonical_username]));
  } catch {
    return new Map();
  }
}

(async () => {
  const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const aliases = await loadAliases(db);
  console.log(`Loaded ${aliases.size} player aliases`);

  // Online Challonge tournaments only — exclude Tonamel/start.gg/Liquipedia/offline
  // rows that may have non-null challonge_id from their own import paths.
  const { rows: tournaments } = await db.query(`
    SELECT id, challonge_id, name
    FROM tournaments
    WHERE source = 'challonge'
      AND challonge_id IS NOT NULL
      AND tonamel_id IS NULL
      AND startgg_phase_group_id IS NULL
      AND liquipedia_url IS NULL
      AND (is_offline IS NULL OR is_offline = FALSE)
    ORDER BY started_at ASC NULLS LAST
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `);

  console.log(`Found ${tournaments.length} Challonge tournaments to process`);
  if (DRY_RUN) console.log('(dry run — no UPDATEs will be issued)');

  let processed = 0, skipped = 0, apiFailed = 0;
  let participantsTotal = 0, urlsSeen = 0, updates = 0, unmatched = 0;

  for (const t of tournaments) {
    if (ONLY_MISSING) {
      const { rows: [{ missing }] } = await db.query(`
        SELECT COUNT(*)::int AS missing
        FROM players p
        WHERE p.avatar_url IS NULL
          AND p.id IN (
            SELECT player1_id FROM matches WHERE tournament_id = $1
            UNION
            SELECT player2_id FROM matches WHERE tournament_id = $1
          )
      `, [t.id]);
      if (missing === 0) {
        skipped++;
        continue;
      }
    }

    let participants;
    try {
      const data = await challonge.getParticipants(t.challonge_id);
      participants = Array.isArray(data) ? data : [];
    } catch (err) {
      apiFailed++;
      const status = err.response?.status;
      console.warn(`  [${t.challonge_id}] FAILED (${status || err.message})`);
      await sleep(SLEEP_MS);
      continue;
    }

    let tUpdates = 0;
    let tUnmatched = 0;
    for (const p of participants) {
      const a = p.participant || p;
      const raw = (a.challonge_username || a.name || '').toLowerCase();
      if (!raw) continue;
      const username = aliases.get(raw) || raw;
      const url = a.attached_participatable_portrait_url || null;
      participantsTotal++;
      if (!url) continue;
      urlsSeen++;

      if (DRY_RUN) {
        tUpdates++;
        continue;
      }
      const r = await db.query(
        `UPDATE players SET avatar_url = $1 WHERE LOWER(challonge_username) = $2`,
        [url, username]
      );
      if (r.rowCount > 0) tUpdates += r.rowCount;
      else tUnmatched++;
    }
    updates += tUpdates;
    unmatched += tUnmatched;
    processed++;
    console.log(`  [${t.challonge_id}] ${(t.name || '').slice(0, 50)} — ${participants.length} participants, ${tUpdates} updates${tUnmatched ? `, ${tUnmatched} no-match` : ''}`);
    await sleep(SLEEP_MS);
  }

  console.log('\n===== SUMMARY =====');
  console.log(`Tournaments processed:     ${processed}`);
  console.log(`Tournaments skipped:       ${skipped}`);
  console.log(`Tournaments API-failed:    ${apiFailed}`);
  console.log(`Participants seen:         ${participantsTotal}`);
  console.log(`Participants with URL:     ${urlsSeen}`);
  console.log(`Player rows updated:       ${updates}`);
  console.log(`Participants w/o player:   ${unmatched}  (entrants that don't map to a stored player — usually walk-ups from older imports)`);

  await db.end();
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
