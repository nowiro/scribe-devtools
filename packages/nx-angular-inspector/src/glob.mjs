// glob.mjs — path matching anchored on SEGMENTS, which is the whole reason this file exists.
//
// The trap, measured on a real workspace: a naive substring matcher tests
// `tools/testing/**/*.ts` against `tools/scripts/x.spec.mjs` and says yes, because `*` was allowed
// to eat the slash. That one mistake turned 21 affected projects into 80 — an answer that is not
// merely wrong but wrong in the direction that looks safe, so nobody questions it.
//
// The rules, and they are the ones `.gitignore`-style globbing everywhere else uses:
//   *   any run of characters WITHIN one segment (never a `/`)
//   ?   exactly one character within one segment
//   **  any number of whole segments, including none
//
// A pattern with no `/` matches at any depth by its last segment (`*.md` matches `docs/a.md`),
// because that is how everyone writes `sharedGlobals` entries and a matcher that disagreed with the
// author's intent would be worse than none.

/**
 * Compile a glob to an anchored regular expression.
 * @param {string} pattern POSIX separators
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  const normalised = pattern.replaceAll('\\', '/').replace(/^\.\//u, '');
  const body = normalised.includes('/') ? normalised : `**/${normalised}`;
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '*') {
      if (body[i + 1] === '*') {
        // `**/` swallows whole segments including none; a bare `**` at the end swallows the rest.
        if (body[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
        continue;
      }
      out += '[^/]*';
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/u, '\\$&');
  }
  return new RegExp(`^${out}$`, 'u');
}

/**
 * Does `file` match any of `patterns`?
 * @param {string} file repo-relative, POSIX separators
 * @param {readonly string[]} patterns
 * @returns {boolean}
 */
export function matchesAny(file, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(file));
}

/**
 * The project root that owns `file`: the LONGEST root that is a segment-wise prefix of it.
 *
 * Longest wins because roots nest — `libs/ui` and `libs/ui/theme` are both projects, and a file in
 * the second belongs to the second. Segment-wise, so `libs/ui-kit/a.ts` is never claimed by
 * `libs/ui`.
 * @param {string} file
 * @param {readonly {name: string, root: string}[]} projects
 * @returns {string | null} project name
 */
export function ownerOf(file, projects) {
  /** @type {{name: string, root: string} | null} */
  let best = null;
  for (const project of projects) {
    const root = project.root.replace(/\/+$/u, '');
    if (root === '' || root === '.') continue;
    if (file !== root && !file.startsWith(`${root}/`)) continue;
    if (best === null || root.length > best.root.length) best = { name: project.name, root };
  }
  return best === null ? null : best.name;
}
