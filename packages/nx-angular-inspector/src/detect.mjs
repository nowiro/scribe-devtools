// detect.mjs — which ecosystem this is, and whether we support it. Checked exactly ONCE, before
// anything else runs, so that no command has to ask again and no command can answer for a
// workspace we do not support.
//
// The rule follows from what the two servers actually key on, not from taste:
//
//   nx      = nx.json exists
//   angular = angular.json exists  ||  node_modules/@angular/core/package.json resolves
//
// The second half of the `angular` alternative is not decoration: an Nx workspace with Angular
// applications has no `angular.json` at all (`ng mcp`'s own `list_projects` finds nothing there —
// measured), so a rule that only looked for the file would classify the most common real shape as
// "not Angular".
//
// The support threshold is a FLOOR, not a ceiling. Below it we FAIL and name the requirement;
// pretending to work on an unsupported version is the failure class this whole tool exists to
// avoid. Above it, an unknown graph shape degrades to the CLI — slower, never wrong.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { packageManifest } from './paths.mjs';

export const MIN_NX = 23;
export const MIN_ANGULAR = 22;

/**
 * @typedef {object} Ecosystem
 * @property {boolean} present
 * @property {string | null} version full version string from the installed package, null when not installed
 * @property {number | null} major
 * @property {string} evidence what made us say `present`
 */

/**
 * @typedef {object} Detected
 * @property {string} root
 * @property {Ecosystem} nx
 * @property {Ecosystem} angular
 * @property {boolean} supported
 * @property {string | null} reason FAIL text when `supported` is false
 */

/**
 * `version` from a package manifest inside the workspace, or null when it is not installed or the
 * manifest is unreadable. Unreadable is treated as absent on purpose: a half-installed
 * `node_modules` must produce the same honest "not installed" as an empty one, not a crash.
 * @param {string} root
 * @param {string} id
 * @returns {string | null}
 */
export function installedVersion(root, id) {
  const manifest = packageManifest(root, id);
  if (!existsSync(manifest)) return null;
  try {
    const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
    return typeof version === 'string' && version !== '' ? version : null;
  } catch {
    return null;
  }
}

/**
 * The leading integer of a version, or null. `23.1.1` → 23, `23.1.1-beta.2` → 23.
 * @param {string | null} version
 * @returns {number | null}
 */
export function major(version) {
  if (version === null) return null;
  const match = /^(\d+)\./u.exec(version) ?? /^(\d+)$/u.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * Detect the ecosystems and apply the threshold.
 *
 * A version that cannot be read while the marker IS present is a FAIL, not a pass: `nx.json`
 * without an installed `nx` means `npm install` has not run, and every later command would fail
 * further from the cause.
 * @param {string} root
 * @returns {Detected}
 */
export function detect(root) {
  const hasNxJson = existsSync(path.join(root, 'nx.json'));
  const hasAngularJson = existsSync(path.join(root, 'angular.json'));
  const nxVersion = installedVersion(root, 'nx');
  const ngVersion = installedVersion(root, '@angular/core');

  /** @type {Ecosystem} */
  const nx = {
    present: hasNxJson,
    version: nxVersion,
    major: major(nxVersion),
    evidence: hasNxJson ? 'nx.json' : '',
  };
  /** @type {Ecosystem} */
  const angular = {
    present: hasAngularJson || ngVersion !== null,
    version: ngVersion,
    major: major(ngVersion),
    evidence: hasAngularJson ? 'angular.json' : ngVersion !== null ? '@angular/core' : '',
  };

  const reason = threshold(nx, angular);
  return { root, nx, angular, supported: reason === null, reason };
}

/**
 * The three lines of the threshold, in order. Returns the FAIL text, or null when supported.
 * @param {Ecosystem} nx
 * @param {Ecosystem} angular
 * @returns {string | null}
 */
function threshold(nx, angular) {
  if (nx.present) {
    if (nx.major === null) return 'nx.json jest, ale nx nie jest zainstalowany — uruchom instalację zależności';
    if (nx.major < MIN_NX) return `wymagane nx >= ${String(MIN_NX)}`;
  }
  if (angular.present) {
    if (angular.major === null)
      return 'angular.json jest, ale @angular/core nie jest zainstalowany — uruchom instalację zależności';
    if (angular.major < MIN_ANGULAR) return `wymagane angular >= ${String(MIN_ANGULAR)}`;
  }
  // The third line is what the word "only" in "we support only nx >= 23 and angular >= 22" costs.
  // A workspace that is neither — a plain package-manager workspace, which is what scribe-devtools
  // itself is — gets one FAIL line rather than an attempt to make something of its package.json.
  // There is no
  // third ecosystem branch and none is planned.
  if (!nx.present && !angular.present) return 'ani Nx, ani Angular — brak wsparcia';
  return null;
}

/**
 * The versions as the `env` line and every FAIL prints them: `nx 23.1.1 · ng 22.1.3`, with only
 * the halves that exist.
 * @param {Detected} detected
 * @returns {string[]}
 */
export function versionParts(detected) {
  /** @type {string[]} */
  const parts = [];
  if (detected.nx.present) parts.push(`nx ${detected.nx.version ?? 'brak'}`);
  if (detected.angular.present) parts.push(`ng ${detected.angular.version ?? 'brak'}`);
  return parts;
}
