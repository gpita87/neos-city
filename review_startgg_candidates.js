#!/usr/bin/env node
// ===========================================================================
// NEOS CITY — start.gg offline-candidate REVIEW (READ-ONLY, network)
//
//   node review_startgg_candidates.js
//
// For each offline-CSV start.gg candidate (bucket b/c), resolves the Pokkén
// singles bracket (by known slug or by name search), then prints:
//   tier guess · entrants · bracket URL · TOP 3 final placements
// so categorization (major/regional/other) can be eyeballed.
//
// NO DB writes. Hits only start.gg (needs STARTGG_TOKEN in backend/.env).
// Run on MAIN — worktrees forbid network calls.
// ===========================================================================

const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
const { detectOfflineTier } = require('./backend/src/services/achievements');

const API_URL = 'https://api.start.gg/gql/alpha';
const POKKEN = 447;
const SLEEP_MS = 800;

async function gql(query, variables = {}) {
  const token = process.env.STARTGG_TOKEN;
  if (!token) throw new Error('STARTGG_TOKEN not set in backend/.env');
  const res = await axios.post(API_URL, { query, variables }, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  if (res.data.errors?.length) throw new Error(res.data.errors[0].message);
  return res.data.data;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Full tournament enumeration (events + videogame + phases + phaseGroups).
async function getTournamentFull(slug) {
  const d = await gql(
    `query($slug:String!){ tournament(slug:$slug){ id name slug startAt
       events{ id name slug numEntrants videogame{ id }
         phases{ id name phaseGroups(query:{perPage:8}){ nodes{ id displayIdentifier } } } } } }`,
    { slug });
  return d.tournament;
}

// Name search, biased to tournaments that actually have a Pokkén event (vg 447).
async function searchByName(name) {
  const d = await gql(
    `query($n:String!){ tournaments(query:{perPage:15, filter:{name:$n, videogameIds:[447]}}){
       nodes{ id name slug startAt } } }`,
    { n: name });
  return d.tournaments?.nodes || [];
}

// Event-level final standings (top placements across the whole event).
async function eventStandings(eventSlug, perPage = 8) {
  const d = await gql(
    `query($slug:String!,$pp:Int!){ event(slug:$slug){ id
       standings(query:{perPage:$pp,page:1}){ nodes{ placement entrant{ name } } } } }`,
    { slug: eventSlug, pp: perPage });
  return d.event?.standings?.nodes || [];
}

function pickPokkenSingles(events) {
  const pk = (events || []).filter(e => Number(e.videogame?.id) === POKKEN);
  const singles = pk.filter(e => !/3v3|2v2|teams|doubles|side|crew|amateur|rookie/i.test(e.name));
  const pool = singles.length ? singles : pk;
  pool.sort((a, b) => (b.numEntrants || 0) - (a.numEntrants || 0));
  return pool[0] || null;
}

function bracketUrl(ev) {
  const phases = ev.phases || [];
  if (!phases.length) return null;
  const last = phases[phases.length - 1];
  const g = last.phaseGroups?.nodes?.[0];
  if (!g) return null;
  const urlSlug = String(ev.slug || '').replace('/event/', '/events/');
  return `https://www.start.gg/${urlSlug}/brackets/${last.id}/${g.id}`;
}
function yr(ts) { return ts ? new Date(ts * 1000).getUTCFullYear() : null; }
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A search hit only counts if its name is a substring relation of the search
// term — rejects "Final Boss"→"Mini Boss", "Revolution"→unrelated, etc.
function nameMatches(searchTerm, hitName) {
  const a = norm(searchTerm), b = norm(hitName);
  return a.length >= 4 && (b.includes(a) || a.includes(b));
}

// Candidates: slug (preferred) or {search,year} to resolve by name.
const CANDIDATES = [
  { label: 'Final Boss 2017',            bucket: 'b', slugs: ['final-boss', 'final-boss-2017', 'final-boss-1'], search: 'Final Boss', year: 2017 },
  { label: 'NEC 18 (Northeast Champ 18)',bucket: 'b', slugs: ['nec-18', 'northeast-championships-18'], search: 'Northeast Championship', year: 2017 },
  { label: 'Genesis 5',                  bucket: 'b', slug: 'genesis-5' },
  { label: 'Summer Jam 12',              bucket: 'b', slugs: ['summer-jam-12'], search: 'Summer Jam', year: 2018 },
  { label: 'Eye of the Storm 2018',      bucket: 'b', slug: 'eye-of-the-storm' },
  { label: 'Destiny 2018',               bucket: 'b', slug: 'destiny-pokken-tournament-major' },
  { label: 'Winter Brawl 3D 2019',       bucket: 'b', slugs: ['winter-brawl-3d-2019'], search: 'Winter Brawl 3D', year: 2019 },
  { label: 'EVO 2019 (Pokken EVO)',      bucket: 'b', slugs: ['evo-2019', 'pokken-dx-at-evo-2019', 'pokken-at-evo-2019'], search: 'Evo 2019', year: 2019 },
  { label: 'GameTyrant Expo 2017',       bucket: 'c', slug: 'gametyrant-expo-2017' },
  { label: 'Revolution 2017',            bucket: 'c', slugs: ['revolution-2017'], search: 'Revolution', year: 2017 },
  { label: 'DreamHack Denver 2017',      bucket: 'c', slugs: ['dreamhack-denver-2017', 'dreamhack-denver'], search: 'DreamHack Denver', year: 2017 },
  { label: 'Burst Attack @ Thalia Beach',bucket: 'c', slugs: ['burst-attack', 'burst-attack-thalia-beach'], search: 'Burst Attack', year: 2017 },
  // NOTE: bare "Calyptus Cup" search collides with "Calyptus Cup Climax" (a
  // separate Sept-2018 event), so no name-search fallback — slug guesses only.
  { label: 'Calyptus Cup (Jan 2018)',    bucket: 'c', slugs: ['calyptus-cup', 'calyptus-cup-2018', 'calyptus-cup-1'] },
  { label: 'Respawn 6',                  bucket: 'c', slug: 'respawn-6' },
  { label: 'Burnside Brawl',             bucket: 'c', slug: 'burnside-brawl' },
  { label: 'Switchfest 2018',            bucket: 'c', slugs: ['switchfest-1'], search: 'Switchfest', year: 2018 },
  { label: 'BAM 10',                     bucket: 'c', slug: 'battle-arena-melbourne-10' },
  { label: 'Battle of Castelia',         bucket: 'c', slugs: ['battle-of-castelia'], search: 'Battle of Castelia', year: 2018 },
  { label: 'Calyptus Cup Climax',        bucket: 'c', slug: 'calyptus-cup-climax' },
  { label: 'Nietplay Tournament',        bucket: 'c', slug: 'nietplay-tournament' },
  { label: 'Heart of Battle',            bucket: 'c', slug: 'heart-of-battle' },
  { label: 'Thermodynamic Throwdown',    bucket: 'c', slug: 'thermodynamic-throwdown-a-dedicated-pokken-major-by-team-calyptus' },
  { label: 'Michigan Masters 2019',      bucket: 'c', slugs: ['michigan-masters-2019'], search: 'Michigan Masters', year: 2019 },
  { label: 'April Annihilation',         bucket: 'c', slugs: ['april-annihilation', 'april-anni-lation'], search: 'Annihilation', year: 2019 },
  { label: 'Combo Breaker 2019',         bucket: 'c', slug: 'pokken-tournament-dx-combo-breaker-2019' },
  { label: "Smash'N'Splash 5",           bucket: 'c', slug: 'smash-n-splash-5' },
  { label: 'Time to Guess',              bucket: 'c', slug: 'time-to-guess' },
  { label: 'Neitplay 2',                 bucket: 'c', slug: 'nietplay-2-summer-edition' },
  { label: 'Switchfest 2019 (2GG)',      bucket: 'c', slug: '2gg-switchfest-2019' },
  { label: 'Eye of the Storm 2 (2019)',  bucket: 'c', slug: 'eye-of-the-storm-2' },
  { label: 'Winter Brawl 3D 2020',       bucket: 'c', slugs: ['winter-brawl-3d-2020'], search: 'Winter Brawl', year: 2020 },
];

async function resolveSlug(c) {
  const slugs = c.slugs || (c.slug ? [c.slug] : []);
  for (const s of slugs) {
    const t = await getTournamentFull(s);
    if (t && pickPokkenSingles(t.events)) return t;
    await sleep(SLEEP_MS);
  }
  if (c.search) {
    const hits = await searchByName(c.search);
    // STRICT: exact year AND a name-substring relation, so the fallback can't
    // grab an unrelated event (wrong year or merely-similar name).
    const ok = hits.filter(h =>
      (!c.year || yr(h.startAt) === c.year) && nameMatches(c.search, h.name));
    for (const h of ok) {
      const full = await getTournamentFull(h.slug);
      await sleep(SLEEP_MS);
      if (full && pickPokkenSingles(full.events)) return full;
    }
  }
  return null;
}

(async () => {
  if (!process.env.STARTGG_TOKEN) { console.error('STARTGG_TOKEN not set'); process.exit(1); }
  const unresolved = [];

  for (const c of CANDIDATES) {
    console.log('\n' + '─'.repeat(92));
    let t;
    try { t = await resolveSlug(c); } catch (e) { console.log(`${c.label}  → ERROR: ${e.message}`); unresolved.push(c.label); await sleep(SLEEP_MS); continue; }
    if (!t) { console.log(`[${c.bucket}] ${c.label}  → ⛔ NOT RESOLVED (no slug / no Pokkén event)`); unresolved.push(c.label); await sleep(SLEEP_MS); continue; }

    const ev = pickPokkenSingles(t.events);
    if (!ev) { console.log(`[${c.bucket}] ${c.label}  → ⛔ tournament found (${t.slug}) but no Pokkén event`); unresolved.push(c.label); await sleep(SLEEP_MS); continue; }

    const tier = detectOfflineTier(t.name);
    const url = bracketUrl(ev);
    console.log(`[${c.bucket}] ${c.label}`);
    console.log(`     start.gg: ${t.name}  (${t.startAt ? new Date(t.startAt * 1000).toISOString().slice(0, 10) : '?'})`);
    console.log(`     tier→ ${tier.toUpperCase()}   event "${ev.name}"   entrants: ${ev.numEntrants ?? '?'}   slug: ${t.slug}`);
    console.log(`     URL:  ${url || '(no phase group)'}`);

    let standings = [];
    try { standings = await eventStandings(ev.slug, 8); } catch (e) { /* ignore */ }
    if (standings.length) {
      const top = standings.filter(s => s.placement && s.placement <= 3).sort((a, b) => a.placement - b.placement);
      const line = top.map(s => `${s.placement}) ${s.entrant?.name || '?'}`).join('   ');
      console.log(`     TOP 3: ${line || '(no top-3 placements)'}`);
    } else {
      console.log('     TOP 3: (no event standings on start.gg — bracket may use phase-group standings only)');
    }
    await sleep(SLEEP_MS);
  }

  console.log('\n' + '═'.repeat(92));
  if (unresolved.length) {
    console.log(`Unresolved (${unresolved.length}): ${unresolved.join(', ')}`);
  } else {
    console.log('All candidates resolved.');
  }
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
