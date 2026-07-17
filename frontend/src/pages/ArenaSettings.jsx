import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getGroups, getMyGroups, setMyGroups, createGroup, updateGroup, markGroupExpired } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import IngameNameEditor from '../components/arena/IngameNameEditor';
import RegionPicker from '../components/arena/RegionPicker';
import { formatGroupId, matchesGroupQuery } from '../lib/groupFormat';

const MAX_GROUPS = 6;

// One group's in-game join details (ID + password when on file, full marker).
function GroupDetails({ g }) {
  if (!g.ingame_id && !g.password && g.has_room !== false) return null;
  return (
    <span className="block text-xs text-slate-500">
      {g.ingame_id && <span className="tabular-nums">ID {formatGroupId(g.ingame_id)}</span>}
      {g.password && <span>{g.ingame_id ? ' · ' : ''}pw <span className="text-slate-400">{g.password}</span></span>}
      {g.has_room === false && <span className="text-amber-400"> · full</span>}
    </span>
  );
}

// Checkbox list of active Pokkén Groups with an n/6 counter (the in-game
// membership cap). Save is full-replace: the checked set IS the membership.
function GroupPicker({ reloadKey }) {
  const [groups, setGroups] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [savedIds, setSavedIds] = useState(new Set());
  const [query, setQuery] = useState('');
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
  }, [reloadKey]);

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

  // Community-maintained expired flag; update the row in place, no full reload.
  const setExpired = async (g, expired) => {
    setBusy(true);
    setError(null);
    try {
      const { group } = await markGroupExpired(g.id, expired);
      setGroups((gs) => gs.map((x) => (x.id === group.id ? { ...x, expired: group.expired } : x)));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update group');
    } finally {
      setBusy(false);
    }
  };

  const atCap = selected.size >= MAX_GROUPS;
  const visible = groups.filter((g) => matchesGroupQuery(g, query));

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

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search groups by name or ID…"
        className="mt-3 w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-cyan-500/50 focus:outline-none"
      />

      <div className="mt-3 space-y-2">
        {groups.length === 0 && <p className="text-sm text-slate-500">No groups on file yet.</p>}
        {groups.length > 0 && visible.length === 0 && (
          <p className="text-sm text-slate-500">No groups match "{query}".</p>
        )}
        {visible.map((g) => {
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
              <span className="min-w-0 flex-1">
                <span className="text-sm text-slate-200">
                  {g.name}
                  {g.is_official && <span className="ml-2 text-[10px] font-display tracking-widest uppercase text-cyan-400">Official</span>}
                  {g.active === false && <span className="ml-2 text-[10px] text-amber-400">(inactive)</span>}
                  {g.expired && <span className="ml-2 text-[10px] font-display tracking-widest uppercase text-red-400">expired — do not use</span>}
                </span>
                <GroupDetails g={g} />
                {g.ruleset?.note && <span className="block text-xs text-slate-600">{g.ruleset.note}</span>}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpired(g, !g.expired); }}
                className={`shrink-0 text-[10px] disabled:opacity-50 ${g.expired
                  ? 'text-slate-500 hover:text-emerald-300'
                  : 'text-slate-600 hover:text-red-400'}`}
                title={g.expired
                  ? 'It works again (e.g. the owner extended it)? Clear the expired flag.'
                  : 'Group gone/expired in-game? Flag it so nobody wastes time trying to join.'}
              >
                {g.expired ? 'un-mark expired' : 'mark expired'}
              </button>
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

// Community contribution: any signed-in player can add a group we're missing —
// name + in-game ID only. Passwords are deliberately NOT collected here (an
// admin fills them in) so inexperienced users are never asked to type a
// password into this site.
function AddGroupForm({ onAdded }) {
  const [name, setName] = useState('');
  const [ingameId, setIngameId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await createGroup({ name, ingame_id: ingameId || undefined });
      setName(''); setIngameId('');
      setDone(true);
      onAdded();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add group');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-cyan-500/50 focus:outline-none';
  return (
    <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
      <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase">Add a Group</h2>
      <p className="mt-1 text-xs text-slate-500">
        Know a Group we're missing? Add its name and in-game ID (spaces are fine).
        Leave the password out — an admin fills that in. Never enter a password you
        use anywhere else.
      </p>
      <form onSubmit={submit} className="mt-3 flex gap-2 flex-wrap">
        <input className={inputCls} placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className={`${inputCls} min-w-[14rem]`} placeholder="In-game ID (e.g. 391 572 457 905 58)" value={ingameId} onChange={(e) => setIngameId(e.target.value)} />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500 text-[#050a18] hover:bg-cyan-400 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {done && <p className="mt-2 text-sm text-emerald-300">✓ Added — it's in the picker above now.</p>}
    </div>
  );
}

// Admin CRUD: add groups with full details, set/clear passwords, toggle
// has-room (groups cap at 100 in-game and fill up), deactivate/reactivate.
function AdminGroupManager() {
  const [groups, setGroups] = useState(null);
  const [name, setName] = useState('');
  const [ingameId, setIngameId] = useState('');
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [pwEditId, setPwEditId] = useState(null);
  const [pwValue, setPwValue] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = () =>
    getGroups({ include_inactive: 1 })
      .then((d) => setGroups(d.groups))
      .catch(() => setError('Failed to load groups'));

  useEffect(() => { load(); }, []);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await createGroup({
        name,
        ingame_id: ingameId || undefined,
        password: password || undefined,
        ruleset: note ? { note } : {},
      });
      setName(''); setIngameId(''); setPassword(''); setNote('');
    });
  };

  const savePw = (g) => run(async () => {
    await updateGroup(g.id, { password: pwValue || null });
    setPwEditId(null);
    setPwValue('');
  });

  if (!groups) return null;

  const inputCls = 'bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-cyan-500/50 focus:outline-none';
  return (
    <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
      <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase">Manage Groups (Admin)</h2>

      <form onSubmit={add} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className={inputCls} placeholder="In-game ID" value={ingameId} onChange={(e) => setIngameId(e.target.value)} />
        <input className={inputCls} placeholder="Password (optional)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className={inputCls} placeholder="Ruleset note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500 text-[#050a18] hover:bg-cyan-400 disabled:opacity-50 transition-colors justify-self-start"
        >
          Add group
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search groups by name or ID…"
        className={`${inputCls} mt-3 w-full`}
      />

      <ul className="mt-3 divide-y divide-[#1a2744]">
        {groups.filter((g) => matchesGroupQuery(g, query)).map((g) => (
          <li key={g.id} className="py-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm min-w-0">
                <span className={g.active ? 'text-slate-200' : 'text-slate-500 line-through'}>{g.name}</span>
                <span className="ml-2 text-xs text-slate-500">{g.member_count} {g.member_count === 1 ? 'member' : 'members'}</span>
                {g.expired && <span className="ml-2 text-[10px] font-display tracking-widest uppercase text-red-400">expired</span>}
                <span className="block text-xs text-slate-500">
                  {g.ingame_id ? <span className="tabular-nums">ID {formatGroupId(g.ingame_id)}</span> : 'no ID'}
                  {' · '}
                  {g.password ? <>pw <span className="text-slate-400">{g.password}</span></> : 'no password'}
                  {g.ruleset?.note && <span className="text-slate-600"> · {g.ruleset.note}</span>}
                </span>
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <label className="text-xs text-slate-400 flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={g.has_room !== false}
                    disabled={busy}
                    onChange={() => run(() => updateGroup(g.id, { has_room: !(g.has_room !== false) }))}
                    className="accent-cyan-500"
                  />
                  has room
                </label>
                <button
                  onClick={() => { setPwEditId(g.id); setPwValue(g.password || ''); }}
                  disabled={busy}
                  className="text-xs text-slate-500 hover:text-cyan-300 disabled:opacity-50"
                >
                  {g.password ? 'Edit pw' : 'Set pw'}
                </button>
                <button
                  onClick={() => run(() => markGroupExpired(g.id, !g.expired))}
                  disabled={busy}
                  className={`text-xs disabled:opacity-50 ${g.expired ? 'text-slate-500 hover:text-emerald-300' : 'text-slate-500 hover:text-amber-300'}`}
                >
                  {g.expired ? 'Clear expired' : 'Mark expired'}
                </button>
                <button
                  onClick={() => run(() => updateGroup(g.id, { active: !g.active }))}
                  disabled={busy}
                  className={`text-xs disabled:opacity-50 ${g.active ? 'text-slate-500 hover:text-red-400' : 'text-slate-500 hover:text-emerald-300'}`}
                >
                  {g.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </span>
            </div>
            {pwEditId === g.id && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  className={`${inputCls} text-xs`}
                  placeholder="Password (blank to clear)"
                  value={pwValue}
                  autoFocus
                  onChange={(e) => setPwValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') savePw(g); if (e.key === 'Escape') setPwEditId(null); }}
                />
                <button onClick={() => savePw(g)} disabled={busy} className="text-xs text-cyan-300 hover:underline disabled:opacity-50">Save</button>
                <button onClick={() => setPwEditId(null)} disabled={busy} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ArenaSettings() {
  const { user, loading } = useAuth();
  const [groupsVersion, setGroupsVersion] = useState(0);

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
            <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase mb-3">Region</h2>
            <RegionPicker />
          </div>

          <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
            <h2 className="font-display text-sm tracking-widest text-cyan-400 uppercase mb-3">My Groups</h2>
            <GroupPicker reloadKey={groupsVersion} />
          </div>

          {!user.is_admin && <AddGroupForm onAdded={() => setGroupsVersion((v) => v + 1)} />}
          {user.is_admin && <AdminGroupManager />}
        </>
      )}
    </div>
  );
}
