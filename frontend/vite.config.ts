import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to 0.0.0.0 so other devices on the LAN (e.g. a phone testing receipt
    // capture) can reach the dev server at http://<lan-ip>:5173.
    host: true,
    // Both are overridable so a second instance can run beside the first — a
    // demo database on its own ports, without stopping the one you are using.
    // The defaults are the previous hardcoded values, so a plain `npm run dev`
    // is unchanged.
    port: Number(process.env.VITE_DEV_PORT) || 5173,
    open: true,
    // Proxy API calls to the backend in dev so the frontend can use the same
    // relative "/api" base URL it uses in production (behind nginx).
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://localhost:5000'
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    // The theme suite reads the real stylesheet (`import css from
    // '../App.css?raw'`) and does the contrast arithmetic itself, because jsdom
    // applies no external stylesheet and cannot be asked what colour anything
    // is. Vitest blanks CSS modules by default, which blanks `?raw` with them.
    // Scoped to the raw query on purpose: turning CSS on for the plain
    // `import '../App.css'` would start feeding real rules to every component
    // suite, where `display: none` on the mobile bar would suddenly hide
    // controls that jsdom currently reports as visible.
    css: { include: [/App\.css\?raw$/] }
  }
});
