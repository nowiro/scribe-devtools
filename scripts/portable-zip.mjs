#!/usr/bin/env node
// Builds the PORTABLE zip: unpack, run `node packages/browser-inspector/bin/browser-inspector.mjs …` with Node ≥ 22
// and the system Chrome/Edge — no npm, no build (there is no build step in this repository, so the
// zip is a curated copy of the tree, not a bundle).
//
// Inside: `packages/browser-inspector` (bin, src, templates, fixtures, package.json — not `test/`),
// `node_modules/playwright-core` (its only runtime dependency, itself dependency-free, hoisted by
// the workspace install), the marker file `packages/browser-inspector/PORTABLE`, and the shims
// `browser-inspector.cmd` / `browser-inspector` at the zip root. The marker matters at runtime: the keeper's
// identity hash
// (DESIGN.md §2.5) skips the `src/**` mtime stamp when it sees it, because an unpacked zip has
// arbitrary mtimes and would otherwise get a fresh keeper per unpack.
//
// The zip is TRACKED: every version lives in `download/scribe-devtools-portable-<version>.zip`
// (plus a `.sha256` sidecar), and the pre-commit hook rebuilds it before every commit. That only
// works because the build is DETERMINISTIC — fixed mtimes, sorted entries, no timestamp in the
// marker — so an unchanged tree yields byte-identical bytes and git sees nothing to add. Without
// that, every commit would append a 3 MB blob to history.
//
// The version comes from `packages/browser-inspector/package.json` and nowhere else; the root
// `package.json` must agree (the release procedure bumps both), otherwise the build fails loudly.
//
// Usage: npm run portable                                (zip + .sha256 land in download/)
//        node scripts/portable-zip.mjs [--out <dir>] [--stage <dir>]   (--stage: copy only, no zip — for tests)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGE = 'packages/browser-inspector';

export const PORTABLE_MARKER = 'PORTABLE';
export const DOWNLOAD_DIR = 'download';
/** One fixed timestamp for every entry — the zip must not change when nothing in it did. */
export const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');

/** What of the package goes into the zip — tests stay out, fixtures go in (the smoke needs them). */
const PACKAGE_ENTRIES = ['package.json', 'README.md', 'bin', 'src', 'templates', 'fixtures'];
const REQUIRED_ENTRIES = new Set(['package.json', 'bin', 'src']);

/**
 * The single source of the version: the package's package.json. The root package.json must say
 * the same — a release that bumps one and not the other would ship a zip named after the wrong one.
 * @param {string} root
 * @returns {string}
 */
export function readVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, PACKAGE, 'package.json'), 'utf8'));
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof pkg.version !== 'string' || pkg.version === '') throw new Error(`${PACKAGE}/package.json: brak "version"`);
  if (rootPkg.version !== pkg.version) {
    throw new Error(
      `wersja w package.json (${String(rootPkg.version)}) i ${PACKAGE}/package.json (${pkg.version}) się różnią — podbij obie`,
    );
  }
  return pkg.version;
}

/** @param {string} version */
export const zipName = (version) => `scribe-devtools-portable-${version}.zip`;

/**
 * Copy everything the unpacked zip needs into `staging` and write the marker + shims.
 * Pure file operations, no zip — the unpack test in WP8 asserts on this directory directly.
 * @param {string} root repository root (must have been `npm install`-ed)
 * @param {string} staging empty directory
 * @returns {{ version: string, playwrightVersion: string }}
 */
export function stagePortable(root, staging) {
  const version = readVersion(root);
  const pkg = JSON.parse(readFileSync(join(root, PACKAGE, 'package.json'), 'utf8'));
  const pwPath = join(root, 'node_modules', 'playwright-core');
  let playwrightVersion;
  try {
    playwrightVersion = JSON.parse(readFileSync(join(pwPath, 'package.json'), 'utf8')).version;
  } catch {
    throw new Error('brak node_modules/playwright-core — uruchom npm ci przed budowaniem zipa (także przed commitem)');
  }
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

  // No build timestamp in the marker: it would make every build a new blob (see the header).
  writeFileSync(
    join(staging, PACKAGE, PORTABLE_MARKER),
    `portable build of @scribe-devtools/browser-inspector ${version}\nplaywright-core ${playwrightVersion}\n`,
    'utf8',
  );
  // Shims: `browser-inspector …` from the zip root on both shells; `%~dp0` / `$(dirname "$0")` make them
  // cwd-independent.
  const winPath = `${PACKAGE.replaceAll('/', '\\')}\\bin\\browser-inspector.mjs`;
  writeFileSync(join(staging, 'browser-inspector.cmd'), `@echo off\r\nnode "%~dp0${winPath}" %*\r\n`, 'utf8');
  writeFileSync(
    join(staging, 'browser-inspector'),
    `#!/bin/sh\nexec node "$(dirname "$0")/${PACKAGE}/bin/browser-inspector.mjs" "$@"\n`,
    {
      encoding: 'utf8',
      mode: 0o755,
    },
  );
  writeFileSync(
    join(staging, 'README-PORTABLE.md'),
    [
      `# browser-inspector ${version} — portable`,
      '',
      'Wymagania: Node >= 22 i systemowy Chrome albo Edge. Bez `npm install`, bez builda.',
      '',
      '```',
      'browser-inspector help                      # Windows: browser-inspector.cmd, POSIX: ./browser-inspector',
      `node ${PACKAGE}/bin/browser-inspector.mjs help`,
      '```',
      '',
      `Zawartość: \`${PACKAGE}\` (bin, src, templates, fixtures), \`node_modules/playwright-core\` ${playwrightVersion},`,
      `marker \`${PACKAGE}/${PORTABLE_MARKER}\` (keeper pomija stempel mtime źródeł). Dokumentacja: README.md w repozytorium.`,
      '',
    ].join('\n'),
    'utf8',
  );
  return { version, playwrightVersion };
}

/**
 * Every file under `dir`, repository-relative with `/` separators, sorted — the entry order of the
 * zip. Directories are implied by their files; listing them would only add entries to keep stable.
 * @param {string} dir
 * @returns {string[]}
 */
export function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).replaceAll('\\', '/'));
    }
  };
  walk(dir);
  return out.sort();
}

// ── A zip writer of our own ───────────────────────────────────────────────────────────────────
// Neither Compress-Archive (backslashes in entry names — 157 of 160 entries of the first 0.1.0
// build unpacked on Linux as flat files), nor bsdtar/zip (they store atime/ctime in extended
// timestamp fields, so two builds of the same tree differ) give a byte-stable archive. The format
// needed here is small: local headers, deflate, a central directory, no zip64 (3 MB, ~160 files).

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} data @returns {number} */
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time of FIXED_MTIME, computed from UTC fields so the bytes do not follow the time zone. */
const DOS_DATE =
  ((FIXED_MTIME.getUTCFullYear() - 1980) << 9) | ((FIXED_MTIME.getUTCMonth() + 1) << 5) | FIXED_MTIME.getUTCDate();
const DOS_TIME =
  (FIXED_MTIME.getUTCHours() << 11) | (FIXED_MTIME.getUTCMinutes() << 5) | (FIXED_MTIME.getUTCSeconds() >> 1);

/** Unix mode in the external attributes — the `browser-inspector` shim must stay executable after unzip on POSIX. */
const unixMode = (/** @type {string} */ name) => (name === 'browser-inspector' ? 0o100755 : 0o100644);

/**
 * Deterministic zip of `staging`: entries in sorted order, forward slashes, one fixed timestamp,
 * deflate level 9, UTF-8 names, no directory entries, no extra fields.
 * @param {string} staging
 * @param {string} zipPath
 */
export function zipDirectory(staging, zipPath) {
  rmSync(zipPath, { force: true });
  /** @type {Buffer[]} */
  const local = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  for (const name of listFiles(staging)) {
    const data = readFileSync(join(staging, name));
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    header.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    header.writeUInt16LE(8, 8); // method: deflate
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, nameBytes, packed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0 — so the mode bits below count
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE((unixMode(name) << 16) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += header.length + nameBytes.length + packed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFileSync(zipPath, Buffer.concat([...local, centralBytes, end]));
}

/**
 * Entry names of a zip, read from its central directory — the portability check: a name with a
 * backslash unpacks as one flat file on Linux/macOS. Pure Node, so the test does not depend on
 * whichever `tar` the platform has (GNU tar cannot list a zip at all).
 * @param {string} zipPath
 * @returns {string[]}
 */
export function zipEntries(zipPath) {
  const buf = readFileSync(zipPath);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error(`${zipPath}: brak końca katalogu centralnego — to nie jest zip`);
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  /** @type {string[]} */
  const names = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error(`${zipPath}: uszkodzony wpis katalogu ${i}`);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    names.push(buf.subarray(pos + 46, pos + 46 + nameLength).toString('utf8'));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** @param {string} file @returns {string} hex sha256 */
export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * A released version's zip is frozen: once the tag `v<version>` exists, `download/<zip>` IS the
 * release and must not follow later commits made before the next version bump — otherwise the
 * file named 0.1.0 would quietly carry 0.1.1's code. The rule is pure so the test can feed tags.
 * @param {string} version
 * @param {string[]} tags existing git tags
 * @param {boolean} zipExists
 */
export const isFrozen = (version, tags, zipExists) => zipExists && tags.includes(`v${version}`);

/** @param {string} root @returns {string[]} `git tag -l` of the repository, [] outside git */
export function gitTags(root) {
  try {
    return execFileSync('git', ['tag', '-l'], { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/u)
      .filter((line) => line !== '');
  } catch {
    return [];
  }
}

/**
 * Build the zip for the current version into `outDir` (default `download/`) with its `.sha256`
 * sidecar in `sha256sum` format. Returns the paths and whether the bytes changed against what was
 * there before — the pre-commit hook prints that, a human reads it.
 * @param {string} root
 * @param {string} outDir
 * @returns {{ version: string, playwrightVersion: string, zipPath: string, shaPath: string, changed: boolean }}
 */
export function buildPortable(root, outDir) {
  const staging = mkdtempSync(join(tmpdir(), 'browser-inspector-portable-'));
  try {
    const { version, playwrightVersion } = stagePortable(root, staging);
    mkdirSync(outDir, { recursive: true });
    const zipPath = join(outDir, zipName(version));
    const shaPath = `${zipPath}.sha256`;
    let before;
    try {
      before = readFileSync(shaPath, 'utf8').split(/\s+/u)[0];
    } catch {
      before = undefined;
    }
    zipDirectory(staging, zipPath);
    const digest = sha256(zipPath);
    writeFileSync(shaPath, `${digest}  ${zipName(version)}\n`, 'utf8');
    return { version, playwrightVersion, zipPath, shaPath, changed: digest !== before };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** @param {string} flag */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const stageOnly = argValue('--stage');
  if (stageOnly) {
    const staging = resolve(stageOnly);
    mkdirSync(staging, { recursive: true });
    const { version, playwrightVersion } = stagePortable(REPO, staging);
    console.log(
      `[zip] staged ${version} (playwright-core ${playwrightVersion}) into ${staging} — no zip written (--stage)`,
    );
  } else {
    const outDir = resolve(argValue('--out') ?? join(REPO, DOWNLOAD_DIR));
    const version = readVersion(REPO);
    const frozen = isFrozen(version, gitTags(REPO), existsSync(join(outDir, zipName(version))));
    if (frozen && !process.argv.includes('--force')) {
      console.log(
        `[zip] wersja ${version} jest wydana (tag v${version}) — ${relative(REPO, join(outDir, zipName(version)))} zostaje bez zmian; nowy kod wymaga podbicia wersji (--force przebudowuje mimo to)`,
      );
    } else {
      const { zipPath, shaPath, changed } = buildPortable(REPO, outDir);
      console.log(
        `[zip] ${changed ? 'zbudowany' : 'bez zmian'}: ${relative(REPO, zipPath)} (+ ${relative(REPO, shaPath)}) — wersja ${version}`,
      );
      console.log(`[zip] po rozpakowaniu: node ${PACKAGE}/bin/browser-inspector.mjs help  (bez npm, bez builda)`);
    }
  }
}
