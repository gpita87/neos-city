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

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://liquipedia.net',   // needed for liquipedia_import_console.js
    'https://tonamel.com',      // needed for tonamel_import_console.js
  ]
}));
app.use(express.json());

// Rate limit: 500 requests per 15 min per IP (high enough for batch imports)
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

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
