// Lazy socket.io singleton for the live Arena feature.
//
// Dev: VITE_API_URL is unset → connect same-origin; vite.config.js proxies
// /socket.io to localhost:3001 (ws: true). Prod: connect to VITE_API_URL.
//
// `auth` is a function so every (re)connect reads the CURRENT session token —
// logging in/out doesn't require a page reload to be reflected on the socket.
// No token = spectator connection (server still pushes public scoreboards).

import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    const base = import.meta.env.VITE_API_URL || '/';
    socket = io(base, {
      auth: (cb) => cb({ token: window.localStorage?.getItem('auth_token') || undefined }),
    });
  }
  return socket;
}

// After login/logout: reconnect so the server re-evaluates our identity.
export function reconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket.connect();
  }
}
