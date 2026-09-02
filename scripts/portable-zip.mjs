#!/usr/bin/env node
// Builds the PORTABLE zip: unpack, run `node packages/browser-inspector/bin/bi.mjs …` with Node ≥ 22
// and the system Chrome/Edge — no npm, no build (there is no build step in this repository, so the
// zip is a curated copy of the tree, not a bundle).
//
// Inside: `packages/browser-inspector` (bin, src, templates, fixtures, package.json — not `test/`),
// `node_modules/playwright-core` (its only runtime dependency, itself dependency-free, hoisted by
// the workspace install), the marker file `packages/browser-inspector/PORTABLE`, and the shims
// `bi.cmd` / `bi` at the zip root. The marker matters at runtime: the keeper's identity hash
// (DESIGN.md §2.5) skips the `src/**` mtime stamp when it sees it, because an unpacked zip has
// arbitrary mtimes and would otherwise get a fresh keeper per unpack.
//
// Usage: npm run portable            (zip lands in the repository root)
//        node scripts/portable-zip.mjs [--out <dir>] [--stage <dir>]   (--stage: copy only, no zip — for tests)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGE = 'packages/browser-inspector';

export const PORTABLE_MARKER = 'PORTABLE';

/** What of the package goes into the zip — tests stay out, fixtures go in (the smoke needs them). */
const PACKAGE_ENTRIES = ['package.json', 'README.md', 'bin', 'src', 'templates', 'fixtures'];
const REQUIRED_ENTRIES = new Set(['package.json', 'bin', 'src']);

/**
 * Copy everything the unpacked zip needs into `staging` and write the marker + shims.
 * Pure file operations, no zip — the unpack test in WP8 asserts on this directory directly.
 * @param {string} root repository root (must have been `npm install`-ed)
 * @param {string} staging empty directory
 * @returns {{ version: string, playwrightVersion: string }}
 */
export function stagePortable(root, staging) {
  const pkg = JSON.parse(readFileSync(join(root, PACKAGE, 'package.json'), 'utf8'));
  const pwPath = join(root, 'node_modules', 'playwright-core');
  const playwrightVersion = JSON.parse(readFileSync(join(pwPath, 'package.json'), 'utf8')).version;
  const pinned = pkg.dependencies?.['playwright-core'];
  if (pinned !== playwrightVersion) {
    throw new Error(
      `playwright-core in node_modules is ${playwrightVersion}, package.json pins ${pinned} — run npm ci first`,
    );
  }

  /** @param {string} src */
  const filter = (src) => {
    const name = src.split(/[\\/]/u).pop() ?? '';
    return name !== 'node_modules' && name !== '.gitkeep' && !name.endsWith('.log');
  };
  mkdirSync(join(staging, PACKAGE), { recursive: true });
  for (const entry of PACKAGE_ENTRIES) {
    try {
      cpSync(join(root, PACKAGE, entry), join(staging, PACKAGE, entry), { recursive: true, filter });
    } catch (error) {
      // README.md, templates or fixtures may not exist yet in an early tree; the runtime must.
      if (/** @type {any} */ (error)?.code !== 'ENOENT' || REQUIRED_ENTRIES.has(entry)) throw error;
    }
  }
  // Only playwright-core: it has no dependencies of its own, so the whole runtime is one directory.
  cpSync(pwPath, join(staging, 'node_modules', 'playwright-core'), { recursive: true, filter });

  writeFileSync(
    join(staging, PACKAGE, PORTABLE_MARKER),
    `portable build of @scribe-devtools/browser-inspector ${pkg.version}\nplaywright-core ${playwrightVersion}\nbuilt ${new Date().toISOString()}\n`,
    'utf8',
  );
  // Shims: `bi …` from the zip root on both shells; `%~dp0` / `$(dirname "$0")` make them cwd-independent.
  const winPath = `${PACKAGE.replaceAll('/', '\\')}\\bin\\bi.mjs`;
  writeFileSync(join(staging, 'bi.cmd'), `@echo off\r\nnode "%~dp0${winPath}" %*\r\n`, 'utf8');
  writeFileSync(join(staging, 'bi'), `#!/bin/sh\nexec node "$(dirname "$0")/${PACKAGE}/bin/bi.mjs" "$@"\n`, {
    encoding: 'utf8',
    mode: 0o755,
  });
  writeFileSync(
    join(staging, 'README-PORTABLE.md'),
    [
      `# browser-inspector ${pkg.version} — portable`,
      '',
      'Wymagania: Node >= 22 i systemowy Chrome albo Edge. Bez `npm install`, bez builda.',
      '',
      '```',
      'bi help                      # Windows: bi.cmd, POSIX: ./bi',
      `node ${PACKAGE}/bin/bi.mjs help`,
      '```',
      '',
      `Zawartość: \`${PACKAGE}\` (bin, src, templates, fixtures), \`node_modules/playwright-core\` ${playwrightVersion},`,
      `marker \`${PACKAGE}/${PORTABLE_MARKER}\` (keeper pomija stempel mtime źródeł). Dokumentacja: README.md w repozytorium.`,
      '',
    ].join('\n'),
    'utf8',
  );
  return { version: pkg.version, playwrightVersion };
}

/**
 * @param {string} staging
 * @param {string} zipPath
 */
export function zipDirectory(staging, zipPath) {
  rmSync(zipPath, { force: true });
  // Windows: bsdtar from System32, never Compress-Archive. The PowerShell cmdlet writes entry
  // names with backslashes, and unzip on Linux/macOS then creates files literally named
  // "packages\browser-inspector\bin\bi.mjs" (157 of 160 entries in the first 0.1.0 build).
  // bsdtar picks the zip format from the extension (`-a`) and stores forward slashes, like `zip -r`.
  const [tool, args] =
    process.platform === 'win32'
      ? [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zipPath, '.']]
      : ['zip', ['-qr', zipPath, '.']];
  execFileSync(tool, args, { cwd: staging, stdio: 'inherit' });
}

/**
 * Entry names of a zip, as the archive stores them — the portability check: a name with a
 * backslash unpacks as one flat file on Linux/macOS.
 * @param {string} zipPath
 */
export function zipEntries(zipPath) {
  const tool =
    process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return execFileSync(tool, ['-tf', zipPath], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .filter((line) => line !== '');
}

/** @param {string} flag */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const stageOnly = argValue('--stage');
  const staging = stageOnly ? resolve(stageOnly) : mkdtempSync(join(tmpdir(), 'bi-portable-'));
  if (stageOnly) mkdirSync(staging, { recursive: true });
  try {
    console.log(`[zip] staging: ${staging}`);
    const { version, playwrightVersion } = stagePortable(REPO, staging);
    if (stageOnly) {
      console.log(`[zip] staged ${version} (playwright-core ${playwrightVersion}) — no zip written (--stage)`);
    } else {
      const outDir = resolve(argValue('--out') ?? REPO);
      const zipPath = join(outDir, `scribe-devtools-portable-${version}.zip`);
      zipDirectory(staging, zipPath);
      console.log(`[zip] gotowe -> ${zipPath}`);
      console.log(`[zip] po rozpakowaniu: node ${PACKAGE}/bin/bi.mjs help  (bez npm, bez builda)`);
    }
  } finally {
    if (!stageOnly) rmSync(staging, { recursive: true, force: true });
  }
}
