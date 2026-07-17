import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getArenaTournaments, createArenaTournament } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

// Status color map — same shape as SERIES_META in Home.jsx.
export const ARENA_STATUS_META = {
  scheduled: { label: 'Upcoming', badge: 'bg-sky-900/40 text-sky-300 border-sky-700/50', border: 'border-sky-500/40' },
  live: { label: 'Live', badge: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50', border: 'border-emerald-500/40' },
  finished: { label: 'Finishing', badge: 'bg-amber-900/40 text-amber-300 border-amber-700/50', border: 'border-amber-500/40' },
  finalized: { label: 'Complete', badge: 'bg-slate-800/60 text-slate-300 border-slate-600/50', border: 'border-[#1a2744]' },
  cancelled: { label: 'Cancelled', badge: 'bg-red-900/40 text-red-300 border-red-700/50', border: 'border-[#1a2744]' },
};
const DEFAULT_STATUS = ARENA_STATUS_META.finalized;

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function TournamentCard({ t }) {
  const meta = ARENA_STATUS_META[t.status] || DEFAULT_STATUS;
  return (
    <Link
      to={`/arena/${t.id}`}
      className={`block bg-[#0c1425] border ${meta.border} rounded-xl p-5 hover:bg-[#101a30] transition-colors`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-xs font-display tracking-widest uppercase px-2 py-0.5 rounded border ${meta.badge}`}>
          {meta.label}
        </span>
        <span className="text-xs text-slate-500">{fmtDateTime(t.starts_at)} · {t.duration_minutes} min</span>
      </div>
      <div className="mt-2 font-display tracking-widest text-slate-100">{t.name}</div>
      {t.description && <p className="mt-1 text-sm text-slate-400">{t.description}</p>}
      <div className="mt-2 text-xs text-slate-500">
        {t.participants_count} {t.participants_count === 1 ? 'player' : 'players'}
      </div>
    </Link>
  );
}

// Minimal admin form — name, start time, duration. Shown only to admins.
function CreateForm({ onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createArenaTournament({
        name,
        description: description || undefined,
        starts_at: new Date(startsAt).toISOString(),
        duration_minutes: Number(duration),
      });
      setName(''); setDescription(''); setStartsAt('');
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create tournament');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-cyan-500/50 focus:outline-none';
  return (
    <form onSubmit={submit} className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5 space-y-3">
      <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase">New Tournament</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input className={inputCls} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className={inputCls} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input className={inputCls} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        <select className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
          <option value={30}>30 minutes</option>
          <option value={60}>60 minutes</option>
          <option value={90}>90 minutes</option>
          <option value={5}>5 minutes (test)</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500 text-[#050a18] hover:bg-cyan-400 disabled:opacity-50 transition-colors"
      >
        {busy ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}

export default function Arena() {
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    getArenaTournaments()
      .then((d) => setTournaments(d.tournaments))
      .catch(() => setError('Failed to load arena tournaments'));

  useEffect(() => { load(); }, []);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!tournaments) return <p className="text-slate-500">Loading…</p>;

  const live = tournaments.filter((t) => ['live', 'finished'].includes(t.status));
  const upcoming = tournaments.filter((t) => t.status === 'scheduled')
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const past = tournaments.filter((t) => ['finalized', 'cancelled'].includes(t.status));

  const Section = ({ title, items }) => items.length > 0 && (
    <section className="space-y-3">
      <h2 className="font-display text-sm tracking-widest text-slate-400 uppercase">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((t) => <TournamentCard key={t.id} t={t} />)}
      </div>
    </section>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-cyan-400 uppercase neon-text">Arena</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live hour-long tournaments played right here. Win to climb the board — win streaks are worth double.
          </p>
        </div>
        {user && (
          <Link to="/arena/settings" className="text-sm text-slate-400 hover:text-cyan-300 transition-colors">
            ⚙ My groups & in-game name
          </Link>
        )}
      </div>

      {user?.is_admin && <CreateForm onCreated={load} />}

      {tournaments.length === 0 && (
        <p className="text-slate-500">No arena tournaments yet — check back soon.</p>
      )}
      <Section title="Happening Now" items={live} />
      <Section title="Upcoming" items={upcoming} />
      <Section title="Past" items={past} />
    </div>
  );
}
