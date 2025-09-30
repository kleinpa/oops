import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// A simple plugin to set the necessary COOP/COEP headers
const coepPlugin = {
  name: "coep-plugin",
  configureServer: (server) => {
    server.middlewares.use((req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
};

export default defineConfig({
  plugins: [vue(), coepPlugin],
});
