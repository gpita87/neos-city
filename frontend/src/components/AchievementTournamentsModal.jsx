import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAchievementTournaments } from '../lib/api';
import { formatDate } from '../lib/utils';

// Map a raw final_rank into a short label
function rankLabel(rank) {
  if (rank == null) return null;
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

function rankColor(rank) {
  if (rank == null) return 'text-slate-500';
  if (rank === 1) return 'text-yellow-400';
  if (rank === 2) return 'text-slate-300';
  if (rank <= 4)  return 'text-cyan-400';
  if (rank <= 8)  return 'text-emerald-400';
  return 'text-slate-500';
}

const SERIES_BADGE = {
  ffc:    { label: 'FFC',     class: 'bg-purple-900/40 text-purple-300 border-purple-700/40' },
  rtg_na: { label: 'RTG NA',  class: 'bg-blue-900/40 text-blue-300 border-blue-700/40' },
  rtg_eu: { label: 'RTG EU',  class: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' },
  dcm:    { label: 'DCM',     class: 'bg-orange-900/40 text-orange-300 border-orange-700/40' },
  tcc:    { label: 'TCC',     class: 'bg-pink-900/40 text-pink-300 border-pink-700/40' },
  eotr:   { label: 'EOTR',    class: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40' },
  nezumi: { label: 'ねずみ杯', class: 'bg-rose-900/40 text-rose-300 border-rose-700/40' },
  nezumi_rookies: { label: 'Rookies', class: 'bg-amber-900/40 text-amber-300 border-amber-700/40' },
  ha:     { label: "Heaven's Arena", class: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40' },
  worlds: { label: 'Worlds',  class: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40' },
  major:  { label: 'Major',   class: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40' },
  regional: { label: 'Regional', class: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40' },
  other:  { label: 'Other',   class: 'bg-slate-800/60 text-slate-400 border-slate-700/40' },
};

function SeriesBadge({ series }) {
  const meta = SERIES_BADGE[series] || SERIES_BADGE.other;
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.class}`}>
      {meta.label}
    </span>
  );
}

const REGION_LABELS_LOCAL = {
  kanto: 'Kanto', johto: 'Johto', hoenn: 'Hoenn', sinnoh: 'Sinnoh',
  unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea',
};

// Region tier colors for the qualifying-tier chip and the highest-region
// chips. Mirrors PlayerProfile's REGION_COLORS but kept local so the modal
// stays self-contained.
const REGION_CHIP_COLORS = {
  kanto:  'bg-red-900/30 text-red-300 border-red-800/40',
  johto:  'bg-purple-900/30 text-purple-300 border-purple-800/40',
  hoenn:  'bg-emerald-900/30 text-emerald-300 border-emerald-800/40',
  sinnoh: 'bg-blue-900/30 text-blue-300 border-blue-800/40',
  unova:  'bg-slate-700/40 text-slate-200 border-slate-600/50',
  kalos:  'bg-sky-900/30 text-sky-300 border-sky-800/40',
  alola:  'bg-orange-900/30 text-orange-300 border-orange-800/40',
  galar:  'bg-pink-900/30 text-pink-300 border-pink-800/40',
  paldea: 'bg-fuchsia-900/30 text-fuchsia-300 border-fuchsia-800/40',
};

const TIER_DISPLAY = [
  { key: 'gym_leader', icon: '🏟️', name: 'Gym Leader' },
  { key: 'elite_four', icon: '4️⃣', name: 'Elite Four' },
  { key: 'rival',      icon: '🔥', name: 'Rival' },
  { key: 'champion',   icon: '👑', name: 'Champion' },
];

/**
 * Header shown above the opponent list for meta achievements. Driven by the
 * backend's `meta` payload, which spells out the verb, kind, region, and
 * required count. Falls back to neutral phrasing if the payload is partial.
 */
function MetaExplainer({ meta, count }) {
  const required = meta?.required ?? 1;
  const unlocked = count >= required;
  const regionName = meta?.region_name || '';
  const kindLabel = meta?.kind_label || 'qualifying opponents';
  const verb = meta?.verb || 'Faced';

  // "any Gym Leader" for Kanto-tier achievements, otherwise "Gym Leaders at Kalos+".
  const tierPhrase = meta?.region === 'kanto'
    ? `any ${kindLabel.replace(/s$/, '')}`
    : `${kindLabel} at ${regionName}+`;

  return (
    <div className="bg-cyan-900/10 border border-cyan-800/30 rounded-lg p-3 mb-4">
      <p className="text-xs text-slate-300 leading-relaxed">
        <span className="text-cyan-300 font-medium">How this is earned:</span>{' '}
        {verb}{' '}
        {required === 1 ? 'a ' : `${required} unique `}
        {tierPhrase}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-slate-400 font-display tracking-wider">PROGRESS</span>
        <span className={`text-[11px] font-display tracking-wider ${unlocked ? 'text-cyan-300' : 'text-slate-400'}`}>
          {Math.min(count, required)} / {required} {unlocked && count > required && (
            <span className="text-slate-500 normal-case tracking-normal">
              ({count} on file)
            </span>
          )}
        </span>
        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${unlocked ? 'bg-cyan-400' : 'bg-cyan-500/60'}`}
            style={{ width: `${Math.min(100, (count / required) * 100)}%` }}
          />
        </div>
      </div>
      {meta?.stale_filtered > 0 && (
        <p className="mt-2 text-[10px] text-slate-500 italic">
          {meta.stale_filtered} historical contributor row{meta.stale_filtered === 1 ? '' : 's'} hidden — opponent no longer qualifies at this tier.
        </p>
      )}
    </div>
  );
}

/**
 * Pills showing an opponent's highest region across all 4 placement tiers.
 * Hides tiers the opponent hasn't reached.
 */
function HighestRegionsRow({ highestRegions }) {
  if (!highestRegions) return null;
  const visible = TIER_DISPLAY.filter(t => highestRegions[t.key]);
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {visible.map(t => {
        const region = highestRegions[t.key];
        const color = REGION_CHIP_COLORS[region] || 'bg-white/5 text-slate-400 border-slate-700/40';
        return (
          <span
            key={t.key}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${color}`}
            title={`${REGION_LABELS_LOCAL[region] || region} ${t.name}`}
          >
            <span>{t.icon}</span>
            <span>{REGION_LABELS_LOCAL[region] || region}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Big chip showing why an opponent qualifies for the current achievement —
 * e.g. "👑 Kalos Champion". Coloured by the qualifying region tier.
 */
function QualifyingBadge({ qualifying }) {
  if (!qualifying) return null;
  const color = REGION_CHIP_COLORS[qualifying.region] || 'bg-white/5 text-slate-400 border-slate-700/40';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium ${color}`}
      title={`Qualifies because they hold ${qualifying.region_name} ${qualifying.tier_name}`}
    >
      <span>{qualifying.tier_icon || '👑'}</span>
      <span>{qualifying.region_name} {qualifying.tier_name}</span>
    </span>
  );
}

/**
 * Modal listing the tournaments that contributed to an achievement.
 *
 * Props:
 *   - achievement: { id, name, description, icon }   (required)
 *   - playerId:    number | null  (when set, scopes the list to that player)
 *   - playerName:  string | null  (display only — used in the header)
 *   - onClose:     () => void
 */
export default function AchievementTournamentsModal({ achievement, playerId = null, playerName = null, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!achievement?.id) return;
    let cancelled = false;
    setData(null);
    setError(null);
    getAchievementTournaments(achievement.id, playerId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load'); });
    return () => { cancelled = true; };
  }, [achievement?.id, playerId]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!achievement) return null;

  const tournaments = data?.tournaments || [];
  const mode = data?.mode;
  const meta = data?.meta || null;

  // For meta achievements, the natural unit is the unique opponent — you
  // earn 8 Badges by defeating eight different Gym Leaders, and the modal
  // should reflect that. The backend returns a structured `meta` payload
  // for every meta achievement in player mode — global ('meta' category)
  // AND series-scoped ('series_ha', 'series_ffc', etc.). The presence of
  // `meta.opponents` is the authoritative signal; gating on category here
  // hid the modal for HA / FFC / RTG / DCM / TCC / EOTR / nezumi /
  // worlds / major / regional Dark Horse + 8 Badges + Elite Trainer + …
  // variants, so they fell through to the empty `tournaments[]` branch.
  const useMetaView = mode === 'player' && meta && Array.isArray(meta.opponents);

  let displayRows = tournaments;

  if (mode === 'player' && !useMetaView) {
    // Match-based + placement: group tournament rows, aggregate opponents inline
    const byId = new Map();
    for (const t of tournaments) {
      const key = t.id || `null_${t.match_id || Math.random()}`;
      if (!byId.has(key)) {
        byId.set(key, { ...t, opponents: [] });
      }
      const row = byId.get(key);
      if (t.opponent_id && !row.opponents.find(o => o.id === t.opponent_id)) {
        row.opponents.push({ id: t.opponent_id, name: t.opponent_name, username: t.opponent_username });
      }
    }
    displayRows = [...byId.values()];
  }

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
          <span className="text-4xl shrink-0">{achievement.icon}</span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg tracking-wide text-white">{achievement.name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{achievement.description}</p>
            {playerName && (
              <p className="text-[11px] text-cyan-400 mt-1 font-display tracking-wider">
                {playerName.toUpperCase()}'S CONTRIBUTING TOURNAMENTS
              </p>
            )}
            {!playerName && mode === 'aggregate' && (
              <p className="text-[11px] text-cyan-400 mt-1 font-display tracking-wider">
                ALL UNLOCKS
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-slate-400 hover:text-white text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 flex-1">
          {error && (
            <p className="text-red-400 text-sm">Failed to load: {error}</p>
          )}
          {!data && !error && (
            <p className="text-slate-500 text-sm">Loading...</p>
          )}

          {/* ── Meta-achievement view (player mode): grouped by unique opponent ── */}
          {data && useMetaView && (
            <>
              <MetaExplainer meta={meta} count={meta.opponents.length} />
              {meta.opponents.length === 0 ? (
                <p className="text-slate-500 text-sm">
                  No qualifying opponents on file.
                  This achievement may have been unlocked before opponent tracking was added,
                  or earlier contributors no longer hold a qualifying tier.
                </p>
              ) : (
                <ul className="space-y-2">
                  {meta.opponents.map((opp, oidx) => {
                    const t = opp.match?.tournament;
                    const score = opp.match
                      ? (opp.match.player1_id === playerId
                          ? `${opp.match.player1_score}–${opp.match.player2_score}`
                          : `${opp.match.player2_score}–${opp.match.player1_score}`)
                      : null;
                    return (
                      <li
                        key={`opp_${opp.opponent_id ?? oidx}`}
                        className="bg-white/5 border border-[#1a2744] rounded-lg p-3"
                      >
                        {/* Row 1: index, name, qualifying badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="shrink-0 w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-display flex items-center justify-center">
                            {oidx + 1}
                          </span>
                          {opp.opponent_id ? (
                            <Link
                              to={`/players/${opp.opponent_id}`}
                              onClick={onClose}
                              className="text-sm font-medium text-white hover:text-cyan-400 truncate"
                            >
                              {opp.opponent_name || opp.opponent_username || `Player #${opp.opponent_id}`}
                            </Link>
                          ) : (
                            <span className="text-sm text-slate-500 italic">Opponent unknown</span>
                          )}
                          <QualifyingBadge qualifying={opp.qualifying} />
                        </div>

                        {/* Row 2: full highest-region pills (context) */}
                        <div className="ml-9">
                          <HighestRegionsRow highestRegions={opp.highest_regions} />
                        </div>

                        {/* Row 3: where this qualifying win/game happened */}
                        {opp.match ? (
                          <div className="ml-9 mt-2 flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                            <span className="text-slate-600">↳</span>
                            {t?.id ? (
                              <Link
                                to={`/tournaments/${t.id}`}
                                onClick={onClose}
                                className="text-slate-300 hover:text-cyan-400 truncate"
                              >
                                {t.name}
                              </Link>
                            ) : (
                              <span className="text-slate-500 italic">Tournament unknown</span>
                            )}
                            {t?.series && <SeriesBadge series={t.series} />}
                            {t?.completed_at && (
                              <span className="text-slate-600">{formatDate(t.completed_at)}</span>
                            )}
                            {score && (
                              <span className="text-slate-500 font-display">
                                {score}
                              </span>
                            )}
                            {t?.bracket_url && (
                              <a
                                href={t.bracket_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-cyan-400 hover:text-cyan-300 hover:underline"
                                title={`Open bracket on ${t.bracket_host || 'the original site'}`}
                              >
                                🔗 {t.bracket_host || 'Bracket'}
                              </a>
                            )}
                          </div>
                        ) : (
                          <p className="ml-9 mt-2 text-[11px] text-slate-500 italic">
                            Match context unavailable.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {/* ── Standard view (placement, match-based, aggregate) ── */}
          {data && !useMetaView && displayRows.length === 0 && (
            <p className="text-slate-500 text-sm">
              No contributing tournaments on file.
              {mode === 'player' && ' This achievement may have been unlocked before tournament tracking was added.'}
            </p>
          )}
          {data && !useMetaView && displayRows.length > 0 && (
            <ul className="space-y-2">
              {displayRows.map((t, idx) => (
                <li
                  key={`${t.id ?? 'unknown'}_${t.player_id ?? idx}`}
                  className="bg-white/5 border border-[#1a2744] rounded-lg p-3 flex items-center gap-3"
                >
                  {/* Rank */}
                  {t.final_rank != null && (
                    <span className={`shrink-0 w-12 text-center font-display font-bold tracking-wide ${rankColor(t.final_rank)}`}>
                      {rankLabel(t.final_rank)}
                    </span>
                  )}

                  {/* Tournament info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {t.id ? (
                        <Link
                          to={`/tournaments/${t.id}`}
                          onClick={onClose}
                          className="text-sm font-medium text-white hover:text-cyan-400 truncate"
                        >
                          {t.name}
                        </Link>
                      ) : (
                        <span className="text-sm text-slate-500 italic">Tournament unknown</span>
                      )}
                      {t.series && <SeriesBadge series={t.series} />}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                      {t.completed_at && <span>{formatDate(t.completed_at)}</span>}
                      {t.participants_count != null && (
                        <span>{t.participants_count} entrants</span>
                      )}
                      {/* Aggregate mode: who unlocked it */}
                      {mode === 'aggregate' && t.player_name && (
                        <Link
                          to={`/players/${t.player_id}`}
                          onClick={onClose}
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          {t.player_name}
                        </Link>
                      )}
                      {/* Match/Meta opponents */}
                      {t.opponents && t.opponents.length > 0 && (
                        <span className="text-slate-400">
                          vs{' '}
                          {t.opponents.map((o, i) => (
                            <span key={o.id}>
                              {i > 0 && ', '}
                              <Link
                                to={`/players/${o.id}`}
                                onClick={onClose}
                                className="text-slate-300 hover:text-cyan-400"
                              >
                                {o.name}
                              </Link>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bracket link */}
                  {t.bracket_url && (
                    <a
                      href={t.bracket_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline"
                      title={`Open bracket on ${t.bracket_host || 'the original site'}`}
                    >
                      🔗 {t.bracket_host || 'Bracket'}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1a2744] flex items-center justify-between text-[11px] text-slate-500">
          <span>
            {data && useMetaView && meta.opponents.length > 0 && (
              <>
                {meta.opponents.length} {meta.opponents.length === 1 ? 'opponent' : 'unique opponents'}
              </>
            )}
            {data && !useMetaView && displayRows.length > 0 && (
              <>
                {displayRows.length} {displayRows.length === 1 ? 'tournament' : 'tournaments'}
                {mode === 'aggregate' && ' • across all holders'}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
