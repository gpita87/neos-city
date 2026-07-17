import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getArenaTournament, registerArena, withdrawArena, pauseArena, resumeArena,
  reportArenaMatch, patchMe,
} from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useArenaSocket } from '../hooks/useArenaSocket';
import { ARENA_STATUS_META } from './Arena';

// Countdown driven by SERVER time: `offsetMs` is (server_now - client now),
// captured whenever a payload carrying server_now arrives, so a wrong local
// clock can't skew the tournament clock.
function ArenaClock({ tournament, offsetMs }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const serverNow = Date.now() + offsetMs;
  let label; let target;
  if (tournament.status === 'scheduled') {
    label = 'Starts in'; target = new Date(tournament.starts_at).getTime();
  } else if (tournament.status === 'live') {
    label = 'Time left'; target = new Date(tournament.ends_at).getTime();
  } else {
    return null;
  }

  const ms = Math.max(0, target - serverNow);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return (
    <div className="text-right">
      <div className="text-xs font-display text-slate-400 tracking-widest uppercase">{label}</div>
      <div className="font-display text-2xl text-cyan-300 tracking-widest tabular-nums">
        {h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`}
      </div>
    </div>
  );
}

function Scoreboard({ standings, myUserId }) {
  if (!standings.length) {
    return <p className="text-slate-500 text-sm">No players registered yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs font-display text-slate-500 tracking-widest uppercase text-left">
          <th className="py-2 pr-2 w-8">#</th>
          <th className="py-2 pr-2">Player</th>
          <th className="py-2 pr-2 text-right">Score</th>
          <th className="py-2 pr-2 text-right">W–L</th>
          <th className="py-2 text-right">Streak</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((p, i) => (
          <tr
            key={p.user_id}
            className={`border-t border-[#1a2744] ${p.user_id === myUserId ? 'bg-cyan-500/5' : ''} ${p.status !== 'active' ? 'opacity-50' : ''}`}
          >
            <td className="py-2 pr-2 text-slate-500">{i + 1}</td>
            <td className="py-2 pr-2">
              <span className="flex items-center gap-2">
                {p.avatar_url
                  ? <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                  : <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[10px]">⚔️</span>}
                {p.player_id
                  ? <Link to={`/players/${p.player_id}`} className="text-slate-200 hover:text-cyan-300">{p.name}</Link>
                  : <span className="text-slate-200">{p.name}</span>}
                {p.status === 'paused' && <span className="text-xs text-slate-500">(paused)</span>}
                {p.status === 'withdrawn' && <span className="text-xs text-slate-500">(withdrew)</span>}
              </span>
            </td>
            <td className="py-2 pr-2 text-right font-display text-cyan-300 tabular-nums">{p.score}</td>
            <td className="py-2 pr-2 text-right text-slate-400 tabular-nums">{p.wins}–{p.losses}</td>
            <td className="py-2 text-right tabular-nums">
              {p.streak >= 2 ? <span className="text-amber-400">🔥 {p.streak}</span> : <span className="text-slate-500">{p.streak}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Inline editor for the user's Pokkén in-game name — what the opponent looks
// for inside the Group to make sure they matched the right player.
function IngameNameEditor() {
  const { user, refresh } = useAuth();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!user) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await patchMe({ ingame_name: value });
      await refresh();
      setEditing(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span className="text-xs text-slate-400">
        Your in-game name:{' '}
        {user.ingame_name
          ? <span className="text-slate-200 font-medium">{user.ingame_name}</span>
          : <span className="text-amber-400">not set — opponents need it to find you</span>}
        <button
          onClick={() => { setValue(user.ingame_name || ''); setEditing(true); }}
          className="ml-2 text-cyan-300 hover:underline"
        >
          {user.ingame_name ? 'Edit' : 'Set it'}
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        maxLength={40}
        placeholder="In-game name"
        autoFocus
        className="bg-[#050a18] border border-[#1a2744] rounded px-2 py-1 text-slate-200 text-xs w-44 focus:outline-none focus:border-cyan-500/50"
      />
      <button onClick={save} disabled={saving} className="text-cyan-300 hover:underline disabled:opacity-50">Save</button>
      <button onClick={() => setEditing(false)} disabled={saving} className="text-slate-500 hover:text-slate-300">Cancel</button>
      {error && <span className="text-red-400">{error}</span>}
    </span>
  );
}

function describeReport(report, opponentName, myUserId) {
  const mine = Number(report.winner_user_id) === Number(myUserId);
  return `${mine ? 'You' : opponentName} won 2–${report.loser_games}`;
}

// The player's live match: who to fight, where to find them, and result
// reporting with dual-verification states (awaiting / disputed).
function CurrentMatchPanel({ match, myUserId, onOpenReport, tournamentStatus }) {
  const opponent = match.opponent;
  const opponentName = opponent?.name || 'Opponent';
  const reports = match.reports || [];
  const myReport = reports.find((r) => Number(r.reporter_user_id) === Number(myUserId));
  const theirReport = reports.find((r) => Number(r.reporter_user_id) !== Number(myUserId));

  return (
    <div className={`bg-[#0c1425] border rounded-xl p-5 ${match.status === 'disputed' ? 'border-red-500/50' : 'border-emerald-500/40'}`}>
      <h2 className="font-display text-sm tracking-widest text-emerald-300 uppercase">Your Match</h2>

      <div className="mt-3 flex items-center gap-3">
        {opponent?.avatar_url
          ? <img src={opponent.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
          : <span className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">⚔️</span>}
        <div>
          <p className="text-slate-200">vs <span className="font-medium">{opponentName}</span></p>
          <p className="text-sm text-cyan-300">
            In game, look for: <span className="font-semibold">{opponent?.ingame_name || opponentName}</span>
            {!opponent?.ingame_name && <span className="text-xs text-slate-500"> (no in-game name on file — using display name)</span>}
          </p>
        </div>
      </div>

      {match.sharedGroups?.length > 0 ? (
        <div className="mt-3 text-sm text-slate-400">
          Shared groups:{' '}
          {match.sharedGroups.map((g) => (
            <span key={g.id} className="inline-block mr-1 px-2 py-0.5 rounded bg-cyan-900/40 text-cyan-300 border border-cyan-700/50 text-xs">
              {g.name}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No shared groups on file — coordinate in chat (coming soon).</p>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Best 2 of 3 — switch supports freely; no character switch after a win.
      </p>
      {tournamentStatus === 'finished' && (
        <p className="mt-1 text-xs text-amber-400">
          The clock has expired — finish this match and report; it still counts.
        </p>
      )}

      {/* Result reporting states */}
      <div className="mt-4 border-t border-[#1a2744] pt-4">
        {match.status === 'active' && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={onOpenReport}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-[#050a18] hover:bg-emerald-400 transition-colors"
            >
              Report result
            </button>
            <span className="text-xs text-slate-500">Play your set, then either player reports.</span>
          </div>
        )}

        {match.status === 'awaiting_confirm' && myReport && !theirReport && (
          <div className="text-sm">
            <p className="text-amber-300">
              You reported: <span className="font-medium">{describeReport(myReport, opponentName, myUserId)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Waiting for {opponentName} to confirm — it auto-confirms after 5 minutes.
            </p>
            <button onClick={onOpenReport} className="mt-2 text-xs text-slate-400 hover:text-cyan-300">
              Change my report
            </button>
          </div>
        )}

        {match.status === 'awaiting_confirm' && theirReport && !myReport && (
          <div className="text-sm">
            <p className="text-amber-300">
              {opponentName} reported: <span className="font-medium">{describeReport(theirReport, opponentName, myUserId)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Report your result — matching reports confirm instantly.
            </p>
            <button
              onClick={onOpenReport}
              className="mt-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 text-[#050a18] hover:bg-emerald-400 transition-colors"
            >
              Report result
            </button>
          </div>
        )}

        {match.status === 'disputed' && (
          <div className="text-sm">
            <p className="text-red-400 font-medium">Reports conflict</p>
            <ul className="mt-1 text-xs text-slate-400 space-y-0.5">
              {myReport && <li>You reported: {describeReport(myReport, opponentName, myUserId)}</li>}
              {theirReport && <li>{opponentName} reported: {describeReport(theirReport, opponentName, myUserId)}</li>}
            </ul>
            <p className="mt-1 text-xs text-slate-500">
              Re-report to converge on the real result, or an admin will resolve it.
            </p>
            <button
              onClick={onOpenReport}
              className="mt-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-red-500/80 text-[#050a18] hover:bg-red-400 transition-colors"
            >
              Re-report result
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// You/Opponent winner picker + 2-0 / 2-1 score picker.
function ReportResultModal({ match, myUserId, onClose, onSubmit, busy, error }) {
  const opponentName = match.opponent?.name || 'Opponent';
  const [winner, setWinner] = useState('me');
  const [loserGames, setLoserGames] = useState(0);

  const choice = (active) =>
    `px-4 py-2 rounded-lg text-sm border transition-colors ${active
      ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
      : 'bg-[#050a18] border-[#1a2744] text-slate-400 hover:border-slate-500'}`;

  const submit = () => onSubmit({
    winner_user_id: winner === 'me' ? Number(myUserId) : Number(match.opponent_user_id),
    loser_games: loserGames,
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-sm tracking-widest text-cyan-400 uppercase">Report Result</h3>

        <p className="mt-4 text-xs font-display text-slate-500 tracking-widest uppercase">Who won?</p>
        <div className="mt-2 flex gap-2">
          <button className={choice(winner === 'me')} onClick={() => setWinner('me')}>You</button>
          <button className={choice(winner === 'them')} onClick={() => setWinner('them')}>{opponentName}</button>
        </div>

        <p className="mt-4 text-xs font-display text-slate-500 tracking-widest uppercase">Score</p>
        <div className="mt-2 flex gap-2">
          <button className={choice(loserGames === 0)} onClick={() => setLoserGames(0)}>2–0</button>
          <button className={choice(loserGames === 1)} onClick={() => setLoserGames(1)}>2–1</button>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="text-sm text-slate-500 hover:text-slate-300">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-cyan-500 text-[#050a18] hover:bg-cyan-400 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ArenaTournament() {
  const { id } = useParams();
  const tournamentId = Number(id);
  const { user } = useAuth();

  const [data, setData] = useState(null); // { tournament, standings, matches, me }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const offsetRef = useRef(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState(null);

  const captureServerNow = (serverNow) => {
    if (!serverNow) return;
    const off = new Date(serverNow).getTime() - Date.now();
    offsetRef.current = off;
    setOffsetMs(off);
  };

  const load = useCallback(() => {
    getArenaTournament(tournamentId)
      .then((d) => {
        setData(d);
        captureServerNow(d.server_now);
      })
      .catch((err) => setError(err.response?.status === 404 ? 'Tournament not found' : 'Failed to load tournament'));
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  const { connected, joinMatch, leaveMatch } = useArenaSocket(tournamentId, {
    onReconnect: load,
    onTournamentUpdate: (t) => {
      captureServerNow(t.server_now);
      setData((d) => (d ? { ...d, tournament: { ...d.tournament, ...t } } : d));
    },
    onScoreboard: (payload) => {
      captureServerNow(payload.server_now);
      setData((d) => (d ? { ...d, standings: payload.standings } : d));
    },
    // Pairings/matches change what "my match" is — simplest correct move is refetch.
    onPairing: load,
    onMatchAssigned: load,
    onMatchUpdate: load,
  });

  // Poll fallback: if the socket isn't connected, refresh every 10s.
  useEffect(() => {
    if (connected) return undefined;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [connected, load]);

  // Join my match's socket room (match-scoped pushes; chat arrives in M3).
  const myMatchId = data?.me?.match?.id;
  useEffect(() => {
    if (!myMatchId || !connected) return undefined;
    joinMatch(myMatchId);
    return () => leaveMatch(myMatchId);
    // joinMatch/leaveMatch are stable wrappers around the singleton socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMatchId, connected]);

  const action = async (fn) => {
    setBusy(true);
    try {
      await fn(tournamentId);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async (body) => {
    if (!myMatchId) return;
    setReportBusy(true);
    setReportError(null);
    try {
      await reportArenaMatch(myMatchId, body);
      setReportOpen(false);
      load();
    } catch (err) {
      setReportError(err.response?.data?.error || 'Failed to report result');
    } finally {
      setReportBusy(false);
    }
  };

  if (error) return <p className="text-red-400">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading…</p>;

  const { tournament, standings, me } = data;
  const meta = ARENA_STATUS_META[tournament.status] || ARENA_STATUS_META.finalized;
  const registrationOpen = ['scheduled', 'live'].includes(tournament.status);
  const registered = me?.participant && me.participant.status !== 'withdrawn';

  return (
    <div className="space-y-6">
      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link to="/arena" className="text-xs text-slate-500 hover:text-cyan-300">← Arena</Link>
            <span className={`text-xs font-display tracking-widest uppercase px-2 py-0.5 rounded border ${meta.badge}`}>
              {meta.label}
            </span>
            {!connected && <span className="text-xs text-slate-600">(live updates paused — reconnecting…)</span>}
          </div>
          <h1 className="mt-2 font-display text-xl tracking-widest text-slate-100 uppercase">{tournament.name}</h1>
          {tournament.description && <p className="mt-1 text-sm text-slate-400">{tournament.description}</p>}
          <p className="mt-2 text-xs text-slate-500">
            {new Date(tournament.starts_at).toLocaleString()} · {tournament.duration_minutes} minutes ·
            win = 2 pts, wins on a 2+ streak = 4 pts · best 2 of 3
          </p>
        </div>
        <ArenaClock tournament={tournament} offsetMs={offsetMs} />
      </div>

      {/* Registration */}
      {registrationOpen && (
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
          {!user ? (
            <p className="text-sm text-slate-400">
              <Link to="/login" className="text-cyan-300 hover:underline">Sign in</Link> to enter this tournament.
            </p>
          ) : !registered ? (
            <div className="flex items-center gap-4 flex-wrap">
              <button
                onClick={() => action(registerArena)}
                disabled={busy}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-cyan-500 text-[#050a18] hover:bg-cyan-400 disabled:opacity-50 transition-colors"
              >
                {tournament.status === 'live' ? 'Join now (late entry)' : 'Register'}
              </button>
              <IngameNameEditor />
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-emerald-300">✓ You're in{me.participant.status === 'paused' ? ' (paused)' : ''}</span>
              {me.participant.status === 'active' ? (
                <button onClick={() => action(pauseArena)} disabled={busy} className="text-xs text-slate-400 hover:text-amber-300">Pause pairing</button>
              ) : (
                <button onClick={() => action(resumeArena)} disabled={busy} className="text-xs text-slate-400 hover:text-emerald-300">Resume</button>
              )}
              <button onClick={() => action(withdrawArena)} disabled={busy} className="text-xs text-slate-500 hover:text-red-400">Withdraw</button>
              <IngameNameEditor />
              {!user.player_id && (
                <Link to="/link" className="text-xs text-slate-500 hover:text-cyan-300">
                  Tip: claim your player profile so results show under your record →
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {me?.match && (
        <CurrentMatchPanel
          match={me.match}
          myUserId={user?.id}
          tournamentStatus={tournament.status}
          onOpenReport={() => { setReportError(null); setReportOpen(true); }}
        />
      )}

      {reportOpen && me?.match && (
        <ReportResultModal
          match={me.match}
          myUserId={user?.id}
          busy={reportBusy}
          error={reportError}
          onClose={() => setReportOpen(false)}
          onSubmit={submitReport}
        />
      )}

      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
        <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase mb-3">
          {tournament.status === 'finalized' ? 'Final Standings' : 'Scoreboard'}
        </h2>
        <Scoreboard standings={standings} myUserId={user?.id} />
      </div>
    </div>
  );
}
