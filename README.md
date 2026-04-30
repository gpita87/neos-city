# 🏙️ Neos City — Pokkén Tournament Community Hub

A full-stack web app for the Pokkén Tournament competitive community. Pulls tournament data from Challonge, calculates ELO ratings, tracks achievements, and lets players run live Bo3/Bo5 matches.

---

## Features

- **Challonge Import** — Paste any Challonge tournament URL to pull all match results
- **ELO Ratings** — Custom rating system that updates after every imported tournament
- **Player Profiles** — Stats, head-to-head records, match history, ELO chart
- **Achievements** — 20+ achievements unlocked automatically from tournament data
- **Live Match Rooms** — Create a Bo3 or Bo5 room, report game scores in real-time
- **Leaderboard** — Full rankings with win rate, tournament count, and rank badges

---

## Setup

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) account (free tier is fine)

### 1. Database (Supabase)

1. Create a new Supabase project at https://supabase.com
2. Go to **SQL Editor** and paste the contents of `backend/src/db/schema.sql`
3. Run it — this creates all tables
4. Go to **Project Settings → Database** and copy the **Connection string (URI)**

### 2. Backend

```bash
cd backend
npm install
```

Edit `.env` and fill in your `DATABASE_URL` from Supabase:
```
DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres
```

Start the backend:
```bash
npm run dev
```

The backend runs on http://localhost:3001

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on http://localhost:5173

---

## Importing Your First Tournament

1. Go to the **Tournaments** page
2. Paste a Challonge URL (e.g. `https://challonge.com/8rd0p4mu` or just the slug `8rd0p4mu`)
3. Click **Import** — the app pulls all participants and match results, calculates ELO, and awards achievements automatically

---

## Deploying

### Frontend → Vercel
```bash
cd frontend
npm run build
# Push to GitHub, then connect repo to vercel.com
```

Set environment variable in Vercel:
- `VITE_API_URL` = your Railway backend URL

### Backend → Railway
1. Go to https://railway.app → New Project → Deploy from GitHub
2. Add environment variables from your `.env` file
3. Railway auto-detects Node.js and deploys

---

## Project Structure

```
neos-city/
├── backend/
│   ├── src/
│   │   ├── services/
│   │   │   ├── challonge.js   ← Challonge API client (OAuth)
│   │   │   ├── elo.js         ← ELO rating engine
│   │   │   └── achievements.js ← Achievement catalog + checker
│   │   ├── routes/
│   │   │   ├── tournaments.js ← Import + view tournaments
│   │   │   ├── players.js     ← Leaderboard + player profiles
│   │   │   ├── matches.js     ← Match feed
│   │   │   ├── achievements.js ← Achievement catalog
│   │   │   └── live.js        ← Bo3/Bo5 live rooms
│   │   ├── db/
│   │   │   ├── schema.sql     ← Run this in Supabase first
│   │   │   └── index.js       ← DB connection pool
│   │   └── app.js             ← Express server entry
│   └── .env                   ← Challonge credentials + DB URL
└── frontend/
    └── src/
        ├── pages/
        │   ├── Home.jsx
        │   ├── Leaderboard.jsx
        │   ├── PlayerProfile.jsx
        │   ├── Tournaments.jsx
        │   ├── TournamentDetail.jsx
        │   ├── Achievements.jsx
        │   └── LiveRoom.jsx
        └── lib/
            ├── api.js         ← All backend API calls
            └── utils.js       ← ELO rank labels, win rate, dates
```
