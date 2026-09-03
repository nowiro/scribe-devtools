// generators.mjs — what can be generated here, and what a given generator takes.
//
// This replaces `nx_generators`, `nx_generator_schema` and `ng generate --help`. The whole answer
// is on disk already: every plugin ships its collection manifest inside `node_modules`, and the
// schema of a generator is a JSON file next to it. There is nothing to ask a server about.
//
// The scan is stat-first and read-second. Probing three well-known filenames per package is a stat
// each (~5 000 stats on a large workspace, tens of milliseconds); reading every `package.json` to
// find the `generators` field would be ~1 700 file reads for the same nine hits.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Manifest filenames a plugin can ship, in the order Nx and the Angular CLI look for them. */
export const MANIFEST_NAMES = Object.freeze(['generators.json', 'collection.json', 'schematics.json']);

/**
 * @typedef {object} Generator
 * @property {string} collection npm package name
 * @property {string} name
 * @property {string} description
 * @property {string} schemaFile absolute path, '' when the manifest names none
 * @property {boolean} hidden
 */

/**
 * @typedef {object} Option
 * @property {string} name
 * @property {string} type
 * @property {boolean} required
 * @property {string} default rendered, '' when there is none
 * @property {string} description
 */

/**
 * Every package directory under `node_modules`, scoped packages included, without reading any of
 * them. `.bin` and dot-directories are npm's own bookkeeping.
 * @param {string} root
 * @returns {{ id: string, dir: string }[]}
 */
export function packageDirs(root) {
  const modules = path.join(root, 'node_modules');
  /** @type {{ id: string, dir: string }[]} */
  const out = [];
  for (const entry of safeReaddir(modules)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      for (const scoped of safeReaddir(path.join(modules, entry))) {
        if (scoped.startsWith('.')) continue;
        out.push({ id: `${entry}/${scoped}`, dir: path.join(modules, entry, scoped) });
      }
      continue;
    }
    out.push({ id: entry, dir: path.join(modules, entry) });
  }
  return out;
}

/** @param {string} dir @returns {string[]} */
function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * All generators installed in the workspace, sorted by `collection:name`.
 * @param {string} root
 * @returns {{ generators: Generator[], collections: number }}
 */
export function scanGenerators(root) {
  /** @type {Generator[]} */
  const generators = [];
  let collections = 0;
  for (const { id, dir } of packageDirs(root)) {
    const manifest = MANIFEST_NAMES.map((name) => path.join(dir, name)).find((file) => existsSync(file));
    if (manifest === undefined) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    } catch {
      continue;
    }
    // `generators` is the Nx spelling, `schematics` the Angular one; a collection may carry both,
    // and `@schematics/angular` in an Nx workspace is exactly that case.
    const entries = { ...(parsed.schematics ?? {}), ...(parsed.generators ?? {}) };
    const names = Object.keys(entries);
    if (names.length === 0) continue;
    collections += 1;
    for (const name of names) {
      const entry = entries[name] ?? {};
      generators.push({
        collection: id,
        name,
        description: String(entry.description ?? '').trim(),
        schemaFile: entry.schema === undefined ? '' : path.resolve(path.dirname(manifest), String(entry.schema)),
        hidden: entry.hidden === true || entry.private === true,
      });
    }
  }
  generators.sort((a, b) => `${a.collection}:${a.name}`.localeCompare(`${b.collection}:${b.name}`, 'en'));
  return { generators, collections };
}

/**
 * `@nx/angular:library` → the two halves. A missing colon means the whole string is a filter over
 * names, not a fully qualified generator.
 * @param {string} spec
 * @returns {{ collection: string, name: string } | null}
 */
export function parseSpec(spec) {
  const at = spec.lastIndexOf(':');
  if (at <= 0 || at === spec.length - 1) return null;
  return { collection: spec.slice(0, at), name: spec.slice(at + 1) };
}

/**
 * The options a generator takes, flattened out of its JSON schema.
 *
 * The digest is the point: the full `@nx/angular:library` schema is 7 999 B, and the list below is
 * a few hundred — every flag with its type, whether it is required, and its default. That is what a
 * caller needs to write the command; the prose belongs in the file on disk.
 * @param {any} schema
 * @returns {{ options: Option[], required: string[] }}
 */
export function schemaOptions(schema) {
  const required = [...(schema?.required ?? [])].map(String).sort();
  const properties = schema?.properties ?? {};
  /** @type {Option[]} */
  const options = [];
  for (const [name, raw] of Object.entries(properties)) {
    const property = /** @type {any} */ (raw) ?? {};
    options.push({
      name,
      type: describeType(property),
      required: required.includes(name),
      default: property.default === undefined ? '' : JSON.stringify(property.default),
      description: String(property.description ?? property.alias ?? '')
        .replace(/\s+/gu, ' ')
        .trim(),
    });
  }
  options.sort((a, b) => (a.required === b.required ? a.name.localeCompare(b.name, 'en') : a.required ? -1 : 1));
  return { options, required };
}

/**
 * A schema property's type as one word, with an enum spelled out — `string`, `boolean`,
 * `application|library`. The enum is worth the characters: it is the difference between a caller
 * guessing a value and knowing it.
 * @param {any} property
 * @returns {string}
 */
export function describeType(property) {
  if (Array.isArray(property.enum) && property.enum.length > 0) return property.enum.map(String).join('|');
  if (Array.isArray(property.type)) return property.type.map(String).join('|');
  if (typeof property.type === 'string') return property.type;
  if (property.oneOf || property.anyOf) return 'oneOf';
  return '?';
}
