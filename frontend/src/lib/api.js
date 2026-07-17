import axios from 'axios';

// In dev VITE_API_URL is unset and the Vite proxy forwards /api → localhost:3001.
// In prod set VITE_API_URL to the deployed backend (e.g. https://neos-city-api.onrender.com)
// at build time so the bundle calls the right host.
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({ baseURL });

// Admin token for mutating routes (organizer add/delete/sync, tournament imports).
// Set in DevTools: localStorage.setItem('admin_token', '...'). When present we
// attach it as `x-admin-token` on every request — read endpoints ignore it.
api.interceptors.request.use(config => {
  if (typeof window !== 'undefined') {
    const adminToken = window.localStorage?.getItem('admin_token');
    if (adminToken) config.headers['x-admin-token'] = adminToken;
    // User session token (Discord / email login). Attached as a Bearer header
    // on every request; read endpoints ignore it, auth-gated routes verify it.
    const authToken = window.localStorage?.getItem('auth_token');
    if (authToken) config.headers['Authorization'] = `Bearer ${authToken}`;
  }
  return config;
});

// region: 'NA' | 'EU' | 'JP' | null (null = all regions)
export const getLeaderboard = (region = null) =>
  api.get('/players', { params: region ? { region } : {} }).then(r => r.data);
export const getPlayer = (id) => api.get(`/players/${id}`).then(r => r.data);
// Alphabetical index of every player — for the /players lookup page.
export const getPlayerIndex = () => api.get('/players/index').then(r => r.data);
// is_offline: true → offline only, false → online only, undefined → all
export const getTournaments = (is_offline) =>
  api.get('/tournaments', { params: is_offline !== undefined ? { is_offline } : {} }).then(r => r.data);
export const getTournament = (id) => api.get(`/tournaments/${id}`).then(r => r.data);
export const importTournament = (challonge_id) =>
  api.post('/tournaments/import', { challonge_id }).then(r => r.data);
export const getAchievements = (params = {}) => api.get('/achievements', { params }).then(r => r.data);
export const getRecentAchievements = (limit = 20) =>
  api.get('/achievements/recent', { params: { limit } }).then(r => r.data);
export const getAchievementHolders = (achievement_id) =>
  api.get('/achievements/holders', { params: { achievement_id } }).then(r => r.data);
// player_id is optional — when supplied, returns the contributing tournaments
// for that one player; when omitted, returns the aggregate unlock events.
export const getAchievementTournaments = (achievement_id, player_id = null) =>
  api.get(`/achievements/${achievement_id}/tournaments`, {
    params: player_id ? { player_id } : {},
  }).then(r => r.data);
export const getRecentMatches = () => api.get('/matches').then(r => r.data);
export const getRecentPlacements = (days = 30) =>
  api.get('/tournaments/recent-placements', { params: { days } }).then(r => r.data);
export const getOfflineLeaderboard = () => api.get('/players/offline-leaderboard').then(r => r.data);

// tier:      'worlds' | 'major' | 'regional' | 'other'
// placement: 'wins' | 'runner_up' | 'top4' | 'top8'
export const getOfflinePlacements = (player_id, tier, placement) =>
  api.get(`/players/${player_id}/offline-placements`, { params: { tier, placement } }).then(r => r.data);

// Live match rooms
export const createRoom = (player1_id, player2_id, format) =>
  api.post('/live/create', { player1_id, player2_id, format }).then(r => r.data);
export const getRoom = (code) => api.get(`/live/${code}`).then(r => r.data);
export const reportGame = (code, winner) =>
  api.patch(`/live/${code}/report`, { winner }).then(r => r.data);

// Community pillars (YouTube creators) + resource library
// Returns { active_days, creators: [...] }; each creator has a derived is_active
// flag and resource_count. active_days tunes the active/archive threshold.
export const getCreators = (active_days) =>
  api.get('/creators', { params: active_days ? { active_days } : {} }).then(r => r.data);
// params: { kind, character, skill_level, series, creator_id } — all optional
export const getResources = (params = {}) =>
  api.get('/resources', { params }).then(r => r.data);

// Twitch streamers — cached live status + last Pokkén-category stream per
// channel. Returns { configured, last_checked_at, streamers: [...] }.
export const getTwitchStreamers = () => api.get('/twitch').then(r => r.data);

// ── Auth + account linking (OAuth-only: Discord + Google) ────────────────────
export const getMe = () => api.get('/auth/me').then(r => r.data);
// Invalidates every session for the account (bumps token_version server-side),
// so the caller's own token also stops working — clear it locally afterward.
export const logoutAll = () => api.post('/auth/logout-all').then(r => r.data);
export const linkPlayer = (player_id) => api.post('/auth/link', { player_id }).then(r => r.data);
export const unlinkPlayer = () => api.post('/auth/unlink').then(r => r.data);
// Ranked player records matching the signed-in user's provider name, for the
// post-login "Is this you?" claim step. Returns { suggestions: [...] } ([] when
// nothing matches or the account is already linked).
export const getClaimSuggestions = () => api.get('/auth/claim-suggestions').then(r => r.data);
// Self-service profile fields; currently { ingame_name } (Arena M2).
export const patchMe = (data) => api.patch('/auth/me', data).then(r => r.data);
// OAuth sign-in is a full-page navigation (not an XHR), so build raw URLs.
// In dev VITE_API_URL is unset and the Vite proxy forwards /api → backend.
export const discordLoginUrl = () => `${import.meta.env.VITE_API_URL || ''}/api/auth/discord`;
export const googleLoginUrl = () => `${import.meta.env.VITE_API_URL || ''}/api/auth/google`;

// ── Live Arena tournaments ────────────────────────────────────────────────────
// Reads are public (spectators). Register/withdraw/pause/resume need a session;
// create/update need admin. Live updates arrive over socket.io (lib/socket.js) —
// these REST calls are the snapshot layer / reconnect fallback.
export const getArenaTournaments = () => api.get('/arena').then(r => r.data);
export const getArenaTournament = (id) => api.get(`/arena/${id}`).then(r => r.data);
export const registerArena = (id) => api.post(`/arena/${id}/register`).then(r => r.data);
export const withdrawArena = (id) => api.post(`/arena/${id}/withdraw`).then(r => r.data);
export const pauseArena = (id) => api.post(`/arena/${id}/pause`).then(r => r.data);
export const resumeArena = (id) => api.post(`/arena/${id}/resume`).then(r => r.data);
export const createArenaTournament = (data) => api.post('/arena', data).then(r => r.data);
export const updateArenaTournament = (id, data) => api.patch(`/arena/${id}`, data).then(r => r.data);
// Match results: players report ({ winner_user_id, loser_games }); admins
// force-confirm a disputed/stuck match with the same body.
export const reportArenaMatch = (matchId, data) => api.post(`/arena/matches/${matchId}/report`, data).then(r => r.data);
export const resolveArenaMatch = (matchId, data) => api.post(`/arena/matches/${matchId}/resolve`, data).then(r => r.data);
// Per-match chat history (players in the match + admins). Live messages arrive
// over the socket; this restores the thread on reload/reconnect.
export const getArenaMatchChat = (matchId) => api.get(`/arena/matches/${matchId}/chat`).then(r => r.data);

// ── Pokkén in-game Groups (lobbies) ──────────────────────────────────────────
// Players list which Groups they're in (max 6, the in-game cap) so paired
// opponents can see where to play. PUT /mine is full-replace semantics.
export const getGroups = (params = {}) => api.get('/groups', { params }).then(r => r.data);
export const getMyGroups = () => api.get('/groups/mine').then(r => r.data);
export const setMyGroups = (group_ids) => api.put('/groups/mine', { group_ids }).then(r => r.data);
export const createGroup = (data) => api.post('/groups', data).then(r => r.data);
export const updateGroup = (id, data) => api.patch(`/groups/${id}`, data).then(r => r.data);

// Organizers
export const getOrganizers = () => api.get('/organizers').then(r => r.data);
export const addOrganizer = (data) => api.post('/organizers', data).then(r => r.data);
export const deleteOrganizer = (id) => api.delete(`/organizers/${id}`).then(r => r.data);
export const discoverTournaments = () => api.post('/organizers/discover').then(r => r.data);
export const syncTournaments = (opts = {}) => api.post('/organizers/sync', opts).then(r => r.data);
export const batchImportTournaments = (urls) =>
  api.post('/tournaments/batch-import', { urls }).then(r => r.data);
