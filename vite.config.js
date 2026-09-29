import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = import.meta.dirname;

// A page directory without its trailing slash (`/morceau`) would miss its index.html, and relative
// URLs inside it would resolve one level too high. nginx does the same 308s in production (see
// README).
function trailingSlash(paths) {
  const redirect = (req, res, next) => {
    const path = paths.find((p) => req.url === p || req.url?.startsWith(`${p}?`));
    if (path) {
      res.statusCode = 308;
      res.setHeader('Location', req.url.replace(path, `${path}/`));
      res.end();
      return;
    }
    next();
  };
  return {
    name: 'trailing-slash',
    // Block bodies on purpose: a hook that returns a function has it run as a post-middleware.
    configureServer(server) {
      server.middlewares.use(redirect);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
  };
}

// The live-state API (server/, `make api`). In production nginx proxies /api/ to it the same way.
const apiProxy = { '/api': 'http://127.0.0.1:8787' };

export default defineConfig({
  plugins: [tailwindcss(), trailingSlash(['/morceau', '/admin'])],
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Plain module scripts only, no dynamic imports: the polyfill would be dead weight.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        morceau: resolve(root, 'morceau/index.html'),
        admin: resolve(root, 'admin/index.html'),
      },
    },
  },
});
