/**
 * seed_creators.js — Seed the community-pillar creators and the resource
 * library. EDIT THE TWO ARRAYS BELOW, then run from the neos-city directory:
 *
 *   node seed_creators.js
 *
 * Idempotent: creators are matched on channel_url, resources on url — re-running
 * skips anything already present (and refreshes blurb/series/etc. for creators).
 * After seeding creators, run `node refresh_creators.js` to pull their latest
 * uploads from YouTube so the active/archive split is populated.
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── EDIT ME: the pillars ─────────────────────────────────────────────────────
// region: 'NA' | 'EU' | 'JP' | null
// series: array of series keys — 'ffc','rtg_na','rtg_eu','dcm','tcc','eotr',
//         'nezumi','nezumi_rookies','ha'  (rendered as colored badges)
// player_id: optional — link the card to a /players/:id profile
const CREATORS = [
  // ── Pokkén-focused channels (recently active) ──────────────────────────────
  { name: 'SonicNKnux',  channel_url: 'https://www.youtube.com/@SonicNKnux',     blurb: 'Pokkén content & matches',        sort_order: 0 },
  { name: 'Jin Journeys', channel_url: 'https://www.youtube.com/@TheJinJourneys', blurb: 'Pokkén content',                 sort_order: 1 },
  { name: 'TresNoms',    channel_url: 'https://www.youtube.com/@TresNoms',       blurb: 'Pokkén content',                  sort_order: 2 },
  { name: 'RpgFrog',     channel_url: 'https://www.youtube.com/@rpgfrog2330',    blurb: 'Pokkén content',                  sort_order: 3 },

  // ── Tournament match archives ──────────────────────────────────────────────
  { name: 'Pokken Tournament Oceania', channel_url: 'https://www.youtube.com/@PokkenOCE',      blurb: 'Tournament match archive (OCE)', sort_order: 10 },
  { name: "Euclase's Pokkén Archives", channel_url: 'https://www.youtube.com/@EuclaseArchive', blurb: 'Tournament match archive',       sort_order: 11 },

  // ── Legacy / fundamentals resources ────────────────────────────────────────
  { name: 'BadIntent',   channel_url: 'https://www.youtube.com/@BadIntent',      blurb: 'Fundamentals — see Pokkén Basics playlist', sort_order: 20 },
  { name: '21 Hits',     channel_url: 'https://www.youtube.com/@21Hits',         blurb: 'Pokkén guides & tech',            sort_order: 21 },
];

// ── EDIT ME: the resource library ────────────────────────────────────────────
// kind: 'character_guide' | 'fundamental'
// character: e.g. 'Gardevoir' (character guides) — null for fundamentals
// skill_level: 'beginner' | 'intermediate' | 'advanced' | null
// series: optional series key | null
// creator: optional creator name (must match a CREATORS entry above) — links the
//          resource to that creator's card and counts toward its "N guides" badge
const RESOURCES = [
  {
    title: 'Pokkén Basics (playlist)',
    url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAK4GxBRrz1f2Nix6IqAzzoc',
    kind: 'fundamental',
    skill_level: 'beginner',
    creator: 'BadIntent',
  },
];

async function seedCreators() {
  let added = 0, updated = 0;
  for (const c of CREATORS) {
    const { rows } = await pool.query('SELECT id FROM creators WHERE channel_url = $1', [c.channel_url]);
    if (rows.length) {
      await pool.query(
        `UPDATE creators SET name=$2, blurb=$3, region=$4, series=COALESCE($5::text[],'{}'),
                             player_id=$6, sort_order=COALESCE($7,0)
         WHERE id=$1`,
        [rows[0].id, c.name, c.blurb || null, c.region || null,
         c.series || null, c.player_id || null, c.sort_order]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO creators (name, channel_url, blurb, region, series, player_id, sort_order)
         VALUES ($1,$2,$3,$4,COALESCE($5::text[],'{}'),$6,COALESCE($7,0))`,
        [c.name, c.channel_url, c.blurb || null, c.region || null,
         c.series || null, c.player_id || null, c.sort_order]
      );
      added++;
    }
  }
  console.log(`Creators: ${added} added, ${updated} updated.`);
}

async function seedResources() {
  let added = 0, skipped = 0;
  for (const r of RESOURCES) {
    const { rows } = await pool.query('SELECT id FROM resources WHERE url = $1', [r.url]);
    if (rows.length) { skipped++; continue; }

    // Optional: link to a creator by name (seeded above).
    let creatorId = null;
    if (r.creator) {
      const { rows: cr } = await pool.query('SELECT id FROM creators WHERE name = $1', [r.creator]);
      if (cr.length) creatorId = cr[0].id;
      else console.warn(`  resource "${r.title}": creator "${r.creator}" not found — leaving unlinked`);
    }

    await pool.query(
      `INSERT INTO resources (title, url, kind, character_name, skill_level, series, creator_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r.title, r.url, r.kind, r.character || null, r.skill_level || null, r.series || null, creatorId]
    );
    added++;
  }
  console.log(`Resources: ${added} added, ${skipped} already present.`);
}

(async () => {
  if (CREATORS.length === 0 && RESOURCES.length === 0) {
    console.log('Nothing to seed — edit the CREATORS / RESOURCES arrays in seed_creators.js first.');
    await pool.end();
    return;
  }
  await seedCreators();
  await seedResources();
  await pool.end();
})().catch(err => {
  console.error('Fatal:', err.message);
  pool.end();
  process.exit(1);
});
