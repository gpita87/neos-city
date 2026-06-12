const axios = require('axios');

// ─── YouTube Data API v3 ──────────────────────────────────────────────────────
//
// Used only to keep creators.latest_upload_at fresh. The frontend reads cached
// DB values, so the API is never on the request path. Set YOUTUBE_API_KEY in
// backend/.env (create a key at https://console.cloud.google.com → APIs &
// Services → Credentials, then enable "YouTube Data API v3").
//
// Quota is cheap: resolving + reading latest upload for one channel is ~2 units
// against a 10,000-unit/day free quota, so even dozens of creators is trivial.

const API_BASE = 'https://www.googleapis.com/youtube/v3';

function apiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY not set in backend/.env');
  return key;
}

// Pull a channel ID (UC...) or handle (@name) out of any common channel URL.
// Returns { channelId } when the URL embeds a UC id, or { handle } / { user }
// / { custom } when it only carries a vanity name that must be resolved.
function parseChannelUrl(url) {
  const u = String(url || '').trim();
  let m;
  if ((m = u.match(/youtube\.com\/channel\/(UC[\w-]+)/i))) return { channelId: m[1] };
  if ((m = u.match(/youtube\.com\/@([\w.-]+)/i)))           return { handle: m[1] };
  if ((m = u.match(/youtube\.com\/user\/([\w-]+)/i)))       return { user: m[1] };
  if ((m = u.match(/youtube\.com\/c\/([\w%.-]+)/i)))        return { custom: decodeURIComponent(m[1]) };
  if (/^UC[\w-]+$/.test(u))                                 return { channelId: u };
  if (/^@[\w.-]+$/.test(u))                                 return { handle: u.slice(1) };
  return {};
}

// Resolve a channel URL/handle to a canonical UC channel ID (1 quota unit).
// Returns null when it can't be resolved.
async function resolveChannelId(url) {
  const parsed = parseChannelUrl(url);
  if (parsed.channelId) return parsed.channelId;

  const params = { key: apiKey(), part: 'id' };
  if (parsed.handle)      params.forHandle = parsed.handle;
  else if (parsed.user)   params.forUsername = parsed.user;
  else return null; // 'custom' (/c/) names aren't resolvable via the data API

  const { data } = await axios.get(`${API_BASE}/channels`, { params });
  return data.items?.[0]?.id || null;
}

// Fetch channel metadata + most-recent upload for a UC channel ID.
// Returns { channelId, avatarUrl, latestUploadAt, latestVideoId, latestVideoTitle }
// (latest* are null if the channel has no public uploads). ~2 quota units.
async function getChannelSnapshot(channelId) {
  // 1) channel → uploads playlist id + avatar (1 unit)
  const { data: chData } = await axios.get(`${API_BASE}/channels`, {
    params: { key: apiKey(), part: 'contentDetails,snippet', id: channelId },
  });
  const channel = chData.items?.[0];
  if (!channel) throw new Error(`Channel not found: ${channelId}`);

  const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
  const thumbs = channel.snippet?.thumbnails || {};
  const avatarUrl = (thumbs.medium || thumbs.high || thumbs.default || {}).url || null;

  const snapshot = {
    channelId,
    avatarUrl,
    latestUploadAt: null,
    latestVideoId: null,
    latestVideoTitle: null,
  };
  if (!uploadsId) return snapshot;

  // 2) uploads playlist → most recent item (1 unit)
  const { data: plData } = await axios.get(`${API_BASE}/playlistItems`, {
    params: { key: apiKey(), part: 'snippet', playlistId: uploadsId, maxResults: 1 },
  });
  const item = plData.items?.[0]?.snippet;
  if (item) {
    snapshot.latestUploadAt = item.publishedAt || null;
    snapshot.latestVideoId = item.resourceId?.videoId || null;
    snapshot.latestVideoTitle = item.title || null;
  }
  return snapshot;
}

// Fetch a channel's avatar + its N most-recent uploads in one helper (2 quota
// units). Returns { channelId, avatarUrl, videos: [{ videoId, title,
// publishedAt }] } newest-first. videos is [] for a channel with no uploads.
async function getChannelRecent(channelId, max = 3) {
  const { data: chData } = await axios.get(`${API_BASE}/channels`, {
    params: { key: apiKey(), part: 'contentDetails,snippet', id: channelId },
  });
  const channel = chData.items?.[0];
  if (!channel) throw new Error(`Channel not found: ${channelId}`);

  const thumbs = channel.snippet?.thumbnails || {};
  const avatarUrl = (thumbs.medium || thumbs.high || thumbs.default || {}).url || null;
  const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;

  let videos = [];
  if (uploadsId) {
    const perPage = Math.min(Math.max(parseInt(max, 10) || 1, 1), 50);
    const { data: plData } = await axios.get(`${API_BASE}/playlistItems`, {
      params: { key: apiKey(), part: 'snippet', playlistId: uploadsId, maxResults: perPage },
    });
    videos = (plData.items || [])
      .map(it => ({
        videoId: it.snippet?.resourceId?.videoId || null,
        title: it.snippet?.title || null,
        publishedAt: it.snippet?.publishedAt || null,
      }))
      .filter(v => v.videoId);
  }
  return { channelId, avatarUrl, videos };
}

// Fetch a single video's metadata (title, channel, thumbnail). 1 quota unit.
// Returns null if the video isn't found / is private.
async function getVideoMeta(videoId) {
  const { data } = await axios.get(`${API_BASE}/videos`, {
    params: { key: apiKey(), part: 'snippet', id: videoId },
  });
  const s = data.items?.[0]?.snippet;
  if (!s) return null;
  const t = s.thumbnails || {};
  return {
    videoId,
    title: s.title || null,
    channelTitle: s.channelTitle || null,
    channelId: s.channelId || null,
    thumbnailUrl: (t.medium || t.high || t.default || {}).url || null,
    publishedAt: s.publishedAt || null,
  };
}

// Fetch a playlist's metadata (title, channel, thumbnail, video count).
// 1 quota unit. Returns null if the playlist isn't found / is private.
async function getPlaylistMeta(playlistId) {
  const { data } = await axios.get(`${API_BASE}/playlists`, {
    params: { key: apiKey(), part: 'snippet,contentDetails', id: playlistId },
  });
  const item = data.items?.[0];
  if (!item) return null;
  const s = item.snippet || {};
  const t = s.thumbnails || {};
  return {
    playlistId,
    title: s.title || null,
    channelTitle: s.channelTitle || null,
    thumbnailUrl: (t.medium || t.high || t.default || {}).url || null,
    itemCount: item.contentDetails?.itemCount ?? null,
  };
}

module.exports = {
  parseChannelUrl,
  resolveChannelId,
  getChannelSnapshot,
  getChannelRecent,
  getVideoMeta,
  getPlaylistMeta,
};
