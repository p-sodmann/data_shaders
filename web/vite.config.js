import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Prometheus for the dev server. Nothing uses it yet; the Prometheus source (step 07)
    // queries /prom/api/v1/... so the browser never needs CORS on Prometheus itself.
    proxy: {
      '/prom': {
        target: 'http://localhost:9090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/prom/, ''),
      },
      // mars-gateway (ADR-0010): the keys plate, and pushes from clients pointed at the dev server.
      '/api/keys': 'http://localhost:9111',
      '/push': 'http://localhost:9111',
    },
  },
});
