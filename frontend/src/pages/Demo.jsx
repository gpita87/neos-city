// Placeholder page gated behind the `demo` feature flag. It exists only to prove
// the flag plumbing works end-to-end: visible at /demo and in the nav when the
// `demo` flag is on, gone when it's off. Delete this file (and the demo flag)
// once you have a real feature to gate.
export default function Demo() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl text-fuchsia-300 tracking-widest mb-3">✨ DEMO FEATURE</h1>
      <p className="text-slate-400 leading-relaxed">
        You're seeing this because the <code className="text-fuchsia-300">demo</code> feature flag is on.
        Flip it off in the 🚧 FLAGS panel (bottom-right) or with{' '}
        <code className="text-fuchsia-300">?ff=-demo</code> and this page — plus its nav link — disappears,
        while staying invisible to everyone who hasn't opted in.
      </p>
    </div>
  );
}
