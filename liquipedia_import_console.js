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
 * 5. Watch the console output — takes ~5-10 minutes for all 76 events
 *
 * HOW IT WORKS
 * ────────────
 * For each event in EVENT_URLS the script makes TWO same-origin fetches and
 * sends TWO POSTs to the Neos City backend:
 *
 *   1. main event page (e.g. .../Frosty_Faustings/PokkenDX)
 *        ↳ parse the Prize Pool / placements table on the page
 *        ↳ POST /api/tournaments/import-liquipedia-placements
 *          → canonical placements with proper tied ranks (5–6, 9–12, ...)
 *
 *   2. bracket sub-page (.../Frosty_Faustings/PokkenDX/Bracket)
 *        ↳ parse the .brkts-match / .bracket-game elements
 *        ↳ POST /api/tournaments/import-liquipedia-bracket
 *          → match list (drives ELO + Pass-2 achievements)
 *
 * The two endpoints both DELETE-then-INSERT the affected rows, so this is
 * idempotent — re-running cleanly overwrites whatever was there before.
 *
 * Why both passes are needed: the bracket parser was producing distinct
 * ranks for players who actually tied in the bracket (because the legacy
 * parser only stamps sequential DOM-order rounds, and the new parser was
 * falling back to that same DOM-order weight scheme). The Prize Pool table
 * on each main page is the canonical source for placements *with ties*; we
 * grab placements from there and let the bracket parser focus on what it's
 * good at, which is the match list.
 *
 * Safe to re-run. FORCE_REIMPORT below toggles the bracket-side skip-cache.
 * Placements always run regardless — the placements endpoint is fast and
 * the table doesn't change once a tournament is over.
 */

(async () => {

const BACKEND = 'http://localhost:3001';
const DELAY_MS = 800; // polite pause between Liquipedia fetches

// Set to true to re-import every event even if its liquipedia_url is already
// in the DB. Use this after running reset_bracket_placements.js (which wipes
// rank>2 placements but leaves the tournaments themselves in place — without
// FORCE_REIMPORT every event would be skipped on the second run).
const FORCE_REIMPORT = true;

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

// ── Place-string parsing ─────────────────────────────────────────────────────
//
// Liquipedia's placements column uses a small set of forms:
//   "1st", "2nd", "3rd"                    → single rank
//   "5th-6th", "9th-12th", "17th-24th"     → range; players in this row tie
//   "5th — 6th" (em-dash variant)          → same as above
// We always take the LOWEST rank in the range as the canonical placement,
// matching how tournament_placements.final_rank is stored elsewhere (top4
// counts everyone with final_rank ≤ 4, top8 counts ≤ 8, etc.). The detail
// page just renders "5th" for players tied at 5–6, which is fine.
function parsePlaceString(s) {
  if (!s) return null;
  // Strip "place" suffix words and trailing punctuation, normalise dashes
  const cleaned = s
    .replace(/–|—/g, '-')        // en-dash / em-dash → hyphen
    .replace(/place$/i, '')
    .replace(/[:.]+$/g, '')
    .trim();
  const m = cleaned.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

// ── Player-name extraction from a placements-table cell ──────────────────────
//
// The participant cell on Liquipedia's prizepool table mixes flag <span>s,
// pencil "edit" links for redlinked players, "Place N to M" expander
// affordances (same-page anchors that toggle hidden tiers), and the actual
// name link/text. Strategy:
//   1. Walk all <a> children, take the ones whose text looks like a name.
//   2. If no usable links (text-only entries), fall back to textContent.
//
// Filtering rules — every one of these has bitten us in practice on this DB:
//   • Flag-only links (single-char text, e.g. emoji flag)
//   • Redlink "edit" affordances ("[edit]" appears as link text "edit")
//   • Page-anchor expanders — Liquipedia renders a "place 9 to 24" link with
//     href="...#" that toggles hidden tiers via JS. The link sits ABOVE the
//     real placement rows, so filtering by text alone catches it; we also
//     reject any href that's a bare same-page anchor as belt-and-braces.
//   • The "place N to M" text variants Liquipedia actually uses include
//     non-breaking space (U+00A0) between "place" and the number, which is
//     why we use \s+ rather than a literal space in the test.
//   • TBD / TBA / TBC placeholders.
function extractPlayerNames(cell) {
  if (!cell) return [];
  const out = [];

  for (const a of cell.querySelectorAll('a')) {
    const txt = (a.textContent || '').replace(/ /g, ' ').trim();
    if (!txt) continue;
    if (txt.length < 2) continue;                          // flag-only links
    if (/^edit$/i.test(txt)) continue;
    if (/^place\s+\d+(\s+to\s+\d+)?\s*$/i.test(txt)) continue; // expander link
    const href = a.getAttribute('href') || '';
    if (href === '#' || /#$/.test(href)) continue;         // same-page anchor
    out.push(txt);
  }

  if (out.length === 0) {
    const raw = (cell.textContent || '').replace(/ /g, ' ').trim();
    for (const part of raw.split(/[,;\n]+/)) {
      const p = part.trim();
      if (!p) continue;
      if (/^TB[ADC]$/i.test(p)) continue;
      if (/^place\s+\d+(\s+to\s+\d+)?\s*$/i.test(p)) continue;
      out.push(p);
    }
  }

  // Drop duplicates (flag link + name link sometimes both yield the name)
  // and drop any placeholders that slipped through.
  return [...new Set(out)].filter(n =>
    n && !/^TB[ADC]$/i.test(n) && !/^place\s+\d+/i.test(n)
  );
}

// ── Locate the prize-pool / placements table on a tournament page ──────────
//
// Liquipedia changed templates over the years; we try the most reliable
// matchers first and fall through to a heuristic only as a last resort.
//   1. Modern: .prizepooltable / .csstable-widget grid (post-2020 events)
//   2. Wikitable: <table class="wikitable"> with a placement-shaped first cell
//   3. Heuristic: any container holding "1st" + "2nd" siblings
// Returns { rows: [[placeText, participantCell], ...], strategy: <name> }.
// Strategies that yield <2 rows are rejected so the heuristic doesn't fire
// on infobox stubs that happen to contain the word "1st".
function findPlacementRows(doc) {
  // Strategy 1 — modern prizepool widget
  //
  // ACTUAL per-row layout on contemporary Liquipedia tournament pages
  // (verified May 2026 against FF XVIII / Vortex_Gallery 2026):
  //   <div class="csstable-widget-row">
  //     <div class="csstable-widget-cell prizepooltable-place">5th-6th</div>
  //     <div class="csstable-widget-cell">$0</div>
  //     <div class="csstable-widget-cell">-</div>
  //     <div class="csstable-widget-cell">                          ← player 1
  //       <div class="block-players-wrapper">
  //         <div class="block-player has-team">
  //           <span class="flag">…</span>
  //           <span class="name name"><a href="/fighters/Mins">Mins</a></span>
  //         </div>
  //         <span class="race"><img alt="…" /></span>      ← character icon
  //       </div>
  //     </div>
  //     <div class="csstable-widget-cell">                          ← player 2
  //       <div class="block-players-wrapper">…<a href="/fighters/Rina_the_Stampede">…</a>…</div>
  //     </div>
  //     ... one extra .csstable-widget-cell per tied player
  //   </div>
  //
  // So tied tiers are encoded as N+3 top-level cells on a single row, NOT one
  // wrapper cell with N players inside. Cell counts observed:
  //   solo (1st-4th): 4 cells   → 1 player
  //   2-way tie:      5 cells   → 2 players
  //   4-way tie:      7 cells   → 4 players
  //   8-way tie:     11 cells   → 8 players
  //
  // Earlier comment claimed the structure was "one cell wrapping every player"
  // and the fix was `cells[cells.length-1]`. That comment was wrong; picking
  // the last cell still loses every tied player except one (the last). The
  // correct fix is to gather every cell on the row that contains a
  // `.block-player` and feed all of them through extractPlayerNames.
  const modern = doc.querySelector('.prizepooltable, .csstable-widget');
  if (modern) {
    const rows = modern.querySelectorAll('.csstable-widget-row, .prizepoolrowcontent, tr');
    const out = [];
    for (const row of rows) {
      if (row.matches('.prizepoolrowtitle, thead tr')) continue;
      const cells = row.querySelectorAll(':scope > .csstable-widget-cell, :scope > td, :scope > .prizepoolrowcontent > div');
      if (cells.length < 2) continue;
      const placeCell = row.querySelector('.placement-text, [class*="placement"]') || cells[0];
      const placeText = (placeCell?.textContent || '').trim();
      if (!placeText) continue;
      // Gather EVERY cell on the row that contains a player block — tied tiers
      // render each player as a separate top-level .csstable-widget-cell, so
      // we'd lose all but one if we only looked at cells[length-1]. Wrap the
      // collected cells into a synthetic <div> so the existing extractor API
      // (which takes a single cell) keeps working: it'll see every <a> in one
      // querySelectorAll('a') sweep. Falls back to the last cell for legacy
      // tables that don't use .block-player wrappers.
      const cellsArr = Array.from(cells);
      const playerCells = cellsArr.filter(c => c.querySelector('.block-player, .block-players-wrapper'));
      let participantCell;
      if (playerCells.length === 0) {
        participantCell = cells[cells.length - 1];
      } else if (playerCells.length === 1) {
        participantCell = playerCells[0];
      } else {
        participantCell = doc.createElement('div');
        for (const c of playerCells) participantCell.appendChild(c.cloneNode(true));
      }
      out.push([placeText, participantCell]);
    }
    if (out.length >= 2) return { rows: out, strategy: 'modern' };
  }

  // Strategy 2 — generic wikitable (older pages)
  for (const tbl of doc.querySelectorAll('table.wikitable, table.wikitable-striped')) {
    const out = [];
    for (const tr of tbl.querySelectorAll('tbody > tr, tr')) {
      const cells = tr.querySelectorAll('td, th');
      if (cells.length < 2) continue;
      const placeText = (cells[0].textContent || '').trim();
      if (!parsePlaceString(placeText)) continue;
      // Pick the cell most likely to hold names — last cell with link/letters
      let participantCell = null;
      for (let k = cells.length - 1; k >= 1; k--) {
        const c = cells[k];
        if (c.querySelector('a') || /[A-Za-z]/.test(c.textContent)) {
          participantCell = c;
          break;
        }
      }
      if (!participantCell) participantCell = cells[cells.length - 1];
      out.push([placeText, participantCell]);
    }
    if (out.length >= 2) return { rows: out, strategy: 'wikitable' };
  }

  // Strategy 3 — heuristic walk (rarely used)
  const candidates = [...doc.querySelectorAll('div, tr')]
    .filter(el => /^\s*1st\b/i.test(el.textContent || '')
                && /2nd\b/i.test(el.parentNode?.textContent || ''));
  if (candidates.length > 0) {
    const parent = candidates[0].parentNode;
    const rows = [];
    for (const child of parent.children) {
      const txt = (child.textContent || '').trim();
      const place = parsePlaceString(txt.split(/\s/)[0]);
      if (!place) continue;
      rows.push([txt.split(/\s/)[0], child]);
    }
    if (rows.length >= 2) return { rows, strategy: 'heuristic' };
  }

  return { rows: [], strategy: 'none' };
}

// ── Reduce raw [placeText, cell] rows into [{rank, players}] groups ────────
//
// Two normalisations:
//   1. One row with multiple participants in a single cell (e.g. "5th-6th"
//      with two names in one td)         → one group with players: [a, b]
//   2. Multiple consecutive rows with the same parsed rank
//      (each row carries one participant)  → fold them into one group
function reducePlacements(rawRows) {
  const out = [];
  for (const [placeText, cell] of rawRows) {
    const rank = parsePlaceString(placeText);
    if (!rank) continue;
    const players = extractPlayerNames(cell);
    if (players.length === 0) continue;

    const last = out[out.length - 1];
    if (last && last.rank === rank) {
      for (const p of players) if (!last.players.includes(p)) last.players.push(p);
    } else {
      out.push({ rank, players: [...new Set(players)] });
    }
  }
  return out;
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
console.log('🏆 Neos City — Liquipedia Importer (matches + canonical placements)');
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
//
// Drives the FORCE_REIMPORT skip path for the BRACKET fetch only. Placements
// always run, regardless of whether the bracket has been imported before —
// the placements table is small, the request is cheap, and re-running it is
// the only way to fix events that landed under the old broken bracket parser.
let alreadyImported = new Set();
try {
  const resp = await fetch(`${BACKEND}/api/tournaments?is_offline=true`);
  const rows = await resp.json();
  // Stored URLs may be lowercased (legacy) or canonical-case (post-fix); normalize
  // for the FORCE_REIMPORT skip check so casing differences don't cause re-fetches.
  alreadyImported = new Set(rows.map(r => r.liquipedia_url).filter(Boolean).map(s => s.toLowerCase()));
  console.log(`ℹ️  Already imported: ${alreadyImported.size} brackets\n`);
} catch (e) { /* ignore */ }

// ── Main loop ─────────────────────────────────────────────────────────────────
//
// For each event we fetch BOTH the main page and the /Bracket sub-page. The
// main page carries the canonical Prize Pool / placements table (with proper
// ties); /Bracket carries the match data we need for ELO and Pass-2
// achievements. The two POSTs are independent on the backend — bracket POST
// writes matches + provisional placements, placements POST overwrites those
// with the canonical ranks. Running both per event is what gives us correct
// data on re-imports.
let bracketImported = 0, bracketSkipped = 0, bracketMissing = 0, bracketErrors = 0;
let placementsImported = 0, placementsMissing = 0, placementsErrors = 0;

for (let i = 0; i < EVENT_URLS.length; i++) {
  const eventUrl   = EVENT_URLS[i];
  const bracketUrl = eventUrl + '/Bracket';

  // Slug the backend uses to look up the tournament. Same normalisation in
  // liquipediaUrlToSlug on the backend — keeping these in sync matters so a
  // re-run hits the same row. Case is preserved (Liquipedia is case-sensitive
  // when used as a URL); the alreadyImported lookup below normalises both sides.
  const slug = bracketUrl
    .replace(/^https?:\/\/liquipedia\.net\/fighters\//i, '')
    .replace(/\/Bracket\/?$/i, '');

  console.log(`\n[${i + 1}/${EVENT_URLS.length}] ${slug}`);

  // ── Pass 1: main page → placements table ──────────────────────────────────
  let mainMeta = null;
  try {
    await sleep(DELAY_MS);
    const resp = await fetch(eventUrl);
    if (!resp.ok) {
      console.log(`  ⏭️  Main page HTTP ${resp.status}, skipping placements`);
      placementsMissing++;
    } else {
      const html = await resp.text();
      const doc  = new DOMParser().parseFromString(html, 'text/html');
      mainMeta = extractMeta(doc, eventUrl);

      const { rows: rawRows, strategy } = findPlacementRows(doc);
      const placements = reducePlacements(rawRows);

      if (placements.length === 0) {
        console.log(`  ⏭️  No placements table found on main page`);
        placementsMissing++;
      } else {
        const summary = placements.slice(0, 4).map(g => `${g.rank}=${g.players.length}p`).join(', ');
        console.log(`  📋 placements [${strategy}]: ${placements.length} groups (${summary}${placements.length > 4 ? ', ...' : ''})`);

        const postResp = await fetch(`${BACKEND}/api/tournaments/import-liquipedia-placements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventUrl,
            name:               mainMeta.name,
            date:               mainMeta.date,
            location:           null,
            prize_pool:         mainMeta.prize_pool,
            participants_count: mainMeta.participants_count,
            placements,
          }),
        });

        if (!postResp.ok) {
          const err = await postResp.json().catch(() => ({}));
          console.error(`  ❌ Placements backend error: ${err.error || postResp.status}`);
          placementsErrors++;
        } else {
          const result = await postResp.json();
          console.log(`  ✅ ${result.placements_inserted} placements written`);
          placementsImported++;
        }
      }
    }
  } catch (e) {
    console.error(`  ❌ Placements fetch error: ${e.message}`);
    placementsErrors++;
  }

  // ── Pass 2: /Bracket sub-page → matches ───────────────────────────────────
  // Skip cache only applies to the bracket pass. Placements ran above, which
  // is the part that was previously broken — it's the side we want to refresh
  // unconditionally on every run.
  if (alreadyImported.has(slug.toLowerCase()) && !FORCE_REIMPORT) {
    bracketSkipped++;
    console.log(`  ⏩ Bracket already in DB — skipping match fetch`);
    continue;
  }

  try {
    await sleep(DELAY_MS);
    const resp = await fetch(bracketUrl);
    if (!resp.ok) {
      console.log(`  ⏭️  Bracket HTTP ${resp.status}, no match data`);
      bracketMissing++;
      continue;
    }

    const html = await resp.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');

    let matches = parseBracket(doc);
    let parserUsed = 'new';
    if (matches.length === 0) {
      matches = parseLegacyBracket(doc);
      parserUsed = 'legacy';
    }

    if (matches.length === 0) {
      console.log(`  ⏭️  No bracket matches found`);
      bracketMissing++;
      continue;
    }

    // Reuse the metadata grabbed off the main page when available; the
    // bracket sub-page often has thinner infobox content (no prize pool,
    // no entrant count). Only fall back to the bracket doc if the main
    // fetch failed.
    const bracketMeta = mainMeta || extractMeta(doc, bracketUrl);
    console.log(`  ⚔️  bracket [${parserUsed}]: ${matches.length} matches → "${bracketMeta.name || slug}" (${bracketMeta.date || 'no date'})`);

    const postResp = await fetch(`${BACKEND}/api/tournaments/import-liquipedia-bracket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bracketUrl,
        name:               bracketMeta.name,
        date:               bracketMeta.date,
        location:           null,
        prize_pool:         bracketMeta.prize_pool,
        participants_count: bracketMeta.participants_count,
        matches,
      }),
    });

    if (!postResp.ok) {
      const err = await postResp.json().catch(() => ({}));
      console.error(`  ❌ Bracket backend error: ${err.error || postResp.status}`);
      bracketErrors++;
      continue;
    }

    const result = await postResp.json();
    console.log(`  ✅ ${result.matches_imported} matches written`);
    bracketImported++;
    alreadyImported.add(slug); // suppress duplicates within this run
  } catch (e) {
    console.error(`  ❌ Bracket fetch error: ${e.message}`);
    bracketErrors++;
  }
}

console.log('\n──────────────────────────────────────');
console.log('Placements (canonical, from main page)');
console.log(`  ✅ Imported:    ${placementsImported}`);
console.log(`  ⏭️  No table:    ${placementsMissing}`);
console.log(`  ❌ Errors:      ${placementsErrors}`);
console.log('Brackets (matches, from /Bracket sub-page)');
console.log(`  ✅ Imported:    ${bracketImported}`);
console.log(`  ⏭️  No bracket:  ${bracketMissing}`);
console.log(`  ⏩ Skipped:     ${bracketSkipped} (already in DB; set FORCE_REIMPORT = true to refresh)`);
console.log(`  ❌ Errors:      ${bracketErrors}`);
console.log('');
console.log('Run `node recalculate_elo.js` when done so achievements + ELO pick up the canonical placements.');

})();
