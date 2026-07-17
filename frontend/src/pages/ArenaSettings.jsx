import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getGroups, getMyGroups, setMyGroups, createGroup, updateGroup } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import IngameNameEditor from '../components/arena/IngameNameEditor';

const MAX_GROUPS = 6;

// Checkbox list of active Pokkén Groups with an n/6 counter (the in-game
// membership cap). Save is full-replace: the checked set IS the membership.
function GroupPicker() {
  const [groups, setGroups] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [savedIds, setSavedIds] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    Promise.all([getGroups(), getMyGroups()])
      .then(([all, mine]) => {
        const mineIds = new Set(mine.groups.map((g) => g.id));
        // Memberships in deactivated groups still count against the in-game
        // cap — surface them in the list so they can be unchecked.
        const activeIds = new Set(all.groups.map((g) => g.id));
        const stale = mine.groups.filter((g) => !activeIds.has(g.id));
        setGroups([...all.groups, ...stale]);
        setSelected(mineIds);
        setSavedIds(mineIds);
      })
      .catch(() => setError('Failed to load groups'));
  }, []);

  if (error && !groups) return <p className="text-sm text-red-400">{error}</p>;
  if (!groups) return <p className="text-sm text-slate-500">Loading groups…</p>;

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_GROUPS) next.add(id);
      return next;
    });
  };

  const dirty = selected.size !== savedIds.size || [...selected].some((id) => !savedIds.has(id));

  const save = async () => {
    setBusy(true);
    setError(null);
    setSavedFlash(false);
    try {
      const { groups: mine } = await setMyGroups([...selected]);
      const mineIds = new Set(mine.map((g) => g.id));
      setSelected(mineIds);
      setSavedIds(mineIds);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save your groups');
    } finally {
      setBusy(false);
    }
  };

  const atCap = selected.size >= MAX_GROUPS;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Which in-game Groups are you a member of? Opponents see the ones you share.
        </p>
        <span className={`text-sm font-display tracking-widest tabular-nums ${atCap ? 'text-amber-400' : 'text-cyan-300'}`}>
          {selected.size}/{MAX_GROUPS}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {groups.length === 0 && <p className="text-sm text-slate-500">No groups on file yet.</p>}
        {groups.map((g) => {
          const checked = selected.has(g.id);
          const disabled = !checked && atCap;
          return (
            <label
              key={g.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${checked
                ? 'bg-cyan-500/10 border-cyan-500/40'
                : 'bg-[#050a18] border-[#1a2744] hover:border-slate-600'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled || busy}
                onChange={() => toggle(g.id)}
                className="mt-0.5 accent-cyan-500"
              />
              <span>
                <span className="text-sm text-slate-200">
                  {g.name}
                  {g.is_official && <span className="ml-2 text-[10px] font-display tracking-widest uppercase text-cyan-400">Official</span>}
                  {g.active === false && <span className="ml-2 text-[10px] text-amber-400">(inactive)</span>}
                </span>
                {g.ruleset?.note && <span className="block text-xs text-slate-500">{g.ruleset.note}</span>}
              </span>
            </label>
          );
        })}
      </div>

      {atCap && (
        <p className="mt-2 text-xs text-amber-400">
          That's the in-game cap — uncheck one to pick a different group.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="px-5 py-2 rounded-lg text-sm font-medium bg-cyan-500 text-[#050a18] hover:bg-cyan-400 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Saving…' : 'Save my groups'}
        </button>
        {savedFlash && <span className="text-sm text-emerald-300">✓ Saved</span>}
      </div>
    </div>
  );
}

// Minimal admin CRUD: add a group by name, toggle active on existing ones.
function AdminGroupManager() {
  const [groups, setGroups] = useState(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () =>
    getGroups({ include_inactive: 1 })
      .then((d) => setGroups(d.groups))
      .catch(() => setError('Failed to load groups'));

  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createGroup({ name, ruleset: note ? { note } : {} });
      setName(''); setNote('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create group');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (g) => {
    setBusy(true);
    setError(null);
    try {
      await updateGroup(g.id, { active: !g.active });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update group');
    } finally {
      setBusy(false);
    }
  };

  if (!groups) return null;

  const inputCls = 'bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-cyan-500/50 focus:outline-none';
  return (
    <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
      <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase">Manage Groups (Admin)</h2>

      <form onSubmit={add} className="mt-3 flex gap-2 flex-wrap">
        <input className={inputCls} placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className={`${inputCls} flex-1 min-w-[12rem]`} placeholder="Ruleset note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500 text-[#050a18] hover:bg-cyan-400 disabled:opacity-50 transition-colors"
        >
          Add
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <ul className="mt-3 divide-y divide-[#1a2744]">
        {groups.map((g) => (
          <li key={g.id} className="py-2 flex items-center justify-between gap-3">
            <span className="text-sm">
              <span className={g.active ? 'text-slate-200' : 'text-slate-500 line-through'}>{g.name}</span>
              <span className="ml-2 text-xs text-slate-500">{g.member_count} {g.member_count === 1 ? 'member' : 'members'}</span>
              {g.ruleset?.note && <span className="ml-2 text-xs text-slate-600">· {g.ruleset.note}</span>}
            </span>
            <button
              onClick={() => toggleActive(g)}
              disabled={busy}
              className={`text-xs disabled:opacity-50 ${g.active ? 'text-slate-500 hover:text-red-400' : 'text-slate-500 hover:text-emerald-300'}`}
            >
              {g.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ArenaSettings() {
  const { user, loading } = useAuth();

  if (loading) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-3">
          <Link to="/arena" className="text-xs text-slate-500 hover:text-cyan-300">← Arena</Link>
        </div>
        <h1 className="mt-2 font-display text-2xl tracking-widest text-cyan-400 uppercase neon-text">Arena Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Help opponents find you: your in-game name, and which Pokkén Groups you play in.
        </p>
      </div>

      {!user ? (
        <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
          <p className="text-sm text-slate-400">
            <Link to="/login" className="text-cyan-300 hover:underline">Sign in</Link> to set your in-game name and groups.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
            <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase mb-3">In-Game Name</h2>
            <IngameNameEditor />
          </div>

          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
            <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase mb-3">My Groups</h2>
            <GroupPicker />
          </div>

          {user.is_admin && <AdminGroupManager />}
        </>
      )}
    </div>
  );
}
