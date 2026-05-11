import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLeaderboard, getOfflineLeaderboard } from '../lib/api';
import { winRate } from '../lib/utils';

const REGIONS = [
  { key: null,  label: 'All',    flag: '🌐' },
  { key: 'NA',  label: 'NA',     flag: '🇺🇸' },
  { key: 'EU',  label: 'EU',     flag: '🇪🇺' },
  { key: 'JP',  label: 'Japan',  flag: '🇯🇵' },
];

const OFFLINE_TIERS = [
  { key: 'worlds',   label: 'Worlds',    icon: '🌍', color: 'text-yellow-400' },
  { key: 'major',    label: 'Majors',    icon: '🏟️', color: 'text-cyan-400' },
  { key: 'regional', label: 'Regionals', icon: '🗺️', color: 'text-emerald-400' },
  { key: 'other',    label: 'Locals',    icon: '📍', color: 'text-slate-400' },
];

export default function Leaderboard() {
  const [players, setPlayers] = useState([]);
  const [offlinePlayers, setOfflinePlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion]   = useState(null);
  const [mode, setMode]       = useState('online'); // 'online' | 'offline'

  useEffect(() => {
    if (mode === 'online') {
      setLoading(true);
      getLeaderboard(region)
        .then(setPlayers)
        .finally(() => setLoading(false));
    }
  }, [region, mode]);

  useEffect(() => {
    if (mode === 'offline') {
      setLoading(true);
      getOfflineLeaderboard()
        .then(setOfflinePlayers)
        .finally(() => setLoading(false));
    }
  }, [mode]);

  return (
    <div>
      <h1 className="font-display text-2xl tracking-widest text-white mb-6">LEADERBOARD</h1>

      {/* Mode tabs: Online / Offline */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode('online')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-display tracking-wider transition-colors
            ${mode === 'online'
              ? 'bg-cyan-500 text-white'
              : 'bg-[#0c1425] border border-[#1a2744] text-slate-400 hover:text-white hover:border-cyan-500'
            }`}
        >
          🎮 Online
        </button>
        <button
          onClick={() => setMode('offline')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-display tracking-wider transition-colors
            ${mode === 'offline'
              ? 'bg-amber-600 text-white'
              : 'bg-[#0c1425] border border-[#1a2744] text-slate-400 hover:text-white hover:border-amber-500'
            }`}
        >
          🏆 Offline
        </button>
      </div>

      {/* Region tabs — online only */}
      {mode === 'online' && (
        <div className="flex gap-2 mb-4">
          {REGIONS.map((r) => (
            <button
              key={r.key ?? 'all'}
              onClick={() => setRegion(r.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-display tracking-wider transition-colors
                ${region === r.key
                  ? 'bg-cyan-500 text-white'
                  : 'bg-[#0c1425] border border-[#1a2744] text-slate-400 hover:text-white hover:border-cyan-500'
                }`}
            >
              <span>{r.flag}</span>
              <span>{r.label}</span>
            </button>
          ))}
        </div>
      )}

      {loading && <p className="text-slate-400">Loading...</p>}

      {/* Online leaderboard */}
      {mode === 'online' && (
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a2744] text-slate-500 text-xs font-display tracking-wider">
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-left">PLAYER</th>
                <th className="px-4 py-3 text-right">W</th>
                <th className="px-4 py-3 text-right">L</th>
                <th className="px-4 py-3 text-right">WIN%</th>
                <th className="px-4 py-3 text-right">EVENTS</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => (
                <tr key={p.id} className="border-b border-[#1a2744] hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                  <td className="px-4 py-3">
                    <Link to={`/players/${p.id}`} className="flex items-center gap-2 hover:text-cyan-400">
                      <span className="font-medium text-white">{p.display_name}</span>
                      {p.region && (
                        <span className="ml-1 text-xs text-slate-500">
                          {p.region === 'NA' ? '🇺🇸' : p.region === 'EU' ? '🇪🇺' : p.region === 'JP' ? '🇯🇵' : ''}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right text-green-400">{p.total_match_wins}</td>
                  <td className="px-4 py-3 text-right text-red-400">{p.total_match_losses}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{winRate(p.total_match_wins, p.total_match_losses)}</td>
                  <td className="px-4 py-3 text-right text-slate-400">{p.tournaments_entered}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && players.length === 0 && (
            <p className="text-center text-slate-500 py-8">
              {region
                ? `No ${region} players yet. Import tournaments or assign player regions first.`
                : 'No players yet. Import a tournament first!'}
            </p>
          )}
        </div>
      )}

      {/* Offline leaderboard */}
      {mode === 'offline' && (
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1a2744] text-slate-500 text-xs font-display tracking-wider">
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-left">PLAYER</th>
                {OFFLINE_TIERS.map(t => (
                  <th key={t.key} className="px-2 py-3 text-center" title={t.label}>
                    <span className="text-xs">{t.icon}</span>
                  </th>
                ))}
                <th className="px-3 py-3 text-right">1ST</th>
                <th className="px-3 py-3 text-right">2ND</th>
              </tr>
            </thead>
            <tbody>
              {offlinePlayers.map((p, i) => (
                <tr key={p.id} className="border-b border-[#1a2744] hover:bg-white/5 transition-colors group">
                  <td className="px-4 py-3 text-slate-500">{i + 1}</td>
                  <td className="px-4 py-3">
                    <Link to={`/players/${p.id}`} className="flex items-center gap-2 hover:text-amber-400">
                      <span className="font-medium text-white">{p.display_name}</span>
                      {p.region && (
                        <span className="text-xs text-slate-500">
                          {p.region === 'NA' ? '🇺🇸' : p.region === 'EU' ? '🇪🇺' : p.region === 'JP' ? '🇯🇵' : ''}
                        </span>
                      )}
                    </Link>
                  </td>
                  {OFFLINE_TIERS.map(t => {
                    const w = p[`offline_${t.key}_wins`] || 0;
                    const r = p[`offline_${t.key}_runner_up`] || 0;
                    const t4 = p[`offline_${t.key}_top4`] || 0;
                    const t8 = p[`offline_${t.key}_top8`] || 0;
                    const hasAny = w + r + t4 + t8 > 0;
                    return (
                      <td key={t.key} className="px-2 py-3 text-center text-xs">
                        {hasAny ? (
                          <span className={t.color} title={`${t.label}: ${w}W ${r}R ${t4}T4 ${t8}T8`}>
                            {w > 0 && <span className="text-yellow-400 font-bold">{w}W </span>}
                            {r > 0 && <span className="text-slate-300">{r}R </span>}
                            {(t4 - w - r) > 0 && <span className="text-slate-400">{t4 - w - r}T4 </span>}
                            {(t8 - t4) > 0 && <span className="text-slate-500">{t8 - t4}T8</span>}
                          </span>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right text-yellow-400 font-bold">{p.offline_wins || 0}</td>
                  <td className="px-3 py-3 text-right text-slate-300">{(p.offline_top2 || 0) - (p.offline_wins || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && offlinePlayers.length === 0 && (
            <p className="text-center text-slate-500 py-8">
              No offline tournament data yet. Import offline tournaments first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
