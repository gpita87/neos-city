import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecentPlacements, getTournaments, getRecentAchievements } from '../lib/api';
import { formatDate } from '../lib/utils';

// Series display names and colors
const SERIES_META = {
  ffc:             { name: 'FFC',        color: 'border-purple-500/40', accent: 'text-purple-400', bg: 'bg-purple-500/10', badge: 'bg-purple-900/40 text-purple-300 border-purple-700/50' },
  rtg_na:          { name: 'RTG NA',     color: 'border-blue-500/40',   accent: 'text-blue-400',   bg: 'bg-blue-500/10',   badge: 'bg-blue-900/40 text-blue-300 border-blue-700/50' },
  rtg_eu:          { name: 'RTG EU',     color: 'border-green-500/40',  accent: 'text-green-400',  bg: 'bg-green-500/10',  badge: 'bg-green-900/40 text-green-300 border-green-700/50' },
  dcm:             { name: 'DCM',        color: 'border-orange-500/40', accent: 'text-orange-400', bg: 'bg-orange-500/10', badge: 'bg-orange-900/40 text-orange-300 border-orange-700/50' },
  tcc:             { name: 'TCC',        color: 'border-pink-500/40',   accent: 'text-pink-400',   bg: 'bg-pink-500/10',   badge: 'bg-pink-900/40 text-pink-300 border-pink-700/50' },
  eotr:            { name: 'EOTR',       color: 'border-yellow-500/40', accent: 'text-yellow-400', bg: 'bg-yellow-500/10', badge: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50' },
  nezumi:          { name: 'ねずみ杯',    color: 'border-rose-500/40',   accent: 'text-rose-400',   bg: 'bg-rose-500/10',   badge: 'bg-rose-900/40 text-rose-300 border-rose-700/50' },
  nezumi_rookies:  { name: 'Rookies',    color: 'border-amber-500/40',  accent: 'text-amber-400',  bg: 'bg-amber-500/10',  badge: 'bg-amber-900/40 text-amber-300 border-amber-700/50' },
  ha:              { name: "Heaven's Arena", color: 'border-cyan-500/40', accent: 'text-cyan-400', bg: 'bg-cyan-500/10', badge: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/50' },
};

const DEFAULT_SERIES = { name: 'Online', color: 'border-slate-500/40', accent: 'text-slate-400', bg: 'bg-slate-500/10', badge: 'bg-slate-800/40 text-slate-400 border-slate-600/50' };

const PLACEMENT_ICONS = ['', '🥇', '🥈', '🥉', '4th', '5th', '6th', '7th', '8th'];
const REGION_FLAGS = { NA: '🇺🇸', EU: '🇪🇺', JP: '🇯🇵' };

function PlacementRow({ p, index }) {
  const rank = p.final_rank;
  const isPodium = rank <= 3;

  return (
    <Link
      to={`/players/${p.player_id}`}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors hover:bg-white/5 ${
        isPodium ? 'text-white' : 'text-slate-400'
      }`}
    >
      <span className={`w-7 text-center text-sm ${
        rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-amber-600' : 'text-slate-600'
      }`}>
        {rank <= 3 ? PLACEMENT_ICONS[rank] : <span className="text-xs">{rank}</span>}
      </span>
      <span className={`flex-1 truncate ${isPodium ? 'font-medium' : ''}`}>
        {p.display_name}
      </span>
      {p.region && REGION_FLAGS[p.region] && (
        <span className="text-xs">{REGION_FLAGS[p.region]}</span>
      )}
    </Link>
  );
}

function TournamentCard({ tournament }) {
  const series = SERIES_META[tournament.series] || DEFAULT_SERIES;

  return (
    <div className={`bg-[#0c1425] border ${series.color} rounded-xl overflow-hidden`}>
      {/* Card header */}
      <div className={`px-5 py-3 ${series.bg} border-b ${series.color}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`px-2 py-0.5 rounded border text-[10px] font-display tracking-wider ${series.badge}`}>
              {series.name}
            </span>
            <Link
              to={`/tournaments/${tournament.tournament_id}`}
              className="text-white font-medium text-sm truncate hover:text-cyan-400 transition-colors"
            >
              {tournament.name}
            </Link>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0 ml-3">
            <span>{tournament.participants_count} players</span>
            <span>{formatDate(tournament.completed_at)}</span>
          </div>
        </div>
      </div>

      {/* Placements */}
      <div className="px-2 py-2">
        {tournament.placements.length === 0 ? (
          <p className="text-slate-600 text-sm px-3 py-2">No placement data available.</p>
        ) : (
          <div className="space-y-0.5">
            {tournament.placements.map((p, i) => (
              <PlacementRow key={p.player_id} p={p} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [recentPlacements, setRecentPlacements] = useState([]);
  const [upcomingTournaments, setUpcomingTournaments] = useState([]);
  const [recentAch, setRecentAch] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getRecentPlacements(30).catch(() => []),
      getTournaments(false).catch(() => []),
      getRecentAchievements(8).catch(() => []),
    ]).then(([placements, tournaments, ach]) => {
      setRecentPlacements(placements);
      // Show last 5 tournaments for the sidebar
      setUpcomingTournaments(tournaments.slice(0, 5));
      setRecentAch(ach);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="text-center py-10">
        <h1 className="font-display text-4xl md:text-5xl text-cyan-400 tracking-widest mb-3 neon-text">
          NEOS CITY
        </h1>
        <p className="text-slate-400 text-lg">
          Pokkén Tournament community hub — results, stats & achievements
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column — recent tournament results */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="font-display text-sm tracking-widest text-cyan-400">RECENT RESULTS</h2>

          {loading && <p className="text-slate-500 text-sm">Loading recent tournaments...</p>}

          {!loading && recentPlacements.length === 0 && (
            <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-8 text-center">
              <p className="text-slate-500">No tournaments in the last 30 days.</p>
              <Link to="/tournaments" className="text-cyan-400 hover:text-cyan-300 text-sm mt-2 inline-block">
                Browse all tournaments →
              </Link>
            </div>
          )}

          {recentPlacements.map(t => (
            <TournamentCard key={t.tournament_id} tournament={t} />
          ))}

          {recentPlacements.length > 0 && (
            <div className="text-center pt-2">
              <Link to="/tournaments" className="text-sm text-slate-400 hover:text-cyan-400 transition-colors">
                View all tournaments →
              </Link>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Recent Tournaments list */}
          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-sm tracking-widest text-cyan-400">LATEST EVENTS</h2>
              <Link to="/tournaments" className="text-xs text-slate-400 hover:text-white">View all →</Link>
            </div>
            <div className="space-y-3">
              {upcomingTournaments.length === 0 && !loading && (
                <p className="text-slate-500 text-sm">No tournaments imported yet.</p>
              )}
              {upcomingTournaments.map(t => {
                const series = SERIES_META[t.series] || DEFAULT_SERIES;
                return (
                  <Link
                    key={t.id}
                    to={`/tournaments/${t.id}`}
                    className="block p-3 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded border text-[9px] font-display tracking-wider ${series.badge}`}>
                        {series.name}
                      </span>
                      <p className="text-white font-medium text-sm truncate">{t.name}</p>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {t.participants_count} players · {formatDate(t.completed_at)}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Recent Achievements */}
          {recentAch.length > 0 && (
            <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-sm tracking-widest text-cyan-400">RECENT ACHIEVEMENTS</h2>
                <Link to="/achievements" className="text-xs text-slate-400 hover:text-white">View all →</Link>
              </div>
              <div className="space-y-2">
                {recentAch.map((a, idx) => (
                  <div
                    key={`${a.player_id}-${a.achievement_id}-${idx}`}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-white/5"
                  >
                    <span className="text-lg">{a.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">
                        <Link
                          to={`/players/${a.player_id}`}
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          {a.player_name}
                        </Link>
                        {' '}unlocked{' '}
                        <span className="text-white font-medium" title={a.description}>
                          {a.achievement_name}
                        </span>
                      </p>
                      <p className="text-[10px] text-slate-600">{formatDate(a.unlocked_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick links */}
          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
            <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-4">EXPLORE</h2>
            <div className="space-y-2">
              <Link to="/calendar" className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 text-sm text-slate-400 hover:text-white transition-colors">
                <span>📅</span> Tournament Calendar
              </Link>
              <Link to="/achievements" className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 text-sm text-slate-400 hover:text-white transition-colors">
                <span>🏅</span> Achievement Catalog
              </Link>
              <Link to="/tournaments" className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 text-sm text-slate-400 hover:text-white transition-colors">
                <span>🏆</span> All Tournaments
              </Link>
              <Link to="/live" className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 text-sm text-slate-400 hover:text-white transition-colors">
                <span>⚡</span> Live Match
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
