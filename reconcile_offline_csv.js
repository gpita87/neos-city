/**
 * reconcile_offline_csv.js  (READ-ONLY)
 *
 * Cross-references the "[OFFLINE] Pokken Tournament DX Major & Regional
 * Tournament Archives" CSV (2017–2020 majors/regionals) against the Neos City
 * DB's offline tournaments.
 *
 * For each CSV row it reports one of three buckets:
 *   (a) IN DB, FULL BRACKET   — has match rows in `matches`
 *   (b) IN DB, WINNER/RU ONLY — offline row exists, no match rows
 *   (c) NOT IN DB             — no matching offline row
 *
 * It also runs the REAL detectOfflineTier() so you can see what tier each event
 * would land in, and which start.gg(SmashGG)-bracketed rows are import candidates.
 *
 * READ-ONLY. No writes. Run from the neos-city directory with backend/.env present:
 *   node reconcile_offline_csv.js
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });
const { detectOfflineTier } = require('./backend/src/services/achievements');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// CSV rows. `slug` = the liquipedia_slug from offline_import.js this row most
// likely maps to (null if I judged it absent from the hardcoded 74-event list).
// `bracket` is the CSV's BRACKET column (SmashGG = start.gg).
const CSV = [
  { name: 'SoCal Regionals 2017',                 date: '2017-09-24', region: 'NA', bracket: 'SmashGG',  slug: 'scr_2017' },
  { name: 'GameTyrant Expo 2017',                 date: '2017-09-30', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'Revolution 2017',                      date: '2017-10-06', region: 'UK', bracket: 'SmashGG',  slug: null },
  { name: 'Dreamhack Denver 2017',                date: '2017-10-20', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'Final Boss',                           date: '2017-10-29', region: 'NA', bracket: 'SmashGG',  slug: 'final_boss_2017' },
  { name: 'Burst Attack @ Thalia Beach',          date: '2017-11-04', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'NEC 18',                               date: '2017-12-15', region: 'NA', bracket: 'SmashGG',  slug: 'nec_18' },
  { name: 'Pokemon Australia Qualifier',          date: '2018-01-01', region: 'AUS',bracket: 'Challonge', slug: null },
  { name: 'Frost Fausting X',                     date: '2018-01-21', region: 'NA', bracket: 'SmashGG',  slug: 'frosty_faustings_10' },
  { name: 'Gensis 5',                             date: '2018-01-20', region: 'NA', bracket: 'SmashGG',  slug: 'genesis_5' },
  { name: 'Calyptus Cup',                         date: '2018-01-20', region: 'DE', bracket: 'SmashGG',  slug: null },
  { name: 'Winter Brawl 2018',                    date: '2018-02-25', region: 'NA', bracket: 'SmashGG',  slug: 'winter_brawl_2018' },
  { name: 'Final Round 2018',                     date: '2018-03-16', region: 'NA', bracket: 'SmashGG',  slug: 'final_round_2018' },
  { name: 'NorCal Regionals 2018',               date: '2018-04-01', region: 'NA', bracket: 'SmashGG',  slug: 'ncr_2018' },
  { name: 'Respawn 6',                            date: '2018-04-01', region: 'DE', bracket: 'SmashGG',  slug: null },
  { name: 'Burnside Brawl',                       date: '2018-04-21', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'Switchfest 2018',                      date: '2018-04-21', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'BAM 10',                               date: '2018-05-18', region: 'AUS',bracket: 'SmashGG',  slug: null },
  { name: 'Battle of Castelia',                   date: '2018-05-19', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'Combo Breaker 2018',                   date: '2018-05-26', region: 'NA', bracket: 'Challonge', slug: null },
  { name: 'Dreamhack Austin 2018',                date: '2018-06-02', region: 'NA', bracket: 'SmashGG',  slug: 'dreamhack_austin_2018' },
  { name: 'Pokken Sheffield Qualifer',            date: '2018-06-17', region: 'UK', bracket: 'Challonge', slug: null },
  { name: 'Pokemon Internationals (NAIC 2018)',   date: '2018-07-07', region: 'NA', bracket: 'Challonge', slug: null },
  { name: 'Defend the North 2018',                date: '2018-07-22', region: 'NA', bracket: 'SmashGG',  slug: 'defend_the_north_2018' },
  { name: 'EVO 2018',                             date: '2018-08-03', region: 'NA', bracket: 'SmashGG',  slug: 'evo_2018' },
  { name: 'Pokemon Last Chance Qualifer',         date: '2018-08-24', region: 'NA', bracket: 'Challonge', slug: null },
  { name: 'Pokemon Worlds 2018',                  date: '2018-08-26', region: 'NA', bracket: 'Challonge', slug: 'worlds_2018' },
  { name: 'Summer Jam (12)',                      date: '2018-09-02', region: 'NA', bracket: 'SmashGG',  slug: 'summer_jam_12' },
  { name: 'Calyptus Cup Climax',                  date: '2018-09-15', region: 'DE', bracket: 'SmashGG',  slug: null },
  { name: 'SoCal Regionals 2018',                 date: '2018-09-16', region: 'NA', bracket: 'SmashGG',  slug: 'scr_2018' },
  { name: 'Revolution 2018',                      date: '2018-09-30', region: 'UK', bracket: 'SmashGG',  slug: 'revolution_2018' },
  { name: 'Eye of the Storm (2018)',              date: '2018-10-14', region: 'NA', bracket: 'SmashGG',  slug: 'eye_of_the_storm_2018' },
  { name: 'Canada Cup 2018',                      date: '2018-10-28', region: 'NA', bracket: 'Deleted',  slug: 'canada_cup_2018' },
  { name: 'Destiny: Pokken Tournament',           date: '2018-11-11', region: 'NA', bracket: 'SmashGG',  slug: 'destiny_2018' },
  { name: 'NEC 19',                               date: '2018-12-16', region: 'NA', bracket: 'SmashGG',  slug: 'nec_19' },
  { name: 'Frosty Fausting XI',                   date: '2019-01-19', region: 'NA', bracket: 'SmashGG',  slug: 'frosty_faustings_11' },
  { name: 'Frostfire 2019',                       date: '2019-01-26', region: 'NA', bracket: 'SmashGG',  slug: 'frostfire_2019' },
  { name: 'Nietplay Tournament',                  date: '2019-02-09', region: 'UK', bracket: 'SmashGG',  slug: null },
  { name: 'Heart of Battle',                      date: '2019-02-09', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'Pokemon OCE Qualifier (OIC 2019)',     date: '2019-02-17', region: 'AUS',bracket: 'Challonge', slug: 'oic_2019' },
  { name: 'Winter Brawl 3D Edition (2019)',       date: '2019-02-24', region: 'NA', bracket: 'SmashGG',  slug: 'winter_brawl_2019' },
  { name: 'Thermodynamic Throwdown',              date: '2019-03-09', region: 'DE', bracket: 'SmashGG',  slug: null },
  { name: 'NorCal Regionals 2019',               date: '2019-03-29', region: 'NA', bracket: 'SmashGG',  slug: 'ncr_2019' },
  { name: 'Michigan Masters 2019',                date: '2019-04-12', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'April Anniliation',                    date: '2019-04-12', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'Europe International Championship (EIC 2019)', date: '2019-04-28', region: 'EU', bracket: 'Challonge', slug: 'eic_2019' },
  { name: 'Combo Breaker 2019',                   date: '2019-05-24', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: "Smash'N'Splash",                       date: '2019-06-01', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'Time to Guess',                        date: '2019-06-08', region: 'DE', bracket: 'SmashGG',  slug: null },
  { name: 'North American Internationals (NAIC 2019)', date: '2019-06-23', region: 'NA', bracket: 'Challonge', slug: 'naic_2019' },
  { name: 'Neitplay 2 Tournament',                date: '2019-07-06', region: 'UK', bracket: 'SmashGG',  slug: null },
  { name: 'Toryuken 2019 (Toryuken 8)',           date: '2019-07-14', region: 'NA', bracket: 'SmashGG',  slug: 'toryuken_8' },
  { name: 'Defend the North 2019',                date: '2019-07-21', region: 'NA', bracket: 'SmashGG',  slug: 'defend_the_north_2019' },
  { name: 'Pokken EVO (EVO 2019)',                date: '2019-08-03', region: 'NA', bracket: 'SmashGG',  slug: 'evo_2019' },
  { name: 'Pokemon Worlds 2019',                  date: '2019-08-18', region: 'NA', bracket: 'Challonge', slug: 'worlds_2019' },
  { name: 'Switchfest 2019',                      date: '2019-09-01', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'Revolution 2019',                      date: '2019-10-13', region: 'UK', bracket: 'SmashGG',  slug: 'revolution_2019' },
  { name: 'Eye of the Storm 2 (2019)',            date: '2019-10-13', region: 'NA', bracket: 'SmashGG',  slug: null },
  { name: 'NEC 20',                               date: '2019-12-01', region: 'NA', bracket: 'SmashGG',  slug: 'nec_20' },
  { name: 'Frosty Faustings XII',                 date: '2020-01-18', region: 'NA', bracket: 'SmashGG',  slug: 'frosty_faustings_12' },
  { name: 'Frostfire 2020',                       date: '2020-02-02', region: 'NA', bracket: 'SmashGG',  slug: 'frostfire_2020' },
  { name: 'Dreamhack Anaheim 2020',               date: '2020-02-23', region: 'NA', bracket: 'SmashGG',  slug: 'dreamhack_anaheim_2020' },
  { name: 'Winter Brawl 3D 2020',                 date: '2020-02-23', region: 'NA', bracket: 'SmashGG',  slug: null },
];

async function findRow(csv) {
  // 1) try liquipedia_slug match (most reliable)
  if (csv.slug) {
    const { rows } = await pool.query(
      `SELECT id, name, is_offline, series, liquipedia_slug, liquipedia_url
       FROM tournaments WHERE liquipedia_slug = $1 LIMIT 1`, [csv.slug]);
    if (rows.length) return rows[0];
  }
  // 2) fall back to a loose name match against offline rows
  const probe = csv.name.replace(/\s*\(.*\)\s*/g, '').trim();
  const { rows } = await pool.query(
    `SELECT id, name, is_offline, series, liquipedia_slug, liquipedia_url
     FROM tournaments
     WHERE is_offline = TRUE AND LOWER(name) LIKE '%' || LOWER($1) || '%'
     ORDER BY id LIMIT 1`, [probe.slice(0, 18)]);
  return rows[0] || null;
}

async function matchCount(tournamentId) {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM matches WHERE tournament_id = $1`, [tournamentId]);
  return r.c;
}

async function main() {
  console.log('\nCSV ROW | BRACKET | DB STATUS | TIER (detectOfflineTier) | NOTE');
  console.log('─'.repeat(110));

  const buckets = { a: 0, b: 0, c: 0 };
  const candidates = []; // start.gg-bracketed, bucket b or c

  for (const csv of CSV) {
    const row = await findRow(csv);
    const tier = detectOfflineTier(csv.name.replace(/\s*\(.*\)\s*/g, '').trim());
    let status, bucket;

    if (!row) {
      status = 'NOT IN DB';
      bucket = 'c';
    } else {
      const mc = await matchCount(row.id);
      if (mc > 0) { status = `IN DB · FULL BRACKET (${mc} matches)`; bucket = 'a'; }
      else        { status = 'IN DB · winner/RU only';              bucket = 'b'; }
    }
    buckets[bucket]++;

    const isStartgg = /smashgg/i.test(csv.bracket);
    if (isStartgg && (bucket === 'b' || bucket === 'c')) {
      candidates.push({ ...csv, bucket, tier });
    }

    const flag = isStartgg && (bucket === 'b' || bucket === 'c') ? ' ⭐ start.gg import candidate' : '';
    console.log(`${csv.name.padEnd(42)} | ${csv.bracket.padEnd(9)} | [${bucket}] ${status.padEnd(34)} | ${tier.padEnd(8)} |${flag}`);
  }

  console.log('─'.repeat(110));
  console.log(`Buckets:  (a) full bracket = ${buckets.a}   (b) winner/RU only = ${buckets.b}   (c) not in DB = ${buckets.c}`);
  console.log(`\nstart.gg(SmashGG) import candidates (bucket b or c): ${candidates.length}`);
  for (const c of candidates) {
    console.log(`   [${c.bucket}] ${c.tier.padEnd(8)} ${c.date}  ${c.name}`);
  }
  console.log('');
  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
