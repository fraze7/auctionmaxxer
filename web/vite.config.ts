import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // While developing, the page is served by Vite on port 5173 but the API
    // lives on port 3001 (reached through the SSH tunnel to the server).
    // This forwards every /api request there, so the app can always just
    // fetch("/api/...") - the same path it uses once deployed.
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
