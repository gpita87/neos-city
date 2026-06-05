import { useSyncExternalStore } from 'react';
import { subscribe, isFlagEnabled } from '../lib/flags';

// Reactive read of a single feature flag. Re-renders the component when the flag
// is toggled (via the panel or a new ?ff URL). Returns a boolean.
//
//   const showDemo = useFlag('demo');
//   return showDemo ? <NewThing /> : <OldThing />;
//
// isFlagEnabled returns a primitive, so it's a stable getSnapshot for
// useSyncExternalStore — no extra memoization needed.
export function useFlag(name) {
  return useSyncExternalStore(
    subscribe,
    () => isFlagEnabled(name),
    () => isFlagEnabled(name), // server snapshot (SSR-safe; app is CSR today)
  );
}
