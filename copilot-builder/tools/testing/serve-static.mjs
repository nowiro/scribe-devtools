#!/usr/bin/env node
// serve-static.mjs — a tiny static server with SPA fallback for end-to-end tests over a BUILT
// application (`dist/apps/<app>/browser`), so the e2e job serves the artifact the build job produced
// instead of running a second build inside a dev server.
//
//   node tools/testing/serve-static.mjs <dir> <port>
//
// Zero dependencies: node:http and node:fs. A request is answered from inside <dir> only: an asset
// (anything with a file extension) must exist there and REALLY live there — a symlink pointing out
// of the directory is a 404, not a file. Anything without an extension is the Angular router's
// business and gets index.html. A malformed URL is a 400, never an exception: the server must outlive
// every request Playwright throws at it. Loopback only.
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * @typedef {{ status: 200, file: string } | { status: 400 | 404, file?: undefined }} Resolution
 */

/**
 * What a request path maps to: the asset inside `root`, index.html for a route, 404 for an asset
 * that is missing or escapes the directory, 400 for a URL that cannot be decoded.
 * @param {string} root absolute directory
 * @param {string} pathname the URL path, still percent-encoded
 * @returns {Resolution}
 */
export function resolveRequest(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes('\0')) return { status: 400 };
  const requested = path.normalize(decoded).replace(/^(?:\.\.[/\\])+/u, '');
  const candidate = path.join(root, requested);
  const inside = candidate === root || candidate.startsWith(root + path.sep);
  if (!inside || path.extname(candidate) === '') return { status: 200, file: path.join(root, 'index.html') };
  if (!existsSync(candidate)) return { status: 404 };
  const realRoot = realpathSync(root);
  const real = realpathSync(candidate);
  if (!(real === realRoot || real.startsWith(realRoot + path.sep)) || statSync(real).isDirectory())
    return { status: 404 };
  return { status: 200, file: real };
}

/**
 * The request handler, exported so a test can drive it on an ephemeral port.
 * @param {string} root
 * @returns {import('node:http').RequestListener}
 */
export function handler(root) {
  return (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const resolved = resolveRequest(root, url.pathname);
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (resolved.status !== 200) {
      response.writeHead(resolved.status, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      response.end(resolved.status === 400 ? 'bad request' : 'not found');
      return;
    }
    response.writeHead(200, {
      ...headers,
      'content-type': TYPES[path.extname(resolved.file)] ?? 'application/octet-stream',
    });
    createReadStream(resolved.file)
      .on('error', () => response.destroy())
      .pipe(response);
  };
}

/**
 * @param {string[]} argv
 * @returns {number} exit code (0 keeps the server running)
 */
export function main(argv) {
  const [dirArg, portArg] = argv;
  if (!dirArg || !portArg) {
    process.stderr.write('usage: node tools/testing/serve-static.mjs <dir> <port>\n');
    return 2;
  }
  const root = path.resolve(dirArg);
  if (!existsSync(path.join(root, 'index.html'))) {
    process.stderr.write(`FAIL serve-static: ${root}/index.html does not exist — build the application first\n`);
    return 2;
  }
  createServer(handler(root)).listen(Number(portArg), '127.0.0.1', () => {
    process.stdout.write(`serve-static · ${root} · http://127.0.0.1:${portArg}/\n`);
  });
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
