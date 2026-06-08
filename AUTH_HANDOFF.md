# Auth + Account Linking — Handoff

**Status:** OAuth-only auth (Discord + Google). Backend modules load clean; frontend
builds clean (`npm run build`). Not yet exercised against real Discord/Google
credentials. No automated tests (project has none).

**What this feature is:** real user logins so existing players can claim their
`players` record. Login is **OAuth-only — Discord or Google.** The self-built
email/password flow (register / verification / password reset via Resend) was
**removed** — both providers return a provider-verified email, which is all we need,
and it deletes the email-deliverability + password-support burden entirely. Groundwork
for a future online ranked ladder — **the ladder itself is not built here.**

**Design plan of record:** the two approved plans —
`C:\Users\pitag\.claude\plans\adaptive-leaping-raven.md` (original email+Discord cut) and
`C:\Users\pitag\.claude\plans\sprightly-coalescing-lamport.md` (the OAuth-only pivot).
This doc is the living handoff and supersedes both where they disagree.

---

## ⚡ Pending actions for Gabriel

**Migrations — ✅ APPLIED** (`add_token_version.sql` + `add_google_auth.sql`, run by
Gabriel 2026-06-08). `users` now has `token_version` and `google_id`.

**Still pending (external, before OAuth actually works in a browser):**

**Google Cloud setup** (reuse the existing project that backs `YOUTUBE_API_KEY`):
1. APIs & Services → OAuth consent screen → External; scopes `openid email profile`
   (non-sensitive → **no Google review**); **Publish to Production** (avoids the
   test-user cap / "unverified app" screen for these basic scopes).
2. Credentials → Create OAuth client ID → Web application → Authorized redirect URIs
   (exact): `http://localhost:3001/api/auth/google/callback` and
   `https://api.neos-city.com/api/auth/google/callback`.
3. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` in
   `backend/.env` and Render `neos-city-api` (prod redirect = the api.neos-city.com one).

Discord app is still required (unchanged). `RESEND_API_KEY` / `EMAIL_FROM` are no longer
read — safe to remove from Render.

---

## Current state (what's done)

- ✅ `users` table migration **applied** (`add_users_auth.sql`).
- ✅ Discord OAuth + **Google OAuth** logins. Shared `resolveOAuthUser` resolver.
- ✅ **Cross-provider account merge by verified email** (one person = one account).
- ✅ `token_version` session revocation (`signSession` embeds `tv`; `requireAuth`
   rejects stale `tv`); `POST /auth/logout-all`. *(Migration applied.)*
- ✅ Trust-based claiming — any signed-in (OAuth) user can claim a player. No email gate.
- ✅ Player-merge tooling re-points claims (`merge_players.js`, `link_offline_player.js`).
- ✅ Frontend: AuthContext, bearer interceptor, `/login` (Discord+Google), `/auth/callback`,
   `/link` claim page, nav identity/logout, profile claim CTA.
- ✅ Email/password fully removed — routes, `services/email.js`, Resend dep usage, and the
   verify/forgot/reset pages + the unverified banner are gone.
- ⛔ **Not done / external:** Google Cloud app not created, Discord app not created, prod
   env vars not set on Render. *(Both migrations are applied.)*

---

## Key design decisions (and why)

1. **Bearer JWT in `localStorage`, not cookies.** Prod is cross-origin
   (`www.neos-city.com` → `api.neos-city.com`); bearer reuses the existing
   `x-admin-token` interceptor pattern with zero CORS changes. Token stored as
   `localStorage.auth_token`.
2. **Session JWT payload is `{ sub, tv }`.** `sub` = user id; `tv` = `token_version`
   for revocation. `is_admin` / `player_id` are re-loaded from the DB on every request
   by `requireAuth`, so they're always authoritative.
3. **Verified-email merge across providers (this is the model).** A login resolves to a
   user by, in order: (1) provider id (`discord_id`/`google_id`), then (2) if the
   provider asserts a **verified** email and an existing account holds that same email
   **verified**, attach this provider to it — so a Discord login and a Google login on
   the same address become one account; else (3) create a new account, storing the email
   only if it doesn't collide. **This reverses the original "never merge by email"
   decision** — that rule only defended against attacker-controlled *unverified* emails
   from self-registration, which no longer exists. Every email in the system is now
   provider-verified, so the takeover risk is gone.
4. **Any OAuth login can claim a player.** The provider login *is* the identity proof, so
   there's no separate `email_verified` gate on `/link` (the original cut required it).
5. **Tokens delivered via URL fragment (`#token=`), not query string** — keeps JWTs out
   of server logs / referrers / history. Both OAuth callbacks redirect to
   `${FRONTEND_URL}/auth/callback#token=…`.
6. **Stateless signed `state` JWTs** carry a `purpose` claim (`discord_state` /
   `google_state`, 10m) that the callback checks. (The old `verify_email`/`pwreset`
   token purposes are gone with the email flow.)

---

## Data model — `users` table

| Column | Notes |
|---|---|
| `id` | SERIAL PK |
| `email` | nullable; partial-unique on `LOWER(email)`; set from the OAuth provider |
| `email_verified` | bool; set from the provider (Discord `verified`, Google `email_verified`). Used by the merge logic, **not** as a claim gate. |
| `password_hash` | **unused** now (nullable). Left in place; drop in a later migration if desired. |
| `discord_id` / `discord_username` | nullable; `discord_id` partial-unique |
| `google_id` | nullable; partial-unique (added by `add_google_auth.sql`). No `google_username` column — Google's name lands in `display_name`. |
| `display_name`, `avatar_url` | informational; backfilled on merge if empty |
| `player_id` | FK → `players(id)` `ON DELETE SET NULL`; partial-unique (one user per player) |
| `token_version` | INTEGER default 0 (added by `add_token_version.sql`); embedded as `tv`, bumped by `logout-all` to revoke sessions |
| `is_admin` | seeded false; **not wired to anything yet** |
| `created_at`, `updated_at` | routes set `updated_at` explicitly (no trigger) |

- **CHECK** `users_has_identity`: `email OR discord_id OR google_id` (widened for Google).
- **RLS enabled, no policies** — defense-in-depth for the PostgREST anon endpoint; the
  backend uses the `postgres` role and bypasses RLS.
- Linking is **trust-based & first-come**: one account ↔ one player, both enforced by a
  partial-unique index.

---

## File map

**Backend**
- `backend/src/db/migrations/add_users_auth.sql` — `users` table (applied).
- `backend/src/db/migrations/add_token_version.sql` — `token_version` column (applied).
- `backend/src/db/migrations/add_google_auth.sql` — `google_id` + widened CHECK (applied).
- `backend/src/routes/auth.js` — all auth routes. Key piece: `resolveOAuthUser({provider,
  providerId, email, emailVerified, username, avatarUrl, displayName})` (the shared
  resolve/merge/create logic) + `signSession(user)` (embeds `tv`). `authLimiter` (30/15min,
  loopback-exempt).
- `backend/src/middleware/requireAuth.js` — `requireAuth` (bearer verify + per-request user
  load + `tv` revocation check via `tokenVersionMatches`), `attachUser` (non-blocking
  variant, same check, **currently unused**), `USER_COLUMNS` (no `password_hash`; includes
  `google_id`, `token_version`).
- `backend/src/app.js` — mounts `app.use('/api/auth', authRouter)`. No new CORS origin
  needed (OAuth is full-page server redirects).
- `merge_players.js`, `link_offline_player.js` — re-point `users.player_id` on merges.
- **Deleted:** `backend/src/services/email.js`.

**Frontend**
- `frontend/src/contexts/AuthContext.jsx` — `AuthProvider` + `useAuth()`: `{user, token,
  loading, logout, refresh, setToken}`. (No `login`/`register` — sign-in is OAuth via the
  callback.) Token in `localStorage.auth_token`.
- `frontend/src/lib/api.js` — bearer interceptor + helpers: `getMe, linkPlayer,
  unlinkPlayer, logoutAll, discordLoginUrl, googleLoginUrl`.
- `frontend/src/main.jsx` — wraps `<App>` in `<AuthProvider>`.
- `frontend/src/App.jsx` — `AuthNav` (sign-in vs identity+logout); routes for `/login`,
  `/auth/callback`, `/link`. (No VerifyBanner, no verify/forgot/reset routes.)
- `frontend/src/pages/Login.jsx` — Discord + Google buttons only.
- `frontend/src/pages/AuthCallback.jsx` — reads `#token`, stores it, refreshes.
  **Provider-agnostic** (serves both Discord and Google).
- `frontend/src/pages/ClaimPlayer.jsx` — player search → claim (no verify gate).
- `frontend/src/pages/PlayerProfile.jsx` — `ClaimProfileCTA` ("This is me — claim profile"
  / "✓ Your profile"; nothing when signed out).
- **Deleted:** `VerifyEmail.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`.

---

## API surface (`/api/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/me` | requireAuth | `{user}` |
| GET | `/discord` | — | 302 to Discord authorize (state JWT, 10m) |
| GET | `/discord/callback` | limiter | resolve/merge via `resolveOAuthUser`; redirect to `…/auth/callback#token=…` |
| GET | `/google` | — | 302 to Google authorize (state JWT, 10m) |
| GET | `/google/callback` | limiter | same resolver; same redirect |
| POST | `/link` | requireAuth | `{player_id}`; 409 if taken/already-linked. **No email gate.** |
| POST | `/unlink` | requireAuth | clears caller's own `player_id` |
| POST | `/logout-all` | requireAuth | bumps `token_version` — revokes every session incl. caller's |
| POST | `/admin/unlink` | requireAdmin | `{user_id}`; reuses `x-admin-token` |

---

## How to test locally (needs the Discord + Google apps configured)

Backend `npm run dev` (3001) + frontend `npm run dev` (5173).
1. `/login` shows only **Continue with Discord** / **Continue with Google** — no email form.
2. Sign in with one provider → Google/Discord consent → bounced to `/auth/callback#token=…`
   → signed in; nav shows identity. New `users` row has the provider id + verified email.
3. **Cross-provider merge (key check):** sign in with Discord (row gets `discord_id` +
   verified email X) → logout → sign in with Google on the same email X → resolves to the
   **same row** (now has both `discord_id` and `google_id`), not a second account.
4. `/link` → search a player → "This is me" → lands on their profile.
5. Negatives: claim same player from a 2nd account → 409; tamper the `state` query param →
   redirect to `/login?error=discord|google`.
6. `logout-all`: call it (no UI yet — `import('./lib/api').logoutAll()` from DevTools), then
   any further request 401s and the app drops you to signed-out.

---

## Known limitations (by design, not bugs)

- **OAuth-only.** A user with neither a Discord nor a Google account can't sign in. For a
  Discord-run Pokkén scene this is fine; Google is the universal fallback.
- **Discord without a shared/verified email** → `email_verified = false`, no email stored.
  They can still log in and still claim (no gate), but they won't auto-merge with a Google
  login until they have a verified email on file. Google always returns a verified email.
- **`/login?next=…` is ignored.** OAuth can't easily thread a post-login destination through
  the provider without encoding it in the `state` JWT. After login everyone lands on `/`.
  Minor; thread `next` through `state` if it matters later.
- `is_admin` exists but is **not enforced anywhere** — admin routes still use `ADMIN_TOKEN`.

---

## Open follow-ups / next steps (in rough priority)

1. ✅ **`token_version` session revocation — DONE** (migration applied). `signSession`
   embeds `tv`; `requireAuth`/`attachUser` reject stale `tv` (pre-`tv` tokens treated as
   version 0, so deploy doesn't mass-logout); `POST /auth/logout-all` bumps it. *(Its
   original driver, password-reset revocation, is moot now that passwords are gone — it
   stays for `logout-all` + future admin force-logout / ladder use.)*
2. ✅ **Authenticated method-linking — largely SATISFIED** by the verified-email auto-merge
   in `resolveOAuthUser`. A Discord-first user who later signs in with Google on the same
   verified email lands on the same account automatically. *Remaining gap:* there's no
   in-app "link a second provider" button for the case where the two providers' emails
   **differ** (or one is unverified) — that still needs an explicit, authenticated
   confirm-link flow. Build it only if that case actually comes up.
3. **Unify `ADMIN_TOKEN` into `is_admin` — NEXT.** Replace the shared `x-admin-token` on
   mutating routes with `requireAuth` + an `is_admin` check, then retire the shared secret.
   `is_admin` + `admin/unlink` are already seeded. Touches every admin route in
   `tournaments.js` / `organizers.js` — its own task.
4. **The ranked ladder** — the actual reason this exists. Builds on `users.player_id` as the
   verified identity.
5. **Hardening:** server-side OAuth `state` store (currently a stateless 10m JWT), token
   refresh/rotation, expose "is this player already claimed" on the public profile payload
   so the claim button can pre-gray, optionally drop the unused `password_hash` column.

---

## Gotchas for the next agent

- **Don't run DB migrations/scripts without Gabriel** (shared Supabase). Two are pending
  (top of this doc).
- **JSX syntax check on this machine:** `npx esbuild frontend/src/pages/Foo.jsx > /dev/null`
  — **no `--loader=jsx`** (inferred from the extension). `node -c file.js` for plain JS.
  `cd frontend && npm run build` is the real cross-module check (catches broken imports the
  per-file check can't).
- **`resolveOAuthUser` is the heart of the model** — both callbacks funnel through it.
  The `${idCol}`/`${usernameCol}` SQL interpolations use internal constants, never user
  input. If you add a third provider, give it a column + extend the resolver, don't fork it.
- **`requireAuth` re-reads the user every request** (live `is_admin`/`player_id` + the `tv`
  check). Keep it that way.
- **Push to main = deploy to prod (Render).** Apply the pending migrations first.
