# Feature Flags — a "staging" experience on the live site

Instead of a second Render environment + second database, new features ship to
prod **hidden behind a named flag**. A normal visitor never sees them. You flip a
flag on with a URL param, test on the real site against real data, then either
remove the flag (ship it) or delete the feature.

## Files (already added)

| File | Role |
|------|------|
| `frontend/src/lib/flags.js` | Core: the `FLAGS` registry, URL parsing, localStorage persistence, `isFlagEnabled()`. |
| `frontend/src/hooks/useFlag.js` | `useFlag('name')` React hook — reactive boolean. |
| `frontend/src/components/FlagPanel.jsx` | Floating 🚧 FLAGS panel (bottom-right). Self-hides unless you've opted in. |
| `frontend/src/pages/Demo.jsx` | Throwaway page proving the plumbing works. Delete once you have a real feature. |

## URL grammar

| URL | Effect |
|-----|--------|
| `?ff=demo` | Turn **demo** on (persists in this browser). |
| `?ff=demo,beta` | Turn several on at once. |
| `?ff=-demo` | Turn **demo** off. |
| `?ff=*` | Turn on every registered flag. |
| `?ff=none` or `?ff=` | Clear all overrides, back to defaults. |

Once set, a flag persists in `localStorage` (`neos_ff`), so you can drop `?ff`
from later URLs and keep clicking around. The 🚧 FLAGS panel (visible only while
any flag is on or `?ff` is in the URL) lets you toggle without retyping URLs.

## One-time wiring (apply to `App.jsx` when your tree is clean)

`App.jsx` is currently mid-cherry-pick, so this isn't applied yet. Four edits:

**1. Add imports** (next to the other `./pages` / `./components` imports near the top):

```jsx
import FlagPanel from './components/FlagPanel';
import Demo from './pages/Demo';
import { useFlag } from './hooks/useFlag';
```

**2. Read the flag** at the top of `export default function App() {`:

```jsx
export default function App() {
  const showDemo = useFlag('demo');
```

**3. Gate the nav item + route.** In the `<nav>`, after the Creators item:

```jsx
            {showDemo && <NavItem to="/demo">✨ Demo</NavItem>}
```

In `<Routes>`, after the `/creators` route:

```jsx
          {showDemo && <Route path="/demo" element={<Demo />} />}
```

**4. Mount the panel** just before the closing `</div>` of the root element
(after `</main>`):

```jsx
      <FlagPanel />
    </div>
```

Then start the frontend and visit `http://localhost:5173/?ff=demo` — the ✨ Demo
nav link and `/demo` page appear, and the 🚧 FLAGS panel shows in the corner.
Visit `?ff=-demo` (or untoggle in the panel) and they vanish.

## Adding a real flag

1. Add a row to `FLAGS` in `lib/flags.js`:

   ```js
   newLeaderboard: {
     label: 'Redesigned leaderboard',
     description: 'WIP leaderboard layout.',
     default: false,
   },
   ```

2. Gate the feature anywhere with the hook:

   ```jsx
   const v2 = useFlag('newLeaderboard');
   return v2 ? <LeaderboardV2 /> : <Leaderboard />;
   ```

   Outside React (utils, api calls), use `isFlagEnabled('newLeaderboard')`.

3. Test at `?ff=newLeaderboard`. When happy, delete the flag and the old code
   path; when abandoning, delete the flag and the new code path. Either way the
   flag is temporary scaffolding, not permanent config.

## Notes & limits

- **Frontend-only.** Flags gate UI. They don't change which backend/DB you hit —
  staging shares prod data, as you chose. Don't gate destructive admin actions
  behind a flag and expect isolation; there is none. Keep flag-gated work
  read-only against prod, or point your *local* backend at a throwaway DB for
  anything that writes.
- **Not a secret.** Anyone who reads the JS bundle can discover flag names and
  enable them. Fine for hiding unfinished UI; not a security boundary.
- **`default: true`** ships a flag on for everyone — use it as the last step
  before fully removing a flag, or skip it and just delete the flag.
