import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser calls /api on the same address; Vite forwards it to the API server.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
