import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTournament } from '../lib/api';
import { formatDate } from '../lib/utils';

export default function TournamentDetail() {
  const { id } = useParams();
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTournament(id).then(setTournament).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-slate-400">Loading...</p>;
  if (!tournament) return <p className="text-red-400">Tournament not found.</p>;

  // Group matches by round
  const byRound = {};
  for (const m of tournament.matches || []) {
    const r = m.round ?? 0;
    if (!byRound[r]) byRound[r] = [];
    byRound[r].push(m);
  }
  const rounds = Object.keys(byRound).sort((a, b) => Number(a) - Number(b));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-white tracking-wide">{tournament.name}</h1>
        <p className="text-slate-500 text-sm mt-1">
          {tournament.participants_count} participants · {tournament.tournament_type} · {formatDate(tournament.completed_at)}
        </p>
        <a
          href={tournament.challonge_url}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-400 text-xs hover:underline mt-1 inline-block"
        >
          View on Challonge ↗
        </a>
      </div>

      {rounds.map(round => (
        <div key={round} className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-[#1a2744] text-xs font-display tracking-widest text-slate-400">
            {Number(round) < 0 ? `LOSERS ROUND ${Math.abs(round)}` : Number(round) === 0 ? 'FINALS' : `ROUND ${round}`}
          </div>
          <div className="divide-y divide-[#1a2744]">
            {byRound[round].map(m => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className={`flex-1 text-right font-medium ${m.winner_id === m.player1_id ? 'text-white' : 'text-slate-500'}`}>
                  <Link to={`/players/${m.player1_id}`} className="hover:text-cyan-400">{m.player1_name}</Link>
                </span>
                <span className="text-slate-400 font-display text-xs w-16 text-center">
                  {m.player1_score ?? '—'} – {m.player2_score ?? '—'}
                </span>
                <span className={`flex-1 font-medium ${m.winner_id === m.player2_id ? 'text-white' : 'text-slate-500'}`}>
                  <Link to={`/players/${m.player2_id}`} className="hover:text-cyan-400">{m.player2_name}</Link>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {rounds.length === 0 && (
        <p className="text-slate-500">No match data available for this tournament.</p>
      )}
    </div>
  );
}
