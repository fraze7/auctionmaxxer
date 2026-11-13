import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development, forward /api to the API on port 3001 (via the SSH tunnel).
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
