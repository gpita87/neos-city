# OAuth Login Setup — Discord + Google (Handoff)

**Goal:** make the OAuth logins actually work in a browser. All the **code** is already
written and deployed (`backend/src/routes/auth.js`, frontend `/login`, `/auth/callback`,
`/link`). What's missing is **external provider configuration** + the matching env vars. This
doc is the step-by-step to finish that. Nothing here touches code.

Companion docs: `AUTH_HANDOFF.md` (the auth system overview) and `WORKTREE_SUMMARY.md`
(the admin-gate + sign-in-flag change this lives next to).

> ⚠️ **The sign-in button is behind a feature flag now.** A normal visitor sees no "Sign in"
> button. To exercise the login during/after setup, append `?ff=auth` to the URL once
> (`http://localhost:5173/?ff=auth` or `https://www.neos-city.com/?ff=auth`) — it persists in
> that browser — or just navigate straight to `/login`. Drop the flag for everyone later by
> not flipping it; flip it on for the public when you're ready (see `frontend/src/lib/flags.js`).

---

## What you're configuring

| Provider | Where | App scopes (already set in code) |
|---|---|---|
| Discord | https://discord.com/developers/applications | `identify email` |
| Google  | https://console.cloud.google.com (reuse the project that has `YOUTUBE_API_KEY`) | `openid email profile` |

Both flows are **server-side authorization-code** flows. The browser hits
`GET /api/auth/<provider>`, the provider bounces back to
`GET /api/auth/<provider>/callback`, the backend mints a session JWT and redirects to
`${FRONTEND_URL}/auth/callback#token=…`. So the only URLs the providers need to know about are
the **backend callback URLs** below.

---

## 1. Discord app

1. https://discord.com/developers/applications → **New Application** → name it `Neos City`.
2. Left sidebar → **OAuth2**.
3. Copy **Client ID**. Click **Reset Secret** → copy the **Client Secret** (shown once).
4. **OAuth2 → Redirects → Add Redirect**, add **both** (exact, no trailing slash):
   - `http://localhost:3001/api/auth/discord/callback`
   - `https://api.neos-city.com/api/auth/discord/callback`
   - **Save Changes.**
5. No scopes to set in the portal — the app requests `identify email` at runtime. (You don't
   need to add a bot, set a redirect default, or publish anything.)

> Note: `email` only comes back if the Discord account has a **verified** email. If a user
> logs in without one, `email_verified = false` and no email is stored — they can still log in
> and claim a player, they just won't auto-merge with a Google login on the same address until
> they have a verified email. Google always returns a verified email.

**Env vars (Discord):**
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` → **local:** `http://localhost:3001/api/auth/discord/callback` ·
  **prod:** `https://api.neos-city.com/api/auth/discord/callback`

---

## 2. Google app

Reuse the existing Google Cloud project (the one backing `YOUTUBE_API_KEY`).

1. **APIs & Services → OAuth consent screen**
   - User type **External**.
   - Fill app name (`Neos City`), user support email, developer contact email.
   - Scopes: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` — these are
     **non-sensitive**, so **no Google verification review** is required.
   - **Publish app → Production.** (Publishing with only these basic scopes skips the
     test-user cap and the scary "unverified app" interstitial.)
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type **Web application**, name `Neos City Web`.
   - **Authorized redirect URIs** — add **both** (exact):
     - `http://localhost:3001/api/auth/google/callback`
     - `https://api.neos-city.com/api/auth/google/callback`
   - (Authorized JavaScript origins are **not** needed — this is a server-side code flow.)
   - Create → copy **Client ID** and **Client Secret**.

**Env vars (Google):**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` → **local:** `http://localhost:3001/api/auth/google/callback` ·
  **prod:** `https://api.neos-city.com/api/auth/google/callback`

---

## 3. Set the env vars

| Variable | Local (`backend/.env`) | Render (`neos-city-api`) |
|---|---|---|
| `DISCORD_CLIENT_ID` | from Discord | same |
| `DISCORD_CLIENT_SECRET` | from Discord | same |
| `DISCORD_REDIRECT_URI` | `http://localhost:3001/api/auth/discord/callback` | `https://api.neos-city.com/api/auth/discord/callback` |
| `GOOGLE_CLIENT_ID` | from Google | same |
| `GOOGLE_CLIENT_SECRET` | from Google | same |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3001/api/auth/google/callback` | `https://api.neos-city.com/api/auth/google/callback` |

Already-present prerequisites (don't remove): `JWT_SECRET`, `FRONTEND_URL`
(prod = `https://www.neos-city.com`; dev falls back to `http://localhost:5173`). The callback
redirect uses `FRONTEND_URL`, so it must be correct or login bounces to the wrong origin.

- **Render:** editing env vars on `neos-city-api` triggers a service restart automatically.
  **No static-site rebuild is needed** — these are backend-only; the frontend talks to OAuth
  via full-page server redirects, so nothing is baked into the JS bundle.
- **Cleanup (optional):** `RESEND_API_KEY` / `EMAIL_FROM` are no longer read (email/password
  auth was removed) — safe to delete from Render and `backend/.env`.

---

## 4. Test it

**Local:**
1. `cd backend && npm run dev` (3001) and `cd frontend && npm run dev` (5173).
2. Open `http://localhost:5173/?ff=auth` → the **Sign in** button appears (top-right).
3. `/login` shows **Continue with Discord** / **Continue with Google**.
4. Each provider → consent → bounced to `/auth/callback#token=…` → signed in; nav shows your
   identity. Confirm a `users` row exists with the provider id + (for Google) a verified email.
5. **Cross-provider merge:** sign in with Discord (verified email X) → log out → sign in with
   Google on the same email X → you land on the **same** account (now has both `discord_id`
   and `google_id`), not a second row.
6. Negative: tamper the `state` query param on a callback → redirect to `/login?error=…`.

**Prod:** same, at `https://www.neos-city.com/?ff=auth`. If a callback fails, check the
`neos-city-api` logs for `[auth] discord callback:` / `[auth] google callback:` lines — the
usual culprit is a redirect URI that doesn't **exactly** match what's registered, or a missing
env var (the kickoff routes 503 with `… login not configured` when client id / redirect uri
is unset).

---

## 5. ⏰ FINAL STEP (don't forget) — make yourself admin

**After** you've logged in successfully at least once (so your `users` row exists), grant
yourself admin so the new `is_admin` route gate recognizes your session:

```powershell
cd C:\Users\pitag\Documents\neos-city
node make_admin.js <your-discord-username-or-email>
```

This is DB-mutating and gated on your row existing — it can only run **after** a real login.
No migration needed (`is_admin` already exists). Verify by hitting a mutating route (e.g. an
import) with only your session `auth_token` and no `x-admin-token`. See `AUTH_HANDOFF.md`
follow-up #3 for the legacy-`ADMIN_TOKEN` retirement cleanup that comes after this is confirmed.

---

## Kickoff prompt for a fresh Claude Code session

> Paste this when you've created the Discord + Google apps and have the client IDs/secrets in
> hand, to have an agent help wire and verify the flow:

```
I'm finishing the OAuth login setup for Neos City (Discord + Google). The code is already
written (backend/src/routes/auth.js, frontend /login + /auth/callback + /link) — I just
created the provider apps and have the client IDs/secrets. Read OAUTH_SETUP_HANDOFF.md and
AUTH_HANDOFF.md first.

Help me:
1. Put DISCORD_CLIENT_ID/SECRET/REDIRECT_URI and GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI into
   backend/.env (I'll paste the values; don't print secrets back). Confirm JWT_SECRET and
   FRONTEND_URL are set.
2. Start backend (3001) + frontend (5173). Verify GET /api/auth/discord and /api/auth/google
   return a 302 to the provider (not a 503 "not configured").
3. Walk me through a full login in the browser at http://localhost:5173/?ff=auth (the Sign in
   button is behind the `auth` feature flag). Confirm a users row is created with the provider
   id + verified email.
4. Verify cross-provider merge: Discord then Google on the same verified email resolves to one
   account (both discord_id and google_id set), not two rows.
5. When that works, REMIND me to run `node make_admin.js <my-discord-username-or-email>` to
   grant admin, then confirm an admin route works with only the session token.

Constraints: don't run DB-mutating scripts yourself — hand me the command. Don't commit/push
without my OK (push to main = deploy to prod on Render).
```
