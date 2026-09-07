import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev the three services run on separate ports (make dev). The SPA always
// talks to its own origin under /api/* — Vite proxies to the right service, so
// the code is identical to production, where one ingress fronts all three.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api/auth': 'http://localhost:3000',
      '/api/events': 'http://localhost:3001',
      '/api/registrations': 'http://localhost:3002',
    },
  },
})
