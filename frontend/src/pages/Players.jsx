import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPlayerIndex } from '../lib/api';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function regionFlag(region) {
  if (region === 'NA') return '🇺🇸';
  if (region === 'EU') return '🇪🇺';
  if (region === 'JP') return '🇯🇵';
  return null;
}

// Bucket key for a player. A-Z if the first character is an ASCII letter,
// otherwise '#' (Japanese names, numerals, etc.).
function bucketKey(name) {
  if (!name) return '#';
  const first = name.trim().charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
}

export default function Players() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    getPlayerIndex()
      .then(setPlayers)
      .finally(() => setLoading(false));
  }, []);

  // Cmd/Ctrl-K to focus the search box.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return players;
    return players.filter(p => {
      const dn = (p.display_name || '').toLowerCase();
      const cu = (p.challonge_username || '').toLowerCase();
      return dn.includes(q) || cu.includes(q);
    });
  }, [players, q]);

  // Group filtered list by first-letter bucket.
  const grouped = useMemo(() => {
    const groups = {};
    for (const p of filtered) {
      const key = bucketKey(p.display_name);
      (groups[key] ||= []).push(p);
    }
    // Order: A..Z first, then '#' last
    const ordered = [];
    for (const L of LETTERS) if (groups[L]) ordered.push([L, groups[L]]);
    if (groups['#']) ordered.push(['#', groups['#']]);
    return ordered;
  }, [filtered]);

  const activeLetters = useMemo(
    () => new Set(grouped.map(([L]) => L)),
    [grouped]
  );

  function jumpTo(letter) {
    const el = document.getElementById(`bucket-${letter}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-2xl tracking-widest text-white">PLAYERS</h1>
        <span className="text-xs text-slate-500 font-display tracking-wider">
          {loading ? '…' : `${players.length} TOTAL`}
          {q && !loading && ` · ${filtered.length} MATCH${filtered.length === 1 ? '' : 'ES'}`}
        </span>
      </div>

      {/* Sticky search */}
      <div className="sticky top-[72px] z-40 -mx-4 px-4 py-3 bg-[#050a18]/90 backdrop-blur-md border-b border-[#1a2744] mb-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or Challonge handle…"
            className="w-full bg-[#0c1425] border border-[#1a2744] rounded-lg pl-9 pr-9 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs px-2 py-1 rounded"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Letter jump strip — hidden while searching */}
      {!q && !loading && (
        <div className="flex flex-wrap gap-1 mb-6 text-xs font-display tracking-wider">
          {LETTERS.map((L) => {
            const active = activeLetters.has(L);
            return (
              <button
                key={L}
                onClick={() => active && jumpTo(L)}
                disabled={!active}
                className={`w-7 h-7 rounded transition-colors ${
                  active
                    ? 'text-cyan-300 hover:bg-cyan-500/15 hover:text-white border border-cyan-500/20'
                    : 'text-slate-700 border border-transparent cursor-default'
                }`}
              >
                {L}
              </button>
            );
          })}
          <button
            onClick={() => activeLetters.has('#') && jumpTo('#')}
            disabled={!activeLetters.has('#')}
            className={`w-7 h-7 rounded transition-colors ${
              activeLetters.has('#')
                ? 'text-cyan-300 hover:bg-cyan-500/15 hover:text-white border border-cyan-500/20'
                : 'text-slate-700 border border-transparent cursor-default'
            }`}
            title="Other (non-Latin / numeric)"
          >
            #
          </button>
        </div>
      )}

      {loading && <p className="text-slate-400">Loading players…</p>}

      {!loading && filtered.length === 0 && (
        <p className="text-center text-slate-500 py-12">
          {q ? `No players match "${query}".` : 'No players in the database yet.'}
        </p>
      )}

      <div className="space-y-6">
        {grouped.map(([letter, list]) => (
          <section key={letter} id={`bucket-${letter}`} className="scroll-mt-32">
            <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-2 sticky top-[140px] bg-[#050a18]/80 py-1 z-30">
              {letter}
              <span className="ml-2 text-slate-600 font-normal">{list.length}</span>
            </h2>
            <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
              <ul className="divide-y divide-[#1a2744]">
                {list.map((p) => {
                  const flag = regionFlag(p.region);
                  const tournaments = p.tournaments_entered || 0;
                  const games = p.games_played || 0;
                  const offlineTop2 = p.offline_top2 || 0;
                  const showHandle = p.challonge_username && p.challonge_username !== p.display_name;
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/players/${p.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors"
                      >
                        <span className="font-medium text-white truncate">{p.display_name}</span>
                        {flag && <span className="text-xs">{flag}</span>}
                        {showHandle && (
                          <span className="text-xs text-slate-500 truncate">@{p.challonge_username}</span>
                        )}
                        <span className="ml-auto flex items-center gap-3 text-xs text-slate-500 shrink-0">
                          {tournaments > 0 && (
                            <span title="Tournaments entered">
                              <span className="text-slate-300">{tournaments}</span> events
                            </span>
                          )}
                          {games > 0 && (
                            <span title="Games played" className="hidden sm:inline">
                              <span className="text-slate-300">{games}</span> games
                            </span>
                          )}
                          {offlineTop2 > 0 && (
                            <span title="Offline top-2 finishes" className="hidden sm:inline text-amber-400">
                              🏆 {offlineTop2}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
