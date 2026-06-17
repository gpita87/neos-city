#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — start.gg event/bracket enumerator (READ-ONLY, network)
//
//   node enumerate_startgg.js
//
// Walks a hardcoded list of tournament slugs, queries the start.gg GraphQL API
// for each one's events + phases + phase groups, flags which events are Pokkén
// (videogame id 447), and prints one ready-to-import bracket URL per phase
// group:
//
//   https://www.start.gg/<eventSlugUrlForm>/brackets/<phaseId>/<phaseGroupId>
//
// NO DB writes. Hits only the start.gg API (needs STARTGG_TOKEN in
// backend/.env). Must run on MAIN — worktrees forbid network calls.
// ===========================================================================

const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

const API_URL = 'https://api.start.gg/gql/alpha';
const POKKEN_VIDEOGAME_ID = 447;

// Best-guess slugs for the offline-CSV candidates the broad date-window search
// (search_startgg_offline.js) missed because it hit start.gg's 1200-result page
// cap (it only reached ~2018-07 onward). These are mostly 2017 / early-2018
// majors+regionals. Slugs are GUESSES based on start.gg's observed naming; the
// script prints "NOT FOUND" for any that miss — adjust and re-run those.
const TOURNAMENT_SLUGS = [
  // 2017
  'final-boss-2017',
  'dreamhack-denver-2017',
  'gametyrant-expo-2017',
  'revolution-2017',
  'northeast-championship-18',
  // early 2018
  'genesis-5',
  'calyptus-cup',
  'respawn-6',
  'burnside-brawl',
  'switchfest-2018',
  '2gg-switchfest-2018',
  'battle-arena-melbourne-10',
  'bam-10',
  'battle-of-castelia',
  'summer-jam-12',
  // 2019–2020 stragglers not in the search window
  'michigan-masters-2019',
  'april-annihilation',
  'winter-brawl-3d-2020',
];

async function gql(query, variables = {}) {
  const token = process.env.STARTGG_TOKEN;
  if (!token) throw new Error('STARTGG_TOKEN is not set in backend/.env');
  const res = await axios.post(
    API_URL,
    { query, variables },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  if (res.data.errors?.length) throw new Error(`start.gg GQL error: ${res.data.errors[0].message}`);
  return res.data.data;
}

// Fetch a tournament by slug with every event, each event's videogame + phases
// + phase groups. This is the read-only enumeration query.
async function getTournament(slug) {
  const data = await gql(
    `query Enumerate($slug: String!) {
      tournament(slug: $slug) {
        id
        name
        slug
        startAt
        endAt
        isOnline
        city
        countryCode
        venueAddress
        events {
          id
          name
          slug
          numEntrants
          startAt
          state
          isOnline
          videogame { id name }
          phases {
            id
            name
            phaseGroups(query: { perPage: 50 }) {
              nodes { id displayIdentifier }
            }
          }
        }
      }
    }`,
    { slug }
  );
  return data.tournament;
}

function fmtDate(ts) {
  if (!ts) return 'unknown';
  // ISO date only (UTC) — avoids Date.now/locale; ts is unix seconds.
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function eventSlugToUrl(eventSlug, phaseId, phaseGroupId) {
  // API event slug is "tournament/<t>/event/<e>"; bracket URLs use "events".
  const urlSlug = String(eventSlug || '').replace('/event/', '/events/');
  return `https://www.start.gg/${urlSlug}/brackets/${phaseId}/${phaseGroupId}`;
}

(async () => {
  for (const slug of TOURNAMENT_SLUGS) {
    console.log('\n' + '='.repeat(78));
    console.log(`TOURNAMENT SLUG: ${slug}`);
    let t;
    try {
      t = await getTournament(slug);
    } catch (err) {
      console.log(`  ERROR fetching: ${err.message}`);
      continue;
    }
    if (!t) {
      console.log('  NOT FOUND (null tournament)');
      continue;
    }
    const loc = [t.city, t.countryCode].filter(Boolean).join(', ') || '(no location set)';
    console.log(`  name:        ${t.name}`);
    console.log(`  startAt:     ${fmtDate(t.startAt)}  endAt: ${fmtDate(t.endAt)}`);
    console.log(`  isOnline:    ${t.isOnline}   location: ${loc}`);
    if (t.venueAddress) console.log(`  venue:       ${t.venueAddress}`);
    console.log(`  events:      ${(t.events || []).length}`);

    for (const ev of t.events || []) {
      const vg = ev.videogame ? `${ev.videogame.name} (id ${ev.videogame.id})` : 'unknown game';
      const isPokken = Number(ev.videogame?.id) === POKKEN_VIDEOGAME_ID;
      console.log(`\n  ── EVENT: ${ev.name}`);
      console.log(`     game:        ${vg}  ${isPokken ? '✅ POKKÉN' : '⏭️  skip (non-Pokkén)'}`);
      console.log(`     eventSlug:   ${ev.slug}`);
      console.log(`     numEntrants: ${ev.numEntrants}   startAt: ${fmtDate(ev.startAt)}   isOnline: ${ev.isOnline}`);
      if (!isPokken) continue;
      for (const ph of ev.phases || []) {
        const groups = ph.phaseGroups?.nodes || [];
        for (const g of groups) {
          const url = eventSlugToUrl(ev.slug, ph.id, g.id);
          console.log(`     PHASE "${ph.name}" (id ${ph.id})  group ${g.displayIdentifier} (pgid ${g.id})`);
          console.log(`        BRACKET URL: ${url}`);
        }
      }
    }
  }
  console.log('\n' + '='.repeat(78));
  console.log('Done. Copy the BRACKET URL lines for Pokkén events into the *_startgg_urls.txt files.');
})().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
