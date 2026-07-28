import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to 0.0.0.0 so other devices on the LAN (e.g. a phone testing receipt
    // capture) can reach the dev server at http://<lan-ip>:5173.
    host: true,
    port: 5173,
    open: true,
    // Proxy API calls to the backend in dev so the frontend can use the same
    // relative "/api" base URL it uses in production (behind nginx).
    proxy: {
      '/api': 'http://localhost:5000'
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts'
  }
});
