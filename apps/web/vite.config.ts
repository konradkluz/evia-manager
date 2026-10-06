import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { securityHeadersPlugin } from './security-headers.ts';

// Panel web (ADR-0006; EVM-008). The API is same-origin under /api: locally through this proxy (API on API_PORT,
// default 3000), in EVM-076 through Caddy. Dev and preview listen on localhost only (no --host, no allowedHosts).
const api = { target: `http://localhost:${process.env['API_PORT'] ?? '3000'}`, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss(), securityHeadersPlugin()],
  build: { sourcemap: false },
  server: { host: 'localhost', port: 5173, strictPort: true, proxy: { '/api': api } },
  preview: { host: 'localhost', port: 4173, strictPort: true, proxy: { '/api': api } },
});
