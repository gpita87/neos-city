/**
 * fix_missing_dates.js
 *
 * Investigates tournaments with no date and attempts to resolve them.
 * Strategy:
 *   1. Major offline events → hardcoded known dates from Liquipedia
 *   2. Numbered series events (TCC, RTG EU, FFC) → infer from neighbors
 *   3. Challonge-sourced events → re-fetch from Challonge v1 API
 *
 * Usage: node fix_missing_dates.js [--dry-run]
 *   --dry-run: only show what would be updated, don't write to DB
 */

require('dotenv').config({ path: './backend/.env' });
const { Pool } = require('pg');
const https = require('https');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const V1_KEY = process.env.CHALLONGE_V1_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Known offline event dates (from Liquipedia research) ────────────────────
const KNOWN_DATES = {
  'CEO 2017: Pokken Bracket': '2017-06-16',
  'CEO 2023 Side Tournaments': '2023-06-23',
  'CEO 2024 Side Tournaments': '2024-06-28',
  'CEO 2025 Side Tournaments': '2025-06-13',
  'Frostfire 2020 Bracket': '2020-02-01',
  'Frosty Faustings XIV Side Tournaments': '2022-01-28',
  'Frosty Faustings XV Side Tournaments': '2023-02-03',
  'Battle Arena Melbourne 12: PokkenDX Brac': '2022-05-13',
  'Battle Arena Melbourne 13: PokkenDX Brac': '2023-06-09',
  'DreamHack Summer 2016: Pokken Bracket': '2016-06-18',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function challongeV1Get(path) {
  return new Promise((resolve, reject) => {
    const url = `https://api.challonge.com/v1${path}${path.includes('?') ? '&' : '?'}api_key=${V1_KEY}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN — no DB writes ===' : '=== LIVE RUN — will update DB ===');
  console.log();

  // Get all no-date tournaments
  const { rows: noDate } = await pool.query(`
    SELECT id, name, challonge_id, source, is_offline,
           (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id) AS match_count
    FROM tournaments t
    WHERE started_at IS NULL AND completed_at IS NULL
    ORDER BY name
  `);

  console.log(`Found ${noDate.length} tournaments with no date.\n`);

  const fixes = [];       // { id, name, date, method }
  const unfixable = [];   // { id, name, reason }

  // ─── Pass 1: Known offline dates ────────────────────────────────────────
  for (const t of noDate) {
    // Check if name matches a known date (partial match for truncated names)
    for (const [knownName, date] of Object.entries(KNOWN_DATES)) {
      if (t.name.startsWith(knownName.slice(0, 30)) || knownName.startsWith(t.name.slice(0, 30))) {
        fixes.push({ id: t.id, name: t.name, date, method: 'known_offline' });
        break;
      }
    }
  }
  const fixedIds = new Set(fixes.map(f => f.id));

  // ─── Pass 2: Numbered series — infer from neighbors ─────────────────────
  // Extract number from names like "The Croissant Cup #25" or "RTG EU 72"
  const seriesPatterns = [
    { regex: /The Croissant Cup #(\d+)/, series: 'tcc' },
    { regex: /RTG EU #?(\d+)/, series: 'rtg_eu' },
    { regex: /RTG Asia #?(\d+)/, series: 'rtg_asia' },
    { regex: /Ferrum Fist Challenge/i, series: 'ffc' },
    { regex: /End Of the Road EU #(\d+)/, series: 'eotr' },
  ];

  // Get ALL tournaments for these series (with dates) to build timeline
  const { rows: allSeries } = await pool.query(`
    SELECT id, name, started_at, completed_at FROM tournaments
    WHERE (name ILIKE '%Croissant Cup%' OR name ILIKE '%RTG EU%' OR name ILIKE '%Ferrum Fist%'
           OR name ILIKE '%End of the Road%' OR name ILIKE '%RTG Asia%')
    ORDER BY COALESCE(completed_at, started_at) ASC NULLS LAST
  `);

  function extractNumber(name) {
    const m = name.match(/#(\d+)/);
    if (m) return parseInt(m[1]);
    const m2 = name.match(/\b(\d{1,3})\s*$/);
    if (m2) return parseInt(m2[1]);
    return null;
  }

  // Build a map of number→date for each series
  const seriesTimelines = {};
  for (const t of allSeries) {
    const num = extractNumber(t.name);
    const date = t.completed_at || t.started_at;
    if (num && date) {
      // Detect which series
      let seriesKey = 'unknown';
      if (/Croissant Cup/i.test(t.name)) seriesKey = 'tcc';
      else if (/RTG EU/i.test(t.name)) seriesKey = 'rtg_eu';
      else if (/Ferrum Fist/i.test(t.name)) seriesKey = 'ffc';
      else if (/End.?of.?the.?Road/i.test(t.name)) seriesKey = 'eotr';
      else if (/RTG Asia/i.test(t.name)) seriesKey = 'rtg_asia';

      if (!seriesTimelines[seriesKey]) seriesTimelines[seriesKey] = [];
      seriesTimelines[seriesKey].push({ num, date: new Date(date), name: t.name });
    }
  }

  // Sort each series by number
  for (const key of Object.keys(seriesTimelines)) {
    seriesTimelines[key].sort((a, b) => a.num - b.num);
  }

  // For no-date numbered events, interpolate
  for (const t of noDate) {
    if (fixedIds.has(t.id)) continue;
    const num = extractNumber(t.name);
    if (!num) continue;

    let seriesKey = null;
    if (/Croissant Cup/i.test(t.name)) seriesKey = 'tcc';
    else if (/RTG EU/i.test(t.name)) seriesKey = 'rtg_eu';
    else if (/Ferrum Fist/i.test(t.name)) seriesKey = 'ffc';
    else if (/End.?of.?the.?Road/i.test(t.name)) seriesKey = 'eotr';
    else if (/RTG Asia/i.test(t.name)) seriesKey = 'rtg_asia';

    if (!seriesKey || !seriesTimelines[seriesKey] || seriesTimelines[seriesKey].length < 2) continue;

    const timeline = seriesTimelines[seriesKey];

    // Find closest neighbors
    let before = null, after = null;
    for (const entry of timeline) {
      if (entry.num < num) before = entry;
      if (entry.num > num && !after) after = entry;
    }

    if (before && after) {
      // Interpolate linearly
      const fraction = (num - before.num) / (after.num - before.num);
      const interpolatedMs = before.date.getTime() + fraction * (after.date.getTime() - before.date.getTime());
      const interpolated = new Date(interpolatedMs);
      fixes.push({
        id: t.id, name: t.name,
        date: interpolated.toISOString().slice(0, 10),
        method: `interpolated (between #${before.num} and #${after.num})`
      });
      fixedIds.add(t.id);
    } else if (before) {
      // Extrapolate from last two known events
      const sorted = timeline.filter(e => e.num <= before.num);
      if (sorted.length >= 2) {
        const prev2 = sorted[sorted.length - 2];
        const prev1 = sorted[sorted.length - 1];
        const gapMs = (prev1.date.getTime() - prev2.date.getTime()) / (prev1.num - prev2.num);
        const extrapolated = new Date(prev1.date.getTime() + gapMs * (num - prev1.num));
        fixes.push({
          id: t.id, name: t.name,
          date: extrapolated.toISOString().slice(0, 10),
          method: `extrapolated forward from #${prev1.num}`
        });
        fixedIds.add(t.id);
      }
    } else if (after) {
      const sorted = timeline.filter(e => e.num >= after.num);
      if (sorted.length >= 2) {
        const next1 = sorted[0];
        const next2 = sorted[1];
        const gapMs = (next2.date.getTime() - next1.date.getTime()) / (next2.num - next1.num);
        const extrapolated = new Date(next1.date.getTime() - gapMs * (next1.num - num));
        fixes.push({
          id: t.id, name: t.name,
          date: extrapolated.toISOString().slice(0, 10),
          method: `extrapolated backward from #${next1.num}`
        });
        fixedIds.add(t.id);
      }
    }
  }

  // ─── Pass 3: Re-fetch from Challonge API ────────────────────────────────
  const challongeToFetch = noDate.filter(t => !fixedIds.has(t.id) && t.challonge_id && t.source !== 'offline');

  if (challongeToFetch.length > 0) {
    console.log(`\nAttempting to re-fetch dates from Challonge API for ${challongeToFetch.length} tournaments...`);
    for (const t of challongeToFetch) {
      try {
        await sleep(500); // Rate limit
        const resp = await challongeV1Get(`/tournaments/${t.challonge_id}.json`);
        const td = resp.tournament;
        const date = td.started_at || td.completed_at || td.created_at;
        if (date) {
          const d = new Date(date);
          fixes.push({
            id: t.id, name: t.name,
            date: d.toISOString().slice(0, 10),
            method: `challonge_api (${td.started_at ? 'started_at' : td.completed_at ? 'completed_at' : 'created_at'})`
          });
          fixedIds.add(t.id);
          process.stdout.write('✓');
        } else {
          process.stdout.write('·');
        }
      } catch (err) {
        process.stdout.write('✗');
      }
    }
    console.log();
  }

  // ─── Remaining unfixable ────────────────────────────────────────────────
  for (const t of noDate) {
    if (!fixedIds.has(t.id)) {
      unfixable.push({ id: t.id, name: t.name, matchCount: t.match_count, source: t.source, challonge_id: t.challonge_id });
    }
  }

  // ─── Report ─────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  console.log('FIXABLE TOURNAMENTS');
  console.log('='.repeat(80));
  for (const f of fixes) {
    console.log(`  ${f.date}  ${f.name}`);
    console.log(`           Method: ${f.method}`);
  }
  console.log(`\nTotal fixable: ${fixes.length}`);

  if (unfixable.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('UNFIXABLE (need manual investigation)');
    console.log('='.repeat(80));
    for (const u of unfixable) {
      console.log(`  ${u.name}  (${u.matchCount} matches, source: ${u.source}, slug: ${u.challonge_id || 'none'})`);
    }
    console.log(`\nTotal unfixable: ${unfixable.length}`);
  }

  // ─── Apply fixes ────────────────────────────────────────────────────────
  if (!DRY_RUN && fixes.length > 0) {
    console.log('\n\nApplying fixes...');
    let updated = 0;
    for (const f of fixes) {
      const dateISO = new Date(f.date + 'T12:00:00Z').toISOString();
      await pool.query(
        `UPDATE tournaments SET started_at = $1, completed_at = $1 WHERE id = $2 AND started_at IS NULL AND completed_at IS NULL`,
        [dateISO, f.id]
      );
      updated++;
    }
    console.log(`Updated ${updated} tournaments.`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
