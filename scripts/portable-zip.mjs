#!/usr/bin/env node
// Builds the PORTABLE zip: unpack, run either tool with Node ≥ 22 (browser-inspector also wants the
// system Chrome/Edge) — no npm, no build (there is no build step in this repository, so the zip is
// a curated copy of the tree, not a bundle).
//
// Two packages ride in ONE zip, under ONE version — the repo's version, not a per-package one:
//
//   packages/browser-inspector      bin, src, templates, fixtures, package.json — not `test/`
//   packages/nx-angular-inspector   bin, src, package.json — no templates/fixtures, nothing to ship
//
// The two are coupled deliberately, not by oversight: a single zip is what "one portable release of
// this repository" means, and it is the shape the existing release procedure (§ Wydanie in
// docs/MAINTAINING.md, kept on the main branch) already assumes — one tag, one asset, one CHANGELOG
// section. The cost of the coupling is real and worth naming: a browser-inspector-only bugfix release
// still bumps nx-angular-inspector's version even when nothing in it changed. `readVersion` enforces
// the coupling by checking EVERY package in `PACKAGES` against the root version, not just the first
// one — a bump that only touches one manifest fails loudly here, the same way a browser-inspector-only
// bump already failed before nx-angular-inspector existed.
//
// Inside: each package's files (below), `node_modules/playwright-core` (browser-inspector's only
// runtime dependency — nx-angular-inspector has none, so nothing else is copied for it), a
// `PORTABLE` marker in EACH package's own directory, and a pair of shims per package
// (`<bin>.cmd` / `<bin>`) at the zip root. The marker matters for browser-inspector specifically:
// its keeper's identity hash (DESIGN.md §2.5) skips the `src/**` mtime stamp when it sees the
// marker, because an unpacked zip has arbitrary mtimes and would otherwise get a fresh keeper per
// unpack. nx-angular-inspector has no keeper and nothing reads its marker today; it is written for
// the same reason a build number is stamped on a part with no serial number reader yet — it says
// what this directory is, and it costs one file.
//
// Where the zip is TRACKED (the release branch), every version lives in
// `download/scribe-devtools-portable-<version>.zip` (plus a `.sha256` sidecar) and the pre-commit
// hook rebuilds it before every commit. That only works because the build is DETERMINISTIC — fixed
// mtimes, sorted entries, no timestamp in the marker — so an unchanged tree yields byte-identical
// bytes and git sees nothing to add. Without that, every commit would append a 3 MB blob to
// history. Where `download/` is ignored instead, the zip is an on-demand scratch build and the
// "frozen after the tag" rule below does not apply to it (`isTracked`).
//
// Usage: pnpm run portable                                (zip + .sha256 land in download/)
//        node scripts/portable-zip.mjs [--out <dir>] [--stage <dir>]   (--stage: copy only, no zip — for tests)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const PORTABLE_MARKER = 'PORTABLE';
export const DOWNLOAD_DIR = 'download';
/** One fixed timestamp for every entry — the zip must not change when nothing in it did. */
export const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');

/**
 * @typedef {object} PackageSpec
 * @property {string} dir repo-relative
 * @property {string} bin shim name — `<bin>.cmd` and `<bin>` at the zip root
 * @property {string} entry `bin`-relative entry script, e.g. `bin/browser-inspector.mjs`
 * @property {string[]} entries what of the package goes into the zip — tests stay out
 * @property {Set<string>} required entries whose absence is a broken tree, not an early checkout
 */

/**
 * The package directories that actually went into the zip, for README-PORTABLE.md: `fixtures/`
 * ships where it is checked out and is absent on a branch without it — a fixed list lied there.
 * @param {string} root
 * @param {PackageSpec} pkg
 */
const shipped = (root, pkg) =>
  pkg.entries
    .filter((entry) => entry !== 'package.json' && entry !== 'README.md' && existsSync(join(root, pkg.dir, entry)))
    .join(', ');

/** @type {readonly PackageSpec[]} */
export const PACKAGES = Object.freeze([
  {
    dir: 'packages/browser-inspector',
    bin: 'browser-inspector',
    entry: 'bin/browser-inspector.mjs',
    entries: ['package.json', 'README.md', 'bin', 'src', 'templates', 'fixtures'],
    required: new Set(['package.json', 'bin', 'src']),
  },
  {
    dir: 'packages/nx-angular-inspector',
    bin: 'nx-angular-inspector',
    entry: 'bin/nx-angular-inspector.mjs',
    // No `templates`/`fixtures`: nothing it ships at runtime lives there. `fixtures/` here is the
    // synthetic-workspace GENERATOR the test suite uses — a dev-time tool, not a runtime asset.
    entries: ['package.json', 'README.md', 'bin', 'src'],
    required: new Set(['package.json', 'bin', 'src']),
  },
]);

/**
 * The single source of the version: the repository's own `package.json`. EVERY package in
 * `PACKAGES` must say the same — a release that bumps the root and one package but not the other
 * would ship a zip whose two tools disagree about what version they are.
 * @param {string} root
 * @returns {string}
 */
export function readVersion(root) {
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof rootPkg.version !== 'string' || rootPkg.version === '') throw new Error('package.json: brak "version"');
  for (const pkg of PACKAGES) {
    const manifest = JSON.parse(readFileSync(join(root, pkg.dir, 'package.json'), 'utf8'));
    if (manifest.version !== rootPkg.version) {
      throw new Error(
        `wersja w package.json (${String(rootPkg.version)}) i ${pkg.dir}/package.json (${String(manifest.version)}) się różnią — podbij obie`,
      );
    }
  }
  return rootPkg.version;
}

/** @param {string} version */
export const zipName = (version) => `scribe-devtools-portable-${version}.zip`;

/**
 * The directory playwright-core actually lives in, asked of the module resolver from the package
 * that depends on it. Returns the REAL path, so a pnpm symlink is followed to the store before
 * anything is copied out of it.
 * @param {string} root repository root
 * @returns {string} absolute directory
 */
export function resolvePlaywrightCore(root) {
  const from = createRequire(join(root, 'packages/browser-inspector/package.json'));
  return realpathSync(dirname(from.resolve('playwright-core/package.json')));
}

/**
 * Copy everything the unpacked zip needs into `staging` and write the markers + shims.
 * Pure file operations, no zip — the unpack test asserts on this directory directly.
 * @param {string} root repository root (dependencies must be installed)
 * @param {string} staging empty directory
 * @returns {{ version: string, playwrightVersion: string }}
 */
export function stagePortable(root, staging) {
  const version = readVersion(root);
  const biPkg = JSON.parse(readFileSync(join(root, 'packages/browser-inspector/package.json'), 'utf8'));
  // RESOLVED from the package that declares it, never assembled as `<root>/node_modules/…`: npm
  // hoists playwright-core to the root, pnpm does not — it puts a symlink in
  // `packages/browser-inspector/node_modules` pointing into `.pnpm`. The hardcoded root path was
  // correct under one package manager and silently wrong under the other. `require.resolve` asks
  // the runtime the same question node will ask at runtime, so it is right under both.
  const pwPath = resolvePlaywrightCore(root);
  let playwrightVersion;
  try {
    playwrightVersion = JSON.parse(readFileSync(join(pwPath, 'package.json'), 'utf8')).version;
  } catch {
    throw new Error('brak playwright-core — zainstaluj zależności przed budowaniem zipa (także przed commitem)');
  }
  const pinned = biPkg.dependencies?.['playwright-core'];
  if (pinned !== playwrightVersion) {
    throw new Error(
      `playwright-core installed is ${playwrightVersion}, package.json pins ${pinned} — reinstall dependencies first`,
    );
  }

  /** @param {string} src */
  const filter = (src) => {
    const name = src.split(/[\\/]/u).pop() ?? '';
    return name !== 'node_modules' && name !== '.gitkeep' && !name.endsWith('.log');
  };

  for (const pkg of PACKAGES) {
    mkdirSync(join(staging, pkg.dir), { recursive: true });
    for (const entry of pkg.entries) {
      try {
        cpSync(join(root, pkg.dir, entry), join(staging, pkg.dir, entry), { recursive: true, filter });
      } catch (error) {
        // README.md, templates or fixtures may not exist yet in an early tree; the runtime must.
        if (/** @type {any} */ (error)?.code !== 'ENOENT' || pkg.required.has(entry)) throw error;
      }
    }
    // No build timestamp in the marker: it would make every build a new blob (see the header).
    writeFileSync(
      join(staging, pkg.dir, PORTABLE_MARKER),
      `portable build of @scribe-devtools/${pkg.bin} ${version}\n`,
      'utf8',
    );
  }

  // Only browser-inspector has a runtime dependency: playwright-core, itself dependency-free, so the
  // whole extra tree is one directory. nx-angular-inspector needs nothing copied here — zero
  // runtime dependencies is the point of it.
  // `dereference` because under pnpm the resolved directory is reached through a symlink into the
  // store: copying the link would put a pointer to a path that does not exist on the machine that
  // unpacks the zip. The portable build must carry bytes, not references.
  cpSync(pwPath, join(staging, 'node_modules', 'playwright-core'), { recursive: true, dereference: true, filter });

  // Shims: `<bin> …` from the zip root on both shells; `%~dp0` / `$(dirname "$0")` make them
  // cwd-independent. One pair per package.
  for (const pkg of PACKAGES) {
    const winPath = `${pkg.dir.replaceAll('/', '\\')}\\${pkg.entry.replaceAll('/', '\\')}`;
    writeFileSync(join(staging, `${pkg.bin}.cmd`), `@echo off\r\nnode "%~dp0${winPath}" %*\r\n`, 'utf8');
    writeFileSync(join(staging, pkg.bin), `#!/bin/sh\nexec node "$(dirname "$0")/${pkg.dir}/${pkg.entry}" "$@"\n`, {
      encoding: 'utf8',
      mode: 0o755,
    });
  }

  writeFileSync(
    join(staging, 'README-PORTABLE.md'),
    [
      `# scribe-devtools ${version} — portable`,
      '',
      'Wymagania: Node >= 22. Bez `pnpm install`, bez builda. Dwa narzędzia w jednym zipie, jedna wersja.',
      '',
      '## browser-inspector',
      '',
      'Wymaga też systemowego Chrome albo Edge.',
      '',
      '```',
      'browser-inspector help                      # Windows: browser-inspector.cmd, POSIX: ./browser-inspector',
      'node packages/browser-inspector/bin/browser-inspector.mjs help',
      '```',
      '',
      `Zawartość: \`packages/browser-inspector\` (${shipped(root, PACKAGES[0])}), \`node_modules/playwright-core\`` +
        ` ${playwrightVersion}, marker \`packages/browser-inspector/${PORTABLE_MARKER}\` (keeper pomija stempel mtime źródeł).`,
      '',
      '## nx-angular-inspector',
      '',
      'Zero zależności runtime — tylko Node. Wspiera tylko nx >= 23 i angular >= 22.',
      '',
      '```',
      'nx-angular-inspector help                   # Windows: nx-angular-inspector.cmd, POSIX: ./nx-angular-inspector',
      'node packages/nx-angular-inspector/bin/nx-angular-inspector.mjs help',
      '```',
      '',
      `Zawartość: \`packages/nx-angular-inspector\` (${shipped(root, PACKAGES[1])}).`,
      '',
      'Dokumentacja: README.md i AGENTS.md w repozytorium.',
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

/** Unix mode in the external attributes — every POSIX shim must stay executable after unzip. */
const POSIX_SHIMS = new Set(PACKAGES.map((pkg) => pkg.bin));
const unixMode = (/** @type {string} */ name) => (POSIX_SHIMS.has(name) ? 0o100755 : 0o100644);

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

/**
 * Whether git tracks `file` (repo-relative). Only a tracked zip is a release asset worth freezing:
 * an ignored one is a scratch build, and freezing it meant the second `pnpm run portable` under a
 * tagged version silently handed back the first build, whatever changed in between.
 * @param {string} root
 * @param {string} file
 */
export function isTracked(root, file) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', file], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

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
    const zipRel = relative(REPO, join(outDir, zipName(version))).replaceAll('\\', '/');
    const frozen =
      isFrozen(version, gitTags(REPO), existsSync(join(outDir, zipName(version)))) && isTracked(REPO, zipRel);
    if (frozen && !process.argv.includes('--force')) {
      console.log(
        `[zip] wersja ${version} jest wydana (tag v${version}) — ${relative(REPO, join(outDir, zipName(version)))} zostaje bez zmian; nowy kod wymaga podbicia wersji (--force przebudowuje mimo to)`,
      );
    } else {
      const { zipPath, shaPath, changed } = buildPortable(REPO, outDir);
      console.log(
        `[zip] ${changed ? 'zbudowany' : 'bez zmian'}: ${relative(REPO, zipPath)} (+ ${relative(REPO, shaPath)}) — wersja ${version}`,
      );
      for (const pkg of PACKAGES)
        console.log(`[zip] po rozpakowaniu: node ${pkg.dir}/${pkg.entry} help  (bez npm, bez builda)`);
    }
  }
}
