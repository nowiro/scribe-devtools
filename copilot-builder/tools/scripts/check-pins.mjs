// Offline, deterministic gate over tools/scripts/pins.config.mjs — one of the first steps of
// `npm run verify`, next to `biome format .`. It answers four questions a green test suite does not:
//
//   1. META  — does every dependency in every manifest have a row? A check that does not know
//              what it is not checking reads as coverage while covering nothing, so a package
//              added without a row is a failure, not a silence.
//   2. SHAPE — does the declared spec match the row's `policy`? `exact` means a bare version, which is what this
//              repository pins everywhere — two machines resolve the same lockfile the same way.
//   3. TAG   — does every file that embeds the version in another shape (a CI image tag) carry the pinned one?
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
import { FROZEN_ALWAYS, PINS } from './pins.config.mjs';
import { REPO, isMain } from './lib/repo.mjs';

/** @typedef {import('./pins.config.mjs').Pin} Pin */
/** @typedef {Map<string, {spec: string, where: string}[]>} Declarations */

/** Never walked: generated, installed, or not this repository's text. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.angular',
  '.cache',
  'coverage',
  'dist',
  'out-tsc',
  'tmp',
  '.scribe',
  '.scribe-devtools',
  '.mcp-artifacts',
  '.vitest',
  'playwright-report',
  'test-results',
]);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.mts', '.ts', '.json', '.yml', '.yaml', '.txt']);

/**
 * Manifests the package manager installs from: the root plus everything the workspace patterns
 * expand to.
 * Discovered, not listed — a hardcoded list makes the META check blind to a new package, which is
 * the one thing it exists to catch.
 * @param {string} root
 * @returns {string[]} repo-relative paths, POSIX separators
 */
/**
 * Workspace member patterns from the `workspaces` array of the root manifest (npm), or none.
 * @param {string} root
 * @returns {string[]} glob-ish patterns, exactly as declared
 */
export function workspacePatterns(root) {
  /** @type {{workspaces?: string[]}} */
  const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  return rootPkg.workspaces ?? [];
}

export function discoverManifests(root) {
  const found = ['package.json'];
  for (const pattern of workspacePatterns(root)) {
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
 * The spec at the `owner` coordinate, or null when the coordinate names nothing.
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
 * SHAPE + FLOOR — the owner's spec has the shape the policy says and sits above the supported floor.
 * @param {Pin} pin
 * @param {string} ownerSpec
 * @param {string} version
 * @returns {string[]}
 */
function shapeProblems(pin, ownerSpec, version) {
  const problems = [];
  if (pin.policy === 'exact' && ownerSpec !== version) {
    problems.push(
      `SHAPE ${pin.id}: policy is exact but ${pin.owner} says "${ownerSpec}" — a range resolves differently on two machines`,
    );
  }
  if (pin.policy === 'caret' && !ownerSpec.startsWith('^')) {
    problems.push(`SHAPE ${pin.id}: policy is caret but ${pin.owner} says "${ownerSpec}"`);
  }
  // A floor, not a range: it constrains the edit, never the resolution.
  if (pin.minSupported && compareVersions(version, pin.minSupported) < 0) {
    problems.push(
      `FLOOR ${pin.id}: ${pin.owner} pins ${version}, below the supported floor ${pin.minSupported} — ${pin.why.split('.')[0]}`,
    );
  }
  return problems;
}

/**
 * TAG — a file that embeds the version in another shape (`mcr.microsoft.com/playwright:v1.62.1-noble`)
 * must carry the pinned version and no other. `{version}` in the pattern stands for the version.
 * @param {Pin} pin
 * @param {string} version
 * @param {string} root
 * @returns {string[]}
 */
export function tagProblems(pin, version, root) {
  const problems = [];
  for (const tag of pin.tags ?? []) {
    const abs = path.join(root, tag.file);
    if (!existsSync(abs)) {
      problems.push(`TAG ${pin.id}: ${tag.file} is missing`);
      continue;
    }
    const escaped = tag.pattern
      .replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
      .replace(String.raw`\{version\}`, '(\\d+\\.\\d+\\.\\d+(?:[-+][\\w.-]+)?)');
    const found = [...readFileSync(abs, 'utf8').matchAll(new RegExp(escaped, 'gu'))].map((match) => match[1]);
    if (found.length === 0) {
      problems.push(`TAG ${pin.id}: ${tag.file} does not contain "${tag.pattern.replace('{version}', version)}"`);
      continue;
    }
    for (const seen of found) {
      if (seen !== version)
        problems.push(`TAG ${pin.id}: ${tag.file} carries ${seen}, pinned is ${version} — bump both in one commit`);
    }
  }
  return problems;
}

/**
 * LAG — prose in the row's scope quoting a version other than the pinned one.
 * @param {Pin} pin
 * @param {string} version
 * @param {string} root
 * @returns {string[]}
 */
function lagProblems(pin, version, root) {
  const prose = pin.prose ?? [];
  if (prose.length === 0) return [];
  const problems = [];
  const frozen = [...FROZEN_ALWAYS, ...(pin.frozen ?? [])];
  const inScope = (/** @type {string} */ rel) =>
    prose.some((entry) => (entry.endsWith('/') ? rel.startsWith(entry) : rel === entry));
  for (const rel of walkText(root, frozen)) {
    if (!inScope(rel)) continue;
    for (const hit of proseLag(readFileSync(path.join(root, rel), 'utf8'), pin.id, version)) {
      problems.push(
        `LAG ${pin.id}: ${rel}:${hit.line} quotes ${hit.found}, pinned is ${version} — read the line before changing it (append \`pins:ignore\` when the old version is the point)`,
      );
    }
  }
  return problems;
}

/**
 * Every rule for one row: META (owner declares it), then SHAPE/FLOOR, TAG and LAG.
 * @param {Pin} pin
 * @param {Declarations} byId
 * @param {string} root
 * @returns {string[]}
 */
function checkPin(pin, byId, root) {
  if (!byId.has(pin.id)) {
    return [`META ${pin.id}: has a row but no manifest declares it — drop the row or restore the dependency`];
  }
  const ownerSpec = specAt(byId, pin.id, pin.owner);
  if (ownerSpec === null) {
    const seen = byId
      .get(pin.id)
      ?.map((d) => d.where)
      .join(', ');
    return [`META ${pin.id}: owner "${pin.owner}" declares nothing (found in ${seen})`];
  }
  const version = bareVersion(ownerSpec);
  if (version === null) return [`SHAPE ${pin.id}: owner spec "${ownerSpec}" carries no version`];
  return [
    ...shapeProblems(pin, ownerSpec, version),
    ...tagProblems(pin, version, root),
    ...lagProblems(pin, version, root),
  ];
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

  // META, both directions. An unrowed dependency is the silent case; a row for a package nobody
  // depends on is stale config that would go on reporting `ok` about nothing.
  for (const [id, declarations] of byId) {
    if (rows.has(id)) continue;
    problems.push(
      `META ${id}: declared in ${declarations.map((d) => d.where).join(', ')} but has no row in tools/scripts/pins.config.mjs — add one (id, owner, policy, staleDays, why) so a bump is reviewable`,
    );
  }
  for (const pin of PINS) problems.push(...checkPin(pin, byId, root));

  return {
    ok: problems.length === 0,
    problems,
    message:
      problems.length === 0
        ? `${byId.size} dependencies in ${manifests.length} manifests, ${PINS.length} rows, every one owned · image tags in sync · no prose quoting a stale version`
        : `${problems.length} problem(s) across ${byId.size} dependencies in ${manifests.length} manifests`,
  };
}

if (isMain(import.meta.url)) {
  const { ok, message, problems } = checkPins(REPO);
  const stream = ok ? process.stdout : process.stderr;
  stream.write(`${ok ? 'ok' : 'FAIL'} pins: ${message}\n`);
  for (const problem of problems) stream.write(`  ${problem}\n`);
  process.exitCode = ok ? 0 : 1;
}
