import { useEffect, useState } from 'react';
import { getOfflinePlacements } from '../lib/api';
import { formatDate } from '../lib/utils';

const TIER_META = {
  worlds:   { label: 'Worlds',    icon: '🌍', color: 'text-yellow-400' },
  major:    { label: 'Majors',    icon: '🏟️', color: 'text-cyan-400' },
  regional: { label: 'Regionals', icon: '🗺️', color: 'text-emerald-400' },
  other:    { label: 'Locals',    icon: '📍', color: 'text-slate-400' },
};

const PLACEMENT_META = {
  wins:      { label: '1st Place',       short: '1ST',   color: 'text-yellow-400' },
  runner_up: { label: 'Runner-Up',       short: '2ND',   color: 'text-slate-200' },
  top4:      { label: 'Top 4 Finishes',  short: 'TOP 4', color: 'text-cyan-300' },
  top8:      { label: 'Top 8 Finishes',  short: 'TOP 8', color: 'text-emerald-300' },
};

function rankLabel(rank) {
  if (rank == null) return '—';
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

function rankColor(rank) {
  if (rank == null) return 'text-slate-500';
  if (rank === 1) return 'text-yellow-400';
  if (rank === 2) return 'text-slate-200';
  if (rank <= 4)  return 'text-cyan-300';
  if (rank <= 8)  return 'text-emerald-300';
  return 'text-slate-500';
}

// Build a Liquipedia URL from whichever column is populated. Returns null if
// neither liquipedia_url nor liquipedia_slug is set.
function liquipediaHref(t) {
  if (t.liquipedia_url) return t.liquipedia_url;
  if (t.liquipedia_slug) {
    return `https://liquipedia.net/fighters/Pokk%C3%A9n_Tournament/${encodeURIComponent(t.liquipedia_slug)}`;
  }
  return null;
}

/**
 * Modal listing the offline tournaments that contributed to one cell of a
 * player's offline-record table (e.g. "Majors → TOP 8 = 2").
 *
 * Props:
 *   - playerId:   number   (required)
 *   - playerName: string   (display only)
 *   - tier:       'worlds' | 'major' | 'regional' | 'other'
 *   - placement:  'wins' | 'runner_up' | 'top4' | 'top8'
 *   - onClose:    () => void
 */
export default function OfflinePlacementsModal({ playerId, playerName, tier, placement, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!playerId || !tier || !placement) return;
    let cancelled = false;
    setData(null);
    setError(null);
    getOfflinePlacements(playerId, tier, placement)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e?.response?.data?.error || e.message || 'Failed to load'); });
    return () => { cancelled = true; };
  }, [playerId, tier, placement]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!playerId || !tier || !placement) return null;

  const tierMeta = TIER_META[tier] || TIER_META.other;
  const placementMeta = PLACEMENT_META[placement] || {};
  const tournaments = data?.tournaments || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0c1425] border border-[#1a2744] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 p-5 border-b border-[#1a2744]">
          <span className="text-4xl shrink-0">{tierMeta.icon}</span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg tracking-wide text-white">
              <span className={tierMeta.color}>{tierMeta.label}</span>
              <span className="text-slate-500"> — </span>
              <span className={placementMeta.color || 'text-white'}>{placementMeta.label}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {playerName ? <>Offline events {playerName} placed in. </> : null}
              {placement === 'top4' && (
                <span className="text-slate-500">Includes 1st and 2nd place finishes.</span>
              )}
              {placement === 'top8' && (
                <span className="text-slate-500">Includes all top-4 and top-8 finishes.</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
          {!error && data == null && (
            <p className="text-slate-500 text-sm">Loading…</p>
          )}
          {!error && data && tournaments.length === 0 && (
            <p className="text-slate-500 text-sm">No contributing tournaments on file.</p>
          )}
          {!error && tournaments.length > 0 && (
            <ul className="space-y-2">
              {tournaments.map(t => {
                const href = liquipediaHref(t);
                return (
                  <li
                    key={t.id}
                    className="bg-white/5 border border-[#1a2744] rounded-lg p-3 flex items-start gap-3"
                  >
                    <span
                      className={`shrink-0 w-12 text-center text-sm font-bold ${rankColor(t.final_rank)}`}
                      title={`Final rank: ${rankLabel(t.final_rank)}`}
                    >
                      {rankLabel(t.final_rank)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white break-words">
                        {t.name || '(unnamed event)'}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatDate(t.completed_at || t.started_at)}
                        {t.location ? <> · {t.location}</> : null}
                        {t.prize_pool ? <> · {t.prize_pool}</> : null}
                        {t.participants_count ? <> · {t.participants_count} entrants</> : null}
                      </p>
                    </div>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-xs px-2 py-1 rounded border border-cyan-700/40 bg-cyan-900/20 text-cyan-300 hover:bg-cyan-900/40 transition-colors"
                        title="Open on Liquipedia"
                      >
                        Liquipedia ↗
                      </a>
                    ) : (
                      <span
                        className="shrink-0 text-[10px] text-slate-600 italic"
                        title="No Liquipedia URL on file for this tournament"
                      >
                        no link
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1a2744] flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            {tournaments.length > 0 && (
              <>{tournaments.length} event{tournaments.length === 1 ? '' : 's'}</>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded bg-white/5 border border-[#1a2744] text-slate-300 hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
