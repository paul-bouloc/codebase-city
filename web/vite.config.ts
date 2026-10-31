import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // The server started by `just dev` (crates/server, default PORT).
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
})
