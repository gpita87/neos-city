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
const youtube = require('./backend/src/services/youtube');
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
  // Pokkén Basics moved to PLAYLISTS (it's a playlist). Add character guides /
  // non-playlist fundamentals here.
];

// ── EDIT ME: featured-video spotlight ────────────────────────────────────────
// Hand-picked one-off videos shown in the spotlight at the top of the page.
// Only video_id + note are needed here — title, channel name, and thumbnail are
// filled in from the YouTube API by refresh_creators.js / the backend poller.
// video_id is the YouTube watch id (the v= part of the URL).
const FEATURED = [
  {
    video_id: '6JFxLh8bZP0',
    note: "One-off Pokkén video from a creator who doesn't normally cover the game.",
    sort_order: 0,
  },
];

// ── EDIT ME: pinned creator videos ───────────────────────────────────────────
// For creators whose recent uploads aren't relevant (e.g. a legacy Pokkén
// channel now posting other content), hand-pick the videos to show and set
// `lock: true` so the poller never overwrites them (videos_locked). Titles +
// dates are fetched from the YouTube API; videos sort newest-first by date.
//   creator: must match a CREATORS name above
//   lock:    true → videos_locked = TRUE (auto-updates disabled)
//   videos:  watch URLs or bare video IDs (replaces the creator's video set)
const PINNED = [
  {
    creator: 'BadIntent',
    lock: true,
    videos: [
      'https://www.youtube.com/watch?v=bsPi1ky3ON8',
      'https://www.youtube.com/watch?v=HTLjidu1vHY',
      'https://www.youtube.com/watch?v=0RfXH46a0Mw',
    ],
  },
];

// Pull the 11-char video id out of a watch/share URL (or accept a bare id).
function extractVideoId(s) {
  const m = String(s).match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{6,})/);
  return m ? m[1] : String(s).trim();
}

// ── EDIT ME: curated playlists ───────────────────────────────────────────────
// Shown in the "Playlists" section. Title / channel / thumbnail / video count
// are fetched from the YouTube API by refresh_creators.js / the poller — only
// the playlist URL (and optional creator/note) are needed here. Display order
// follows array order (sort_order defaults to the index).
//   creator: optional creator name (must match a CREATORS entry above)
const PLAYLISTS = [
  // BadIntent's Pokkén playlists (Pokkén Basics first — the fundamentals set)
  { creator: 'BadIntent', note: 'Fundamentals', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAK4GxBRrz1f2Nix6IqAzzoc' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAINcEinYpabjIfFQ6gB7S0L' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAKfZiSmfmt8NJCdQR1MCOtD' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAJR9TxQTrvBg1luAcDvJCeH' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAKHwH3bGmzjjJah0T9hpY1i' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAK1yDypiMIbnzVfM7H57FLz' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyALf1ZE0O7Gv-6xXV2PfQvdw' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAJ6Bj0OWCpXb9Bu0l5ldVLC' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAJ51AMd8YmBmnLesVcbKwdi' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAJx-yaFOwKP4tOejBgiwFsW' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAKch2MXVu2BmVS_FboBPODm' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAKrGlZv2yqKrlkk38771tJN' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyAKqU18QAbKcAP9dAXf2-IuI' },
  { creator: 'BadIntent', url: 'https://www.youtube.com/playlist?list=PLY3pqCfpWyALdhRX_xVNNKlD4MszrYOxn' },
];

// Pull the "list=" id out of a playlist URL (or accept a bare id).
function extractPlaylistId(s) {
  const m = String(s).match(/[?&]list=([\w-]+)/);
  return m ? m[1] : String(s).trim();
}

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

async function seedFeatured() {
  let added = 0, updated = 0;
  for (const f of FEATURED) {
    const { rows } = await pool.query('SELECT id FROM featured_videos WHERE video_id = $1', [f.video_id]);
    if (rows.length) {
      await pool.query(
        `UPDATE featured_videos SET note=$2, channel_url=$3, sort_order=COALESCE($4,0) WHERE id=$1`,
        [rows[0].id, f.note || null, f.channel_url || null, f.sort_order]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO featured_videos (video_id, note, channel_url, sort_order)
         VALUES ($1,$2,$3,COALESCE($4,0))`,
        [f.video_id, f.note || null, f.channel_url || null, f.sort_order]
      );
      added++;
    }
  }
  console.log(`Featured: ${added} added, ${updated} updated. (run refresh_creators.js to fill titles/thumbnails)`);
}

async function seedPinned() {
  for (const p of PINNED) {
    const { rows: cr } = await pool.query('SELECT id FROM creators WHERE name = $1', [p.creator]);
    if (!cr.length) { console.warn(`  pinned: creator "${p.creator}" not found — skipping`); continue; }
    const creatorId = cr[0].id;

    if (typeof p.lock === 'boolean') {
      await pool.query('UPDATE creators SET videos_locked = $2 WHERE id = $1', [creatorId, p.lock]);
    }

    if (Array.isArray(p.videos)) {
      // Replace this creator's video set with exactly the pinned list.
      await pool.query('DELETE FROM creator_videos WHERE creator_id = $1', [creatorId]);
      for (const ref of p.videos) {
        const vid = extractVideoId(ref);
        let title = null, publishedAt = null;
        try {
          const meta = await youtube.getVideoMeta(vid);
          if (meta) { title = meta.title; publishedAt = meta.publishedAt; }
        } catch (e) {
          console.warn(`  pinned ${p.creator}: could not fetch meta for ${vid} (${e.message})`);
        }
        await pool.query(
          `INSERT INTO creator_videos (creator_id, video_id, title, published_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (creator_id, video_id) DO UPDATE SET
             title = EXCLUDED.title, published_at = EXCLUDED.published_at`,
          [creatorId, vid, title, publishedAt]
        );
      }
      console.log(`Pinned: ${p.creator} → ${p.videos.length} video(s)${p.lock ? ' (locked)' : ''}.`);
    } else if (typeof p.lock === 'boolean') {
      console.log(`Pinned: ${p.creator} videos_locked=${p.lock}.`);
    }
  }
}

async function seedPlaylists() {
  let added = 0, updated = 0;
  for (let i = 0; i < PLAYLISTS.length; i++) {
    const p = PLAYLISTS[i];
    const pid = extractPlaylistId(p.url);
    let creatorId = null;
    if (p.creator) {
      const { rows: cr } = await pool.query('SELECT id FROM creators WHERE name = $1', [p.creator]);
      if (cr.length) creatorId = cr[0].id;
      else console.warn(`  playlist ${pid}: creator "${p.creator}" not found — leaving unlinked`);
    }
    const sortOrder = p.sort_order != null ? p.sort_order : i;
    const { rows } = await pool.query('SELECT id FROM playlists WHERE playlist_id = $1', [pid]);
    if (rows.length) {
      await pool.query(
        'UPDATE playlists SET creator_id=COALESCE($2,creator_id), note=COALESCE($3,note), sort_order=$4 WHERE id=$1',
        [rows[0].id, creatorId, p.note || null, sortOrder]
      );
      updated++;
    } else {
      await pool.query(
        'INSERT INTO playlists (playlist_id, creator_id, note, sort_order) VALUES ($1,$2,$3,$4)',
        [pid, creatorId, p.note || null, sortOrder]
      );
      added++;
    }
  }
  console.log(`Playlists: ${added} added, ${updated} updated. (run refresh_creators.js to fill titles/thumbnails)`);
}

(async () => {
  if (CREATORS.length === 0 && RESOURCES.length === 0 && FEATURED.length === 0 &&
      PINNED.length === 0 && PLAYLISTS.length === 0) {
    console.log('Nothing to seed — edit the CREATORS / RESOURCES / FEATURED / PINNED / PLAYLISTS arrays in seed_creators.js first.');
    await pool.end();
    return;
  }
  await seedCreators();
  await seedResources();
  await seedFeatured();
  await seedPinned();
  await seedPlaylists();
  await pool.end();
})().catch(err => {
  console.error('Fatal:', err.message);
  pool.end();
  process.exit(1);
});
