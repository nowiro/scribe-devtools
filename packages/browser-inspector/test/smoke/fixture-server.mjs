// fixture-server.mjs — `fixtures/*.html` over node:http for the smoke tests, one server per origin
// (the isolation test needs TWO origins, so the port is the caller's — WP2 owns 4501–4519).
//
// The MIME table matters: a `.js` served as `application/octet-stream` is not executed as a module
// by Chrome, which is exactly the trap the app-factory gate documents. Three dynamic routes stand
// in for a backend: `/slow?ms=N` (a delayed body for slow.html), `/api/data` (the JSON routes.html
// fetches) and `/api/zgloszenia` (the POST form.html makes — always 404, the failure the demo app
// shows only in the console and the network).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

/**
 * @param {number} port
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ port: number, origin: string, url: (file: string) => string, close: () => Promise<void> }>}
 */
export function startFixtureServer(port, options = {}) {
  const root = options.root ?? FIXTURES_DIR;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${String(port)}`);
    if (url.pathname === '/slow') {
      const ms = Number(url.searchParams.get('ms') ?? 300);
      setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end(`${String(ms)} ms`), ms);
      return;
    }
    if (url.pathname === '/api/data') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"source":"server"}');
      return;
    }
    if (url.pathname === '/api/zgloszenia') {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
      return;
    }
    const clean = decodeURIComponent(url.pathname);
    const file = path.join(root, clean === '/' ? 'form.html' : clean);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    // No caching headers on purpose: the app-factory static server sends none either, and a
    // `cacheHitsDocument > 0` here would be the engine's bug, not the fixture's.
    res.writeHead(200, { 'content-type': MIME.get(path.extname(file)) ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const origin = `http://localhost:${String(port)}`;
      resolve({
        port,
        origin,
        url: (file) => `${origin}/${file}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
