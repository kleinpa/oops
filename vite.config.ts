import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import vue from '@vitejs/plugin-vue';

const coepPlugin = (): Plugin => {
  return {
    name: "coep-plugin",
    configureServer: (server: ViteDevServer) => {
      server.middlewares.use((_req, res, next) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        next();
      });
    },
  };
};

export default defineConfig({
  plugins: [vue(), coepPlugin()],
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  server: {
    watch: {
      usePolling: true,
    },
  }
});
