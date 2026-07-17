// Socket.io layer for the live Arena feature.
//
// Rooms:
//   arena:t:{tournamentId} — public: scoreboard, pairings, clock. Spectators
//                            (no token) may join; scoreboards are public data.
//   arena:m:{matchId}      — the two players (+ admins): chat, match detail.
//   user:{userId}          — personal room for targeted pairing notifications.
//
// Auth: the client passes the session JWT in socket.handshake.auth.token.
// A MISSING token connects as a spectator (socket.user = null). An INVALID
// token is rejected — silently downgrading a bad session to spectator would
// hide expired logins from the user.
//
// This module is imported by routes/services via getIO()/emit* helpers so
// nothing needs a reference back to app.js (no circular deps).

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { USER_COLUMNS, tokenVersionMatches } = require('../middleware/requireAuth');

let io = null;

// chat:send throttle — sockets bypass the express rate limiter, so cap chat
// at ~1 msg/sec per socket. Tracked per-connection, cleaned up on disconnect.
const CHAT_MIN_INTERVAL_MS = 1000;
const CHAT_MAX_LENGTH = 500;

async function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.user = null; // spectator
    return next();
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) return next(new Error('auth not configured'));
  try {
    const payload = jwt.verify(token, secret);
    const { rows: [user] } = await db.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [payload.sub]
    );
    if (!user || !tokenVersionMatches(payload, user)) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
}

// Is this user one of the two players in the match (or an admin)?
async function canJoinMatch(user, matchId) {
  if (!user) return false;
  if (user.is_admin) return true;
  const { rows: [m] } = await db.query(
    'SELECT 1 FROM arena_matches WHERE id = $1 AND (p1_user_id = $2 OR p2_user_id = $2)',
    [matchId, user.id]
  );
  return Boolean(m);
}

function init(server, corsOrigins) {
  io = new Server(server, {
    cors: { origin: corsOrigins },
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    if (socket.user) socket.join(`user:${socket.user.id}`);

    let lastChatAt = 0;

    socket.on('tournament:join', ({ tournamentId } = {}) => {
      const id = Number(tournamentId);
      if (Number.isInteger(id) && id > 0) socket.join(`arena:t:${id}`);
    });

    socket.on('tournament:leave', ({ tournamentId } = {}) => {
      socket.leave(`arena:t:${Number(tournamentId)}`);
    });

    socket.on('match:join', async ({ matchId } = {}, ack) => {
      const id = Number(matchId);
      if (!Number.isInteger(id) || id <= 0) return ack?.({ ok: false });
      const allowed = await canJoinMatch(socket.user, id).catch(() => false);
      if (!allowed) return ack?.({ ok: false, error: 'not a player in this match' });
      socket.join(`arena:m:${id}`);
      ack?.({ ok: true });
    });

    socket.on('match:leave', ({ matchId } = {}) => {
      socket.leave(`arena:m:${Number(matchId)}`);
    });

    socket.on('chat:send', async ({ matchId, body } = {}, ack) => {
      try {
        if (!socket.user) return ack?.({ ok: false, error: 'sign in to chat' });
        const id = Number(matchId);
        const text = String(body ?? '').trim();
        if (!Number.isInteger(id) || id <= 0 || !text) return ack?.({ ok: false });
        if (text.length > CHAT_MAX_LENGTH) return ack?.({ ok: false, error: 'message too long' });

        const now = Date.now();
        if (now - lastChatAt < CHAT_MIN_INTERVAL_MS) return ack?.({ ok: false, error: 'slow down' });
        lastChatAt = now;

        // Must be a player in the match, and the match still open for chat.
        const { rows: [m] } = await db.query(
          `SELECT id, status FROM arena_matches
           WHERE id = $1 AND (p1_user_id = $2 OR p2_user_id = $2)`,
          [id, socket.user.id]
        );
        if (!m) return ack?.({ ok: false, error: 'not a player in this match' });
        if (!['active', 'awaiting_confirm', 'disputed'].includes(m.status)) {
          return ack?.({ ok: false, error: 'match is closed' });
        }

        const { rows: [msg] } = await db.query(
          `INSERT INTO arena_chat_messages (match_id, sender_user_id, body)
           VALUES ($1, $2, $3) RETURNING id, match_id, sender_user_id, body, created_at`,
          [id, socket.user.id, text]
        );
        io.to(`arena:m:${id}`).emit('chat:message', {
          id: msg.id,
          matchId: msg.match_id,
          senderUserId: msg.sender_user_id,
          senderName: socket.user.display_name || socket.user.discord_username || 'Player',
          body: msg.body,
          at: msg.created_at,
        });
        ack?.({ ok: true });
      } catch (err) {
        console.error('[socket] chat:send failed:', err.message);
        ack?.({ ok: false, error: 'chat failed' });
      }
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitTournament(tournamentId, event, payload) {
  if (io) io.to(`arena:t:${tournamentId}`).emit(event, payload);
}

function emitMatch(matchId, event, payload) {
  if (io) io.to(`arena:m:${matchId}`).emit(event, payload);
}

function emitUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

module.exports = { init, getIO, emitTournament, emitMatch, emitUser };
