require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const tournamentsRouter = require('./routes/tournaments');
const playersRouter = require('./routes/players');
const matchesRouter = require('./routes/matches');
const achievementsRouter = require('./routes/achievements');
const liveRouter = require('./routes/live');
const organizersRouter = require('./routes/organizers');

const app = express();

// Build the CORS allow-list:
//  - FRONTEND_URL is required in production (no localhost fallback).
//  - In dev (NODE_ENV !== 'production') we always allow http://localhost:5173
//    so a fresh checkout works without setting FRONTEND_URL.
//  - The three external origins below are needed by the browser-console importers
//    regardless of environment — they're always allowed.
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.FRONTEND_URL) {
  console.error('FRONTEND_URL must be set in production. Refusing to start.');
  process.exit(1);
}
const corsOrigins = [
  process.env.FRONTEND_URL,
  ...(isProduction ? [] : ['http://localhost:5173']),
  'https://liquipedia.net',   // needed for liquipedia_import_console.js
  'https://tonamel.com',      // needed for tonamel_import_console.js
  'https://challonge.com',    // needed for harvest_console.js
].filter(Boolean);
app.use(cors({ origin: corsOrigins }));
app.use(express.json());

// Rate limit: 500 requests per 15 min per IP (high enough for batch imports).
// Loopback callers (frontend dev server, batch import scripts, browser-console
// harvest tools hitting localhost from challonge.com) are exempted — the
// limiter is meant to deter external abuse, not local tooling sharing one IP.
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  skip: (req) => LOOPBACK_IPS.has(req.ip),
}));

app.use('/api/tournaments', tournamentsRouter);
app.use('/api/players', playersRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/achievements', achievementsRouter);
app.use('/api/live', liveRouter);
app.use('/api/organizers', organizersRouter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Neos City' }));

// Diagnostic: tests Challonge OAuth token acquisition and a basic API call
app.get('/api/health/challonge', async (req, res) => {
  const challonge = require('./services/challonge');
  const steps = {};

  // Step 1: try to get a token
  let token;
  try {
    token = await challonge._getAccessToken();
    steps.token = { ok: true, token_prefix: token ? token.slice(0, 8) + '…' : null };
  } catch (err) {
    steps.token = { ok: false, error: err.message, status: err.response?.status };
    return res.status(200).json({ challonge_ok: false, steps });
  }

  // Step 2: try /application/tournaments
  try {
    const data = await challonge.listTournaments({ page: 1, perPage: 1 });
    const count = Array.isArray(data) ? data.length : (data?.data?.length ?? 0);
    steps.application_tournaments = { ok: true, returned: count };
  } catch (err) {
    steps.application_tournaments = { ok: false, error: err.message, status: err.response?.status };
  }

  res.json({ challonge_ok: steps.application_tournaments?.ok ?? false, steps });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🏙️  Neos City backend running on port ${PORT}`));
