// Offline, deterministic gate over scripts/pins.config.mjs — the first step of `npm run verify`,
// next to `biome format .`. It answers four questions a green test suite does not:
//
//   1. META  — does every dependency in every manifest have a row? A check that does not know
//              what it is not checking reads as coverage while covering nothing, so a package
//              added without a row is a failure, not a silence.
//   2. SHAPE — does the declared spec match the row's `policy`? `exact` means a bare version:
//              `stagePortable` in scripts/portable-zip.mjs compares the manifest string to the
//              installed version with `!==`, so a range there throws on every portable build.
//   3. SYNC  — do the mirrors and the command lines repeat the owner character for character?
//   4. LAG   — does any prose still quote a different version of the package than the pin?
//
// What it deliberately does NOT do: touch the network (that is check-upstream.mjs, WARN, run at
// release), and rewrite prose. Half of those lines are claims about behaviour — "`response.fromCache()`
// does not exist in playwright-core 1.62.1" — and swapping the number would turn a true sentence
// into a false one with a fresh number on it. The gate points; a human reads.
//
// Escape hatch: a line carrying `pins:ignore` is skipped by the LAG check, for prose that quotes
// an old version on purpose.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINS, FROZEN_ALWAYS } from './pins.config.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Never walked: generated, installed, or not this repository's text. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'coverage',
  'download',
  'out',
  '.scribe-devtools',
  '.playwright-mcp',
  '.vitest',
  '.ws',
]);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.mts', '.ts', '.json', '.yml', '.yaml', '.txt']);

/**
 * Manifests npm would install from: the root plus everything its `workspaces` patterns expand to.
 * Discovered, not listed — a hardcoded list makes the META check blind to a new package, which is
 * the one thing it exists to catch.
 * @param {string} root
 * @returns {string[]} repo-relative paths, POSIX separators
 */
export function discoverManifests(root) {
  const found = ['package.json'];
  /** @type {{workspaces?: string[]}} */
  const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const pattern of rootPkg.workspaces ?? []) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (existsSync(path.join(root, pattern, 'package.json'))) found.push(`${pattern}/package.json`);
      continue;
    }
    const base = pattern.slice(0, star).replace(/\/$/u, '');
    const dir = path.join(root, base);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(path.join(dir, entry.name, 'package.json'))) found.push(`${base}/${entry.name}/package.json`);
    }
  }
  return found.sort();
}

/**
 * `{ 'pkg': [{ spec, where }] }` for every dependency section of every manifest.
 * @param {string} root
 * @param {string[]} manifests
 * @returns {Map<string, {spec: string, where: string}[]>}
 */
export function readDeclarations(root, manifests) {
  /** @type {Map<string, {spec: string, where: string}[]>} */
  const byId = new Map();
  for (const manifest of manifests) {
    const pkg = JSON.parse(readFileSync(path.join(root, manifest), 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [id, spec] of Object.entries(pkg[section] ?? {})) {
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id)?.push({ spec: String(spec), where: `${manifest}#${section}` });
      }
    }
  }
  return byId;
}

/**
 * The spec at an `owner`/`mirrors` coordinate, or null when the coordinate names nothing.
 * @param {Map<string, {spec: string, where: string}[]>} byId
 * @param {string} id
 * @param {string} coordinate
 * @returns {string | null}
 */
function specAt(byId, id, coordinate) {
  return byId.get(id)?.find((d) => d.where === coordinate)?.spec ?? null;
}

/**
 * Compares two dotted release numbers left to right; a pre-release suffix orders below the release
 * it belongs to. Enough for a floor check, and worth twenty lines against a dependency.
 * @param {string} a
 * @param {string} b
 * @returns {number} -1, 0 or 1
 */
export function compareVersions(a, b) {
  const split = (/** @type {string} */ v) => {
    const [core, pre = ''] = v.split('-');
    return { nums: core.split('.').map(Number), pre };
  };
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < Math.max(left.nums.length, right.nums.length); i++) {
    const delta = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === '') return 1;
  if (right.pre === '') return -1;
  return left.pre < right.pre ? -1 : 1;
}

/**
 * The bare version inside a spec (`^4.0.0` → `4.0.0`), or null when there is no version at all.
 * @param {string} spec
 * @returns {string | null}
 */
export function bareVersion(spec) {
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u.exec(spec);
  return match ? match[1] : null;
}

/**
 * Every text file under `root` the LAG check may read.
 * @param {string} root
 * @param {string[]} frozen repo-relative file paths, or directory prefixes ending in `/`
 * @returns {string[]}
 */
export function walkText(root, frozen) {
  /** @type {string[]} */
  const out = [];
  const isFrozen = (/** @type {string} */ rel) => frozen.some((f) => (f.endsWith('/') ? rel.startsWith(f) : rel === f));
  const walk = (/** @type {string} */ dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || isFrozen(`${rel}/`)) continue;
        walk(abs);
        continue;
      }
      if (SKIP_FILES.has(entry.name) || isFrozen(rel)) continue;
      if (!TEXT_EXT.has(path.extname(entry.name))) continue;
      if (statSync(abs).size > 2_000_000) continue;
      out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Lines quoting a version of `id` other than `pinned`. A number counts only when it follows the
 * package name on the same line (`playwright-core 1.62.1`, `"playwright-core": "1.62.1"`,
 * `@playwright/mcp@0.0.80`), so an unrelated version on a busy line is not a finding.
 * @param {string} text
 * @param {string} id
 * @param {string} pinned
 * @returns {{line: number, found: string}[]}
 */
export function proseLag(text, id, pinned) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
  const pattern = new RegExp(`${escaped}["'\`]?[@:\\s]+["'\`v]*(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`, 'giu');
  /** @type {{line: number, found: string}[]} */
  const hits = [];
  text.split('\n').forEach((line, index) => {
    if (line.includes('pins:ignore')) return;
    for (const match of line.matchAll(pattern))
      if (match[1] !== pinned) hits.push({ line: index + 1, found: match[1] });
  });
  return hits;
}

/**
 * @param {string} root
 * @returns {{ ok: boolean, message: string, problems: string[] }}
 */
export function checkPins(root) {
  /** @type {string[]} */
  const problems = [];
  const manifests = discoverManifests(root);
  const byId = readDeclarations(root, manifests);
  const rows = new Map(PINS.map((pin) => [pin.id, pin]));

  // 1. META, both directions. An unrowed dependency is the silent case; a row for a package nobody
  // depends on is stale config that would go on reporting `ok` about nothing.
  for (const [id, declarations] of byId) {
    if (rows.has(id)) continue;
    problems.push(
      `META ${id}: declared in ${declarations.map((d) => d.where).join(', ')} but has no row in scripts/pins.config.mjs — add one (id, owner, policy, staleDays, why) so a bump is reviewable`,
    );
  }

  for (const pin of PINS) {
    if (!byId.has(pin.id)) {
      problems.push(`META ${pin.id}: has a row but no manifest declares it — drop the row or restore the dependency`);
      continue;
    }
    const ownerSpec = specAt(byId, pin.id, pin.owner);
    if (ownerSpec === null) {
      const seen = byId
        .get(pin.id)
        ?.map((d) => d.where)
        .join(', ');
      problems.push(`META ${pin.id}: owner "${pin.owner}" declares nothing (found in ${seen})`);
      continue;
    }

    // 2. SHAPE
    const version = bareVersion(ownerSpec);
    if (version === null) {
      problems.push(`SHAPE ${pin.id}: owner spec "${ownerSpec}" carries no version`);
      continue;
    }
    if (pin.policy === 'exact' && ownerSpec !== version) {
      problems.push(
        `SHAPE ${pin.id}: policy is exact but ${pin.owner} says "${ownerSpec}" — a range breaks stagePortable in scripts/portable-zip.mjs and resolves differently on two machines`,
      );
    }
    if (pin.policy === 'caret' && !ownerSpec.startsWith('^')) {
      problems.push(`SHAPE ${pin.id}: policy is caret but ${pin.owner} says "${ownerSpec}"`);
    }

    // 2b. FLOOR — a floor, not a range: it constrains the edit, never the resolution.
    if (pin.minSupported && compareVersions(version, pin.minSupported) < 0) {
      problems.push(
        `FLOOR ${pin.id}: ${pin.owner} pins ${version}, below the supported floor ${pin.minSupported} — ${pin.why.split('.')[0]}`,
      );
    }

    // 3. SYNC — mirrors, then command lines.
    for (const mirror of pin.mirrors ?? []) {
      const mirrorSpec = specAt(byId, pin.id, mirror);
      if (mirrorSpec === null) problems.push(`SYNC ${pin.id}: mirror "${mirror}" declares nothing`);
      else if (mirrorSpec !== ownerSpec)
        problems.push(`SYNC ${pin.id}: ${mirror} says "${mirrorSpec}", owner ${pin.owner} says "${ownerSpec}"`);
    }
    for (const file of pin.argv ?? []) {
      const abs = path.join(root, file);
      if (!existsSync(abs)) {
        problems.push(`SYNC ${pin.id}: argv file ${file} is missing`);
        continue;
      }
      if (!readFileSync(abs, 'utf8').includes(`${pin.id}@${version}`)) {
        problems.push(
          `SYNC ${pin.id}: ${file} does not spawn ${pin.id}@${version} — the server measured is not the server pinned`,
        );
      }
    }

    // 4. LAG
    if ((pin.prose ?? []).length === 0) continue;
    const frozen = [...FROZEN_ALWAYS, ...(pin.frozen ?? [])];
    const inScope = (/** @type {string} */ rel) =>
      (pin.prose ?? []).some((entry) => (entry.endsWith('/') ? rel.startsWith(entry) : rel === entry));
    for (const rel of walkText(root, frozen)) {
      if (!inScope(rel)) continue;
      for (const hit of proseLag(readFileSync(path.join(root, rel), 'utf8'), pin.id, version)) {
        problems.push(
          `LAG ${pin.id}: ${rel}:${hit.line} quotes ${hit.found}, pinned is ${version} — read the line before changing it (append \`pins:ignore\` when the old version is the point)`,
        );
      }
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    message:
      problems.length === 0
        ? `${byId.size} dependencies in ${manifests.length} manifests, ${PINS.length} rows, every one owned · mirrors and command lines in sync · no prose quoting a stale version`
        : `${problems.length} problem(s) across ${byId.size} dependencies in ${manifests.length} manifests`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { ok, message, problems } = checkPins(REPO);
  const stream = ok ? process.stdout : process.stderr;
  stream.write(`${ok ? 'ok' : 'FAIL'} pins: ${message}\n`);
  for (const problem of problems) stream.write(`  ${problem}\n`);
  process.exitCode = ok ? 0 : 1;
}
