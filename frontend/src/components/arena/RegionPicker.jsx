import { useState } from 'react';
import { patchMe } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const REGIONS = [
  { code: 'NA', label: 'North America', flag: '🇺🇸' },
  { code: 'EU', label: 'Europe', flag: '🇪🇺' },
  { code: 'JP', label: 'Japan', flag: '🇯🇵' },
];

// Self-set connection region (users.region) — saves immediately on click;
// clicking the active region again clears it. Distinct from a claimed player's
// importer-managed competitive region (players.region).
export default function RegionPicker() {
  const { user, refresh } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!user) return null;

  const save = async (code) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await patchMe({ region: code });
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save region');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-slate-400">
        Where do you play from? Helps opponents anticipate the connection.
      </p>
      <div className="mt-3 flex gap-2 flex-wrap">
        {REGIONS.map((r) => {
          const active = user.region === r.code;
          return (
            <button
              key={r.code}
              onClick={() => save(active ? null : r.code)}
              disabled={saving}
              title={active ? 'Click again to clear' : r.label}
              className={`px-4 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50 ${active
                ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-200'
                : 'bg-[#050a18] border-[#1a2744] text-slate-400 hover:border-slate-500'}`}
            >
              {r.flag} {r.code} <span className="text-xs opacity-75">{r.label}</span>
            </button>
          );
        })}
      </div>
      {!user.region && <p className="mt-2 text-xs text-slate-500">Not set — opponents just won't see a region.</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
