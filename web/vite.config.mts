import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardsPlugin } from './server/boardsPlugin.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
// Resolved against the current folder.
const boardsDir = path.resolve(process.env.KONEKTON_BOARDS ?? path.join(repo, 'boards'));

// Web version for testing: `npm run dev`. The extension build has its own config (webview/vite.config.mts).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Next to the extension build's cache, not in web/node_modules.
  cacheDir: path.join(repo, 'node_modules/.vite/web'),
  plugins: [react(), boardsPlugin({ boardsDir, fixturesDir: path.join(repo, 'test/fixtures') })],
  server: {
    // Never `cors: true` or `allowedHosts: true`, and never `--host`: the board endpoints read and write files.
    host: 'localhost',
    // The page is same-origin. Vite's CORS middleware runs before plugin middlewares and would answer
    // preflights to /__konekton/* itself; off, the board guard refuses them.
    cors: false,
    port: 5173,
    strictPort: false,
    open: false,
    fs: {
      allow: [path.join(repo, 'web'), path.join(repo, 'webview'), path.join(repo, 'src/shared'), path.join(repo, 'node_modules')],
    },
  },
});
