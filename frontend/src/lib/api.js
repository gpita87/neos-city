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
    const token = window.localStorage?.getItem('admin_token');
    if (token) config.headers['x-admin-token'] = token;
  }
  return config;
});

// region: 'NA' | 'EU' | 'JP' | null (null = all regions)
export const getLeaderboard = (region = null) =>
  api.get('/players', { params: region ? { region } : {} }).then(r => r.data);
export const getPlayer = (id) => api.get(`/players/${id}`).then(r => r.data);
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

// Organizers
export const getOrganizers = () => api.get('/organizers').then(r => r.data);
export const addOrganizer = (data) => api.post('/organizers', data).then(r => r.data);
export const deleteOrganizer = (id) => api.delete(`/organizers/${id}`).then(r => r.data);
export const discoverTournaments = () => api.post('/organizers/discover').then(r => r.data);
export const syncTournaments = (opts = {}) => api.post('/organizers/sync', opts).then(r => r.data);
export const batchImportTournaments = (urls) =>
  api.post('/tournaments/batch-import', { urls }).then(r => r.data);
