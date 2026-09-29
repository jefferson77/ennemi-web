import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = import.meta.dirname;

// `/morceau` without the trailing slash would miss morceau/index.html, and relative URLs inside
// it would resolve one level too high. nginx does the same 308 in production (see README).
function morceauTrailingSlash() {
  const redirect = (req, res, next) => {
    if (req.url === '/morceau' || req.url?.startsWith('/morceau?')) {
      res.statusCode = 308;
      res.setHeader('Location', req.url.replace('/morceau', '/morceau/'));
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'morceau-trailing-slash',
    // Block bodies on purpose: a hook that returns a function has it run as a post-middleware.
    configureServer(server) {
      server.middlewares.use(redirect);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), morceauTrailingSlash()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Plain module scripts only, no dynamic imports: the polyfill would be dead weight.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        morceau: resolve(root, 'morceau/index.html'),
      },
    },
  },
});
