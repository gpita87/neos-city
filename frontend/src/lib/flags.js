// Feature flags — ship unreleased features to prod but keep them hidden behind a
// named flag you flip on via the URL. This gives a "staging" experience on the
// live site: no separate deploy, no second database. A normal visitor never sees
// a flagged feature; you do, after typing the magic ?ff param once.
//
// URL grammar (the `ff` query param):
//   ?ff=newpage           enable "newpage"            (persists in this browser)
//   ?ff=newpage,beta      enable several at once
//   ?ff=-newpage          disable just "newpage"
//   ?ff=none   (or ?ff=)  clear every override, back to defaults
//   ?ff=*                 enable every registered flag
//
// Overrides are saved to localStorage under FF_KEY, so once a flag is set via the
// URL it stays on as you navigate — you can drop ?ff from later URLs. Only flags
// whose `default` is true show for visitors who never type ?ff.

export const FF_KEY = 'neos_ff';

// ── The registry ────────────────────────────────────────────────────────────
// Add a row here for each in-development feature.
//   key         token used in ?ff=<key> and isFlagEnabled('<key>')
//   label       short name shown in the flag panel
//   description what the flag gates (shown in the panel)
//   default     true = on for everyone even without ?ff (usually false)
export const FLAGS = {
  demo: {
    label: 'Demo flag',
    description: 'Example flag wired to a "✨ Demo" nav item. Safe to toggle — delete once you add real flags.',
    default: false,
  },
  creators: {
    label: 'YouTube Creators',
    description: 'YouTube creators + resource library page.',
    default: true,
  },
  auth: {
    label: 'Sign-in',
    description: 'Shows the "Sign in" button / account controls (OAuth login + claim flow).',
    default: true,
  },
  twitch: {
    label: 'Twitch Streams',
    description: 'Twitch streamers page — live status + last Pokkén-category stream per channel.',
    default: true,
  },
};

// ── Storage ───────────────────────────────────────────────────────────────────
// Overrides are { [name]: boolean }. A key present here wins over FLAGS.default.
function readOverrides() {
  try {
    const raw = localStorage.getItem(FF_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOverrides(obj) {
  try {
    localStorage.setItem(FF_KEY, JSON.stringify(obj));
  } catch {
    /* private mode / storage disabled — flags just won't persist */
  }
}

// ── Public read API ───────────────────────────────────────────────────────────
export function isFlagEnabled(name) {
  const overrides = readOverrides();
  if (name in overrides) return overrides[name];
  return !!(FLAGS[name] && FLAGS[name].default);
}

// Resolved state of every registered flag (plus any ad-hoc override keys), as
// { [name]: boolean }. Used by the panel.
export function getFlags() {
  const overrides = readOverrides();
  const out = {};
  for (const [k, meta] of Object.entries(FLAGS)) {
    out[k] = k in overrides ? overrides[k] : !!meta.default;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in out)) out[k] = v; // override for a flag not (yet) in the registry
  }
  return out;
}

// True once the user has put a flag into a non-default state — i.e. some override
// disagrees with the flag's `default`. The panel renders only when this is true,
// so normal visitors never see it. A flag that's merely default-on (a shipped
// feature) does NOT light the indicator, even if a redundant `?ff=*` override for
// it is sitting in localStorage — only an actual deviation from default counts.
export function flagsActive() {
  const overrides = readOverrides();
  for (const [k, v] of Object.entries(overrides)) {
    const def = !!(FLAGS[k] && FLAGS[k].default);
    if (!!v !== def) return true;
  }
  return false;
}

// ── Public write API ──────────────────────────────────────────────────────────
export function setFlag(name, on) {
  const overrides = readOverrides();
  overrides[name] = !!on;
  writeOverrides(overrides);
  notify();
}

export function clearFlags() {
  writeOverrides({});
  notify();
}

// Fold the ?ff query param into stored overrides. Runs once on module load
// (below) and can be called again with an explicit search string if needed.
export function applyUrlFlags(search = window.location.search) {
  const params = new URLSearchParams(search);
  if (!params.has('ff')) return;
  const raw = (params.get('ff') || '').trim();
  let overrides = readOverrides();

  if (raw === '' || raw === 'none') {
    overrides = {};
  } else if (raw === '*') {
    overrides = {};
    for (const k of Object.keys(FLAGS)) overrides[k] = true;
  } else {
    for (let tok of raw.split(',')) {
      tok = tok.trim();
      if (!tok) continue;
      if (tok.startsWith('-')) overrides[tok.slice(1)] = false;
      else overrides[tok] = true;
    }
  }
  writeOverrides(overrides);
  notify();
}

// ── Subscription (drives React re-renders) ────────────────────────────────────
const listeners = new Set();
function notify() {
  listeners.forEach((fn) => fn());
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Honor ?ff the moment anything imports this module.
if (typeof window !== 'undefined') {
  applyUrlFlags();
}
