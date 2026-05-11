import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTournament } from '../lib/api';
import { formatDate } from '../lib/utils';
import AchievementIcon from '../components/AchievementIcon';

// Visual treatment for the top of the bracket. Anything past 8th falls
// through to the muted "other" style.
function rankStyle(rank, partialTopN) {
  if (rank == null) {
    // Partial bracket — the still-alive players are the unrevealed top N.
    if (partialTopN > 0) {
      return { medal: '🔒', tint: 'text-amber-300', label: `Top ${partialTopN}` };
    }
    return { medal: '·', tint: 'text-slate-500', label: '—' };
  }
  if (rank === 1)    return { medal: '🥇', tint: 'text-yellow-300', label: '1st' };
  if (rank === 2)    return { medal: '🥈', tint: 'text-slate-200',  label: '2nd' };
  if (rank === 3)    return { medal: '🥉', tint: 'text-amber-400',  label: '3rd' };
  if (rank <= 4)     return { medal: '🏅', tint: 'text-cyan-300',   label: `${rank}th` };
  if (rank <= 8)     return { medal: '⭐', tint: 'text-teal-300',   label: `${rank}th` };
  return { medal: '·', tint: 'text-slate-500', label: `${rank}th` };
}

const CATEGORY_ORDER = [
  'lifetime', 'series', 'meta', 'global', 'matchup', 'placement', 'streak', 'milestone', 'other',
];
const CATEGORY_NAMES = {
  lifetime:   'Lifetime',
  series:     'Series',
  meta:       'Meta',
  global:     'Global',
  matchup:    'Matchups',
  placement:  'Placements',
  streak:     'Streaks',
  milestone:  'Milestones',
  other:      'Other',
};

export default function TournamentDetail() {
  const { id } = useParams();
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTournament(id).then(setTournament).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-slate-400">Loading...</p>;
  if (!tournament) return <p className="text-red-400">Tournament not found.</p>;

  const isPartial = tournament.is_partial === true;

  const placements = (tournament.placements || []).slice().sort((a, b) => {
    // Partial brackets put the unrevealed top-N (final_rank=null) at the top.
    // Finalized brackets keep them at the bottom (the legacy fallback for any
    // stray null we couldn't resolve).
    if (a.final_rank == null && b.final_rank == null) {
      return (a.display_name || '').localeCompare(b.display_name || '');
    }
    if (a.final_rank == null) return isPartial ? -1 : 1;
    if (b.final_rank == null) return isPartial ? 1 : -1;
    return a.final_rank - b.final_rank;
  });

  const partialTopN = isPartial
    ? placements.filter(p => p.final_rank == null).length
    : 0;

  const achievements = tournament.achievements || [];
  const isOffline = tournament.is_offline === true;

  // Build a Liquipedia link for offline events. Bracket-imported records have a
  // canonical path in `liquipedia_url`; offline_import.js records only have the
  // internal `liquipedia_slug` identifier, so we fall back to the main Pokkén
  // tournaments listing rather than a broken deep link.
  const liquipediaHref = tournament.liquipedia_url
    ? `https://liquipedia.net/fighters/${tournament.liquipedia_url}`
    : 'https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament/Tournaments';

  // Group achievements by player so the UI reads "this player earned X, Y, Z
  // here" rather than a flat undifferentiated list.
  const byPlayer = new Map();
  for (const a of achievements) {
    if (!byPlayer.has(a.player_id)) {
      byPlayer.set(a.player_id, { player_id: a.player_id, player_name: a.player_name, items: [] });
    }
    byPlayer.get(a.player_id).items.push(a);
  }
  // Order players by their finish at this tournament (best rank first), so
  // the winner's achievements appear at the top.
  const rankByPlayerId = new Map(placements.map(p => [p.player_id, p.final_rank ?? 9999]));
  const playerGroups = Array.from(byPlayer.values()).sort((a, b) => {
    const ra = rankByPlayerId.get(a.player_id) ?? 9999;
    const rb = rankByPlayerId.get(b.player_id) ?? 9999;
    if (ra !== rb) return ra - rb;
    return (a.player_name || '').localeCompare(b.player_name || '');
  });

  return (
    <div className="space-y-8">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="font-display text-2xl text-white tracking-wide">{tournament.name}</h1>
        <p className="text-slate-500 text-sm mt-1">
          {[
            tournament.participants_count != null && `${tournament.participants_count} participants`,
            isOffline ? 'offline' : tournament.tournament_type,
            isOffline && tournament.location,
            isOffline && tournament.prize_pool && `prize ${tournament.prize_pool}`,
            formatDate(tournament.completed_at),
          ].filter(Boolean).join(' · ')}
        </p>
        {tournament.challonge_url && (
          <a
            href={tournament.challonge_url}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-400 text-xs hover:underline mt-1 inline-block"
          >
            View on Challonge ↗
          </a>
        )}
        {isOffline && (
          <a
            href={liquipediaHref}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-400 text-xs hover:underline mt-1 inline-block"
          >
            View on Liquipedia ↗
          </a>
        )}
      </div>

      {/* ── Partial-bracket banner ────────────────────────────────────────── */}
      {isPartial && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="font-display tracking-wider text-amber-300">
            🔒 TOP {partialTopN || 'N'} UNREVEALED
          </span>
          <span className="ml-2 text-amber-200/80">
            The organizer hasn't streamed the final results yet — placements below {partialTopN ? partialTopN : ''} are derived from the bracket.
          </span>
        </div>
      )}

      {/* ── Placements ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-3">PLACEMENTS</h2>
        {placements.length === 0 ? (
          <p className="text-slate-500 text-sm">No placement data on file.</p>
        ) : (
          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a2744] text-slate-500 text-xs font-display tracking-wider">
                  <th className="px-4 py-3 text-left w-20">RANK</th>
                  <th className="px-4 py-3 text-left">PLAYER</th>
                </tr>
              </thead>
              <tbody>
                {placements.map(p => {
                  const s = rankStyle(p.final_rank, partialTopN);
                  return (
                    <tr key={p.player_id} className="border-b border-[#1a2744] last:border-0 hover:bg-white/5 transition-colors">
                      <td className={`px-4 py-3 font-display tracking-wider ${s.tint}`}>
                        <span className="mr-2">{s.medal}</span>{s.label}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/players/${p.player_id}`}
                          className="text-white font-medium hover:text-cyan-400"
                        >
                          {p.display_name}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Achievements earned here ──────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-3">
          ACHIEVEMENTS EARNED
          {achievements.length > 0 && (
            <span className="ml-2 text-xs text-slate-600 normal-case">({achievements.length})</span>
          )}
        </h2>

        {achievements.length === 0 ? (
          <p className="text-slate-500 text-sm">
            No achievements were unlocked at this tournament.
          </p>
        ) : (
          <div className="space-y-4">
            {playerGroups.map(group => {
              // Sort each player's achievements by category so related
              // unlocks (e.g. all series achievements) cluster together.
              const sorted = group.items.slice().sort((a, b) => {
                const ai = CATEGORY_ORDER.indexOf(a.category);
                const bi = CATEGORY_ORDER.indexOf(b.category);
                const aRank = ai === -1 ? CATEGORY_ORDER.length : ai;
                const bRank = bi === -1 ? CATEGORY_ORDER.length : bi;
                if (aRank !== bRank) return aRank - bRank;
                return (a.name || '').localeCompare(b.name || '');
              });
              const finishRank = rankByPlayerId.get(group.player_id);
              const finish = finishRank && finishRank !== 9999 ? rankStyle(finishRank, partialTopN) : null;

              return (
                <div
                  key={group.player_id}
                  className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-4"
                >
                  <div className="flex items-baseline justify-between mb-3">
                    <Link
                      to={`/players/${group.player_id}`}
                      className="text-white font-medium hover:text-cyan-400"
                    >
                      {group.player_name}
                    </Link>
                    {finish && (
                      <span className={`text-xs font-display tracking-wider ${finish.tint}`}>
                        {finish.medal} {finish.label}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {sorted.map(a => (
                      <div
                        key={a.achievement_id}
                        className="flex items-center gap-3 p-2 rounded-lg bg-white/5 group relative"
                        title={a.description}
                      >
                        <AchievementIcon
                          icon={a.icon}
                          regionFromId={a.achievement_id}
                          size="md"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{a.name}</p>
                          <p className="text-[10px] text-slate-600">
                            {CATEGORY_NAMES[a.category] || a.category}
                          </p>
                        </div>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 max-w-xs">
                          {a.description}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
