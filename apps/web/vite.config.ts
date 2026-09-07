import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev the three services run on separate ports (make dev). The SPA always
// talks to its own origin under /api/* — Vite proxies to the right service, so
// the code is identical to production, where one ingress fronts all three.
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 5173,
    proxy: {
      '/api/auth': 'http://localhost:3000',
      '/api/users': 'http://localhost:3000',
      '/api/admin/users': 'http://localhost:3000',
      '/api/admin/organizers': 'http://localhost:3000',
      '/api/admin/audit-logs': 'http://localhost:3000',
      '/api/events': 'http://localhost:3001',
      '/api/categories': 'http://localhost:3001',
      '/api/venues': 'http://localhost:3001',
      '/api/ticket-types': 'http://localhost:3001',
      '/api/organizer/events': 'http://localhost:3001',
      '/api/admin/events': 'http://localhost:3001',
      '/api/orders': 'http://localhost:3002',
      '/api/tickets': 'http://localhost:3002',
      '/api/check-ins': 'http://localhost:3002',
      '/api/payments': 'http://localhost:3003',
    },
  },
})
