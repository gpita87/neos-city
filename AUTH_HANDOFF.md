# Auth + Account Linking — Handoff

**Status:** Foundation shipped and migration applied to the DB. Not yet exercised against real Discord/Resend credentials. Frontend builds clean; backend modules load clean. No automated tests (project has none).

**What this feature is:** real user logins (Discord OAuth + email/password) so existing players can claim their `players` record. Groundwork for a future online ranked ladder — **the ladder itself is not built here.**

**Design plan of record:** `C:\Users\pitag\.claude\plans\adaptive-leaping-raven.md` (the approved plan). This doc is the living handoff; the plan is the original spec.

---

## Current state (what's done)

- ✅ `users` table migration **applied** (`backend/src/db/migrations/add_users_auth.sql`).
- ✅ Backend: auth middleware, email service, `/api/auth/*` routes, mounted in `app.js`.
- ✅ Backend deps installed: `jsonwebtoken`, `bcryptjs` (in `backend/package.json`).
- ✅ Player-merge tooling re-points claims (`merge_players.js`, `link_offline_player.js`).
- ✅ Frontend: AuthContext, bearer interceptor, login/callback/verify/reset/claim pages, nav + unverified banner, profile claim CTA.
- ✅ `backend/.env.example` documents all new vars.
- ⛔ **Not done / external:** Discord app not created, Resend not configured, prod env vars not set on Render. Email currently uses the **console-log dev fallback** (no `RESEND_API_KEY`).

---

## Key design decisions (and why)

1. **Bearer JWT in `localStorage`, not cookies.** Prod is cross-origin (`www.neos-city.com` → `api.neos-city.com`); cookies would need `SameSite=None; Secure` + credentialed CORS + CSRF. Bearer reuses the existing `x-admin-token` interceptor pattern with zero CORS changes (the `cors` package auto-reflects the `Authorization` preflight header). Session token stored as `localStorage.auth_token`.
2. **Session JWT payload is `{ sub }` only.** `is_admin` / `player_id` are re-loaded from the DB on every request by `requireAuth`, so they're always authoritative (an admin unlink or fresh claim takes effect immediately, not at token expiry).
3. **No silent email-merge on Discord login (security).** The Discord callback resolves identity by `discord_id` **only**. It never attaches a Discord login to an existing email account by matching email — that would let an attacker pre-register `victim@email` (unverified) and inherit the victim's Discord identity. When a brand-new Discord user's email collides with an existing account, we store the Discord user's email as `NULL` to avoid the unique-index clash and any implicit merge.
4. **Email verification required before claiming.** `POST /api/auth/link` returns 403 unless `email_verified = true`. This gates the future ranked identity behind a real, owned address. Discord users get `email_verified = true` automatically **only if** Discord reports `verified === true` and we actually stored their email.
5. **Tokens delivered via URL fragment (`#token=`), not query string.** Keeps JWTs out of server logs, referrers, and history. Applies to the Discord callback redirect and the verify/reset email links.
6. **Verification + reset tokens are stateless signed JWTs** (no token table). They carry a `purpose` claim (`verify_email` / `pwreset` / `discord_state`) that the consuming route checks, so a session token can't be replayed as a verify token and vice-versa.
7. **bcryptjs not bcrypt** — pure JS, no native build (Windows dev machine + Render both choke on `bcrypt`'s node-gyp step).

---

## Data model — `users` table

| Column | Notes |
|---|---|
| `id` | SERIAL PK |
| `email` | nullable; partial-unique on `LOWER(email)` |
| `password_hash` | nullable (Discord-only users have none); bcryptjs |
| `email_verified` | bool, default false |
| `discord_id` | nullable; partial-unique |
| `discord_username`, `display_name`, `avatar_url` | informational |
| `player_id` | FK → `players(id)` `ON DELETE SET NULL`; partial-unique (one user per player) |
| `is_admin` | seeded false; for future admin unification, **not wired to anything yet** |
| `created_at`, `updated_at` | `updated_at` is NOT auto-updated by a trigger — routes set it explicitly |

- **CHECK** `users_has_identity`: every user must have `email` OR `discord_id`.
- **RLS enabled** (no policies) — defense-in-depth for the Supabase PostgREST anon endpoint, since this table holds password hashes. Backend uses the `postgres` role and bypasses RLS. Same pattern as `enable_rls_all_public_tables.sql`.
- Linking is **trust-based**: a logged-in, verified user picks any player and it links instantly (no Challonge/start.gg ownership proof). First-come-first-served; one account ↔ one player both enforced.

---

## File map

**Backend**
- `backend/src/db/migrations/add_users_auth.sql` — the `users` table (applied).
- `backend/src/middleware/requireAuth.js` — `requireAuth` (fail-closed Bearer verify + per-request user load), `attachUser` (non-blocking variant, **currently unused** — available for routes that vary by login state), `USER_COLUMNS` (the no-password-hash projection).
- `backend/src/services/email.js` — Resend REST via `axios`; **console-log fallback when `RESEND_API_KEY` unset**. Exports `sendEmail`, `sendVerificationEmail`, `sendPasswordResetEmail`.
- `backend/src/routes/auth.js` — all auth routes (see table below). Has `authLimiter` (30/15min, loopback-exempt), `signSession`, `fetchPublicUser`, email/normalize helpers.
- `backend/src/app.js` — mounts `app.use('/api/auth', authRouter)`.
- `merge_players.js`, `link_offline_player.js` — re-point `users.player_id` from loser→winner before `DELETE FROM players` (guarded by `to_regclass('public.users')` so they still work on DBs without the table).

**Frontend**
- `frontend/src/contexts/AuthContext.jsx` — `AuthProvider` + `useAuth()`. Holds `{ user, token, loading }`; `login/register/logout/refresh/setToken`. Stores token in `localStorage.auth_token`.
- `frontend/src/lib/api.js` — interceptor now sends `Authorization: Bearer ${auth_token}` (plus the existing `x-admin-token`). New helpers: `registerUser, loginUser, getMe, verifyEmail, resendVerification, requestPasswordReset, resetPassword, linkPlayer, unlinkPlayer, discordLoginUrl`.
- `frontend/src/main.jsx` — wraps `<App>` in `<AuthProvider>`.
- `frontend/src/App.jsx` — `AuthNav` (sign-in vs identity+logout), `VerifyBanner` (unverified prompt), routes for `/login /auth/callback /verify-email /forgot-password /reset-password /link`.
- `frontend/src/pages/`: `Login.jsx` (email/pw + register toggle + Discord button + forgot link), `AuthCallback.jsx` (reads `#token`), `VerifyEmail.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `ClaimPlayer.jsx` (player search → claim).
- `frontend/src/pages/PlayerProfile.jsx` — `ClaimProfileCTA` in the header ("This is me — claim profile" / "✓ Your profile" / verify-first prompt).

---

## API surface (`/api/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/register` | limiter | `{email,password,display_name?}` → `{token,user}`, sends verify email |
| POST | `/login` | limiter | `{email,password}` → `{token,user}`; generic 401 on any failure |
| GET | `/me` | requireAuth | `{user}` |
| POST | `/verify-email` | limiter | `{token}` (verify_email JWT, 24h) |
| POST | `/resend-verification` | requireAuth | resends to `req.user.email` |
| POST | `/request-password-reset` | limiter | `{email}`, always 200 (no enumeration) |
| POST | `/reset-password` | limiter | `{token,password}` (pwreset JWT, 1h) |
| GET | `/discord` | — | 302 to Discord authorize (state JWT, 10m) |
| GET | `/discord/callback` | limiter | resolves by `discord_id`; redirects to `${FRONTEND_URL}/auth/callback#token=…` |
| POST | `/link` | requireAuth | `{player_id}`; **403 if not email_verified**; 409 if taken/already-linked |
| POST | `/unlink` | requireAuth | clears caller's own `player_id` |
| POST | `/admin/unlink` | requireAdmin | `{user_id}`; reuses `x-admin-token` |

---

## External setup still required (Gabriel)

1. **Discord app** — discord.com/developers → new app → OAuth2 → copy Client ID/Secret → add redirects (exact match):
   - `http://localhost:3001/api/auth/discord/callback`
   - `https://api.neos-city.com/api/auth/discord/callback`
   - scopes used: `identify email`.
2. **Resend** — account → verify `neos-city.com` sending domain (SPF/DKIM DNS at Cloudflare, which Gabriel manages) → API key.
3. **Env vars** (`backend/.env` locally, Render `neos-city-api` for prod) — see `backend/.env.example`: `JWT_SECRET` (required; now actually used), `DISCORD_CLIENT_ID/SECRET/REDIRECT_URI`, `RESEND_API_KEY`, `EMAIL_FROM`. `FRONTEND_URL` already set. Frontend `VITE_API_URL` already set on `neos-city-web`.
   - Prod `DISCORD_REDIRECT_URI` must be the `api.neos-city.com` callback.

---

## How to test locally (no Discord/Resend needed)

Backend `npm run dev` (port 3001) + frontend `npm run dev` (5173). Leave `RESEND_API_KEY` unset.
1. Register at `/login` → backend **console prints the verification link**.
2. Open that link → `/verify-email` → verified.
3. Go to `/link` → search a player → "This is me" → lands on their profile, nav shows it.
4. Negative checks: claim same player from a 2nd account → 409; claim while unverified → 403; wrong password → 401.
5. Password reset: `/forgot-password` → console link → `/reset-password`.
6. Discord path needs a real app (step above); verifies `#token` handoff + no-merge behavior.

Full checklist is in the plan file's "Verification" section.

---

## Known limitations (by design, not bugs)

- **One login method per account at launch.** Email/pw and Discord both work as entry points, but there's no in-app "add a password to my Discord account" / "add Discord to my email account". A Discord-first user can't also get password login for the same address. Deliberate — avoids the unverified-email merge risk. **This is the top follow-up** (see below).
- **Unverified email/password users** can log in but can't claim until verified.
- `is_admin` exists but is **not enforced anywhere** — admin routes still use the shared `ADMIN_TOKEN`.

---

## Open follow-ups / next steps (in rough priority)

1. **`token_version` for session revocation — DISCUSSED, RECOMMENDED, NOT YET IMPLEMENTED.**
   Current gap: `reset-password` only swaps `password_hash`; existing 30-day sessions stay valid. No "log out everywhere". To add (~15 lines):
   - migration: `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;`
   - `signSession(user)` → embed `tv: user.token_version`.
   - `requireAuth`: after loading the user, `if (payload.tv !== user.token_version) return 401;` (no extra query — the user row is already fetched).
   - bump `token_version` in `reset-password` (and optionally a `POST /auth/logout-all`).
   Gabriel asked about this; left out of the initial cut to keep scope tight. Likely the first thing to do next.
2. **Authenticated method-linking** — let a logged-in user add a second login method (password to a Discord account, or Discord to an email account) safely. Resolves the "one method per account" limitation. This is where a safe, *explicit* (verified) merge lives.
3. **Unify `ADMIN_TOKEN` into `is_admin`** — replace the shared `x-admin-token` on mutating routes with `requireAuth` + an `is_admin` check, then retire the shared secret. `is_admin` + `admin/unlink` are already seeded to ease this. Touches every admin route in `tournaments.js` / `organizers.js`, so it's its own task.
4. **The ranked ladder** — the actual reason this exists. Will build on `users.player_id` as the verified identity.
5. **Hardening:** token refresh/rotation, server-side Discord `state` store (currently a stateless 10m JWT), expose "is this player already claimed" on the public profile payload so the claim button can pre-gray.

---

## Gotchas for the next agent

- **Don't run DB-mutating scripts/migrations without Gabriel** (shared Supabase, per `AGENT_CONTEXT.md`). The `users` migration is already applied — don't re-run blindly (it's idempotent, but still).
- **JSX syntax check on this machine:** `npx esbuild frontend/src/pages/Foo.jsx > /dev/null` — **do NOT pass `--loader=jsx`** (this esbuild version rejects it for file input; loader is inferred from the `.jsx` extension). `node -c file.js` for plain JS.
- **CORS:** auth XHRs send `Authorization`, which triggers a preflight. The existing `cors({ origin: corsOrigins })` handles it (auto-reflects request headers). If a second frontend origin is ever needed, `app.js` builds a single allow-list array — extend there.
- **`requireAuth` re-reads the user every request** — that's intentional (live `is_admin`/`player_id`). Keep it that way if you add `token_version` (the comparison is free since the row is already loaded).
- **WIP context:** this work was built on branch `calendar-schedule-fixes` alongside unrelated WIP (`harvested_tournaments.txt`, untracked `check_*.js`). Check `git log`/`git status` to see how it was ultimately committed.
