// In-game Group IDs are stored digits-only; the game shows no separators, but
// a 14-digit run is unreadable — chunk into threes for display (matches how
// the community writes them, e.g. "391 572 457 905 58").
export function formatGroupId(id) {
  return id ? String(id).replace(/(\d{3})(?=\d)/g, '$1 ') : '';
}

// Group search (mirrors the players name search): case-insensitive name
// substring, OR digit-substring against the in-game ID — so "391 572" and
// "39157" both find Neos City 1. Empty query matches everything.
export function matchesGroupQuery(g, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  if ((g.name || '').toLowerCase().includes(q)) return true;
  const qDigits = q.replace(/\D/g, '');
  return qDigits.length > 0 && (g.ingame_id || '').includes(qDigits);
}
