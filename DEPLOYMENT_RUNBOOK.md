# Render Deployment — Runbook

You are picking up the **execution phase** of deploying Neos City to Render. The "readiness" work (admin auth middleware, `render.yaml`, frontend `VITE_API_URL` plumbing, prod-vs-dev CORS) was done in a previous session, possibly on a different branch. Your job is to verify it's in place, then walk Gabriel through the actual deploy.

**Plan of record:**
- Backend on Render Starter ($7/mo, no cold starts) — needed for OAuth flows later.
- Frontend as a free Static Site.
- Region: **us-east** (Ohio or Virginia) to match the Supabase pooler `aws-1-us-east-1`. Don't pick Oregon unless Gabriel says otherwise — the cross-coast latency compounds across multi-query routes.
- Custom domain, OAuth login (Discord / Challonge via Supabase Auth) are **out of scope** for this session.

---

## Step 0 — Audit what's actually on main

Before doing anything else, confirm the readiness work is merged. Do not assume it is.

```powershell
cd C:\Users\pitag\Documents\neos-city
git fetch origin
git log origin/main --oneline -10
git status
```

Then check that all of these exist on `origin/main`:

1. **`render.yaml` at repo root** — `git show origin/main:render.yaml`. Should define two services: `neos-city-api` (web, runtime node, plan starter, region ohio/virginia, healthCheckPath /api/health) and `neos-city-web` (static site, rewrite `/* → /index.html`).
2. **Admin auth middleware** — `git show origin/main:backend/src/middleware/requireAdmin.js` (or wherever it landed). Twelve POST routes in `backend/src/routes/tournaments.js` plus any mutating routes in `organizers.js` should be gated behind it. `GET` routes and `/api/health` must NOT be gated.
3. **Frontend env-driven base URL** — grep `frontend/src/lib/api.js` for `VITE_API_URL`. Must fall back to `/api` when unset (so dev still works via Vite proxy).
4. **CORS hardened** — `backend/src/app.js` should require `FRONTEND_URL` in production and only allow `localhost:5173` when `NODE_ENV !== 'production'`.
5. **`backend/.env.example` updated** with `ADMIN_TOKEN` documented.
6. **Browser-console + Node scripts** updated to send `x-admin-token` header — check `liquipedia_import_console.js`, `tonamel_import_console.js`, `harvest_console.js`, `batch_import.js`, `pull_new.js`, `harvest_new.js`, `offline_import.js`.

If any of these are missing, **stop and tell Gabriel** before proceeding. The previous session may have left work on a feature branch that wasn't merged. Do not start patching from this runbook — it's a runbook, not a build plan.

Also do a clean local build to catch surprises:
```powershell
cd backend
npm install
node -c src/app.js
cd ..\frontend
npm install
npm run build  # should succeed and emit dist/
```

---

## Step 1 — Generate the admin token

Gabriel runs this himself, both because he should hold the secret directly and because it lands in two places (his local `backend/.env` and Render's secrets dashboard):

```powershell
# Pick one
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or
openssl rand -hex 32
```

Have him paste the result into `backend/.env` as `ADMIN_TOKEN=...` and verify locally:

```powershell
cd backend
npm run dev
# In another shell:
curl -X POST http://localhost:3001/api/tournaments/import -H "Content-Type: application/json" -d "{\"challonge_id\":\"x\"}"
# expect: 401
curl -X POST http://localhost:3001/api/tournaments/import -H "Content-Type: application/json" -H "x-admin-token: <the-token>" -d "{\"challonge_id\":\"x\"}"
# expect: 4xx with a real error message about the slug, NOT 401
```

If 401 → middleware not wired right. If 200 without token → fail-open bug, **STOP**, the auth is broken.

---

## Step 2 — Push main to GitHub

Render auto-deploys from `origin/main`. If anything from Step 0 is unpushed:

```powershell
git status
git push origin main
```

Confirm the latest SHA is on GitHub before moving to Step 3 — Render reads from there, not from local.

---

## Step 3 — Render account & blueprint deploy (Gabriel drives the dashboard)

You CANNOT do this for him. Render requires a logged-in browser session and a payment method on file. Walk him through:

1. **Sign in / sign up** at `https://dashboard.render.com`. Connect GitHub (he's `gpita87`).
2. **New Blueprint Instance** → select the `neos-city` repo, branch `main`. Render auto-detects `render.yaml`.
3. **Confirm region** matches Step 0 (Ohio or Virginia). If `render.yaml` says `oregon` and we want us-east, fix the YAML, push, and re-deploy.
4. **Confirm plan** says Starter on the API service (not Free — Free has cold starts that break OAuth later).
5. **Set env vars** on `neos-city-api`. The blueprint declares them with `sync: false` so Render prompts for each one. Gabriel pastes:
   - `NODE_ENV` = `production` (already in YAML, no input needed)
   - `FRONTEND_URL` = leave blank for now; we'll set it after the static site exists in Step 5
   - `ADMIN_TOKEN` = the value from Step 1
   - `DATABASE_URL` = whatever's currently in his local `backend/.env`. **Copy-paste from his `.env`, do not regenerate.** Verify the hostname is `aws-1-us-east-1.pooler.supabase.com` — if not, region match is wrong.
   - `CHALLONGE_V1_KEY`, `CHALLONGE_CLIENT_ID`, `CHALLONGE_CLIENT_SECRET`, `STARTGG_TOKEN`, `JWT_SECRET` — copy from his `backend/.env`.
6. **Set env vars** on `neos-city-web`:
   - `VITE_API_URL` = leave blank for now; set in Step 5.
7. **Apply** — Render starts both builds. The API takes a few minutes (npm install + start), the static site is faster.

**You** (the agent) should NOT see the secret values. Have Gabriel confirm verbally that he's pasted each one. Don't ask him to paste them into the chat.

---

## Step 4 — Smoke test the backend

Once Render shows `neos-city-api` as live, get the URL (looks like `https://neos-city-api.onrender.com`). Run from PowerShell:

```powershell
$API = "https://neos-city-api.onrender.com"

# Health
curl "$API/api/health"
# expect: {"status":"ok","app":"Neos City"}

# DB reachable from Render → Supabase
curl "$API/api/players?region=NA"
# expect: JSON array of NA players

# Challonge API reachable from Render's egress IP
curl "$API/api/health/challonge"
# expect: {"challonge_ok":true,...}. If false, Render's egress is blocked — see "If Challonge blocks Render" below.

# Admin auth — without token
curl -X POST "$API/api/tournaments/import" -H "Content-Type: application/json" -d "{\"challonge_id\":\"x\"}"
# expect: 401

# Admin auth — with token (Gabriel runs this with his real ADMIN_TOKEN)
curl -X POST "$API/api/tournaments/import" -H "Content-Type: application/json" -H "x-admin-token: <token>" -d "{\"challonge_id\":\"some-real-test-slug\"}"
# expect: 200 + tournament JSON
```

If any of these fail, debug before moving on. Render's logs are at the service's "Logs" tab — readable from the dashboard or via `render` CLI if Gabriel has it installed.

---

## Step 5 — Wire up the frontend

Now that the API URL is known:

1. In Render, open `neos-city-web` → Environment → set `VITE_API_URL` = the API URL from Step 4 (e.g. `https://neos-city-api.onrender.com`). Save → Render rebuilds the static site (~1 min).
2. In Render, open `neos-city-api` → Environment → set `FRONTEND_URL` = the static site URL (e.g. `https://neos-city-web.onrender.com`). Save → Render restarts the API (~30s).
3. Visit the static site URL in a browser. Check:
   - Home page loads, recent results render (proves API is reachable from the browser → CORS OK).
   - Hard-refresh on `/players/1` works (proves the `/* → /index.html` rewrite is in place).
   - Open DevTools Network tab — calls go to `https://neos-city-api.onrender.com/api/...`, not relative `/api/...`.

---

## Step 6 — Final hand-back

Tell Gabriel:
- Both URLs (API + static).
- The `ADMIN_TOKEN` is in Render's secrets and his local `.env`. Note for future: setting it on a new dev machine requires copying from one of these — there's no "recover" flow.
- Auto-deploy is on. Pushing to `main` triggers a redeploy. Mention this — he may want a staging branch later.
- Update the "Known Issues / TODOs" section of `AGENT_CONTEXT.md` to remove "No authentication — admin routes wide open." That's resolved now.
- Anything that broke and how you fixed it.

---

## Known traps

**If Challonge blocks Render's egress IP.** Render publishes their egress IPs at `https://render.com/docs/static-outbound-ip-addresses`. If `/api/health/challonge` returns `challonge_ok:false`, the most likely cause is an IP block. Workarounds: (a) move `CHALLONGE_V1_KEY` calls through a proxy, (b) keep imports running locally and have Render only serve reads. Don't try to fix this in-session unless Gabriel asks — flag it for follow-up.

**If `DATABASE_URL` connection fails from Render.** Supabase free tier sometimes pauses the project after inactivity. Have Gabriel un-pause from the Supabase dashboard, then redeploy. Also confirm the connection string uses the **Session pooler** hostname (`aws-1-us-east-1.pooler.supabase.com`), not the direct `db.<ref>.supabase.co` hostname — the latter is IPv6-only and Render's outbound is IPv4.

**If a script breaks because it doesn't send the admin token.** Step 0 task 6 should have caught this, but if a script you didn't update runs against the deployed API, it'll 401. The fix is to set `ADMIN_TOKEN` in the script's environment (locally) and have it send `x-admin-token` on every POST. Don't disable auth to make a script work.

**If render.yaml says `region: oregon`.** Either fix it (push, redeploy) or accept the latency. Don't half-migrate — if any service is in us-east and any is in us-west, you've got the worst of both.

---

## What this runbook is NOT

- A build plan. If readiness work isn't merged, stop.
- An OAuth setup guide. Login via Discord/Challonge is a separate, larger project. The plan is Supabase Auth (Discord built-in, Challonge as custom provider) — leave it for later.
- A custom-domain setup. Render handles HTTPS; DNS pointing at them is a 5-minute task once Gabriel has a domain to point.

When you're done, append a one-paragraph "deploy completed" note to the bottom of `AGENT_CONTEXT.md`'s `## ⚡ NEXT AGENT` section so the next session knows the live URLs and that auth is in place.
