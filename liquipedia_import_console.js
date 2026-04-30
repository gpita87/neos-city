/**
 * liquipedia_import_console.js
 *
 * HOW TO USE
 * ──────────
 * 1. Start the backend:   cd neos-city/backend && npm run dev
 * 2. Open Chrome and go to ANY liquipedia.net page
 *    (e.g. https://liquipedia.net/fighters/Pokkén_Tournament/Tournaments)
 * 3. Open DevTools → Console tab (F12)
 * 4. Paste this entire script and press Enter
 * 5. Watch the console output — takes ~3-5 minutes for all 76 events
 *
 * HOW IT WORKS
 * ────────────
 * The script fetches each bracket page HTML using same-origin fetch() — no
 * tab navigation needed. It parses the bracket DOM, derives placements, and
 * POSTs match data to the Neos City backend at localhost:3001.
 *
 * Safe to re-run — already-imported brackets are skipped (by liquipedia_url).
 * Events without a bracket page (no .brkts-match elements) are silently skipped.
 */

(async () => {

const BACKEND = 'http://localhost:3001';
const DELAY_MS = 800; // polite pause between Liquipedia fetches

// ── All 76 Pokken event base URLs discovered from Liquipedia ─────────────────
const EVENT_URLS = [
  'https://liquipedia.net/fighters/All_In_Together/2023/PokkenDX',
  'https://liquipedia.net/fighters/Battle_Arena_Melbourne/12/PokkenDX',
  'https://liquipedia.net/fighters/Battle_Arena_Melbourne/13/PokkenDX',
  'https://liquipedia.net/fighters/Canada_Cup/2016/Pokken',
  'https://liquipedia.net/fighters/Canada_Cup/2018/PokkenDX',
  'https://liquipedia.net/fighters/Community_Effort_Orlando/2016/Pokken',
  'https://liquipedia.net/fighters/Community_Effort_Orlando/2017/Pokken',
  'https://liquipedia.net/fighters/Community_Effort_Orlando/2023/PokkenDX',
  'https://liquipedia.net/fighters/Community_Effort_Orlando/2024/PokkenDX',
  'https://liquipedia.net/fighters/Community_Effort_Orlando/2025/PokkenDX',
  'https://liquipedia.net/fighters/Defend_the_North/2016/Pokken',
  'https://liquipedia.net/fighters/Defend_the_North/2018/PokkenDX',
  'https://liquipedia.net/fighters/Defend_the_North/2019/PokkenDX',
  'https://liquipedia.net/fighters/DreamHack/2016/Austin/Pokken',
  'https://liquipedia.net/fighters/DreamHack/2016/Summer/Pokken/Master',
  'https://liquipedia.net/fighters/DreamHack/2017/Austin/Pokken',
  'https://liquipedia.net/fighters/DreamHack/2017/Summer/Pokken',
  'https://liquipedia.net/fighters/DreamHack/2018/Austin/PokkenDX',
  'https://liquipedia.net/fighters/DreamHack/2020/Anaheim/Pokken',
  'https://liquipedia.net/fighters/Evolution_Championship_Series/2016/Pokken',
  'https://liquipedia.net/fighters/Evolution_Championship_Series/2017/Pokken',
  'https://liquipedia.net/fighters/Evolution_Championship_Series/2018/PokkenDX',
  'https://liquipedia.net/fighters/Evolution_Championship_Series/2019/PokkenDX',
  'https://liquipedia.net/fighters/FightClub_Championship/5/PokkenDX',
  'https://liquipedia.net/fighters/Final_Round/19/Pokken',
  'https://liquipedia.net/fighters/Final_Round/20/Pokken',
  'https://liquipedia.net/fighters/Final_Round/2018/PokkenDX',
  'https://liquipedia.net/fighters/Final_Round/2019/PokkenDX',
  'https://liquipedia.net/fighters/Frostfire/2019/PokkenDX',
  'https://liquipedia.net/fighters/Frostfire/2020/PokkenDX',
  'https://liquipedia.net/fighters/Frostfire/2022/Pokken',
  'https://liquipedia.net/fighters/Frosty_Faustings/2017/Pokken',
  'https://liquipedia.net/fighters/Frosty_Faustings/2018/PokkenDX',
  'https://liquipedia.net/fighters/Frosty_Faustings/2019/PokkenDX',
  'https://liquipedia.net/fighters/Frosty_Faustings/2020/PokkenDX',
  'https://liquipedia.net/fighters/Frosty_Faustings/2022/PokkenDX',
  'https://liquipedia.net/fighters/Frosty_Faustings/2023/PokkenDX',
  'https://liquipedia.net/fighters/GENESIS/5/PokkenDX',
  'https://liquipedia.net/fighters/Kumite_In_Tennessee/2017/Pokken',
  'https://liquipedia.net/fighters/NEC/17/Pokken',
  'https://liquipedia.net/fighters/NEC/18/PokkenDX',
  'https://liquipedia.net/fighters/NEC/19/PokkenDX',
  'https://liquipedia.net/fighters/NEC/20/PokkenDX',
  'https://liquipedia.net/fighters/NEC/2021/PokkenDX',
  'https://liquipedia.net/fighters/NorCal_Regionals/2017/Pokken',
  'https://liquipedia.net/fighters/NorCal_Regionals/2018/PokkenDX',
  'https://liquipedia.net/fighters/NorCal_Regionals/2019/PokkenDX',
  'https://liquipedia.net/fighters/OzHadou_Nationals/17/PokkenDX',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament/World_Championships/2016/Master',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament/World_Championships/2017',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament_DX/World_Championships/2018',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament_DX/World_Championships/2019',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament_DX/World_Championships/2022/Masters',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament_DX_Championship_Series/2019/Europe',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament_DX_Championship_Series/2019/NA',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament_DX_Championship_Series/2019/Oceania',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament_DX_Championship_Series/2022/Europe',
  'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament_DX_Championship_Series/2022/NA',
  'https://liquipedia.net/fighters/Revolution/2018/PokkenDX',
  'https://liquipedia.net/fighters/Revolution/2019/PokkenDX',
  'https://liquipedia.net/fighters/Smash_Conference_LXIX/Pokken',
  'https://liquipedia.net/fighters/SoCal_Regionals/2017/PokkenDX',
  'https://liquipedia.net/fighters/SoCal_Regionals/2018/PokkenDX',
  'https://liquipedia.net/fighters/Summer_Jam/10/Pokken',
  'https://liquipedia.net/fighters/Summer_Jam/11/Pokken',
  'https://liquipedia.net/fighters/Summer_Jam/12/Pokken',
  'https://liquipedia.net/fighters/Summer_Jam/13/PokkenDX',
  'https://liquipedia.net/fighters/Texas_Showdown/2016/Pokken',
  'https://liquipedia.net/fighters/The_Fall_Classic/2017/PokkenDX',
  'https://liquipedia.net/fighters/Toryuken/8/PokkenDX',
  'https://liquipedia.net/fighters/Vortex_Gallery/2024/Frosty_Faustings/PokkenDX',
  'https://liquipedia.net/fighters/Vortex_Gallery/2025/Frosty_Faustings/PokkenDX',
  'https://liquipedia.net/fighters/Vortex_Gallery/2026/Frosty_Faustings/PokkenDX',
  'https://liquipedia.net/fighters/Winter_Brawl/11/Pokken',
  'https://liquipedia.net/fighters/Winter_Brawl/12/PokkenDX',
  'https://liquipedia.net/fighters/Winter_Brawl/2019/3D_Edition/PokkenDX',
];

// ── Legacy bracket parser (.bracket-game template, pre-2020 events) ──────────
function parseLegacyBracket(doc) {
  const gameEls = doc.querySelectorAll('.bracket-game');
  if (!gameEls.length) return [];

  const parsedMatches = [];

  for (let i = 0; i < gameEls.length; i++) {
    const g = gameEls[i];
    const top = g.querySelector('.bracket-player-top');
    const bot = g.querySelector('.bracket-player-bottom');
    if (!top || !bot) continue;

    // Extract player names from <span> children (skip .flag and .bracket-score spans)
    function getPlayerName(row) {
      const spans = row.querySelectorAll(':scope > span:not(.flag)');
      for (const span of spans) {
        if (span.classList.contains('bracket-score')) continue;
        const name = span.textContent.trim();
        if (name) return name;
      }
      return '';
    }

    const p1 = getPlayerName(top);
    const p2 = getPlayerName(bot);
    if (!p1 || !p2) continue;

    // Determine winner: check for numeric scores first, then checkmark icons
    let winner = null, loser = null;
    let s1 = null, s2 = null;

    const topScoreEl = top.querySelector('.bracket-score');
    const botScoreEl = bot.querySelector('.bracket-score');
    const s1raw = topScoreEl ? topScoreEl.textContent.trim() : '';
    const s2raw = botScoreEl ? botScoreEl.textContent.trim() : '';

    if (s1raw !== '' && s2raw !== '') {
      // Numeric scores available
      s1 = parseFloat(s1raw);
      s2 = parseFloat(s2raw);
      if (!isNaN(s1) && !isNaN(s2)) {
        if (s1 > s2)      { winner = p1; loser = p2; }
        else if (s2 > s1) { winner = p2; loser = p1; }
      }
      // Handle W/DQ walkovers
      if (!winner) {
        if (s1raw === 'W' || s2raw === 'DQ') { winner = p1; loser = p2; }
        else if (s2raw === 'W' || s1raw === 'DQ') { winner = p2; loser = p1; }
      }
    }

    // Fall back to checkmark icon (.fa-check or .forest-green-text)
    if (!winner) {
      const topCheck = !!top.querySelector('.fa-check, .forest-green-text');
      const botCheck = !!bot.querySelector('.fa-check, .forest-green-text');
      if (topCheck && !botCheck)      { winner = p1; loser = p2; }
      else if (botCheck && !topCheck) { winner = p2; loser = p1; }
      else if (topCheck && botCheck)  { winner = p1; loser = p2; } // both checked = GF reset, top wins
    }

    if (!winner) continue;

    // Use DOM order as weight proxy (same approach as new-style parser)
    parsedMatches.push({
      round: i + 1,
      section: 'W',
      weight: i + 1,
      p1, p1Score: isNaN(s1) ? null : s1,
      p2, p2Score: isNaN(s2) ? null : s2,
      winner, loser,
    });
  }

  return parsedMatches;
}

// ── Bracket parser (runs on fetched HTML via DOMParser) ──────────────────────
function parseBracket(doc) {
  const allMatchEls = doc.querySelectorAll('.brkts-match');
  if (!allMatchEls.length) return [];

  // Each match has an absolute position; use getBoundingClientRect equivalent
  // from the parsed doc. Since the doc is not rendered, we use offsetLeft/offsetTop.
  // However DOMParser docs are not laid out, so we read the inline style or data attrs.
  // Fallback: use DOM order as round proxy (matches appear left-to-right in source).

  // Better approach: use the column structure.
  // Each column in the header has a fixed width. We count column headers
  // and match them to matches by DOM order within each column's parent.
  const matches = [];

  // Strategy: iterate matches in DOM order. Liquipedia renders them column by
  // column within .brkts-round-body children. We can count column position
  // by walking the ancestor tree.
  const bracketWrapper = doc.querySelector('.brkts-bracket-wrapper');
  if (!bracketWrapper) return [];

  // Get all round header divs and their labels
  const headerDivs = bracketWrapper.querySelectorAll('.brkts-header.brkts-header-div');
  const roundLabels = [...headerDivs].map(h => h.textContent.trim().toLowerCase());

  function getRoundInfo(label) {
    const l = label;
    const isLower = l.includes('lower') || l.includes('lb') || l.startsWith('l ');
    const isGF    = l.includes('grand final');
    let roundNum  = 1;
    // Try to extract a round number
    const numM = l.match(/round\s+(\d+)|r(\d+)\b/i);
    if (numM) roundNum = parseInt(numM[1] || numM[2]);
    else if (l.includes('quarterfinal')) roundNum = 10;
    else if (l.includes('semifinal'))    roundNum = 11;
    else if (l.includes(' final') && !isGF) roundNum = 12;
    else if (isGF)                       roundNum = 13;
    return { isLower, roundNum, isGF };
  }

  // Walk each "column" (header + its associated matches)
  // Liquipedia layout: .brkts-round-header has N .brkts-header-div children
  // .brkts-round-body  has N column containers, each with their matches
  const roundBodies = bracketWrapper.querySelectorAll(':scope > .brkts-round-body > .brkts-round-lower > .brkts-round-body');

  // If that structure doesn't exist, fall back to direct brkts-round-body
  const topBody = bracketWrapper.querySelector('.brkts-round-body');

  // Collect matches with their column index by traversing the DOM tree
  // We assign weight based on column order and bracket section (upper/lower)
  function collectMatchesFromNode(node, colIdx, isLower) {
    const matchEls = node.querySelectorAll(':scope > .brkts-match, :scope > .brkts-round-center > .brkts-match');
    for (const el of matchEls) {
      const opponents = el.querySelectorAll('.brkts-opponent-entry');
      if (opponents.length < 2) continue;
      const [opp1, opp2] = opponents;
      const p1 = opp1.querySelector('.name')?.textContent?.trim() || '';
      const p2 = opp2.querySelector('.name')?.textContent?.trim() || '';
      if (!p1 || !p2) continue;
      const s1raw = opp1.querySelector('.brkts-opponent-score-inner')?.textContent?.trim() || '';
      const s2raw = opp2.querySelector('.brkts-opponent-score-inner')?.textContent?.trim() || '';
      const s1 = parseFloat(s1raw);
      const s2 = parseFloat(s2raw);
      let winner = null, loser = null;
      if (!isNaN(s1) && !isNaN(s2)) {
        if (s1 > s2)      { winner = p1; loser = p2; }
        else if (s2 > s1) { winner = p2; loser = p1; }
      } else if (s1raw === 'W' || s2raw === 'DQ') { winner = p1; loser = p2; }
      else if (s2raw === 'W' || s1raw === 'DQ')   { winner = p2; loser = p1; }
      if (!winner) continue;

      const section = isLower ? 'L' : 'W';
      const weight  = isLower ? (colIdx + 1) * 2 : (colIdx + 1) * 2 - 1;

      matches.push({
        round: colIdx + 1, section, weight,
        p1, p1Score: isNaN(s1) ? null : s1,
        p2, p2Score: isNaN(s2) ? null : s2,
        winner, loser,
      });
    }
  }

  // Walk the full match tree using y-positions from rendered page
  // Since we're in DOMParser (not live), use DOM-order approach:
  // All matches come out in source order = left-to-right, top-to-bottom
  // within each bracket section. We use the header index to assign rounds.

  // Simpler approach: just use DOM order + track position in column
  // by looking at ancestor path depth
  let colIdx = 0;
  let prevDepth = -1;

  // Flat approach: parse ALL matches in DOM order, assign weight by source position
  // (earlier in source = earlier round, which is correct for Liquipedia's HTML layout)
  const allMatches2 = doc.querySelectorAll('.brkts-match');

  // Find the y-gap between upper and lower bracket using inline styles or class names
  // Since doc is not rendered, check if there are two .brkts-bracket elements
  const brackets = doc.querySelectorAll('.brkts-bracket');
  const hasDualBracket = brackets.length >= 2 ||
    doc.querySelector('.brkts-round-lower') !== null;

  // Assign column index based on DOM order within the bracket
  // Find column containers
  const allColumns = doc.querySelectorAll('.brkts-round-body > *, .brkts-round-lower > .brkts-round-body > *');

  // Final approach: use the rendered page data for Frostfire (already tested),
  // and for fetched HTML use the header count to split by column.
  // Liquipedia wraps each round in a flex column. We just need to count matches per header.

  // Get total header count and assume even distribution
  const totalHeaders = headerDivs.length;
  const upperHeaders = [...headerDivs].filter(h => !h.textContent.toLowerCase().includes('lower') && !h.textContent.toLowerCase().includes('lb')).length;
  const lowerHeaders = totalHeaders - upperHeaders;

  const allMatchArr = [...allMatches2];
  const totalMatches = allMatchArr.length;

  // If we can't determine column structure, use a simple weight = match index
  // But try to use the rendered bracket if available (current page)
  // For fetched pages we do our best with DOM order

  const parsedMatches = [];

  for (let i = 0; i < allMatchArr.length; i++) {
    const el = allMatchArr[i];
    const opponents = el.querySelectorAll('.brkts-opponent-entry');
    if (opponents.length < 2) continue;
    const [opp1, opp2] = opponents;
    const p1 = opp1.querySelector('.name')?.textContent?.trim() || '';
    const p2 = opp2.querySelector('.name')?.textContent?.trim() || '';
    if (!p1 || !p2) continue;
    const s1raw = opp1.querySelector('.brkts-opponent-score-inner')?.textContent?.trim() || '';
    const s2raw = opp2.querySelector('.brkts-opponent-score-inner')?.textContent?.trim() || '';
    const s1 = parseFloat(s1raw);
    const s2 = parseFloat(s2raw);
    let winner = null, loser = null;
    if (!isNaN(s1) && !isNaN(s2)) {
      if (s1 > s2)      { winner = p1; loser = p2; }
      else if (s2 > s1) { winner = p2; loser = p1; }
    } else if (s1raw === 'W' || s2raw === 'DQ') { winner = p1; loser = p2; }
    else if (s2raw === 'W' || s1raw === 'DQ')   { winner = p2; loser = p1; }
    if (!winner) continue;

    // Use DOM order as weight proxy — later in DOM = later in bracket = higher weight
    parsedMatches.push({
      round: i + 1,       // DOM order index (1-based)
      section: 'W',       // section detection requires layout info; default to W
      weight: i + 1,      // same-order weight — recalculate_elo.js will fix ordering by date
      p1, p1Score: isNaN(s1) ? null : s1,
      p2, p2Score: isNaN(s2) ? null : s2,
      winner, loser,
    });
  }

  return parsedMatches;
}

// ── Extract tournament metadata from a fetched doc ───────────────────────────
function extractMeta(doc, bracketUrl) {
  // Title (strip ": Bracket" suffix)
  const rawTitle = doc.querySelector('.firstHeading, h1')?.textContent?.trim() || '';
  const name = rawTitle.replace(/:\s*bracket\s*$/i, '').trim() || null;

  // Date — look for ISO or "Month D, YYYY" in infobox
  let date = null;
  const allText = doc.body?.textContent || '';
  const isoMatch = allText.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) date = isoMatch[1];
  else {
    const longMatch = allText.match(/([A-Z][a-z]+ \d{1,2},?\s+\d{4})/);
    if (longMatch) {
      const d = new Date(longMatch[1]);
      if (!isNaN(d)) date = d.toISOString().split('T')[0];
    }
  }

  // Entrant count
  const entrantMatch = allText.match(/(\d+)\s+entrant/i);
  const participants_count = entrantMatch ? parseInt(entrantMatch[1]) : null;

  // Prize pool
  const prizeMatch = allText.match(/Prize\s+[Pp]ool[^\n]*?\$([\d,]+(?:\.\d+)?)/);
  const prize_pool = prizeMatch ? `$${prizeMatch[1]}` : null;

  return { name, date, participants_count, prize_pool };
}

// ── Delay helper ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Health check ─────────────────────────────────────────────────────────────
console.log('🏆 Neos City — Liquipedia Bracket Importer');
console.log(`📡 Backend: ${BACKEND}`);
console.log(`📋 Events to check: ${EVENT_URLS.length}`);
console.log('');

try {
  const health = await fetch(`${BACKEND}/api/tournaments?is_offline=false`);
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
  console.log('✅ Backend is reachable\n');
} catch (e) {
  console.error(`❌ Cannot reach backend at ${BACKEND}. Is it running?`);
  console.error('   Start: cd neos-city/backend && npm run dev');
  return;
}

// ── Check which liquipedia_urls are already imported ─────────────────────────
let alreadyImported = new Set();
try {
  const resp = await fetch(`${BACKEND}/api/tournaments?is_offline=true`);
  const rows = await resp.json();
  alreadyImported = new Set(rows.map(r => r.liquipedia_url).filter(Boolean));
  console.log(`ℹ️  Already imported: ${alreadyImported.size} brackets\n`);
} catch (e) { /* ignore */ }

// ── Main loop ─────────────────────────────────────────────────────────────────
let imported = 0, skipped = 0, noBracket = 0, errors = 0;

for (let i = 0; i < EVENT_URLS.length; i++) {
  const eventUrl  = EVENT_URLS[i];
  const bracketUrl = eventUrl + '/Bracket';

  // Derive the slug the backend will use
  const slug = bracketUrl
    .replace(/^https?:\/\/liquipedia\.net\/fighters\//i, '')
    .replace(/\/Bracket\/?$/i, '')
    .toLowerCase();

  if (alreadyImported.has(slug)) {
    skipped++;
    continue;
  }

  // process?.stdout?.write not available in browser — use console.log only
  console.log(`[${i+1}/${EVENT_URLS.length}] Fetching ${slug}...`);

  try {
    await sleep(DELAY_MS);
    const resp = await fetch(bracketUrl);

    if (!resp.ok) {
      console.log(`  ⏭️  No page (HTTP ${resp.status})`);
      noBracket++;
      continue;
    }

    const html = await resp.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');

    // Try new-style bracket first, fall back to legacy (.bracket-game) template
    let matches = parseBracket(doc);
    let parserUsed = 'new';
    if (matches.length === 0) {
      matches = parseLegacyBracket(doc);
      parserUsed = 'legacy';
    }

    if (matches.length === 0) {
      console.log(`  ⏭️  No bracket matches found`);
      noBracket++;
      continue;
    }

    const meta = extractMeta(doc, bracketUrl);
    console.log(`  🔍 ${matches.length} matches found [${parserUsed}] → "${meta.name || slug}" (${meta.date || 'no date'})`);

    const postResp = await fetch(`${BACKEND}/api/tournaments/import-liquipedia-bracket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bracketUrl,
        name:               meta.name,
        date:               meta.date,
        location:           null,           // not easily parseable from bracket page
        prize_pool:         meta.prize_pool,
        participants_count: meta.participants_count,
        matches,
      }),
    });

    if (!postResp.ok) {
      const err = await postResp.json().catch(() => ({}));
      console.error(`  ❌ Backend error: ${err.error || postResp.status}`);
      errors++;
      continue;
    }

    const result = await postResp.json();
    console.log(`  ✅ Imported: ${result.matches_imported} matches`);
    imported++;
    alreadyImported.add(slug); // prevent duplicate within same run

  } catch (e) {
    console.error(`  ❌ Error: ${e.message}`);
    errors++;
  }
}

console.log('\n──────────────────────────────────────');
console.log(`✅ Imported:    ${imported} brackets`);
console.log(`⏭️  No bracket:  ${noBracket} events (results-only pages)`);
console.log(`⏩ Skipped:     ${skipped} (already in DB)`);
console.log(`❌ Errors:      ${errors}`);
console.log('');
console.log('Run node recalculate_elo.js when done to reorder ELO chronologically.');

})();
