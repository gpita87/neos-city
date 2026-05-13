import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPlayer } from '../lib/api';
import { formatDate } from '../lib/utils';
import AchievementTournamentsModal from '../components/AchievementTournamentsModal';
import OfflinePlacementsModal from '../components/OfflinePlacementsModal';
import AchievementIcon, { REGION_NUMERALS } from '../components/AchievementIcon';

const REGION_LABELS = {
  kanto: 'Kanto', johto: 'Johto', hoenn: 'Hoenn', sinnoh: 'Sinnoh',
  unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea',
};

const REGION_COLORS = {
  kanto: 'bg-red-900/30 text-red-400 border-red-800/50',
  johto: 'bg-purple-900/30 text-purple-400 border-purple-800/50',
  hoenn: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50',
  sinnoh: 'bg-blue-900/30 text-blue-400 border-blue-800/50',
  unova: 'bg-slate-700/30 text-slate-300 border-slate-600/50',
  kalos: 'bg-sky-900/30 text-sky-400 border-sky-800/50',
  alola: 'bg-orange-900/30 text-orange-400 border-orange-800/50',
  galar: 'bg-pink-900/30 text-pink-400 border-pink-800/50',
  paldea: 'bg-fuchsia-900/30 text-fuchsia-400 border-fuchsia-800/50',
};

// Group achievements by category for display
function groupAchievements(achievements) {
  const groups = {};
  for (const a of achievements) {
    const cat = a.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(a);
  }
  return groups;
}

const CATEGORY_ORDER = [
  'placement', 'participation', 'match', 'meta', 'special',
  'series_ffc', 'series_rtg_na', 'series_rtg_eu', 'series_dcm',
  'series_tcc', 'series_eotr', 'series_nezumi', 'series_ha',
];

const SERIES_BADGE = {
  ffc:             { name: 'FFC',        cls: 'bg-purple-900/40 text-purple-300 border-purple-700/50' },
  rtg_na:          { name: 'RTG NA',     cls: 'bg-blue-900/40 text-blue-300 border-blue-700/50' },
  rtg_eu:          { name: 'RTG EU',     cls: 'bg-green-900/40 text-green-300 border-green-700/50' },
  dcm:             { name: 'DCM',        cls: 'bg-orange-900/40 text-orange-300 border-orange-700/50' },
  tcc:             { name: 'TCC',        cls: 'bg-pink-900/40 text-pink-300 border-pink-700/50' },
  eotr:            { name: 'EOTR',       cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50' },
  nezumi:          { name: 'ねずみ杯',    cls: 'bg-rose-900/40 text-rose-300 border-rose-700/50' },
  nezumi_rookies:  { name: 'Rookies',    cls: 'bg-amber-900/40 text-amber-300 border-amber-700/50' },
  ha:              { name: "Heaven's Arena", cls: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/50' },
  worlds:          { name: 'Worlds',     cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50' },
  major:           { name: 'Major',      cls: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/50' },
  regional:        { name: 'Regional',   cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' },
  other:           { name: 'Local',      cls: 'bg-slate-800/40 text-slate-400 border-slate-600/50' },
};

const PLACEMENT_ICONS = ['', '🥇', '🥈', '🥉'];

function rankLabel(rank) {
  if (rank == null) return '—';
  if (rank <= 3) return PLACEMENT_ICONS[rank];
  if (rank <= 4) return '4th';
  if (rank <= 8) return `${rank}th`;
  return `${rank}`;
}

function rankTint(rank) {
  if (rank === 1) return 'text-yellow-400';
  if (rank === 2) return 'text-slate-300';
  if (rank === 3) return 'text-amber-600';
  if (rank != null && rank <= 8) return 'text-slate-400';
  return 'text-slate-600';
}

const CATEGORY_NAMES = {
  placement: 'Placement',
  participation: 'Participation',
  match: 'Match',
  meta: 'Meta',
  special: 'Special',
  series_ffc: 'FFC',
  series_rtg_na: 'RTG NA',
  series_rtg_eu: 'RTG EU',
  series_dcm: 'DCM',
  series_tcc: 'TCC',
  series_eotr: 'EOTR',
  series_nezumi: 'ねずみ杯',
  series_ha: "Heaven's Arena",
};

function RegionTierDisplay({ highestRegions }) {
  if (!highestRegions) return null;
  const tiers = [
    { key: 'gym_leader', icon: '🏟️', name: 'Gym Leader' },
    { key: 'elite_four', icon: '4️⃣', name: 'Elite Four' },
    { key: 'rival',      icon: '🔥', name: 'Rival' },
    { key: 'champion',   icon: '👑', name: 'Champion' },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {tiers.map(t => {
        const region = highestRegions[t.key];
        if (!region) return null;
        const colorClass = REGION_COLORS[region] || 'bg-white/5 text-slate-400';
        return (
          <span
            key={t.key}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${colorClass}`}
            title={`${REGION_LABELS[region]} ${t.name} (${REGION_NUMERALS[region]}) — achieved ${t.name.toLowerCase()} placement enough times to reach the ${REGION_LABELS[region]} tier`}
          >
            <AchievementIcon icon={t.icon} region={region} size="sm" />
            <span>{REGION_LABELS[region]} {t.name}</span>
          </span>
        );
      })}
    </div>
  );
}

export default function PlayerProfile() {
  const { id } = useParams();
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openAchievement, setOpenAchievement] = useState(null);
  // { tier: 'major', placement: 'top8' } when an offline-record cell is clicked
  const [openOfflineCell, setOpenOfflineCell] = useState(null);

  useEffect(() => {
    getPlayer(id).then(setPlayer).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-slate-400">Loading...</p>;
  if (!player) return <p className="text-red-400">Player not found.</p>;

  const achGroups = groupAchievements(player.achievements || []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6 flex items-center gap-6">
        {player.avatar_url ? (
          <img
            src={player.avatar_url}
            alt={player.display_name}
            className="w-16 h-16 rounded-full object-cover bg-slate-800 border border-[#1a2744]"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-cyan-500/20 flex items-center justify-center text-3xl">
            ⚔️
          </div>
        )}
        <div className="flex-1">
          <h1 className="font-display text-2xl text-white tracking-wide">{player.display_name}</h1>
          <p className="text-slate-500 text-sm">@{player.challonge_username}</p>
          {player.highest_regions && (
            <div className="mt-2">
              <RegionTierDisplay highestRegions={player.highest_regions} />
            </div>
          )}
        </div>
      </div>

      {/* Recent Tournaments */}
      {(player.recent_tournaments?.length > 0 || player.tournaments_entered > 0) && (
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-sm tracking-widest text-cyan-400">RECENT TOURNAMENTS</h2>
            <span className="text-xs text-slate-500">
              <span className="text-white font-bold">{player.tournaments_entered}</span> events total
            </span>
          </div>
          <div className="space-y-1.5">
            {player.recent_tournaments?.map(t => {
              const badge = SERIES_BADGE[t.series] || { name: t.is_offline ? 'Offline' : 'Online', cls: 'bg-slate-800/40 text-slate-400 border-slate-600/50' };
              const date = t.completed_at || t.started_at;
              return (
                <Link
                  key={t.id}
                  to={`/tournaments/${t.id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className={`w-10 text-center text-sm font-bold ${rankTint(t.final_rank)}`}>
                    {rankLabel(t.final_rank)}
                  </span>
                  <span className={`shrink-0 px-2 py-0.5 rounded border text-[10px] font-display tracking-wider ${badge.cls}`}>
                    {badge.name}
                  </span>
                  <span className="flex-1 text-sm text-white truncate">{t.name}</span>
                  {t.participants_count != null && (
                    <span className="text-xs text-slate-500 shrink-0">{t.participants_count}p</span>
                  )}
                  <span className="text-xs text-slate-600 shrink-0 w-20 text-right">{formatDate(date)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Offline Stats — per-tier breakdown */}
      {(player.offline_score > 0) && (
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-sm tracking-widest text-amber-400">OFFLINE RECORD</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs font-display tracking-wider border-b border-[#1a2744]">
                  <th className="px-3 py-2 text-left">TIER</th>
                  <th className="px-3 py-2 text-center">1ST</th>
                  <th className="px-3 py-2 text-center">2ND</th>
                  <th className="px-3 py-2 text-center">TOP 4</th>
                  <th className="px-3 py-2 text-center">TOP 8</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Worlds', icon: '🌍', key: 'worlds', color: 'text-yellow-400' },
                  { label: 'Majors', icon: '🏟️', key: 'major', color: 'text-cyan-400' },
                  { label: 'Regionals', icon: '🗺️', key: 'regional', color: 'text-emerald-400' },
                  { label: 'Locals', icon: '📍', key: 'other', color: 'text-slate-400' },
                ].map(tier => {
                  const wins = player[`offline_${tier.key}_wins`] || 0;
                  const ru   = player[`offline_${tier.key}_runner_up`] || 0;
                  const top4 = player[`offline_${tier.key}_top4`] || 0;
                  const top8 = player[`offline_${tier.key}_top8`] || 0;
                  if (wins + ru + top4 + top8 === 0) return null;
                  // Each non-zero numeric cell becomes a button that opens the
                  // OfflinePlacementsModal scoped to that tier × placement.
                  const cell = (count, placementKey, valueClass) => (
                    count > 0 ? (
                      <button
                        type="button"
                        onClick={() => setOpenOfflineCell({ tier: tier.key, placement: placementKey })}
                        className={`${valueClass} underline decoration-dotted decoration-slate-600 underline-offset-2 hover:decoration-current hover:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded px-1 transition-colors`}
                        title="Show contributing tournaments"
                      >
                        {count}
                      </button>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )
                  );
                  return (
                    <tr key={tier.key} className="border-b border-[#1a2744]/50 hover:bg-white/5">
                      <td className={`px-3 py-2.5 font-medium ${tier.color}`}>
                        <span className="mr-1.5">{tier.icon}</span>{tier.label}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {cell(wins, 'wins', 'text-yellow-400 font-bold')}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {cell(ru, 'runner_up', 'text-slate-300 font-bold')}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {cell(top4, 'top4', 'text-slate-300')}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {cell(top8, 'top8', 'text-slate-300')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ELO chart hidden — ELO is kept internal */}

      {/* Achievements */}
      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
        <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-4">
          ACHIEVEMENTS ({player.achievements?.length ?? 0})
        </h2>

        {player.achievements?.length === 0 && (
          <p className="text-slate-500 text-sm">No achievements yet.</p>
        )}

        {/* Show grouped achievements */}
        {CATEGORY_ORDER.filter(cat => achGroups[cat]?.length > 0).map(cat => (
          <div key={cat} className="mb-4 last:mb-0">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">
              {CATEGORY_NAMES[cat] || cat}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {achGroups[cat].map(a => (
                <button
                  type="button"
                  key={a.achievement_id}
                  onClick={() => setOpenAchievement({
                    id: a.achievement_id,
                    name: a.name,
                    description: a.description,
                    icon: a.icon,
                    category: a.category,
                  })}
                  className="flex items-center gap-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 group relative text-left transition-colors"
                  title="Click to see contributing tournaments"
                >
                  <AchievementIcon icon={a.icon} regionFromId={a.achievement_id} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{a.name}</p>
                    <p className="text-[10px] text-slate-600">{formatDate(a.unlocked_at)}</p>
                  </div>
                  {/* Hover tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    {a.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Meta-achievement progress */}
        {player.meta_progress && Object.keys(player.meta_progress).length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#1a2744]">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">
              PROGRESS
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.entries(player.meta_progress)
                .filter(([, v]) => v.current > 0)
                .sort(([, a], [, b]) => (b.current / b.required) - (a.current / a.required))
                .slice(0, 8) // Show top 8 closest-to-completion
                .map(([achId, { current, required }]) => {
                  // Parse the achievement name from the ID
                  const parts = achId.split('_');
                  const region = parts[parts.length - 1];
                  const type = achId.startsWith('eight_badges_')   ? '8 Badges!'
                             : achId.startsWith('elite_trainer_')  ? 'Elite Trainer'
                             : achId.startsWith('rival_battle_')   ? 'Rival Battle!'
                             : achId.startsWith('smell_ya_later_') ? 'Smell Ya Later!'
                             : achId.startsWith('foreshadowing_')  ? 'Foreshadowing'
                             : achId.startsWith('dark_horse_')     ? 'Dark Horse'
                             : achId;
                  const pct = Math.round((current / required) * 100);
                  const regionLabel = REGION_LABELS[region] || region;

                  return (
                    <div key={achId} className="p-2.5 rounded-lg bg-white/5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-300">
                          {regionLabel} {type}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {current}/{required}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-400 rounded-full transition-all"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Head to Head */}
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
          <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-4 flex items-center gap-2">
            HEAD TO HEAD
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-700 text-slate-300 text-[10px] font-sans cursor-help"
              title="Top 20 most-played opponents across all completed matches. Sorted by total matches played together (highest first)."
            >
              ?
            </span>
          </h2>
          <div className="space-y-2">
            {player.h2h?.length === 0 && (
              <p className="text-slate-500 text-sm">No head-to-head data yet.</p>
            )}
            {player.h2h?.map(h => (
              <Link
                key={h.opponent_id}
                to={`/players/${h.opponent_id}`}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <span className="flex-1 text-sm font-medium text-white">{h.opponent_name}</span>
                <span className="text-green-400 text-sm font-bold">{h.wins}W</span>
                <span className="text-slate-500 text-sm">–</span>
                <span className="text-red-400 text-sm font-bold">{h.losses}L</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Matches */}
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
          <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-4">RECENT MATCHES</h2>
          <div className="space-y-2">
            {player.recent_matches?.map(m => {
              const isP1 = m.player1_id === player.id;
              const won = m.winner_id === player.id;
              const opponent = isP1 ? m.player2_name : m.player1_name;
              const opponentId = isP1 ? m.player2_id : m.player1_id;
              const myScore = isP1 ? m.player1_score : m.player2_score;
              const theirScore = isP1 ? m.player2_score : m.player1_score;
              return (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg text-sm">
                  <span className={`w-12 text-xs font-bold text-center px-2 py-0.5 rounded ${won ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                    {won ? 'WIN' : 'LOSS'}
                  </span>
                  <span className="flex-1">
                    vs <Link to={`/players/${opponentId}`} className="text-white hover:text-cyan-400">{opponent}</Link>
                  </span>
                  {myScore != null && (
                    <span className="text-slate-400 font-display text-xs">{myScore}–{theirScore}</span>
                  )}
                  <span className="text-xs text-slate-600">{m.tournament_name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Achievement -> Tournaments modal */}
      {openAchievement && (
        <AchievementTournamentsModal
          achievement={openAchievement}
          playerId={player.id}
          playerName={player.display_name}
          onClose={() => setOpenAchievement(null)}
        />
      )}

      {/* Offline-record cell -> contributing tournaments modal */}
      {openOfflineCell && (
        <OfflinePlacementsModal
          playerId={player.id}
          playerName={player.display_name}
          tier={openOfflineCell.tier}
          placement={openOfflineCell.placement}
          onClose={() => setOpenOfflineCell(null)}
        />
      )}
    </div>
  );
}
