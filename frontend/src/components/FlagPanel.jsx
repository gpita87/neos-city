import { useState, useSyncExternalStore } from 'react';
import { FLAGS, getFlags, setFlag, clearFlags, flagsActive, subscribe } from '../lib/flags';

// Floating dev panel for toggling feature flags. Renders ONLY when the user has
// opted into flag-land (an active override or ?ff in the URL), so ordinary
// visitors never see it. Mount it once near the app root — see FEATURE_FLAGS.md.
export default function FlagPanel() {
  // Re-render whenever any flag changes. JSON string is a stable snapshot.
  useSyncExternalStore(subscribe, () => JSON.stringify(getFlags()), () => '{}');
  const [open, setOpen] = useState(false);

  if (!flagsActive()) return null;

  const resolved = getFlags();
  const knownKeys = Object.keys(FLAGS);
  // Count only flags deviating from their default — a default-on (shipped) flag
  // shouldn't inflate the indicator badge. Matches flagsActive()'s logic.
  const activeCount = knownKeys.filter(
    (k) => !!resolved[k] !== !!FLAGS[k].default
  ).length;

  return (
    <div className="fixed bottom-4 right-4 z-[100] font-body text-sm">
      {open ? (
        <div className="w-72 rounded-xl border border-fuchsia-500/40 bg-[#0a0f20]/95 backdrop-blur-md shadow-lg shadow-fuchsia-900/30">
          <div className="flex items-center justify-between px-4 py-3 border-b border-fuchsia-500/20">
            <span className="font-display tracking-widest text-fuchsia-300 text-xs">
              🚧 FEATURE FLAGS
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-fuchsia-300 transition-colors"
              aria-label="Collapse"
            >
              ✕
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto px-4 py-3 space-y-3">
            {knownKeys.length === 0 && (
              <p className="text-slate-500 text-xs">
                No flags registered yet. Add one to <code className="text-fuchsia-300">FLAGS</code> in
                {' '}<code className="text-fuchsia-300">lib/flags.js</code>.
              </p>
            )}
            {knownKeys.map((key) => {
              const meta = FLAGS[key];
              const on = resolved[key];
              return (
                <label key={key} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setFlag(key, e.target.checked)}
                    className="mt-0.5 accent-fuchsia-500"
                  />
                  <span className="flex-1">
                    <span className={`block font-medium ${on ? 'text-fuchsia-200' : 'text-slate-300'} group-hover:text-fuchsia-200`}>
                      {meta.label}
                      <code className="ml-2 text-[10px] text-slate-500">{key}</code>
                    </span>
                    <span className="block text-xs text-slate-500 leading-snug">{meta.description}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-4 py-2 border-t border-fuchsia-500/20">
            <span className="text-[11px] text-slate-500">{activeCount} changed</span>
            <button
              onClick={clearFlags}
              className="text-[11px] text-slate-400 hover:text-red-400 transition-colors underline"
            >
              Clear all
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-2 rounded-full border border-fuchsia-500/40 bg-[#0a0f20]/95 backdrop-blur-md text-fuchsia-300 text-xs font-display tracking-widest shadow-lg shadow-fuchsia-900/30 hover:bg-fuchsia-500/10 transition-colors"
        >
          🚧 FLAGS{activeCount > 0 ? ` · ${activeCount}` : ''}
        </button>
      )}
    </div>
  );
}
