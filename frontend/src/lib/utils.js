export function getRankLabel(elo) {
  if (elo >= 2000) return { label: 'Master', class: 'rank-master', icon: '💎' };
  if (elo >= 1800) return { label: 'Gold',   class: 'rank-gold',   icon: '🥇' };
  if (elo >= 1600) return { label: 'Silver', class: 'rank-silver', icon: '🥈' };
  if (elo >= 1400) return { label: 'Bronze', class: 'rank-bronze', icon: '🥉' };
  return { label: 'Unranked', class: 'rank-unranked', icon: '⚔️' };
}

export function winRate(wins, losses) {
  const total = wins + losses;
  if (total === 0) return '—';
  return `${Math.round((wins / total) * 100)}%`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
