#!/usr/bin/env node
// serve.mjs — a static server for the pages the benchmark drives: the form in `bench/app/` on
// port 4300 and, for the app-factory variant, the four Angular builds on 4311–4314.
//
// Deliberately NOT a dev server: `ng serve` adds an HMR websocket and its own console lines, and
// those would land in the measurement on one side only. The MIME table is the whole point of
// writing this instead of a one-liner — a `.js` served as `application/octet-stream` is not
// executed as a module by Chrome, and an Angular app then renders nothing (the trap the app-factory
// gate documents). No caching headers on purpose either: the app-factory server sends none, and
// `timing.cacheHitsDocument > 0` must mean the engine's bug, not the fixture's.
//
// `/api/*` never exists and must stay that way: the form's POST there is the failure the task
// looks for, visible only in the console and the network.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'app');
export const APP_PORT = Number(process.env.BENCH_PORT ?? 4300);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

/**
 * The file a URL path maps to, never outside `root`: `normalize` eats `..` before the disk is
 * touched, and the comparison includes the separator, so a sibling directory sharing the prefix
 * (`app-evil` next to `app`) does not pass either.
 * @param {string} root
 * @param {string} urlPath
 * @returns {string}
 */
export function safePath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    // A broken percent (`%zz`) is a bad REQUEST, not a reason for an exception.
    return root;
  }
  const candidate = path.normalize(path.join(root, decoded));
  return candidate === root || candidate.startsWith(root + path.sep) ? candidate : root;
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {string} file
 */
function sendFile(response, file) {
  response.writeHead(200, { 'content-type': MIME.get(path.extname(file)) ?? 'application/octet-stream' });
  createReadStream(file)
    .on('error', (error) => response.destroy(error))
    .pipe(response);
}

/**
 * Serve `root` on `port` with an SPA fallback to `index.html`. Every exception is a 500 for one
 * request, never the death of the server — one stray request must not take the measurement down.
 * @param {string} root
 * @param {number} port
 * @returns {Promise<{ url: string, port: number, root: string, close: () => Promise<void> }>}
 */
export function serveStatic(root, port) {
  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`server error: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   */
  async function handle(request, response) {
    const url = request.url ?? '/';
    if (url.startsWith('/api/')) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{"error":"no such endpoint"}');
      return;
    }
    const candidate = safePath(root, url);
    const isFile = await stat(candidate)
      .then((s) => s.isFile())
      .catch(() => false);
    const file = isFile ? candidate : path.join(root, 'index.html');
    const exists = isFile
      ? true
      : await stat(file)
          .then((s) => s.isFile())
          .catch(() => false);
    if (!exists) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`no index.html under ${root}`);
      return;
    }
    sendFile(response, file);
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        url: `http://localhost:${String(port)}/`,
        port,
        root,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      }),
    );
  });
}

/** The bench form on its port. */
export const startServer = (port = APP_PORT) => serveStatic(APP_ROOT, port);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer();
  process.stdout.write(`[serve] ${url} (${APP_ROOT})\n`);
}
