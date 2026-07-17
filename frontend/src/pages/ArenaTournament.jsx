import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getArenaTournament, registerArena, withdrawArena, pauseArena, resumeArena,
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

// Stub for M1 — pairing lands in M2, so this only renders if a match exists.
function CurrentMatchStub({ match }) {
  if (!match) return null;
  return (
    <div className="bg-[#0c1425] border border-emerald-500/40 rounded-xl p-5">
      <h2 className="font-display text-sm tracking-widest text-emerald-300 uppercase">Your Match</h2>
      <p className="mt-2 text-slate-200">
        vs <span className="font-medium">{match.opponent?.name || 'Opponent'}</span>
      </p>
      {match.sharedGroups?.length > 0 ? (
        <div className="mt-2 text-sm text-slate-400">
          Shared groups:{' '}
          {match.sharedGroups.map((g) => (
            <span key={g.id} className="inline-block mr-1 px-2 py-0.5 rounded bg-cyan-900/40 text-cyan-300 border border-cyan-700/50 text-xs">
              {g.name}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No shared groups on file — coordinate in chat (coming soon).</p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Best 2 of 3 — switch supports freely; no character switch after a win. Result reporting arrives with the next update.
      </p>
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

  const { connected } = useArenaSocket(tournamentId, {
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
            <button
              onClick={() => action(registerArena)}
              disabled={busy}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-cyan-500 text-[#050a18] hover:bg-cyan-400 disabled:opacity-50 transition-colors"
            >
              {tournament.status === 'live' ? 'Join now (late entry)' : 'Register'}
            </button>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-emerald-300">✓ You're in{me.participant.status === 'paused' ? ' (paused)' : ''}</span>
              {me.participant.status === 'active' ? (
                <button onClick={() => action(pauseArena)} disabled={busy} className="text-xs text-slate-400 hover:text-amber-300">Pause pairing</button>
              ) : (
                <button onClick={() => action(resumeArena)} disabled={busy} className="text-xs text-slate-400 hover:text-emerald-300">Resume</button>
              )}
              <button onClick={() => action(withdrawArena)} disabled={busy} className="text-xs text-slate-500 hover:text-red-400">Withdraw</button>
              {!user.player_id && (
                <Link to="/link" className="text-xs text-slate-500 hover:text-cyan-300">
                  Tip: claim your player profile so results show under your record →
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {me?.match && <CurrentMatchStub match={me.match} />}

      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
        <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase mb-3">
          {tournament.status === 'finalized' ? 'Final Standings' : 'Scoreboard'}
        </h2>
        <Scoreboard standings={standings} myUserId={user?.id} />
      </div>
    </div>
  );
}
