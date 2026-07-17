// In-game Group IDs are stored digits-only; the game shows no separators, but
// a 14-digit run is unreadable — chunk into threes for display (matches how
// the community writes them, e.g. "391 572 457 905 58").
export function formatGroupId(id) {
  return id ? String(id).replace(/(\d{3})(?=\d)/g, '$1 ') : '';
}
