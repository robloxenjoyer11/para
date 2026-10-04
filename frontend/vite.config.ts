import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В dev фронт идёт на :5173, /api проксируется на бэкенд — так через один HTTPS-туннель
// (cloudflared / ngrok → localhost:5173) работает и приложение, и API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true, // иначе Vite блокирует домен туннеля (*.trycloudflare.com, *.ngrok-free.app)
    proxy: { '/api': 'http://localhost:3001' },
  },
});
