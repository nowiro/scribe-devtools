import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handler, resolveRequest } from './serve-static.mjs';

/** @type {string} */
let root;
/** @type {string} */
let outside;

beforeAll(() => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'cb-serve-static-'));
  root = path.join(base, 'browser');
  outside = path.join(base, 'secret.txt');
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>app</h1>', 'utf8');
  writeFileSync(path.join(root, 'main.js'), 'console.log(1);', 'utf8');
  writeFileSync(path.join(root, 'assets', 'logo.svg'), '<svg/>', 'utf8');
  writeFileSync(outside, 'not for the browser', 'utf8');
  symlinkSync(outside, path.join(root, 'leak.txt'));
});
afterAll(() => {
  rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('resolveRequest', () => {
  it('serves existing assets and falls back to index.html for routes', () => {
    expect(resolveRequest(root, '/main.js')).toEqual({ status: 200, file: path.join(root, 'main.js') });
    expect(resolveRequest(root, '/assets/logo.svg')).toEqual({
      status: 200,
      file: path.join(root, 'assets', 'logo.svg'),
    });
    expect(resolveRequest(root, '/')).toEqual({ status: 200, file: path.join(root, 'index.html') });
    expect(resolveRequest(root, '/orders/42/details')).toEqual({ status: 200, file: path.join(root, 'index.html') });
  });

  it('answers 404 for a missing asset instead of index.html with the wrong type', () => {
    expect(resolveRequest(root, '/missing.js')).toEqual({ status: 404 });
    expect(resolveRequest(root, '/assets/')).toEqual({ status: 200, file: path.join(root, 'index.html') });
    expect(resolveRequest(root, '/assets.v2/x.js')).toEqual({ status: 404 });
  });

  it('never leaves the directory — traversal, encoded traversal, symlinks', () => {
    expect(resolveRequest(root, '/../secret.txt')).toEqual({ status: 404 });
    expect(resolveRequest(root, '/..%2Fsecret.txt')).toEqual({ status: 404 });
    expect(resolveRequest(root, '/%2e%2e/%2e%2e/etc/passwd')).toEqual({
      status: 200,
      file: path.join(root, 'index.html'),
    });
    expect(resolveRequest(root, '/leak.txt')).toEqual({ status: 404 });
  });

  it('answers 400 for a URL it cannot decode', () => {
    expect(resolveRequest(root, '/%')).toEqual({ status: 400 });
    expect(resolveRequest(root, '/%E0%A4%A')).toEqual({ status: 400 });
    expect(resolveRequest(root, '/index.html%00.txt')).toEqual({ status: 400 });
  });
});

describe('handler over HTTP', () => {
  /** @type {import('node:http').Server} */
  let server;
  /** @type {string} */
  let origin;
  beforeAll(async () => {
    server = createServer(handler(root));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  });

  it('survives a malformed URL and keeps serving', async () => {
    const bad = await fetch(`${origin}/%`);
    expect(bad.status).toBe(400);
    const ok = await fetch(`${origin}/`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/html');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await ok.text()).toContain('<h1>app</h1>');
  });

  it('types assets and refuses what is not there', async () => {
    const js = await fetch(`${origin}/main.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect((await fetch(`${origin}/missing.js`)).status).toBe(404);
    expect((await fetch(`${origin}/leak.txt`)).status).toBe(404);
  });
});
