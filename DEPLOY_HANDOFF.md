# Deploy to Render — Handoff

**Goal:** ship Neos City to Render on the $7/mo Starter web service plan (backend) plus a free Static Site (frontend), with admin routes protected and the frontend pointing at the deployed backend.

**Branch state at handoff:** `main` is at `416faca` (harvest append, 2026-05-06). No deploy configs exist yet (`git ls-tree main -r` shows no render.yaml / Dockerfile / Procfile). Five commits ahead of the older `claude/blissful-dijkstra-dea8a9` branch. Don't deploy from that older branch — it's pre-loopback-ratelimit-fix and pre-Liquipedia-case-fix.

---

## Region decision (read first)

Render has Oregon (us-west) and Ohio/Virginia (us-east) among other regions. **Pick us-east (Ohio or Virginia)** unless the user has a specific reason to want Oregon:

- The Supabase pooler hostname documented in [AGENT_CONTEXT.md](AGENT_CONTEXT.md) is `aws-1-us-east-1.pooler.supabase.com`. Confirm against the actual `DATABASE_URL` in `backend/.env` before committing to a region.
- A us-west backend → us-east DB adds ~70ms per query. Several routes (`/api/players` with region filter, `/api/tournaments/recent-placements`, `/api/achievements/holders`) issue multiple queries per request. The compounding latency is the most user-visible cost of getting region wrong.
- If the user insists on us-west, the right answer is to migrate Supabase to us-west too (new project, restore from `pg_dump` per the Database Backups section of AGENT_CONTEXT). Don't split regions.

---

## What's already done

- Frontend builds cleanly: `vite build` → `frontend/dist/`. Static assets only, no server runtime needed.
- Backend has `start` script: `node src/app.js`. PORT respects `process.env.PORT`, which Render sets.
- `/api/health` already exists at [backend/src/app.js:38](backend/src/app.js#L38) — wire this to Render's health-check path.
- `.env.example` documents all required env vars: `CHALLONGE_V1_KEY`, `CHALLONGE_CLIENT_ID`, `CHALLONGE_CLIENT_SECRET`, `DATABASE_URL`, `STARTGG_TOKEN`, `FRONTEND_URL`, `JWT_SECRET`, `PORT`. None of them are committed; `.gitignore` covers `.env` patterns.
- Rate limiter at [backend/src/app.js:25](backend/src/app.js#L25) exempts loopback IPs — local import scripts won't get throttled when run against the deployed backend over a tunnel.
- `live.js` is DB-backed (uses `live_matches` table), so server restarts don't lose room state. The "Known Issues" entry about in-memory rooms in AGENT_CONTEXT is stale.

---

## Tasks (in order)

### 1. Admin auth middleware — BLOCKER for deploy

The instant Render gives you a public URL, twelve mutating routes are reachable from the open internet. Add a single middleware that gates them on a shared `ADMIN_TOKEN` env var (32+ random bytes).

**Routes to gate** (all `POST` in [backend/src/routes/tournaments.js](backend/src/routes/tournaments.js)):
- `/import` (line ~391), `/batch-import` (~407), `/preview-dates` (~473), `/append-harvest` (~532)
- `/import-startgg` (~1033), `/batch-import-startgg` (~1054)
- `/import-tonamel` (~1386), `/batch-import-tonamel` (~1398)
- `/import-offline` (~1620), `/batch-import-offline` (~1632)
- `/import-liquipedia-bracket` (~1991), `/import-liquipedia-placements` (~2177)

Plus `DELETE /api/organizers/:id` if it exists in [backend/src/routes/organizers.js](backend/src/routes/organizers.js) — read that file and gate any mutating routes you find.

**Don't gate:** `/api/health`, `/api/health/challonge`, all `GET` routes (read-only, fine for public).

**Implementation:**
- New file `backend/src/middleware/requireAdmin.js`: reads `req.header('x-admin-token')`, compares to `process.env.ADMIN_TOKEN` with `crypto.timingSafeEqual` (avoid timing attacks), returns 401 on mismatch. If `ADMIN_TOKEN` is unset, log a warning and 503 — fail closed, never fail open.
- Wire it on individual mutating routes, not the whole router (so `GET` stays open).
- Update the four browser-console scripts to send the header: `liquipedia_import_console.js`, `tonamel_import_console.js`, `harvest_console.js`, `liquipedia_placements_console.js`. They'll need a way for the user to set the token — easiest is a `const ADMIN_TOKEN = '...';` constant at the top of each script that the user pastes locally before running.
- Update Node-side scripts that call admin routes: `batch_import.js`, `pull_new.js`, `harvest_new.js`, `offline_import.js`. They should read `process.env.ADMIN_TOKEN` and send it as a header on every POST.
- Add `ADMIN_TOKEN=` to `backend/.env.example` with a comment explaining how to generate one (`openssl rand -hex 32`).
- Generate a real token, put it in `backend/.env` locally (the user runs this) and in Render's secrets dashboard.

### 2. Frontend API base URL via env var

Currently [frontend/src/lib/api.js:3](frontend/src/lib/api.js#L3) does `axios.create({ baseURL: '/api' })`. This works in dev because the Vite proxy ([frontend/vite.config.js](frontend/vite.config.js)) forwards `/api` to localhost:3001. In production, the static site has no proxy — `/api` would 404.

**Change:** `baseURL: import.meta.env.VITE_API_URL ? \`${import.meta.env.VITE_API_URL}/api\` : '/api'`. In dev the env var is unset and the proxy continues to handle it. In production set `VITE_API_URL` on the static site to the backend's Render URL (e.g. `https://neos-city-api.onrender.com`).

Vite reads `VITE_*` env vars at build time, so this is set in Render's Static Site env vars and baked into the bundle.

### 3. Backend CORS prod-vs-dev

[backend/src/app.js:15-21](backend/src/app.js#L15) hardcodes `'http://localhost:5173'` as a fallback when `FRONTEND_URL` is unset. In production, `FRONTEND_URL` will be set to the deployed frontend URL, so the localhost entry is harmless but ugly — and it accidentally allows any localhost-served attacker page to hit the deployed API.

**Change:** drop the fallback, require `FRONTEND_URL` to be set, and conditionally include `'http://localhost:5173'` only when `process.env.NODE_ENV !== 'production'`. The three external origins (liquipedia.net, tonamel.com, challonge.com) stay regardless — they're needed for the browser-console importers and the user runs those against whatever backend.

### 4. `render.yaml` blueprint

Check in a blueprint at the repo root so config is version-controlled, not stuck in the Render dashboard. Skeleton:

```yaml
services:
  - type: web
    name: neos-city-api
    runtime: node
    plan: starter           # $7/mo, no cold starts
    region: ohio            # or virginia — match Supabase us-east-1
    rootDir: backend
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: FRONTEND_URL
        sync: false         # set in dashboard
      - key: ADMIN_TOKEN
        sync: false
      - key: DATABASE_URL
        sync: false
      - key: CHALLONGE_V1_KEY
        sync: false
      - key: CHALLONGE_CLIENT_ID
        sync: false
      - key: CHALLONGE_CLIENT_SECRET
        sync: false
      - key: STARTGG_TOKEN
        sync: false
      - key: JWT_SECRET
        sync: false

  - type: web
    name: neos-city-web
    runtime: static
    rootDir: frontend
    buildCommand: npm install && npm run build
    staticPublishPath: ./dist
    envVars:
      - key: VITE_API_URL
        sync: false         # set to https://neos-city-api.onrender.com in dashboard
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

The `rewrite` rule on the static site is critical — without it, any `react-router` deep link (e.g. `/players/123`) hits Render's 404 page on hard refresh. The rewrite sends every path to `index.html` and lets React handle routing client-side.

`sync: false` means "don't auto-fill from another env, the operator pastes the value" — necessary for secrets. The user will paste each value into Render's dashboard once after the initial deploy.

### 5. Smoke test plan (after first deploy)

Run these in order from the user's machine:

```bash
# 1. Backend up
curl https://neos-city-api.onrender.com/api/health
# expect: {"status":"ok","app":"Neos City"}

# 2. DB reachable
curl "https://neos-city-api.onrender.com/api/players?region=NA" | head
# expect: JSON array of NA players

# 3. Challonge API reachable from Render
curl https://neos-city-api.onrender.com/api/health/challonge
# expect: {"challonge_ok":true,...}

# 4. Admin auth working — without token
curl -X POST https://neos-city-api.onrender.com/api/tournaments/import \
  -H "Content-Type: application/json" -d '{"challonge_id":"foo"}'
# expect: 401

# 5. Admin auth working — with token
curl -X POST https://neos-city-api.onrender.com/api/tournaments/import \
  -H "Content-Type: application/json" \
  -H "x-admin-token: <real-token>" \
  -d '{"challonge_id":"some-real-test-slug"}'
# expect: 200 + tournament JSON

# 6. Frontend loads, react-router deep link works
open https://neos-city-web.onrender.com/players/1
# expect: player profile renders, not Render 404
```

If (3) fails the most likely cause is Render egress IP being blocked by Challonge — solvable but outside the scope of this handoff.

---

## Out of scope for this handoff

These can wait:
- **Discord/Challonge OAuth login.** User wants this eventually but separately. The plan-of-record is Supabase Auth (Discord built-in, Challonge as custom provider). Don't roll your own JWT auth — `JWT_SECRET` in `.env.example` is a leftover, not a directive.
- **Custom domain.** Render handles HTTPS automatically via Let's Encrypt once DNS points at them. Add later.
- **CI / preview environments.** Render auto-deploys main on push, which is fine for now.
- **Migrating Supabase region.** Only do this if the user actively wants Render in us-west.
- **The `ADMIN_TOKEN` 503 fail-closed behavior** — once it's working in dev and the deploy is up, this is fine. Don't soften it.

---

## Worktree / merge notes

This file is being written from `.claude/worktrees/elegant-wescoff-f6aa32/` (a per-session ephemeral worktree, not the multi-agent `neos-city-worktrees/` workflow). The file is at the repo root in the worktree but **not yet committed**. The user will decide whether to commit it to main or leave it as a local-only doc. If you (the next agent) want to track this as a checked-in plan, ask first.

When you're ready to start the work, the user's preferred flow per AGENT_CONTEXT is to commit small, related changes — don't bundle "auth middleware + render.yaml + frontend env" into one giant commit. Suggested commit boundaries:

1. `Backend: gate admin routes behind ADMIN_TOKEN`
2. `Scripts: pass ADMIN_TOKEN header on POSTs`
3. `Frontend: read API base URL from VITE_API_URL`
4. `Backend: tighten CORS for production`
5. `Add render.yaml blueprint for $7 Starter deploy`

Last commit lands when the deploy is verified green per the smoke test above.
