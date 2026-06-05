// One-shot cleanup for harvested_tournaments.txt + DB junk rows.
//
// Removes from the file:
//   - Legacy Challonge top-nav URLs (followers, events, rankings, etc.)
//     that snuck in before the NON_TOURNAMENT_SLUGS filter existed.
//   - Slugs Challonge returns 404 for (deleted or never-published events).
//
// Deletes from the DB:
//   - id=889 bracket_generator (legacy junk, name "Турнир открытия")
//   - rankings, if Challonge confirms its game_name is not Pokkén
//   - ax7dpxbl, if Challonge confirms its game_name is not Pokkén
//
// Backs up harvested_tournaments.txt to .bak before writing.

require('dotenv').config({ path: 'backend/.env' });
const fs = require('fs');
const path = require('path');
const db = require('./backend/src/db');
const challonge = require('./backend/src/services/challonge');

const FILE = 'harvested_tournaments.txt';
const BAK  = `harvested_tournaments.txt.bak.${Date.now()}`;

// Top-nav slugs masquerading as tournament URLs (mirrors the NON_TOURNAMENT_SLUGS
// set in harvest_console.js, restricted to ones found on raw challonge.com/<slug>
// without an organizer prefix).
const NAV_SLUGS = new Set([
  'login', 'logout', 'signup', 'settings', 'tournaments', 'users', 'search',
  'about', 'faq', 'contact', 'privacy', 'terms', 'api', 'help',
  'participants', 'matches', 'followers', 'announcements', 'events', 'rankings',
  'templates', 'partners', 'organizedplay', 'switch_locale', 'translate',
  'terms_of_service', 'privacy_policy', 'bracket_generator',
]);

function isNavUrl(url) {
  // matches https://challonge.com/<slug>  (no extra path segments)
  const m = url.match(/^https?:\/\/challonge\.com\/([a-zA-Z0-9_-]+)\/?$/);
  if (!m) return false;
  return NAV_SLUGS.has(m[1].toLowerCase());
}

async function classifyAgainstChallonge(slug) {
  try {
    const t = await challonge.getTournament(slug);
    const tn = t.tournament || t;
    return { ok: true, game: tn.game_name || '', name: tn.name || '' };
  } catch (err) {
    const status = err.response?.status;
    return { ok: false, status: status || err.message };
  }
}

(async () => {
  const lines = fs.readFileSync(FILE, 'utf8').split('\n');
  const urls = lines
    .map((line, idx) => ({ idx, line, trimmed: line.trim() }))
    .filter(x => x.trimmed.startsWith('http'));
  const challongeUrls = urls.filter(x => !x.trimmed.includes('start.gg'));
  const startggUrls   = urls.filter(x =>  x.trimmed.includes('start.gg'));

  // --- Phase 1: which Challonge URLs are in DB? ---
  const slugByUrl = new Map();
  for (const u of challongeUrls) {
    slugByUrl.set(u.trimmed, challonge.extractSlugFromUrl(u.trimmed));
  }
  const allSlugs = [...new Set([...slugByUrl.values()].filter(Boolean))];
  const { rows: dbRows } = await db.query(
    `SELECT id, challonge_id, name FROM tournaments WHERE challonge_id = ANY($1)`,
    [allSlugs]
  );
  const dbBySlug = new Map(dbRows.map(r => [r.challonge_id, r]));

  // --- Phase 2: identify garbage by category ---
  const navUrls = challongeUrls.filter(x => isNavUrl(x.trimmed));
  console.log(`Legacy nav URLs to remove: ${navUrls.length}`);
  for (const u of navUrls) console.log(`  ${u.trimmed}`);
  console.log('');

  // --- Phase 3: spot-check the 3 ambiguous DB rows ---
  console.log('Spot-checking ambiguous DB rows against Challonge v1 game_name…');
  const ambiguous = ['bracket_generator', 'rankings', 'ax7dpxbl'];
  const dbDeletes = []; // rows we will delete from `tournaments`
  for (const slug of ambiguous) {
    const dbRow = dbBySlug.get(slug);
    if (!dbRow) { console.log(`  ${slug}: not in DB (skip)`); continue; }
    const c = await classifyAgainstChallonge(slug);
    if (!c.ok) {
      // Can't reach Challonge — be conservative, only delete the known-junk bracket_generator
      if (slug === 'bracket_generator') {
        dbDeletes.push({ id: dbRow.id, slug, reason: `Challonge ${c.status}; pre-confirmed junk` });
        console.log(`  ${slug}: Challonge ${c.status} — deleting anyway (pre-confirmed junk)`);
      } else {
        console.log(`  ${slug}: Challonge ${c.status} — KEEPING (uncertain)`);
      }
      continue;
    }
    const isPokken = /pokk[eé]n/i.test(c.game);
    console.log(`  ${slug.padEnd(20)} game="${c.game}"  name="${c.name}"  → ${isPokken ? 'KEEP' : 'DELETE'}`);
    if (!isPokken) {
      dbDeletes.push({ id: dbRow.id, slug, reason: `Challonge game_name="${c.game}", not Pokkén` });
    }
    await new Promise(r => setTimeout(r, 700));
  }
  console.log('');

  // --- Phase 4: re-check the orphans (unimported file URLs) for 404s + non-Pokken ---
  const orphans = challongeUrls.filter(x => !dbBySlug.has(slugByUrl.get(x.trimmed)));
  console.log(`Probing ${orphans.length} unimported Challonge URLs for 404 / non-Pokkén…`);
  const urlsToRemoveFromFile = new Set(navUrls.map(u => u.trimmed));
  let n404 = 0, nNotPokken = 0, nKept = 0;
  for (let i = 0; i < orphans.length; i++) {
    const o = orphans[i];
    if (urlsToRemoveFromFile.has(o.trimmed)) continue; // already on the chop list
    const slug = slugByUrl.get(o.trimmed);
    const c = await classifyAgainstChallonge(slug);
    if (!c.ok) {
      if (c.status === 404) { urlsToRemoveFromFile.add(o.trimmed); n404++; }
      else                  { nKept++; } // transient error — keep, retry next pull_new
    } else {
      const isPokken = /pokk[eé]n/i.test(c.game);
      if (!isPokken) { urlsToRemoveFromFile.add(o.trimmed); nNotPokken++;
        console.log(`  NOT POKKEN: ${slug}  game="${c.game}"  name="${c.name}"`);
      } else { nKept++; }
    }
    if ((i + 1) % 20 === 0) console.log(`  ...probed ${i+1}/${orphans.length}`);
    await new Promise(r => setTimeout(r, 700));
  }
  console.log(`  orphan results: 404=${n404}, not-Pokkén=${nNotPokken}, keeping=${nKept}\n`);

  // --- Phase 5: apply file cleanup ---
  console.log(`Backing up ${FILE} → ${BAK}`);
  fs.copyFileSync(FILE, BAK);

  // Walk lines, drop garbage URLs. Also collapse multiple blank lines and orphan
  // comment headers (a "# Appended ..." line followed by no remaining URLs).
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('http') && urlsToRemoveFromFile.has(trimmed)) {
      continue; // skip
    }
    keep.push(line);
  }
  // Optional: trim trailing blank lines to one
  while (keep.length > 1 && keep[keep.length-1].trim() === '' && keep[keep.length-2].trim() === '') {
    keep.pop();
  }
  fs.writeFileSync(FILE, keep.join('\n'));
  const removed = lines.length - keep.length;
  console.log(`File cleanup: removed ${removed} lines, kept ${keep.length}\n`);

  // --- Phase 6: apply DB deletes ---
  if (dbDeletes.length === 0) {
    console.log('No DB rows to delete.');
  } else {
    console.log(`Deleting ${dbDeletes.length} DB row(s):`);
    for (const d of dbDeletes) console.log(`  id=${d.id}  slug=${d.slug}  (${d.reason})`);
    // CASCADE handles matches + placements; player_achievements.tournament_id is ON DELETE SET NULL.
    const ids = dbDeletes.map(d => d.id);
    const r = await db.query(`DELETE FROM tournaments WHERE id = ANY($1) RETURNING id`, [ids]);
    console.log(`  → DELETED ${r.rowCount} row(s).`);
  }

  console.log('\nDone. start.gg URLs left untouched (trusted by videogameId).');
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
