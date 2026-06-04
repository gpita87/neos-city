import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCreators, getResources } from '../lib/api';

/* ── Series colour map (online series only) — mirrors Calendar.jsx ──────── */
const SERIES_META = {
  ffc:            { label: 'FFC',            text: 'text-purple-300', border: 'border-purple-600/50', bg: 'bg-purple-500/10' },
  rtg_na:         { label: 'RTG NA',         text: 'text-blue-300',   border: 'border-blue-600/50',   bg: 'bg-blue-500/10' },
  rtg_eu:         { label: 'RTG EU',         text: 'text-green-300',  border: 'border-green-600/50',  bg: 'bg-green-500/10' },
  dcm:            { label: 'DCM',            text: 'text-orange-300', border: 'border-orange-600/50', bg: 'bg-orange-500/10' },
  tcc:            { label: 'TCC',            text: 'text-pink-300',   border: 'border-pink-600/50',   bg: 'bg-pink-500/10' },
  eotr:           { label: 'EOTR',          text: 'text-yellow-300', border: 'border-yellow-600/50', bg: 'bg-yellow-500/10' },
  nezumi:         { label: 'Nezumi',         text: 'text-rose-300',   border: 'border-rose-600/50',   bg: 'bg-rose-500/10' },
  nezumi_rookies: { label: 'Rookies',        text: 'text-amber-300',  border: 'border-amber-600/50',  bg: 'bg-amber-500/10' },
  ha:             { label: "Heaven's Arena", text: 'text-cyan-300',   border: 'border-cyan-600/50',   bg: 'bg-cyan-500/10' },
};

function regionFlag(region) {
  if (region === 'NA') return '🇺🇸';
  if (region === 'EU') return '🇪🇺';
  if (region === 'JP') return '🇯🇵';
  return null;
}

// "3d ago" / "2w ago" / "5mo ago" from an ISO timestamp.
function relativeTime(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const SKILL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

function SeriesBadge({ series }) {
  const m = SERIES_META[series];
  if (!m) return null;
  return (
    <span className={`text-[10px] font-display tracking-wider px-1.5 py-0.5 rounded border ${m.border} ${m.text} ${m.bg}`}>
      {m.label}
    </span>
  );
}

function CreatorCard({ c }) {
  const flag = regionFlag(c.region);
  const last = relativeTime(c.latest_upload_at);
  const latestUrl = c.latest_video_id ? `https://www.youtube.com/watch?v=${c.latest_video_id}` : c.channel_url;
  return (
    <div className={`bg-[#0c1425] border rounded-xl p-4 flex flex-col gap-3 transition-colors ${
      c.is_active ? 'border-[#1a2744] hover:border-cyan-500/40' : 'border-[#15203a] opacity-75 hover:opacity-100'
    }`}>
      <div className="flex items-center gap-3">
        {c.avatar_url ? (
          <img src={c.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover bg-[#15203a]" loading="lazy" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#15203a] grid place-items-center text-lg">⚔️</div>
        )}
        <div className="min-w-0">
          <a href={c.channel_url} target="_blank" rel="noreferrer"
             className="font-semibold text-white hover:text-cyan-300 transition-colors truncate block">
            {c.name} {flag && <span className="text-xs">{flag}</span>}
          </a>
          {c.blurb && <p className="text-xs text-slate-400 truncate">{c.blurb}</p>}
        </div>
      </div>

      {c.series?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {c.series.map(s => <SeriesBadge key={s} series={s} />)}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between text-xs">
        <span className={c.is_active ? 'text-emerald-400' : 'text-slate-500'}>
          {last ? (
            <a href={latestUrl} target="_blank" rel="noreferrer" className="hover:underline"
               title={c.latest_video_title || 'Latest upload'}>
              ▶ {last}
            </a>
          ) : 'no uploads tracked'}
        </span>
        <span className="flex items-center gap-2 text-slate-500">
          {c.resource_count > 0 && <span>{c.resource_count} guide{c.resource_count === 1 ? '' : 's'}</span>}
          {c.player_id && (
            <Link to={`/players/${c.player_id}`} className="text-cyan-400 hover:text-cyan-300">profile →</Link>
          )}
        </span>
      </div>
    </div>
  );
}

function ResourceRow({ r }) {
  return (
    <a href={r.url} target="_blank" rel="noreferrer"
       className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors">
      <span className="font-medium text-white truncate">{r.title}</span>
      {r.character && (
        <span className="text-[10px] font-display tracking-wider px-1.5 py-0.5 rounded border border-cyan-600/40 text-cyan-300 bg-cyan-500/10 shrink-0">
          {r.character}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3 text-xs text-slate-500 shrink-0">
        {r.skill_level && <span className="hidden sm:inline">{SKILL_LABEL[r.skill_level] || r.skill_level}</span>}
        {r.creator_name && <span className="text-slate-600 truncate max-w-[10rem]">{r.creator_name}</span>}
        <span className="text-slate-600">↗</span>
      </span>
    </a>
  );
}

export default function Creators() {
  const [creators, setCreators] = useState([]);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchive, setShowArchive] = useState(false);

  // Resource filters
  const [query, setQuery] = useState('');
  const [charFilter, setCharFilter] = useState('');
  const [skillFilter, setSkillFilter] = useState('');

  useEffect(() => {
    Promise.all([getCreators(), getResources()])
      .then(([c, r]) => {
        setCreators(c.creators || []);
        setResources(r || []);
      })
      .catch(() => { /* leave empty states */ })
      .finally(() => setLoading(false));
  }, []);

  const active  = useMemo(() => creators.filter(c => c.is_active), [creators]);
  const archive = useMemo(() => creators.filter(c => !c.is_active), [creators]);

  const characters = useMemo(
    () => [...new Set(resources.map(r => r.character).filter(Boolean))].sort(),
    [resources]
  );

  const q = query.trim().toLowerCase();
  const filteredResources = useMemo(() => {
    return resources.filter(r => {
      if (charFilter && r.character !== charFilter) return false;
      if (skillFilter && r.skill_level !== skillFilter) return false;
      if (q && !(`${r.title} ${r.character || ''} ${r.creator_name || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [resources, charFilter, skillFilter, q]);

  const guides       = filteredResources.filter(r => r.kind === 'character_guide');
  const fundamentals = filteredResources.filter(r => r.kind === 'fundamental');

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-2xl tracking-widest text-white">COMMUNITY PILLARS</h1>
        <span className="text-xs text-slate-500 font-display tracking-wider">
          {loading ? '…' : `${active.length} ACTIVE · ${resources.length} RESOURCES`}
        </span>
      </div>

      {loading && <p className="text-slate-400">Loading…</p>}

      {/* ── Active creators ─────────────────────────────────────────────── */}
      {!loading && (
        <section className="mb-10">
          <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-3">ACTIVE CREATORS</h2>
          {active.length === 0 ? (
            <p className="text-slate-500 text-sm bg-[#0c1425] border border-[#1a2744] rounded-xl px-4 py-8 text-center">
              No active creators yet. Seed the pillars with <code className="text-cyan-300">seed_creators.js</code>,
              then run <code className="text-cyan-300">refresh_creators.js</code> to pull their latest uploads.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {active.map(c => <CreatorCard key={c.id} c={c} />)}
            </div>
          )}

          {archive.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowArchive(v => !v)}
                className="text-xs font-display tracking-wider text-slate-400 hover:text-cyan-300 transition-colors"
              >
                {showArchive ? '▾' : '▸'} 💤 ARCHIVE — {archive.length} dormant{showArchive ? '' : ' (no recent uploads)'}
              </button>
              {showArchive && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
                  {archive.map(c => <CreatorCard key={c.id} c={c} />)}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Resource library ────────────────────────────────────────────── */}
      {!loading && (
        <section>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-display text-sm tracking-widest text-cyan-400">RESOURCE LIBRARY</h2>
            {filteredResources.length !== resources.length && (
              <span className="text-xs text-slate-500">{filteredResources.length} of {resources.length}</span>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search resources…"
              className="flex-1 min-w-[12rem] bg-[#0c1425] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
            />
            {characters.length > 0 && (
              <select
                value={charFilter}
                onChange={e => setCharFilter(e.target.value)}
                className="bg-[#0c1425] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="">All characters</option>
                {characters.map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
            )}
            <select
              value={skillFilter}
              onChange={e => setSkillFilter(e.target.value)}
              className="bg-[#0c1425] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="">All levels</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          {resources.length === 0 ? (
            <p className="text-slate-500 text-sm bg-[#0c1425] border border-[#1a2744] rounded-xl px-4 py-8 text-center">
              No resources yet. Add character guides and fundamentals via <code className="text-cyan-300">seed_creators.js</code>.
            </p>
          ) : filteredResources.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No resources match your filters.</p>
          ) : (
            <div className="space-y-6">
              {fundamentals.length > 0 && (
                <div>
                  <h3 className="font-display text-xs tracking-widest text-slate-400 mb-2">⛰ FUNDAMENTALS</h3>
                  <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
                    <div className="divide-y divide-[#1a2744]">
                      {fundamentals.map(r => <ResourceRow key={r.id} r={r} />)}
                    </div>
                  </div>
                </div>
              )}
              {guides.length > 0 && (
                <div>
                  <h3 className="font-display text-xs tracking-widest text-slate-400 mb-2">🎭 CHARACTER GUIDES</h3>
                  <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
                    <div className="divide-y divide-[#1a2744]">
                      {guides.map(r => <ResourceRow key={r.id} r={r} />)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
