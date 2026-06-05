// Full audit of harvested_tournaments.txt. For every URL in the file, look up
// the matching DB row (if any) and Challonge v1 metadata (for unimported or
// suspicious entries), then report anything that doesn't look like Pokkén.

require('dotenv').config({ path: 'backend/.env' });
const fs = require('fs');
const db = require('./backend/src/db');
const challonge = require('./backend/src/services/challonge');

const POKKEN_RX = /pokk[eé]n|ferrum|fighting for cheese|ffc|road to greatness|rtg|croissant|dcm|devcord|synergy smackdown|thunderdome|nezumi|ねずみ|heaven'?s arena|end of the road|eotr|gym leader|weavile|cheese|bandwidth|tokaigi|swiss cheese/i;

(async () => {
  const lines = fs.readFileSync('harvested_tournaments.txt', 'utf8').split('\n');
  const challongeUrls = [];
  const startggUrls = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('http')) continue;
    if (line.includes('start.gg')) startggUrls.push(line);
    else challongeUrls.push(line);
  }
  console.log(`harvested_tournaments.txt: ${challongeUrls.length} Challonge + ${startggUrls.length} start.gg URLs\n`);

  // --- Map every Challonge URL to its slug ---
  const slugRows = challongeUrls.map(u => {
    const slug = challonge.extractSlugFromUrl(u);
    return { url: u, slug };
  });
  const allSlugs = [...new Set(slugRows.map(r => r.slug).filter(Boolean))];

  // --- One round-trip to DB: pull all matching tournaments ---
  const { rows: dbRows } = await db.query(
    `SELECT challonge_id, name, started_at FROM tournaments WHERE challonge_id = ANY($1)`,
    [allSlugs]
  );
  const dbBySlug = new Map(dbRows.map(r => [r.challonge_id, r]));
  console.log(`Of ${allSlugs.length} unique Challonge slugs in file:`);
  console.log(`  ${dbBySlug.size} are imported (have DB rows)`);
  console.log(`  ${allSlugs.length - dbBySlug.size} are NOT in DB (never imported, or different slug column)\n`);

  // --- Look for DB rows whose NAME doesn't match Pokkén keywords ---
  console.log('--- DB rows with non-Pokkén-looking names (Challonge slugs from file) ---');
  const suspiciousDb = [];
  for (const r of dbRows) {
    if (!POKKEN_RX.test(r.name)) suspiciousDb.push(r);
  }
  if (suspiciousDb.length === 0) {
    console.log('  none — every imported file URL has a Pokkén-matching name in DB.\n');
  } else {
    console.log(`  ${suspiciousDb.length} suspicious:`);
    for (const r of suspiciousDb) {
      console.log(`    ${r.challonge_id.padEnd(24)} "${r.name}"`);
    }
    console.log('');
  }

  // --- For URLs NOT in DB, hit Challonge v1 to confirm ---
  const orphans = slugRows.filter(r => r.slug && !dbBySlug.has(r.slug));
  console.log(`--- Phase 2: Challonge v1 lookups for ${orphans.length} URLs not in DB ---`);
  console.log('(700ms per call — this will take a while)\n');
  const orphanResults = [];
  for (let i = 0; i < orphans.length; i++) {
    const o = orphans[i];
    try {
      const t = await challonge.getTournament(o.slug);
      const tn = t.tournament || t;
      const game = tn.game_name || '';
      const name = tn.name || '';
      const isPokken = /pokk[eé]n/i.test(game) || POKKEN_RX.test(name);
      orphanResults.push({ slug: o.slug, url: o.url, game, name, isPokken, state: tn.state });
      process.stdout.write(isPokken ? '.' : 'X');
    } catch (err) {
      const status = err.response?.status;
      orphanResults.push({ slug: o.slug, url: o.url, error: status || err.message });
      process.stdout.write(status === 404 ? '?' : 'e');
    }
    if ((i+1) % 60 === 0) process.stdout.write(` (${i+1}/${orphans.length})\n`);
    await new Promise(r => setTimeout(r, 700));
  }
  console.log(`\n`);

  // --- Categorize orphan results ---
  const confirmedPokken = orphanResults.filter(r => r.isPokken === true);
  const confirmedNotPokken = orphanResults.filter(r => r.isPokken === false);
  const lookupErrored = orphanResults.filter(r => r.error);

  console.log(`Orphan (in-file, not-in-DB) breakdown:`);
  console.log(`  Confirmed Pokkén:   ${confirmedPokken.length}`);
  console.log(`  Confirmed NOT Pokkén: ${confirmedNotPokken.length}`);
  console.log(`  Lookup errored:     ${lookupErrored.length} (mix of 404 and others)\n`);

  if (confirmedNotPokken.length) {
    console.log('--- URLs that are NOT Pokkén (file but not in DB) ---');
    for (const r of confirmedNotPokken) {
      console.log(`  ${r.slug.padEnd(28)}  game="${r.game}"  name="${r.name}"`);
    }
    console.log('');
  }

  if (lookupErrored.length) {
    console.log('--- URLs Challonge returned an error for ---');
    const errBuckets = {};
    for (const r of lookupErrored) {
      const k = String(r.error);
      (errBuckets[k] ||= []).push(r.slug);
    }
    for (const [code, slugs] of Object.entries(errBuckets)) {
      console.log(`  ${code}: ${slugs.length}`);
      for (const s of slugs.slice(0, 10)) console.log(`     ${s}`);
      if (slugs.length > 10) console.log(`     ... and ${slugs.length - 10} more`);
    }
    console.log('');
  }

  // --- Final verdict ---
  console.log('=====================================');
  console.log(`SUMMARY (Challonge URLs only)`);
  console.log(`  ${dbRows.length - suspiciousDb.length} imported + name matches Pokkén keywords`);
  console.log(`  ${suspiciousDb.length} imported but name does NOT match keywords (may still be Pokkén — flag for spot-check)`);
  console.log(`  ${confirmedPokken.length} in file, not imported, Challonge confirms Pokkén`);
  console.log(`  ${confirmedNotPokken.length} in file, not imported, Challonge confirms NOT Pokkén`);
  console.log(`  ${lookupErrored.length} in file, not imported, Challonge lookup failed`);
  console.log('');
  console.log(`start.gg URLs (${startggUrls.length}) were not audited — they came from`);
  console.log(`harvest_startgg.js which queries by videogameId=447 (Pokkén) so they are`);
  console.log(`trusted by construction. Spot-check separately if needed.`);

  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
