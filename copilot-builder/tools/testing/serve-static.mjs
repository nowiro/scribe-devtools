#!/usr/bin/env node
// serve-static.mjs — a tiny static server with SPA fallback for end-to-end tests over a BUILT
// application (`dist/apps/<app>/browser`), so the e2e job serves the artifact the build job produced
// instead of running a second build inside a dev server.
//
//   node tools/testing/serve-static.mjs <dir> <port>
//
// Zero dependencies: node:http and node:fs. Paths are resolved inside <dir> only (a request for
// `../package.json` gets the index, not the file). Anything without a file extension falls back to
// index.html — that is the Angular router's contract with the server.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

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
 * The file to serve for a request path: the asset when it exists inside `root`, index.html otherwise.
 * @param {string} root
 * @param {string} pathname
 * @returns {string}
 */
export function resolveFile(root, pathname) {
  const requested = path.normalize(decodeURIComponent(pathname)).replace(/^(?:\.\.[/\\])+/u, '');
  const file = path.join(root, requested);
  const servable =
    file.startsWith(root) && path.extname(file) !== '' && existsSync(file) && !statSync(file).isDirectory();
  return servable ? file : path.join(root, 'index.html');
}

/**
 * @param {string[]} argv
 * @returns {number} exit code (0 keeps the server running)
 */
function main(argv) {
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
  const port = Number(portArg);
  createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const file = resolveFile(root, url.pathname);
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`serve-static · ${root} · http://127.0.0.1:${port}/\n`);
  });
  return 0;
}

process.exitCode = main(process.argv.slice(2));
