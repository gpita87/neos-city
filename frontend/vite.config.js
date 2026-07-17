import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      // socket.io needs a websocket-capable proxy entry (Arena live updates)
      '/socket.io': { target: 'http://localhost:3001', ws: true }
    }
  }
});
