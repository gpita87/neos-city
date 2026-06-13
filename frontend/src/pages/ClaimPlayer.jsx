import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getPlayerIndex, linkPlayer, getClaimSuggestions } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useFlag } from '../hooks/useFlag';

function regionFlag(region) {
  if (region === 'NA') return '🇺🇸';
  if (region === 'EU') return '🇪🇺';
  if (region === 'JP') return '🇯🇵';
  return null;
}

export default function ClaimPlayer() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const welcome = searchParams.get('welcome') === '1';
  const showSuggestions = useFlag('auth'); // new UI stays behind the auth flag
  const [players, setPlayers] = useState([]);
  const [suggestions, setSuggestions] = useState(null); // null = not loaded yet
  const [query, setQuery] = useState('');
  const [claiming, setClaiming] = useState(null); // player id mid-claim
  const [error, setError] = useState(null);

  useEffect(() => {
    getPlayerIndex().then(setPlayers).catch(() => {});
  }, []);

  // Smart "Is this you?" suggestions — only meaningful once we know the user is
  // signed in and unclaimed. Falls back to [] on error so the UI just shows search.
  useEffect(() => {
    if (!showSuggestions || loading || !user || user.player_id) return;
    getClaimSuggestions()
      .then((data) => setSuggestions(data.suggestions || []))
      .catch(() => setSuggestions([]));
  }, [showSuggestions, loading, user]);

  const skip = () => {
    try { localStorage.setItem('claim_dismissed', '1'); } catch { /* storage off — fine */ }
    navigate('/', { replace: true });
  };

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return players.slice(0, 50);
    return players.filter(p =>
      (p.display_name || '').toLowerCase().includes(q) ||
      (p.challonge_username || '').toLowerCase().includes(q)
    );
  }, [players, q]);

  const claim = async (id) => {
    setClaiming(id);
    setError(null);
    try {
      await linkPlayer(id);
      await refresh();
      navigate(`/players/${id}`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setClaiming(null);
    }
  };

  if (loading) return <p className="text-slate-400 text-center py-16">Loading…</p>;

  // Gate: must be signed in.
  if (!user) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-slate-300 mb-4">Sign in to claim your player profile.</p>
        <Link to="/login?next=/link" className="text-cyan-400 hover:text-cyan-300">Sign in →</Link>
      </div>
    );
  }

  // Already linked.
  if (user.player_id) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <p className="text-3xl mb-3">🔗</p>
        <p className="text-slate-300 mb-4">Your account is already linked to a player.</p>
        <Link to={`/players/${user.player_id}`} className="text-cyan-400 hover:text-cyan-300">
          View your profile →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {welcome ? (
        <div className="text-center mb-6">
          <p className="text-3xl mb-2">👋</p>
          <h1 className="font-display text-2xl tracking-widest text-white mb-1">WELCOME TO NEOS CITY</h1>
          <p className="text-slate-400 text-sm">
            Link your player record to claim your stats, achievements, and match history.
          </p>
        </div>
      ) : (
        <>
          <h1 className="font-display text-2xl tracking-widest text-white mb-1 text-center">CLAIM YOUR PROFILE</h1>
          <p className="text-slate-500 text-sm text-center mb-6">
            Find your existing player record to link it to your account.
          </p>
        </>
      )}

      {/* Smart "Is this you?" suggestions, matched from the provider name (auth-flag UI). */}
      {showSuggestions && suggestions && suggestions.length > 0 && (
        <div className="mb-6">
          <p className="text-xs uppercase tracking-widest text-cyan-400/80 mb-2">Is this you?</p>
          <div className="space-y-2">
            {suggestions.map(p => {
              const flag = regionFlag(p.region);
              const showHandle = p.challonge_username && p.challonge_username !== p.display_name;
              return (
                <div key={p.id} className="flex items-center gap-3 bg-[#0c1425] border border-cyan-500/30 rounded-xl px-4 py-3">
                  <span className="w-7 h-7 rounded-full bg-cyan-500/15 flex items-center justify-center text-sm shrink-0">⚔️</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white truncate">{p.display_name}</span>
                      {flag && <span className="text-xs">{flag}</span>}
                    </div>
                    {showHandle && <span className="text-xs text-slate-500 truncate">@{p.challonge_username}</span>}
                  </div>
                  {p.already_claimed ? (
                    <span className="ml-auto shrink-0 text-xs text-slate-500 px-3 py-1.5">Already claimed</span>
                  ) : (
                    <button
                      onClick={() => claim(p.id)}
                      disabled={claiming === p.id}
                      className="ml-auto shrink-0 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                    >
                      {claiming === p.id ? 'Claiming…' : 'This is me'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-600 text-center mt-3">Not listed? Search for your record below.</p>
        </div>
      )}

      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name or Challonge handle…"
          className="w-full bg-[#0c1425] border border-[#1a2744] rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
        />
      </div>

      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
        <ul className="divide-y divide-[#1a2744]">
          {filtered.map(p => {
            const flag = regionFlag(p.region);
            const showHandle = p.challonge_username && p.challonge_username !== p.display_name;
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`font-medium truncate ${p.claimed ? 'text-slate-500' : 'text-white'}`}>{p.display_name}</span>
                {flag && <span className="text-xs">{flag}</span>}
                {showHandle && <span className="text-xs text-slate-500 truncate">@{p.challonge_username}</span>}
                {p.claimed ? (
                  <span className="ml-auto shrink-0 text-xs text-slate-500 px-3 py-1.5">Already claimed</span>
                ) : (
                  <button
                    onClick={() => claim(p.id)}
                    disabled={claiming === p.id}
                    className="ml-auto shrink-0 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {claiming === p.id ? 'Claiming…' : 'This is me'}
                  </button>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-slate-500 text-sm">
              {q ? `No players match "${query}".` : 'Start typing to find your record.'}
            </li>
          )}
        </ul>
      </div>
      {!q && players.length > 50 && (
        <p className="text-xs text-slate-600 text-center mt-3">Showing first 50 — search to narrow down.</p>
      )}

      {welcome && (
        <p className="text-center mt-6">
          <button onClick={skip} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            Skip for now
          </button>
        </p>
      )}
    </div>
  );
}
