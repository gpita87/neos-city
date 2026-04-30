/**
 * fix_remaining_dates.js
 *
 * Fixes remaining no-date tournaments:
 *   1. TCC (Croissant Cup) — biweekly series, interpolate from any dated anchors
 *   2. Offline/Liquipedia bracket imports — hardcoded from Liquipedia research
 *
 * Usage: node fix_remaining_dates.js [--dry-run]
 */

require('dotenv').config({ path: './backend/.env' });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Known offline event dates (Liquipedia research) ─────────────────────────
const OFFLINE_FIXES = [
  { nameMatch: 'DreamHack Anaheim 2020', date: '2020-02-21' },
  { nameMatch: 'Evolution Championship Series 2016', date: '2016-07-15' },
  { nameMatch: 'Evolution Championship Series 2017', date: '2017-07-14' },
  { nameMatch: 'Evolution Championship Series 2018', date: '2018-08-03' },
  { nameMatch: 'FightClub Championship V', date: '2024-07-26' },
  { nameMatch: 'Final Round 19', date: '2016-03-18' },
  { nameMatch: 'Frostfire 2019', date: '2019-02-02' },  // Frostfire 2019 (community Pokken event)
  { nameMatch: 'Northeast Championship 21', date: '2021-11-05' },
  { nameMatch: 'OzHadou Nationals 17', date: '2023-11-24' },
  { nameMatch: 'SoCal Regionals 2017', date: '2017-09-22' },
  { nameMatch: 'SoCal Regionals 2018', date: '2018-09-14' },
  { nameMatch: 'Summer Jam 13', date: '2019-08-30' },
  { nameMatch: 'Summer Jam X', date: '2016-08-19' },
  { nameMatch: 'The Fall Classic 2017', date: '2017-09-29' },
  { nameMatch: 'Toryuken 8', date: '2019-07-13' },
  { nameMatch: 'Winter Brawl 11', date: '2017-02-17' },
];

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  // ─── Part 1: Fix TCC by looking at ALL TCC events and figuring out schedule ─

  // Get ALL Croissant Cup events
  const { rows: allTCC } = await pool.query(`
    SELECT id, name, COALESCE(completed_at, started_at) AS dt
    FROM tournaments
    WHERE name ILIKE '%Croissant Cup%'
    ORDER BY name
  `);

  // Extract numbers
  function extractNum(name) {
    const m = name.match(/#(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  const tccDated = [];
  const tccUndated = [];
  for (const t of allTCC) {
    const num = extractNum(t.name);
    if (num === null) continue;
    if (t.dt) {
      tccDated.push({ ...t, num });
    } else {
      tccUndated.push({ ...t, num });
    }
  }

  tccDated.sort((a, b) => a.num - b.num);
  tccUndated.sort((a, b) => a.num - b.num);

  console.log(`\nTCC: ${tccDated.length} dated, ${tccUndated.length} undated`);

  if (tccDated.length > 0) {
    console.log('Dated TCC anchors:');
    for (const t of tccDated) {
      console.log(`  #${t.num}  ${t.dt.toISOString().slice(0, 10)}  ${t.name}`);
    }
  }

  // TCC is biweekly (every 2 weeks). If we have ANY two dated events, we can
  // calculate the average interval per event number, then extrapolate everything.
  const tccFixes = [];

  if (tccDated.length >= 2) {
    // Use linear regression on all dated points for best accuracy
    const points = tccDated.map(t => ({ x: t.num, y: t.dt.getTime() }));
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX); // ms per event number
    const intercept = (sumY - slope * sumX) / n;

    const daysBetween = slope / (1000 * 60 * 60 * 24);
    console.log(`\nTCC regression: ~${daysBetween.toFixed(1)} days between events (${(daysBetween / 7).toFixed(1)} weeks)`);

    for (const t of tccUndated) {
      const estimatedMs = slope * t.num + intercept;
      const estimated = new Date(estimatedMs);
      const dateStr = estimated.toISOString().slice(0, 10);
      tccFixes.push({ id: t.id, name: t.name, date: dateStr, num: t.num });
      console.log(`  #${t.num} → ${dateStr}  ${t.name}`);
    }
  } else if (tccDated.length === 1) {
    // Only one anchor — assume biweekly (14 days between events)
    const anchor = tccDated[0];
    const interval = 14 * 24 * 60 * 60 * 1000; // 14 days in ms
    console.log('\nOnly 1 TCC anchor — assuming 14-day interval');

    for (const t of tccUndated) {
      const diff = t.num - anchor.num;
      const estimated = new Date(anchor.dt.getTime() + diff * interval);
      const dateStr = estimated.toISOString().slice(0, 10);
      tccFixes.push({ id: t.id, name: t.name, date: dateStr, num: t.num });
      console.log(`  #${t.num} → ${dateStr}  ${t.name}`);
    }
  } else {
    console.log('\nNo dated TCC events at all — cannot interpolate');
  }

  // ─── Part 2: Do the same for other undated numbered series ─────────────
  const otherSeries = [
    { namePattern: '%RTG EU%', label: 'RTG EU', intervalDays: 14 },
    { namePattern: '%RTG Asia%', label: 'RTG Asia', intervalDays: 14 },
    { namePattern: '%End of the Road%', label: 'EOTR', intervalDays: 14 },
    { namePattern: '%Ferrum Fist%', label: 'FFC', intervalDays: 14 },
    { namePattern: '%Thunderdome Pokken%', label: 'Thunderdome', intervalDays: 14 },
    { namePattern: '%DFW Pokken%', label: 'DFW Pokken', intervalDays: 30 },
    { namePattern: '%Pokkén France%', label: 'Pokken France', intervalDays: 30 },
    { namePattern: '%Pokken France%', label: 'Pokken France 2', intervalDays: 30 },
  ];

  const seriesFixes = [];

  for (const s of otherSeries) {
    const { rows } = await pool.query(`
      SELECT id, name, COALESCE(completed_at, started_at) AS dt
      FROM tournaments
      WHERE name ILIKE $1
      ORDER BY name
    `, [s.namePattern]);

    const dated = [];
    const undated = [];
    for (const t of rows) {
      const num = extractNum(t.name);
      if (num === null) continue;
      if (t.dt) dated.push({ ...t, num });
      else undated.push({ ...t, num });
    }

    if (undated.length === 0) continue;

    dated.sort((a, b) => a.num - b.num);
    undated.sort((a, b) => a.num - b.num);

    console.log(`\n${s.label}: ${dated.length} dated, ${undated.length} undated`);

    if (dated.length >= 2) {
      const points = dated.map(t => ({ x: t.num, y: t.dt.getTime() }));
      const n = points.length;
      const sumX = points.reduce((acc, p) => acc + p.x, 0);
      const sumY = points.reduce((acc, p) => acc + p.y, 0);
      const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0);
      const sumX2 = points.reduce((acc, p) => acc + p.x * p.x, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      const daysBetween = slope / (1000 * 60 * 60 * 24);
      console.log(`  Regression: ~${daysBetween.toFixed(1)} days between events`);

      for (const t of undated) {
        const estimatedMs = slope * t.num + intercept;
        const estimated = new Date(estimatedMs);
        const dateStr = estimated.toISOString().slice(0, 10);
        seriesFixes.push({ id: t.id, name: t.name, date: dateStr });
        console.log(`  #${t.num} → ${dateStr}  ${t.name}`);
      }
    } else if (dated.length === 1) {
      const anchor = dated[0];
      const interval = s.intervalDays * 24 * 60 * 60 * 1000;
      console.log(`  Only 1 anchor (#${anchor.num}) — assuming ${s.intervalDays}-day interval`);

      for (const t of undated) {
        const diff = t.num - anchor.num;
        const estimated = new Date(anchor.dt.getTime() + diff * interval);
        const dateStr = estimated.toISOString().slice(0, 10);
        seriesFixes.push({ id: t.id, name: t.name, date: dateStr });
        console.log(`  #${t.num} → ${dateStr}  ${t.name}`);
      }
    } else {
      console.log(`  No dated anchors — skipping`);
    }
  }

  // ─── Part 3: Fix offline Liquipedia bracket imports ─────────────────────
  const offlineFixes = [];
  const { rows: noDateOffline } = await pool.query(`
    SELECT id, name FROM tournaments
    WHERE started_at IS NULL AND completed_at IS NULL AND is_offline = true
  `);

  for (const t of noDateOffline) {
    for (const fix of OFFLINE_FIXES) {
      if (t.name.includes(fix.nameMatch)) {
        offlineFixes.push({ id: t.id, name: t.name, date: fix.date });
        break;
      }
    }
  }

  // ─── Also check: maybe some of these offline bracket imports have a
  //     duplicate row (from offline_import.js) that HAS a date. Link them. ─
  const { rows: noDateOfflineMissed } = await pool.query(`
    SELECT a.id, a.name, b.id AS dup_id, b.name AS dup_name,
           COALESCE(b.completed_at, b.started_at) AS dup_date
    FROM tournaments a
    JOIN tournaments b ON b.is_offline = true
      AND COALESCE(b.completed_at, b.started_at) IS NOT NULL
      AND a.id != b.id
      AND (
        a.name ILIKE '%' || SPLIT_PART(b.name, ':', 1) || '%'
        OR b.name ILIKE '%' || SPLIT_PART(a.name, ':', 1) || '%'
      )
    WHERE a.started_at IS NULL AND a.completed_at IS NULL AND a.is_offline = true
    ORDER BY a.name
    LIMIT 50
  `);

  if (noDateOfflineMissed.length > 0) {
    console.log('\n\nPotential duplicate offline rows (bracket import + basic import):');
    for (const r of noDateOfflineMissed) {
      console.log(`  NO DATE: "${r.name}" (id=${r.id})`);
      console.log(`  HAS DATE: "${r.dup_name}" → ${r.dup_date?.toISOString().slice(0, 10)} (id=${r.dup_id})`);
      console.log();
    }
  }

  // ─── Summary & Apply ───────────────────────────────────────────────────
  const allFixes = [...tccFixes, ...seriesFixes, ...offlineFixes];

  console.log('\n' + '='.repeat(80));
  console.log(`TOTAL FIXES: ${allFixes.length}`);
  console.log(`  TCC: ${tccFixes.length}`);
  console.log(`  Other series: ${seriesFixes.length}`);
  console.log(`  Offline: ${offlineFixes.length}`);
  console.log('='.repeat(80));

  if (!DRY_RUN && allFixes.length > 0) {
    console.log('\nApplying fixes...');
    let updated = 0;
    for (const f of allFixes) {
      const dateISO = new Date(f.date + 'T12:00:00Z').toISOString();
      const result = await pool.query(
        `UPDATE tournaments SET started_at = $1, completed_at = $1
         WHERE id = $2 AND started_at IS NULL AND completed_at IS NULL`,
        [dateISO, f.id]
      );
      if (result.rowCount > 0) updated++;
    }
    console.log(`Updated ${updated} tournaments.`);
  }

  // Show any still remaining
  const { rows: stillNoDate } = await pool.query(`
    SELECT name, (SELECT COUNT(*) FROM matches m WHERE m.tournament_id = t.id)::int AS mc
    FROM tournaments t
    WHERE started_at IS NULL AND completed_at IS NULL
    ORDER BY name
  `);

  if (stillNoDate.length > 0) {
    console.log(`\n\nSTILL NO DATE (${stillNoDate.length}):`);
    for (const t of stillNoDate) {
      console.log(`  [${String(t.mc).padStart(3)} matches]  ${t.name}`);
    }
  } else {
    console.log('\n\nAll tournaments now have dates!');
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
