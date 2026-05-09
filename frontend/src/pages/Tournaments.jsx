import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getTournaments, importTournament } from '../lib/api';
import { formatDate } from '../lib/utils';

const TABS = [
  { key: 'online',  label: '🎮 Online'  },
  { key: 'offline', label: '🏆 Offline' },
];

// Offline tier display order and labels
const TIER_ORDER = ['worlds', 'major', 'regional', 'other'];
const TIER_LABELS = {
  worlds:   '🌍 World Championships',
  major:    '🏟️ Majors',
  regional: '📍 Regionals',
  other:    '🎮 Locals',
};
const TIER_COLORS = {
  worlds:   'text-yellow-400',
  major:    'text-cyan-400',
  regional: 'text-teal-400',
  other:    'text-slate-400',
};

// Group offline tournaments by tier, then by year within each tier
function groupByTier(tournaments) {
  const tiers = {};
  for (const t of tournaments) {
    const tier = t.series && TIER_ORDER.includes(t.series) ? t.series : 'other';
    if (!tiers[tier]) tiers[tier] = [];
    tiers[tier].push(t);
  }
  // Sort events within each tier by date descending
  for (const tier of Object.keys(tiers)) {
    tiers[tier].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
  }
  // Return in tier order, skipping empty tiers
  return TIER_ORDER.filter(t => tiers[t]?.length).map(t => [t, tiers[t]]);
}

// Group offline tournaments by year
function groupByYear(tournaments) {
  const groups = {};
  for (const t of tournaments) {
    const year = t.completed_at ? new Date(t.completed_at).getFullYear() : 'Unknown';
    if (!groups[year]) groups[year] = [];
    groups[year].push(t);
  }
  // Return years descending
  return Object.entries(groups).sort((a, b) => b[0] - a[0]);
}

function OfflineTable({ tournaments, loading }) {
  if (loading) return <p className="text-slate-400">Loading...</p>;
  if (!tournaments.length) {
    return (
      <p className="text-center text-slate-500 py-8">
        No offline tournaments yet.{' '}
        Run <code className="bg-[#1a2744] px-1 py-0.5 rounded text-cyan-300 text-xs">node offline_import.js</code>{' '}
        from the neos-city directory to import all Liquipedia events.
      </p>
    );
  }

  const groups = groupByYear(tournaments);

  return (
    <div className="space-y-6">
      {groups.map(([year, events]) => (
        <div key={year}>
          <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-2">{year}</h2>
          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a2744] text-slate-500 text-xs font-display tracking-wider">
                  <th className="px-4 py-3 text-left">TOURNAMENT</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">LOCATION</th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">PRIZE</th>
                  <th className="px-4 py-3 text-right hidden sm:table-cell">ENTRANTS</th>
                  <th className="px-4 py-3 text-left">🥇 WINNER</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">🥈 RUNNER-UP</th>
                  <th className="px-4 py-3 text-right hidden lg:table-cell">DATE</th>
                </tr>
              </thead>
              <tbody>
                {events.map((t) => (
                  <tr key={t.id} className="border-b border-[#1a2744] last:border-0 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{t.name}</td>
                    <td className="px-4 py-3 text-slate-400 hidden md:table-cell">{t.location || '—'}</td>
                    <td className="px-4 py-3 text-right text-yellow-400 font-medium hidden sm:table-cell">
                      {t.prize_pool || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 hidden sm:table-cell">
                      {t.participants_count ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <OfflinePlacement tournamentId={t.id} rank={1} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <OfflinePlacement tournamentId={t.id} rank={2} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 text-xs hidden lg:table-cell">
                      {formatDate(t.completed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// Shows winner/runner-up name, linked to their player profile if we have an id
function OfflinePlacement({ tournamentId, rank }) {
  // The offline tournament object already has placements embedded if we want,
  // but for now we pull winner/runner_up from the extra fields stored on the tournament row.
  // The API returns the raw tournament row — winner/runner_up are stored in tournament_placements.
  // For simplicity we display from the placements fetched with the tournament list.
  // This component is a placeholder; the parent passes the data via props if enriched.
  // (See OfflineTableWithPlacements below for the enriched version)
  return <span className="text-slate-400">—</span>;
}

export default function Tournaments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab = tabParam === 'offline' ? 'offline' : 'online';
  const setTab = (next) => {
    if (next === 'online') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };
  const [online, setOnline]     = useState([]);
  const [offline, setOffline]   = useState([]);
  const [loadingOnline, setLoadingOnline]   = useState(true);
  const [loadingOffline, setLoadingOffline] = useState(false);
  const [importing, setImporting] = useState(false);
  const [slug, setSlug]           = useState('');
  const [importMsg, setImportMsg] = useState(null);

  // Load online tournaments on mount
  useEffect(() => {
    setLoadingOnline(true);
    getTournaments(false).then(setOnline).finally(() => setLoadingOnline(false));
  }, []);

  // Load offline tournaments when that tab is first opened
  useEffect(() => {
    if (tab === 'offline' && offline.length === 0 && !loadingOffline) {
      setLoadingOffline(true);
      getTournaments(true)
        .then(rows => {
          // Enrich each tournament with winner/runner-up names from placements
          // The backend returns raw tournament rows; placements aren't included here.
          // We'll display them inline once we load TournamentDetail,
          // but for the table we fetch the enriched version separately.
          setOffline(rows);
        })
        .finally(() => setLoadingOffline(false));
    }
  }, [tab]); // eslint-disable-line

  const handleImport = async (e) => {
    e.preventDefault();
    if (!slug.trim()) return;
    const cleanSlug = slug.trim().replace(/.*challonge\.com\//, '').split('#')[0].split('/')[0];
    setImporting(true);
    setImportMsg(null);
    try {
      const result = await importTournament(cleanSlug);
      setImportMsg({ ok: true, text: `✅ Imported "${result.tournament}" — ${result.participants} players, ${result.matches_imported} matches.` });
      setSlug('');
      getTournaments(false).then(setOnline);
    } catch (err) {
      setImportMsg({ ok: false, text: `❌ ${err.response?.data?.error || err.message}` });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl tracking-widest text-white">TOURNAMENTS</h1>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-display tracking-wider transition-colors
              ${tab === t.key
                ? 'bg-cyan-500 text-white'
                : 'bg-[#0c1425] border border-[#1a2744] text-slate-400 hover:text-white hover:border-cyan-500'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Online tab ──────────────────────────────────────────────────── */}
      {tab === 'online' && (
        <>
          {/* Import form */}
          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
            <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-3">IMPORT FROM CHALLONGE</h2>
            <form onSubmit={handleImport} className="flex gap-3">
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(e.target.value)}
                placeholder="Tournament URL or slug (e.g. 8rd0p4mu)"
                className="flex-1 bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={importing}
                className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            </form>
            {importMsg && (
              <p className={`mt-3 text-sm ${importMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                {importMsg.text}
              </p>
            )}
          </div>

          {loadingOnline && <p className="text-slate-400">Loading...</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {online.map(t => (
              <Link
                key={t.id}
                to={`/tournaments/${t.id}`}
                className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5 hover:border-cyan-500/50 transition-colors block"
              >
                <h3 className="font-medium text-white mb-1">{t.name}</h3>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  {t.game_name && <span>🎮 {t.game_name}</span>}
                  {t.participants_count && <span>👥 {t.participants_count} players</span>}
                  <span>📅 {formatDate(t.completed_at)}</span>
                </div>
              </Link>
            ))}
          </div>

          {!loadingOnline && online.length === 0 && (
            <p className="text-center text-slate-500 py-8">No tournaments imported yet. Paste a Challonge URL above!</p>
          )}
        </>
      )}

      {/* ── Offline tab ─────────────────────────────────────────────────── */}
      {tab === 'offline' && (
        <>
          <div className="text-slate-500 text-sm">
            Real-world offline events from{' '}
            <a
              href="https://liquipedia.net/fighters/Pokkén_Tournament/Tournaments"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:text-cyan-300"
            >
              Liquipedia
            </a>
            . Results are not region-filtered — offline Pokkén is one global scene.
          </div>
          <OfflineTableFull tournaments={offline} loading={loadingOffline} />
        </>
      )}
    </div>
  );
}

// Full offline table with winner/runner-up fetched via detail endpoint per tournament
// We avoid that extra fetch by storing winner/runner_up in separate tournament_placements.
// Instead we fetch the offline list once (includes name, location, prize, date)
// and display winner from a joined query on the backend.
// For now, show what we have. Winner/runner-up will appear after we add a
// richer API endpoint. This is good enough for the initial view.
function OfflineTableFull({ tournaments, loading }) {
  if (loading) return <p className="text-slate-400">Loading...</p>;

  if (!tournaments.length) {
    return (
      <p className="text-center text-slate-500 py-8">
        No offline tournaments yet. Run{' '}
        <code className="bg-[#1a2744] px-1 py-0.5 rounded text-cyan-300 text-xs">node offline_import.js</code>{' '}
        from the neos-city directory (with the backend running).
      </p>
    );
  }

  const tiers = groupByTier(tournaments);

  return (
    <div className="space-y-10">
      {tiers.map(([tier, events]) => (
        <div key={tier}>
          <h2 className={`font-display text-base tracking-widest mb-3 ${TIER_COLORS[tier] || 'text-slate-400'}`}>
            {TIER_LABELS[tier] || tier.toUpperCase()}
            <span className="ml-2 text-xs text-slate-600">({events.length})</span>
          </h2>
          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-[#1a2744] text-slate-500 text-xs font-display tracking-wider">
                  <th className="px-4 py-3 text-left">TOURNAMENT</th>
                  <th className="px-4 py-3 text-left">LOCATION</th>
                  <th className="px-4 py-3 text-right">PRIZE</th>
                  <th className="px-4 py-3 text-right">ENTRANTS</th>
                  <th className="px-4 py-3 text-left">🥇 WINNER</th>
                  <th className="px-4 py-3 text-left">🥈 RUNNER-UP</th>
                  <th className="px-4 py-3 text-right">DATE</th>
                </tr>
              </thead>
              <tbody>
                {events.map((t) => (
                  <OfflineRow key={t.id} tournament={t} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function OfflineRow({ tournament: t }) {
  const [placements, setPlacements] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Fetch the tournament detail to get 1st/2nd place names
    fetch(`/api/tournaments/${t.id}`)
      .then(r => r.json())
      .then(data => {
        const p1 = data.placements?.find(p => p.final_rank === 1);
        const p2 = data.placements?.find(p => p.final_rank === 2);
        setPlacements({ winner: p1?.display_name, runner_up: p2?.display_name });
      })
      .catch(() => setPlacements({}));
  }, [t.id]);

  return (
    <tr
      onClick={() => navigate(`/tournaments/${t.id}`)}
      className="border-b border-[#1a2744] last:border-0 hover:bg-white/5 transition-colors cursor-pointer"
    >
      <td className="px-4 py-3 font-medium text-white hover:text-cyan-300">{t.name}</td>
      <td className="px-4 py-3 text-slate-400">{t.location || '—'}</td>
      <td className="px-4 py-3 text-right text-yellow-400 font-medium">
        {t.prize_pool || '—'}
      </td>
      <td className="px-4 py-3 text-right text-slate-400">
        {t.participants_count ?? '—'}
      </td>
      <td className="px-4 py-3 text-green-400 font-medium">
        {placements === null ? '…' : placements.winner || '—'}
      </td>
      <td className="px-4 py-3 text-slate-300">
        {placements === null ? '…' : placements.runner_up || '—'}
      </td>
      <td className="px-4 py-3 text-right text-slate-500 text-xs">
        {formatDate(t.completed_at)}
      </td>
    </tr>
  );
}
