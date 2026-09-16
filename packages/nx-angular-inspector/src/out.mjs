// out.mjs — everything bigger than a line goes here.
//
// The reason is the thesis of the whole repository in one number: the reference workspace's
// `project-graph.json` is 463 383 o200k tokens. It is simultaneously the best available source of
// the answer and something no context window can ever look at. So the command reads it, writes a
// human- and agent-readable digest to `.ws/`, and prints a path.
//
// The NTFS trap this module exists to avoid: `.ws/gen/@nx/angular:library.md` does not throw on
// NTFS, `existsSync` returns true afterwards, and `readdirSync` does not list the file — the colon
// made Windows treat `angular:library.md` as an alternate data stream on `angular`. So a name is
// SANITISED and the write is verified by listing the directory back.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Characters no filesystem we support will keep verbatim in a name: the Windows-reserved set, the
 * separators, the control range, and the space (a path printed on one line of stdout must not need
 * quoting). Spelled with `\u` escapes rather than literal bytes — a control character in a source
 * file is invisible in a diff.
 */
// oxlint-disable-next-line no-control-regex -- the control range IS the point, see above
const UNSAFE = /[<>:"/\\|?*\u0000-\u001F ]/gu;

/**
 * A path segment safe on NTFS and on POSIX: `@nx/angular:library` → `nx-angular-library`.
 * Not a hash — the agent reads these paths, and `.ws/gen/nx-angular/library.md` says what it holds
 * while `.ws/gen/8f3c1a.md` does not.
 * @param {string} segment
 * @returns {string}
 */
export function safeSegment(segment) {
  const cleaned = segment
    .replace(/^@/u, '')
    .replace(UNSAFE, '-')
    .replace(/-+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '')
    .toLowerCase();
  return cleaned === '' ? 'x' : cleaned;
}

/**
 * `@nx/angular:library` → `gen/nx-angular/library.md`. The collection and the generator become two
 * segments rather than one name, so a collection with forty generators is a directory instead of
 * forty sibling files.
 * @param {string} collection
 * @param {string} generator
 * @returns {string}
 */
export function generatorPath(collection, generator) {
  return path.posix.join('gen', safeSegment(collection), `${safeSegment(generator)}.md`);
}

/**
 * Write `text` to `<outDir>/<relative>` and prove it landed under the name we asked for.
 *
 * The proof is `readdirSync`, not `existsSync`: on the alternate-data-stream path `existsSync`
 * answers true for a file the directory does not contain, so it cannot tell the two apart. A
 * mismatch throws rather than returning a path that points at nothing — a line ending in a path the
 * agent cannot read is worse than a failure, because the agent will believe it.
 * @param {string} outDir
 * @param {string} relative POSIX-separated, relative
 * @param {string} text
 * @returns {string} the absolute path written
 */
export function writeOut(outDir, relative, text) {
  const base = path.resolve(outDir);
  const target = path.resolve(base, ...relative.split('/'));

  // Containment, checked and not assumed. Every `relative` here is built from a project or target
  // name that came out of a graph this tool did not write, and `path.join` happily walks out of the
  // directory: a target spelled `build/../../../../evil` really did land a file two levels above the
  // workspace root. A tool that only reads must not be talked into writing anywhere it likes.
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`ścieżka wyjściowa ${relative} wychodzi poza katalog .ws/ — odmawiam zapisu`);
  }

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text.endsWith('\n') ? text : `${text}\n`, 'utf8');

  // The proof is `readdirSync`, not `existsSync`: on the alternate-data-stream path `existsSync`
  // answers true for a file the directory does not contain, so it cannot tell the two apart.
  //
  // The comparison is case-insensitive on Windows because NTFS is case-INSENSITIVE and
  // case-PRESERVING: overwriting `Portal-build.log` with a write addressed to `portal-build.log`
  // succeeds and leaves the original spelling in the directory listing. A byte-for-byte comparison
  // then reported a successful write as a failure — for every later run, until somebody deleted the
  // directory by hand.
  const listed = readdirSync(path.dirname(target));
  const name = path.basename(target);
  const same = (/** @type {string} */ entry) =>
    process.platform === 'win32' ? entry.toLowerCase() === name.toLowerCase() : entry === name;
  if (!listed.some(same)) {
    throw new Error(`zapis pod ${relative} nie pojawił się w katalogu — nazwa nie przeżyła systemu plików`);
  }
  return target;
}

/**
 * A `.ws/` document: one title line, one provenance line, then the body. The provenance line is
 * there because these files outlive the command that wrote them — a digest with no statement of
 * what it was made from is the exact artefact this repository's currency doctrine exists to stop.
 * @param {object} head
 * @param {string} head.title
 * @param {string} head.source what the content was read from
 * @param {string} head.freshness a verdict word, or '' when freshness does not apply
 * @param {string[]} body
 * @returns {string}
 */
export function document({ title, source, freshness }, body) {
  const provenance = [`źródło: ${source}`, freshness === '' ? '' : `świeżość: ${freshness}`]
    .filter((part) => part !== '')
    .join(' · ');
  return [`# ${title}`, '', `<!-- ${provenance} -->`, '', ...body].join('\n');
}
