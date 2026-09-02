// generate.mjs — (re)generates the snapshot fixtures from the REAL app-factory builds with the real
// playwright-core, so the tests in test/snapshot.test.mjs run against what the browser renders,
// not against a hand-written imitation.
//
//   node packages/browser-inspector/fixtures/snapshots/generate.mjs [--apps D:/github/app-factory/dist/apps]
//
// Ports 4531 (bookstore), 4532 (business-wizard) and 4533 (this package's fixtures) — the range of
// WP3. The static server sends `.js` as `text/javascript`, otherwise Angular's module scripts do
// not execute and the snapshot is an empty shell. Written files (all in this directory):
//
//   bookstore.ai.yml     page.ariaSnapshot({ mode: 'ai' })                 — 952 lines, 136 interactive
//   bookstore.boxes.yml  page.ariaSnapshot({ mode: 'ai', boxes: true })    — same refs, plus [box=…]
//   walk.json            page.evaluate(walkInteractive)                    — DOM side of the box-join
//   wizard.ai.yml        business-wizard, taken on the SAME tab after the bookstore → refs are `f1eN`
//                        (frame sequence 1: the second document of the tab), the shape a session sees
//                        after any navigation
//
// The script also prints a few facts it verified on the way (typed value rendering, checked state,
// iframe refs, `aria-ref=f1eN` resolution) — they are quoted in docs/handoff/WP3.md.
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { boxJoin, locatorForElement, walkInteractive } from '../../src/snapshot.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argApps = process.argv.indexOf('--apps');
const apps = path.resolve(argApps !== -1 ? process.argv[argApps + 1] : 'D:/github/app-factory/dist/apps');

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
]);

/** Static server with SPA fallback, a copy of app-factory's `serveStatic` (tools/scripts/smoke-browser.mjs). */
function serveStatic(rootDir, port) {
  const root = path.resolve(rootDir);
  const server = createServer((req, res) => {
    const clean = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.join(root, clean);
    if (!path.extname(file)) file = path.join(root, 'index.html');
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME.get(path.extname(file)) ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  server.listen(port);
  return server;
}

async function launch() {
  const args = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, args });
  } catch {
    return await chromium.launch({ channel: 'msedge', headless: true, args });
  }
}

const servers = [
  serveStatic(path.join(apps, 'bookstore/browser'), 4531),
  serveStatic(path.join(apps, 'business-wizard/browser'), 4532),
  serveStatic(path.join(here, '..'), 4533),
];
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // Bookstore: the 952-line tree. `networkidle` + a short pause because this is a fixture, not a
  // budgeted run — the tree must be complete and static before the two snapshots and the walk.
  await page.goto('http://localhost:4531/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const ai = await page.ariaSnapshot({ mode: 'ai' });
  const boxes = await page.ariaSnapshot({ mode: 'ai', boxes: true });
  const walk = await page.evaluate(walkInteractive);
  const refs = (s) => [...s.matchAll(/\[ref=([^\]]+)\]/g)].map((m) => m[1]).join(' ');
  if (refs(ai) !== refs(boxes)) throw new Error('refs differ between ai and ai+boxes snapshots');
  writeFileSync(path.join(here, 'bookstore.ai.yml'), ai);
  writeFileSync(path.join(here, 'bookstore.boxes.yml'), boxes);
  writeFileSync(path.join(here, 'walk.json'), `${JSON.stringify(walk, null, 2)}\n`);
  const join = boxJoin(boxes, walk);
  console.log(
    `bookstore: ${ai.split('\n').length} lines, ${Buffer.byteLength(ai)} bytes, walk ${walk.length}, ` +
      `box-join ${join.matched}/${join.interactive}`,
  );
  // Matched = an element was found for the line; a durable selector is a separate question (the 33
  // nameless cover links share their href with the title link and have no id/testid — expected).
  const noSelector = join.entries.filter((e) => !e.selector && e.role !== 'heading' && e.role !== 'img');
  if (noSelector.length) {
    const sample = noSelector.slice(0, 3).map((e) => `${e.ref} ${e.role} "${e.name}"`);
    console.log(`without durable selector: ${noSelector.length} (${sample.join(', ')}${noSelector.length > 3 ? ', …' : ''})`);
  }

  // Facts about rendering, checked on the live tree (quoted in the handoff).
  await page.fill('aria-ref=e39', 'Harry');
  const typed = (await page.ariaSnapshot({ mode: 'ai' })).split('\n').find((l) => l.includes('[ref=e39]'));
  console.log('typed value line:', typed?.trim());
  await page.fill('aria-ref=e39', '');

  // Wizard on the same tab: second document → frame sequence 1 → refs `f1eN`.
  await page.goto('http://localhost:4532/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const wizard = await page.ariaSnapshot({ mode: 'ai' });
  writeFileSync(path.join(here, 'wizard.ai.yml'), wizard);
  console.log(`wizard: ${wizard.split('\n').length} lines, first ref ${/\[ref=([^\]]+)\]/.exec(wizard)?.[1]}`);
  const f1 = /\[ref=(f1e\d+)\]/.exec(wizard.split('\n').find((l) => l.includes('- button')) ?? '')?.[1];
  if (f1) console.log(`aria-ref=${f1} count on same tab:`, await page.locator(`aria-ref=${f1}`).count());

  // iframe.html: frame refs inside a full snapshot, resolved from the parent page.
  const fresh = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await fresh.goto('http://localhost:4533/iframe.html', { waitUntil: 'load' });
  await fresh.waitForSelector('iframe');
  await fresh.waitForTimeout(200);
  const frameSnap = await fresh.ariaSnapshot({ mode: 'ai' });
  console.log('iframe snapshot:\n' + frameSnap);
  const childRef = /\[ref=(f\d+e\d+)\]/.exec(frameSnap.split('\n').find((l) => /button "Przycisk w ramce"/.test(l)) ?? '')?.[1];
  if (childRef) {
    await fresh.click(`aria-ref=${childRef}`);
    console.log(`clicked aria-ref=${childRef} from the parent page → child output:`, await fresh.frames()[1].locator('#child-out').innerText());
  }

  // relabel.html: checked state rendering and the dead ref after a label change.
  await fresh.goto('http://localhost:4533/relabel.html', { waitUntil: 'load' });
  await fresh.check('[name=consent]');
  const relabel = await fresh.ariaSnapshot({ mode: 'ai', boxes: true });
  console.log('relabel snapshot:\n' + relabel);
  const relabelWalk = await fresh.evaluate(walkInteractive);
  const relabelJoin = boxJoin(relabel, relabelWalk);
  console.log('relabel sidecar:', JSON.stringify(relabelJoin.entries));
  // The export path (DESIGN.md §4.5) computes the selector in the page from the live element; it
  // must agree with what the box-join derived from the walk for every interactive line.
  for (const entry of relabelJoin.entries.filter((e) => e.selector)) {
    const live = await fresh.locator(`aria-ref=${entry.ref}`).evaluate(locatorForElement);
    if (live !== entry.selector) throw new Error(`${entry.ref}: in-page ${live} ≠ sidecar ${entry.selector}`);
  }
  console.log(`locatorForElement agrees with the sidecar on ${relabelJoin.entries.filter((e) => e.selector).length} refs`);
  const addRef = /\[ref=(f?\d*e\d+)\]/.exec(relabel.split('\n').find((l) => /button "Dodaj do koszyka"/.test(l)) ?? '')?.[1];
  await fresh.click(`aria-ref=${addRef}`);
  const t0 = Date.now();
  const after = await fresh.locator(`aria-ref=${addRef}`).count();
  await fresh.ariaSnapshot({ mode: 'ai' });
  const again = await fresh.locator(`aria-ref=${addRef}`).count();
  console.log(`old ref ${addRef} after relabel: count ${after}, after full snapshot ${again}, ${Date.now() - t0} ms`);
} finally {
  await browser.close();
  for (const s of servers) s.close();
}
