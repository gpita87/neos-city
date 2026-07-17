import { useState } from 'react';
import { patchMe } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// Inline editor for the user's Pokkén in-game name — what the opponent looks
// for inside the Group to make sure they matched the right player.
// Used on ArenaTournament (registration block) and ArenaSettings.
export default function IngameNameEditor() {
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
