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

// How many unique opponents an achievement requires, derived from its ID.
// Mirrors the META_TYPES.required field on the backend so we don't need an
// extra round-trip to display "X of N defeated".
const META_REQUIRED = {
  eight_badges:   { required: 8, kind: 'Gym Leaders', verb: 'Defeated' },
  elite_trainer:  { required: 4, kind: 'Elite Four',  verb: 'Defeated' },
  rival_battle:   { required: 1, kind: 'Rival',       verb: 'Took a game from' },
  smell_ya_later: { required: 1, kind: 'Rival',       verb: 'Defeated' },
  foreshadowing:  { required: 1, kind: 'Champion',    verb: 'Took a game from' },
  dark_horse:     { required: 1, kind: 'Champion',    verb: 'Defeated' },
};

function metaTypeFromId(id) {
  if (!id) return null;
  for (const key of Object.keys(META_REQUIRED)) {
    if (id.startsWith(`${key}_`)) return key;
  }
  return null;
}

// Region tier baked into the achievement ID — last segment.
function regionFromId(id) {
  if (!id) return null;
  const parts = String(id).split('_');
  return parts[parts.length - 1];
}

const REGION_LABELS_LOCAL = {
  kanto: 'Kanto', johto: 'Johto', hoenn: 'Hoenn', sinnoh: 'Sinnoh',
  unova: 'Unova', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea',
};

/**
 * Header shown above the opponent list for meta achievements.
 * Spells out the rule, the count, and progress toward (or past) unlock.
 */
function MetaExplainer({ achievement, count }) {
  const metaKey = metaTypeFromId(achievement.id);
  const meta = metaKey ? META_REQUIRED[metaKey] : null;
  const region = regionFromId(achievement.id);
  const regionName = REGION_LABELS_LOCAL[region] || region;

  // Region tier of opponents that count: kanto means "any", everything else is "X+"
  const tierPhrase = region === 'kanto'
    ? `any ${meta?.kind || 'qualifying opponents'}`
    : `${meta?.kind || 'qualifying opponents'} at ${regionName}+`;

  const required = meta?.required ?? 1;
  const unlocked = count >= required;

  return (
    <div className="bg-cyan-900/10 border border-cyan-800/30 rounded-lg p-3 mb-4">
      <p className="text-xs text-slate-300 leading-relaxed">
        <span className="text-cyan-300 font-medium">How this is earned:</span>{' '}
        {meta?.verb || 'Faced'}{' '}
        {required === 1 ? 'a ' : `${required} unique `}
        {tierPhrase}{required === 1 ? '' : ''}.
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
    </div>
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

  // For meta achievements, the natural unit is the unique opponent — you
  // earn 8 Badges by defeating eight different Gym Leaders, and the modal
  // should reflect that. We pivot from tournament-per-row to opponent-per-row
  // and list the tournaments where each qualifying interaction took place.
  const isMeta = achievement.category === 'meta';

  let displayRows = tournaments;
  let opponentGroups = null;

  if (mode === 'player' && isMeta) {
    // Build opponent → { id, name, username, tournaments[] } map
    const byOpp = new Map();
    for (const t of tournaments) {
      const oid = t.opponent_id;
      if (!oid) continue; // meta rows always carry an opponent
      if (!byOpp.has(oid)) {
        byOpp.set(oid, {
          id: oid,
          name: t.opponent_name,
          username: t.opponent_username,
          tournaments: [],
        });
      }
      const grp = byOpp.get(oid);
      // Avoid double-listing the same tournament for one opponent
      if (t.id != null && !grp.tournaments.find(x => x.id === t.id && x.match_id === t.match_id)) {
        grp.tournaments.push(t);
      } else if (t.id == null) {
        grp.tournaments.push(t);
      }
    }
    opponentGroups = [...byOpp.values()];
  } else if (mode === 'player') {
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
          {data && mode === 'player' && isMeta && opponentGroups && (
            <>
              <MetaExplainer achievement={achievement} count={opponentGroups.length} />
              {opponentGroups.length === 0 ? (
                <p className="text-slate-500 text-sm">
                  No qualifying opponents on file.
                  This achievement may have been unlocked before opponent tracking was added.
                </p>
              ) : (
                <ul className="space-y-2">
                  {opponentGroups.map((opp, oidx) => (
                    <li
                      key={`opp_${opp.id ?? oidx}`}
                      className="bg-white/5 border border-[#1a2744] rounded-lg p-3"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="shrink-0 w-7 h-7 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-display flex items-center justify-center">
                          {oidx + 1}
                        </span>
                        {opp.id ? (
                          <Link
                            to={`/players/${opp.id}`}
                            onClick={onClose}
                            className="text-sm font-medium text-white hover:text-cyan-400 truncate"
                          >
                            {opp.name || opp.username || `Player #${opp.id}`}
                          </Link>
                        ) : (
                          <span className="text-sm text-slate-500 italic">Opponent unknown</span>
                        )}
                      </div>
                      {opp.tournaments.length === 0 ? (
                        <p className="text-[11px] text-slate-500 ml-9 italic">Tournament context unavailable.</p>
                      ) : (
                        <ul className="space-y-1 ml-9">
                          {opp.tournaments.map((t, tidx) => (
                            <li
                              key={`opp_${opp.id}_t_${t.id ?? tidx}_${t.match_id ?? tidx}`}
                              className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap"
                            >
                              <span className="text-slate-600">↳</span>
                              {t.id ? (
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
                              {t.series && <SeriesBadge series={t.series} />}
                              {t.completed_at && (
                                <span className="text-slate-600">{formatDate(t.completed_at)}</span>
                              )}
                              {t.bracket_url && (
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
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* ── Standard view (placement, match-based, aggregate) ── */}
          {data && !(mode === 'player' && isMeta) && displayRows.length === 0 && (
            <p className="text-slate-500 text-sm">
              No contributing tournaments on file.
              {mode === 'player' && ' This achievement may have been unlocked before tournament tracking was added.'}
            </p>
          )}
          {data && !(mode === 'player' && isMeta) && displayRows.length > 0 && (
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
            {data && mode === 'player' && isMeta && opponentGroups && opponentGroups.length > 0 && (
              <>
                {opponentGroups.length} {opponentGroups.length === 1 ? 'opponent' : 'unique opponents'}
              </>
            )}
            {data && !(mode === 'player' && isMeta) && displayRows.length > 0 && (
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
