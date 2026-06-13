import { useEffect, useState } from 'react';
import { getTwitchStreamers } from '../lib/api';

// "3d ago" / "2w ago" / "5mo ago" from an ISO timestamp — mirrors Creators.jsx.
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

function fullDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const POKKEN_RE = /pokk[eé]n/i;

function LiveBadge({ s }) {
  if (!s.is_live) return null;
  const inPokken = POKKEN_RE.test(s.live_game_name || '');
  return inPokken ? (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-display tracking-wider px-2 py-0.5 rounded-full border border-red-500/60 text-red-300 bg-red-500/15">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
      LIVE · POKKÉN
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-display tracking-wider px-2 py-0.5 rounded-full border border-slate-600/60 text-slate-400 bg-slate-500/10"
          title={s.live_game_name || ''}>
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      LIVE{s.live_game_name ? ` · ${s.live_game_name.toUpperCase()}` : ''}
    </span>
  );
}

function StreamerCard({ s }) {
  const channelUrl = `https://www.twitch.tv/${s.login}`;
  const liveInPokken = s.is_live && POKKEN_RE.test(s.live_game_name || '');
  return (
    <div className={`bg-[#0c1425] border rounded-xl p-4 flex flex-col gap-3 transition-colors ${
      liveInPokken ? 'border-red-500/50 hover:border-red-400/70' : 'border-[#1a2744] hover:border-violet-500/40'
    }`}>
      <div className="flex items-center gap-3">
        {s.avatar_url ? (
          <img src={s.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover bg-[#15203a]" loading="lazy" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#15203a] grid place-items-center text-lg">📺</div>
        )}
        <div className="min-w-0 flex-1">
          <a href={channelUrl} target="_blank" rel="noreferrer"
             className="font-semibold text-white hover:text-violet-300 transition-colors truncate block">
            {s.display_name || s.login}
          </a>
          <span className="text-xs text-slate-500 truncate block">twitch.tv/{s.login}</span>
        </div>
        <LiveBadge s={s} />
      </div>

      {/* Live title takes priority; otherwise the last Pokkén stream */}
      {s.is_live && s.live_title && (
        <p className="text-xs text-slate-300 line-clamp-2" title={s.live_title}>{s.live_title}</p>
      )}

      <div className="mt-auto text-xs">
        {liveInPokken ? (
          <span className="text-red-300">Streaming Pokkén right now</span>
        ) : s.last_pokken_stream_at ? (
          <div className="space-y-1">
            <div className="flex items-baseline gap-2 text-slate-300">
              <span className="text-slate-500 shrink-0">Last Pokkén stream:</span>
              <span title={fullDate(s.last_pokken_stream_at) || ''}>
                {relativeTime(s.last_pokken_stream_at)}
              </span>
            </div>
            {s.last_pokken_title && (
              s.last_pokken_vod_url ? (
                <a href={s.last_pokken_vod_url} target="_blank" rel="noreferrer"
                   className="flex items-baseline gap-2 text-slate-400 hover:text-violet-300 transition-colors">
                  <span className="text-slate-600 shrink-0">▶</span>
                  <span className="truncate" title={s.last_pokken_title}>{s.last_pokken_title}</span>
                </a>
              ) : (
                <p className="text-slate-500 truncate" title={s.last_pokken_title}>{s.last_pokken_title}</p>
              )
            )}
          </div>
        ) : (
          <span className="text-slate-600">No Pokkén stream tracked yet</span>
        )}
      </div>
    </div>
  );
}

export default function Twitch() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTwitchStreamers()
      .then(setData)
      .catch(() => { /* leave empty state */ })
      .finally(() => setLoading(false));
  }, []);

  const streamers = data?.streamers || [];
  const liveCount = streamers.filter(s => s.is_live && POKKEN_RE.test(s.live_game_name || '')).length;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-2xl tracking-widest text-white">TWITCH STREAMS</h1>
        <span className="text-xs text-slate-500 font-display tracking-wider">
          {loading ? '…' : `${streamers.length} CHANNELS${liveCount ? ` · ${liveCount} LIVE IN POKKÉN` : ''}`}
        </span>
      </div>

      {loading && <p className="text-slate-400">Loading…</p>}

      {!loading && data && !data.configured && (
        <p className="text-xs text-amber-400/80 mb-4">
          Twitch API credentials aren't configured on the server — live status and stream dates
          shown here may be stale or missing.
        </p>
      )}

      {!loading && streamers.length === 0 && (
        <p className="text-slate-500 text-sm bg-[#0c1425] border border-[#1a2744] rounded-xl px-4 py-8 text-center">
          No channels yet. Run <code className="text-violet-300">node run_migration.js backend/src/db/migrations/add_twitch_streamers.sql</code> to seed them.
        </p>
      )}

      {!loading && streamers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {streamers.map(s => <StreamerCard key={s.id} s={s} />)}
        </div>
      )}

      {!loading && data?.last_checked_at && (
        <p className="mt-6 text-[11px] text-slate-600">
          Dates come from live status + Pokkén-category VODs (Twitch keeps VODs 14–60 days, so
          older streams show the last date we saw). Updated {relativeTime(data.last_checked_at)}.
        </p>
      )}
    </div>
  );
}
