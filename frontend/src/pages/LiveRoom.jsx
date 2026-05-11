import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getLeaderboard, createRoom, getRoom, reportGame } from '../lib/api';

export default function LiveRoom() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [room, setRoom] = useState(null);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [format, setFormat] = useState('bo3');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(!!code);

  // Load player list for dropdowns
  useEffect(() => {
    getLeaderboard().then(setPlayers).catch(() => {});
  }, []);

  // Load room if code in URL
  const fetchRoom = useCallback(() => {
    if (!code) return;
    getRoom(code).then(setRoom).catch(() => setRoom(null)).finally(() => setLoading(false));
  }, [code]);

  useEffect(() => {
    fetchRoom();
    if (code) {
      const interval = setInterval(fetchRoom, 3000); // Poll every 3s
      return () => clearInterval(interval);
    }
  }, [fetchRoom, code]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!p1 || !p2 || p1 === p2) return;
    setCreating(true);
    try {
      const newRoom = await createRoom(Number(p1), Number(p2), format);
      navigate(`/live/${newRoom.room_code}`);
    } catch (err) {
      alert('Could not create room: ' + (err.response?.data?.error || err.message));
    } finally {
      setCreating(false);
    }
  };

  const handleReport = async (winner) => {
    if (!room || room.status === 'complete') return;
    try {
      const updated = await reportGame(code, winner);
      setRoom(updated);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  if (loading) return <p className="text-slate-400">Loading room...</p>;

  // ── Room view ──────────────────────────────────────────────────────────────
  if (code && room) {
    const winsNeeded = room.format === 'bo5' ? 3 : 2;
    const complete = room.status === 'complete';

    return (
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl tracking-widest text-white">LIVE MATCH</h1>
          <span className="text-xs text-slate-500 font-display bg-[#1a2744] px-3 py-1 rounded-full">
            ROOM: {code}
          </span>
        </div>

        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6">
          {/* Format badge */}
          <p className="text-center text-xs font-display text-slate-500 mb-6 tracking-widest">
            {room.format.toUpperCase()} · FIRST TO {winsNeeded}
          </p>

          {/* Scoreboard */}
          <div className="flex items-center justify-center gap-8">
            <div className="text-center flex-1">
              <p className="font-medium text-white text-lg">{room.player1_name}</p>
              <p className={`font-display text-5xl font-bold mt-3 ${complete && room.winner_id === room.player1_id ? 'text-cyan-400' : 'text-white'}`}>
                {room.player1_games}
              </p>
            </div>
            <div className="text-slate-600 font-display text-xl">VS</div>
            <div className="text-center flex-1">
              <p className="font-medium text-white text-lg">{room.player2_name}</p>
              <p className={`font-display text-5xl font-bold mt-3 ${complete && room.winner_id === room.player2_id ? 'text-cyan-400' : 'text-white'}`}>
                {room.player2_games}
              </p>
            </div>
          </div>

          {/* Win indicators */}
          <div className="flex items-center justify-center gap-8 mt-4">
            <div className="flex gap-1 justify-center">
              {[...Array(winsNeeded)].map((_, i) => (
                <div key={i} className={`w-3 h-3 rounded-full ${i < room.player1_games ? 'bg-cyan-400' : 'bg-[#1a2744]'}`} />
              ))}
            </div>
            <div className="w-12" />
            <div className="flex gap-1 justify-center">
              {[...Array(winsNeeded)].map((_, i) => (
                <div key={i} className={`w-3 h-3 rounded-full ${i < room.player2_games ? 'bg-cyan-400' : 'bg-[#1a2744]'}`} />
              ))}
            </div>
          </div>

          {/* Report buttons */}
          {!complete ? (
            <div className="flex gap-3 mt-8">
              <button
                onClick={() => handleReport('player1')}
                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white font-medium py-3 rounded-lg transition-colors"
              >
                {room.player1_name} wins game
              </button>
              <button
                onClick={() => handleReport('player2')}
                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white font-medium py-3 rounded-lg transition-colors"
              >
                {room.player2_name} wins game
              </button>
            </div>
          ) : (
            <div className="text-center mt-8">
              <p className="font-display text-lg text-cyan-400 tracking-widest">
                🏆 {room.winner_id === room.player1_id ? room.player1_name : room.player2_name} WINS
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (code && !room) {
    return <p className="text-red-400">Room "{code}" not found.</p>;
  }

  // ── Create room view ───────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto">
      <h1 className="font-display text-2xl tracking-widest text-white mb-6">CREATE LIVE MATCH</h1>

      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-6">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="text-xs font-display text-slate-400 tracking-widest block mb-1">PLAYER 1</label>
            <select
              value={p1}
              onChange={e => setP1(e.target.value)}
              className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="">Select player...</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-display text-slate-400 tracking-widest block mb-1">PLAYER 2</label>
            <select
              value={p2}
              onChange={e => setP2(e.target.value)}
              className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="">Select player...</option>
              {players.filter(p => String(p.id) !== p1).map(p => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-display text-slate-400 tracking-widest block mb-1">FORMAT</label>
            <div className="flex gap-3">
              {['bo3', 'bo5'].map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`flex-1 py-2 rounded-lg text-sm font-display tracking-widest transition-colors ${
                    format === f ? 'bg-cyan-500 text-white' : 'bg-[#050a18] border border-[#1a2744] text-slate-400'
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={creating || !p1 || !p2}
            className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors mt-2"
          >
            {creating ? 'Creating...' : 'Create Room'}
          </button>
        </form>
      </div>
    </div>
  );
}
