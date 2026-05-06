/**
 * Neos City — Tonamel Batch Import Console Script (iframe edition)
 *
 * Stays on the org page the entire time. Each bracket is loaded inside a
 * hidden iframe, scraped, then disposed — your console + script state survive
 * the full run. (The previous version used window.location.href to navigate,
 * which destroyed the JS context after the first hop, so logs and state both
 * disappeared.)
 *
 * HOW TO USE
 * ──────────
 * 1. Backend running on localhost:3001
 * 2. Open Chrome, navigate to https://tonamel.com/organization/OhUc2?game=pokken
 *    Wait for the tournament cards to render.
 * 3. F12 → Console → paste this entire file → Enter
 *
 * NETWORK NOTE
 * ────────────
 * The script fetch()es http://localhost:3001 from https://tonamel.com.
 * Modern Chrome treats http://localhost as a secure context, so this works
 * without mixed-content blocking. If you somehow see "Failed to fetch" /
 * "blocked" errors during Phase 2, click the lock icon → Site settings →
 * Insecure content → Allow on tonamel.com, then run `_phase2()` to retry.
 *
 * Re-run any time — already-imported tournaments are detected via tonamel_id
 * and skipped.
 */

const ORG_URL        = 'https://tonamel.com/organization/OhUc2?game=pokken';
const BACKEND_URL    = 'http://localhost:3001';
// Paste your ADMIN_TOKEN here (the same value as backend/.env ADMIN_TOKEN).
// Required — the import endpoint is gated and the script will refuse to run if blank.
const ADMIN_TOKEN    = '';
const IFRAME_HOLD_MS = 1000;   // extra settle time after bracket markers appear
const MAX_WAIT_MS    = 20000;  // give up looking for bracket markers after this
const POST_DELAY_MS  = 250;    // breath between backend POSTs

// ── Series detection ──────────────────────────────────────────────────────────
function detectSeries(name) {
  const n = name.toLowerCase();
  if (n.includes('rookies'))   return 'nezumi_rookies';
  if (n.includes('mouse cup')) return 'nezumi';
  return 'other';
}

// ── Discover events from the currently-loaded org page ────────────────────────
function discoverTournamentsFromOrgPage() {
  const links = [...document.querySelectorAll('a[href*="/competition/"]')];
  return links.map(a => {
    const id    = a.href.split('/competition/')[1].replace(/\/.*$/, '');
    const lines = a.innerText.trim().split('\n').map(l => l.trim()).filter(Boolean);
    // Card structure: ["Result", "Name", "Date", "Online", "N/64", "Pokken"]
    const name         = lines[1] || '';
    const dateStr      = lines[2] || '';
    const countStr     = lines[4] || '';
    const participants = parseInt(countStr.split('/')[0]) || 0;
    const dateObj      = new Date(dateStr);
    const date         = isNaN(dateObj) ? dateStr : dateObj.toISOString().slice(0, 10);
    return { id, name, series: detectSeries(name), date, participants };
  }).filter(e => e.id && e.name);
}

// ── Parse #W/#L match rows from an arbitrary document ─────────────────────────
function parseBracketFromDoc(doc) {
  const lines = doc.body.innerText
    .split('\n').map(l => l.trim()).filter(l => l);
  const matches = [];
  let i = 0;
  while (i < lines.length) {
    if (/^#[WL]\d+-\d+/.test(lines[i])) {
      const matchId = lines[i];
      let j = i + 1;
      if (lines[j] && lines[j].startsWith('[')) j++;   // skip bracket label
      const p1User  = lines[j + 1];
      const p1Score = lines[j + 2];
      const p2User  = lines[j + 4];
      const p2Score = lines[j + 5];
      j += 6;
      if (lines[j] && lines[j].startsWith('[')) j++;   // skip trailing label

      if (/^\d+$/.test(p1Score) && /^\d+$/.test(p2Score)) {
        const s1 = parseInt(p1Score), s2 = parseInt(p2Score);
        matches.push({
          matchId,
          p1: p1User, p1Score: s1,
          p2: p2User, p2Score: s2,
          winner: s1 > s2 ? p1User : p2User,
          loser:  s1 > s2 ? p2User : p1User,
        });
      }
      i = j;
    } else {
      i++;
    }
  }
  return matches;
}

// ── Hidden-iframe loader: polls for bracket markers, parses, disposes ─────────
function scrapeViaIframe(url) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    // Off-screen but full-size so the SPA still lays out and renders.
    iframe.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1280px;height:1024px;border:0;';
    iframe.src = url;

    let settled = false;
    let pollHandle = null;
    let hardTimeout = null;
    const finish = (value, err) => {
      if (settled) return;
      settled = true;
      if (pollHandle) clearInterval(pollHandle);
      if (hardTimeout) clearTimeout(hardTimeout);
      try { iframe.remove(); } catch {}
      if (err) reject(err); else resolve(value);
    };

    iframe.addEventListener('load', () => {
      const start = Date.now();
      pollHandle = setInterval(() => {
        if (settled) return;
        let doc;
        try {
          doc = iframe.contentDocument;
        } catch (err) {
          return finish(null, new Error('cross-origin denial: ' + err.message));
        }
        if (!doc || !doc.body) return;
        const text = doc.body.innerText || '';
        const hasBracket = /#[WL]\d+-\d+/.test(text);
        const elapsed = Date.now() - start;

        if (hasBracket) {
          // Bracket markers visible — give the SPA one more beat to finish
          // rendering trailing rounds, then parse.
          if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
          setTimeout(() => {
            try {
              const doc2 = iframe.contentDocument;
              if (!doc2 || !doc2.body) throw new Error('iframe lost during settle');
              finish(parseBracketFromDoc(doc2));
            } catch (err) {
              finish(null, err);
            }
          }, IFRAME_HOLD_MS);
        } else if (elapsed > MAX_WAIT_MS) {
          // Never saw a bracket marker — could be round-robin, empty, or a
          // load failure. Try parsing anyway (returns [] for the caller to
          // skip), so we don't hard-fail the run.
          try {
            finish(parseBracketFromDoc(doc));
          } catch (err) {
            finish(null, err);
          }
        }
      }, 500);
    });

    iframe.addEventListener('error', () => finish(null, new Error('iframe load error')));
    hardTimeout = setTimeout(
      () => finish(null, new Error('iframe hard timeout')),
      MAX_WAIT_MS + 8000
    );

    document.body.appendChild(iframe);
  });
}

// ── Backend helpers ──────────────────────────────────────────────────────────
async function getAlreadyImported() {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/tournaments`);
    const list = await resp.json();
    return new Set(list.filter(t => t.tonamel_id).map(t => t.tonamel_id));
  } catch (e) {
    console.warn('⚠️  Could not read already-imported list from backend:', e.message);
    return new Set();
  }
}

async function postToBackend(payload) {
  if (!ADMIN_TOKEN) throw new Error('Set ADMIN_TOKEN at the top of this script.');
  const resp = await fetch(`${BACKEND_URL}/api/tournaments/import-tonamel`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body:    JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
  return json;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function runTonamelImport({ skipIds = [] } = {}) {
  console.log('%c🐭 Neos City — Tonamel Batch Import (iframe edition)',
    'font-size:16px;font-weight:bold;color:#818cf8');

  if (!window.location.href.includes('/organization/OhUc2')) {
    console.error('❌ Run this from the org page:', ORG_URL);
    return;
  }

  const events = discoverTournamentsFromOrgPage();
  if (events.length === 0) {
    console.error('❌ No tournament cards found on the org page. Has it finished loading?');
    return;
  }
  console.log(`📋 Discovered ${events.length} tournaments on the org page`);

  const alreadyImported = await getAlreadyImported();
  console.log(`📥 Backend already has ${alreadyImported.size} Tonamel tournaments imported`);

  const skipSet  = new Set([...skipIds, ...alreadyImported]);
  const toScrape = events.filter(e => !skipSet.has(e.id));
  console.log(`🎯 ${toScrape.length} new tournaments to scrape`);

  if (toScrape.length === 0) {
    console.log('✅ Nothing to do — everything is already imported.');
    return;
  }

  window._tonamelCollected = window._tonamelCollected || [];
  const alreadyCollected = new Set(window._tonamelCollected.map(p => p.tonamel_id));

  let scraped = 0, skipped = 0, errored = 0;

  for (let i = 0; i < toScrape.length; i++) {
    const ev = toScrape[i];
    if (alreadyCollected.has(ev.id)) {
      console.log(`⏭️  [${i + 1}/${toScrape.length}] Already collected this run: ${ev.name}`);
      skipped++;
      continue;
    }

    console.log(`⏳ [${i + 1}/${toScrape.length}] ${ev.name} (${ev.id})…`);
    const url = `https://tonamel.com/competition/${ev.id}/tournament`;
    try {
      const matches = await scrapeViaIframe(url);
      if (matches.length === 0) {
        console.warn(`   ⚠️  No matches parsed — skipping (likely round-robin or empty bracket)`);
        skipped++;
        continue;
      }
      window._tonamelCollected.push({
        tonamel_id:         ev.id,
        name:               ev.name,
        series:             ev.series,
        date:               ev.date,
        participants_count: ev.participants,
        matches,
      });
      alreadyCollected.add(ev.id);
      scraped++;
      console.log(`   → ${matches.length} matches collected`);
    } catch (err) {
      errored++;
      console.error(`   ❌ Scrape failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n✅ Phase 1 complete — ${scraped} scraped, ${skipped} skipped, ${errored} errored`);
  console.log(`📦 ${window._tonamelCollected.length} tournaments queued for backend POST`);

  // ── Phase 2: POST inline ──────────────────────────────────────────────────
  if (window._tonamelCollected.length === 0) return;

  console.log('\n%c📤 Phase 2 — POSTing to backend',
    'font-size:14px;font-weight:bold;color:#818cf8');

  const results = { imported: [], errors: [] };
  for (const payload of [...window._tonamelCollected]) {
    try {
      const result = await postToBackend(payload);
      const winner = Object.entries(result.placements || {}).find(([, v]) => v === 1)?.[0] || '?';
      console.log(`✅ ${payload.name} — ${payload.matches.length} matches, 🥇 ${winner}`);
      results.imported.push(payload.name);
      // Drop successful entries from the queue so re-runs don't double-POST.
      window._tonamelCollected = window._tonamelCollected.filter(
        p => p.tonamel_id !== payload.tonamel_id
      );
    } catch (err) {
      console.error(`❌ ${payload.name}: ${err.message}`);
      results.errors.push({ name: payload.name, error: err.message });
      if (/Failed to fetch|blocked|mixed/i.test(err.message)) {
        console.error(
          '%cMixed-content error suspected. Click the lock icon next to the URL → ' +
          'Site settings → Insecure content → Allow, reload tonamel.com, then run _phase2()',
          'color:#fbbf24;font-weight:bold');
        break; // no point hammering — the rest will fail the same way
      }
    }
    await new Promise(r => setTimeout(r, POST_DELAY_MS));
  }

  console.log(`\n%c📊 Import complete`,
    'font-size:14px;font-weight:bold;color:#34d399');
  console.log(`✅ Imported: ${results.imported.length}`);
  console.log(`❌ Errors:   ${results.errors.length}`);
  if (results.errors.length) console.error('Errors:', results.errors);

  return results;
}

// Retry helper — re-POST whatever's still in the queue (e.g. after fixing
// mixed-content). Phase 1 data lives on `window._tonamelCollected`.
window._phase2 = async () => {
  const queued = window._tonamelCollected || [];
  if (!queued.length) { console.log('Nothing queued.'); return; }
  console.log(`📤 Re-posting ${queued.length} queued tournaments…`);
  for (const payload of [...queued]) {
    try {
      await postToBackend(payload);
      console.log(`✅ ${payload.name}`);
      window._tonamelCollected = window._tonamelCollected.filter(
        p => p.tonamel_id !== payload.tonamel_id
      );
    } catch (err) {
      console.error(`❌ ${payload.name}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, POST_DELAY_MS));
  }
};

// ── Run ───────────────────────────────────────────────────────────────────────
runTonamelImport();

// To skip specific IDs:
// runTonamelImport({ skipIds: ['Sbekx'] });
