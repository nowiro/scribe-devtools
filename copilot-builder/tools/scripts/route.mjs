#!/usr/bin/env node
// route.mjs — who touches a path, answered from tools/scripts/routing.config.mjs (0 credits).
//
//   node tools/scripts/route.mjs <path…>                   one line per executor; exit 1 when a path has nobody
//   node tools/scripts/route.mjs --changed [--base=<ref>]  the same over the files a change touches (affected.mjs)
//   node tools/scripts/route.mjs --json <path…>            machine-readable: { byAgent, nobody }
//   node tools/scripts/route.mjs --table                   the markdown table the orchestrator carries
//   node tools/scripts/route.mjs --sync                    rewrite that table inside .github/agents/orchestrator.agent.md
//   node tools/scripts/route.mjs --check                   exit 1 when the table in the agent file is stale
//
// Triage of "which agent takes this file" is a lookup, not a judgement, so it is a script and not a
// subagent: a second agent would carry the file list through a second context and hand the answer
// back to the orchestrator, which still has to read it. The config is the single source; the table
// in the orchestrator's file is generated between `<!-- ROUTING:START -->` / `<!-- ROUTING:END -->`
// markers and `ai:validate` (A19) refuses a stale one — the prose cannot disagree with the answer.
//
// A path nobody owns is not an error of the script but a question for the human: vendored trees and
// generated files route to nobody on purpose, an unknown path means the config has a hole. Both end
// the run with exit 1, so the orchestrator stops and asks instead of guessing.
//
// Exit codes: 0 every path has an executor (or the table is fresh) · 1 a path has nobody / the table
// is stale · 2 usage error.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { changedFiles } from './affected.mjs';
import { REPO, isMain } from './lib/repo.mjs';
import { BY_PATH, BY_WORK, REVIEW_SEATS_ROW } from './routing.config.mjs';

export const ORCHESTRATOR_FILE = '.github/agents/orchestrator.agent.md';
export const ROUTING_START = '<!-- ROUTING:START -->';
export const ROUTING_END = '<!-- ROUTING:END -->';

/**
 * A glob → anchored RegExp: `**` any number of segments (also none), `*` within one segment, `?` one
 * character. A pattern without `/` is anchored at the root, like the rest.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/u, String.raw`\$&`);
  }
  return new RegExp(`^${out}$`, 'u');
}

/**
 * Forward slashes, no leading `./` — the shape every rule is written in.
 * @param {string} file
 * @returns {string}
 */
export const normalizePath = (file) => file.replaceAll('\\', '/').replace(/^\.\//u, '');

/**
 * The first rule whose glob matches, or null when no rule names the path at all.
 * @param {string} file
 * @param {readonly import('./routing.config.mjs').PathRule[]} [rules]
 * @returns {{ agent: string | null, what: string, glob: string } | null}
 */
export function routePath(file, rules = BY_PATH) {
  const rel = normalizePath(file);
  for (const rule of rules) {
    for (const glob of rule.globs) {
      if (globToRegExp(glob).test(rel)) return { agent: rule.agent, what: rule.what, glob };
    }
  }
  return null;
}

/**
 * @typedef {object} Routing
 * @property {Map<string, string[]>} byAgent executor → the paths it takes
 * @property {{ file: string, why: string }[]} nobody vendored, generated, or named by no rule
 */

/**
 * @param {readonly string[]} files
 * @param {readonly import('./routing.config.mjs').PathRule[]} [rules]
 * @returns {Routing}
 */
export function routePaths(files, rules = BY_PATH) {
  /** @type {Map<string, string[]>} */
  const byAgent = new Map();
  /** @type {{ file: string, why: string }[]} */
  const nobody = [];
  for (const file of files) {
    const rel = normalizePath(file);
    const hit = routePath(rel, rules);
    if (hit === null) nobody.push({ file: rel, why: 'brak reguły w tools/scripts/routing.config.mjs — STOP-AND-ASK' });
    else if (hit.agent === null) nobody.push({ file: rel, why: hit.what });
    else byAgent.set(hit.agent, [...(byAgent.get(hit.agent) ?? []), rel]);
  }
  return { byAgent, nobody };
}

/**
 * Seat → family pairs from `review.seats` of the registry, in registry order.
 * @param {string} [repo]
 * @returns {[string, string][]}
 */
export function reviewSeats(repo = REPO) {
  const file = path.join(repo, '.github', 'models-registry.json');
  if (!existsSync(file)) return [];
  const registry = JSON.parse(readFileSync(file, 'utf8'));
  return Object.entries(registry.review?.seats ?? {}).map(([seat, family]) => [seat, String(family)]);
}

/**
 * The routing table as markdown — path rules first, then work rules, the review seats expanded from
 * the registry. Deterministic, so the copy in the orchestrator file can be compared byte for byte.
 * @param {readonly [string, string][]} seats seat agent → family
 * @returns {string}
 */
export function renderRoutingTable(seats) {
  /** @type {[string, string][]} */
  const rows = [];
  for (const rule of BY_PATH) {
    const globs = rule.globs.map((glob) => `\`${glob}\``).join(', ');
    rows.push([`${globs} — ${rule.what}`, rule.agent === null ? '— (człowiek)' : `\`${rule.agent}\``]);
  }
  for (const rule of BY_WORK) {
    if (rule.agent === REVIEW_SEATS_ROW) {
      for (const [seat, family] of seats) rows.push([rule.what.replaceAll('<rodzina>', family), `\`${seat}\``]);
    } else rows.push([rule.what, `\`${rule.agent}\``]);
  }
  // No column padding on purpose: this text is read by a model on every delegation, and a table
  // aligned to its widest row would spend a few hundred spaces per line on nothing.
  const line = (/** @type {string} */ what, /** @type {string} */ agent) => `| ${what} | ${agent} |`;
  return [line('Dotykany plik / praca', 'Wykonawca'), line('---', '---'), ...rows.map(([w, a]) => line(w, a))].join(
    '\n',
  );
}

/**
 * The text between the ROUTING markers, trimmed, or null when the markers are missing or reversed.
 * @param {string} markdown
 * @returns {string | null}
 */
export function extractRoutingBlock(markdown) {
  const start = markdown.indexOf(ROUTING_START);
  const end = markdown.indexOf(ROUTING_END);
  if (start === -1 || end === -1 || end < start) return null;
  return markdown.slice(start + ROUTING_START.length, end).trim();
}

/**
 * Compare (and with `write`, rewrite) the table between the markers of the orchestrator file.
 * @param {string} repo
 * @param {{ write: boolean }} options
 * @returns {{ fresh: boolean, problem: string | null }}
 */
export function syncOrchestrator(repo, { write }) {
  const file = path.join(repo, ORCHESTRATOR_FILE);
  if (!existsSync(file)) return { fresh: false, problem: `${ORCHESTRATOR_FILE} does not exist` };
  const text = readFileSync(file, 'utf8');
  const current = extractRoutingBlock(text);
  if (current === null) {
    return { fresh: false, problem: `${ORCHESTRATOR_FILE}: no ${ROUTING_START} / ${ROUTING_END} markers` };
  }
  const expected = renderRoutingTable(reviewSeats(repo));
  if (current === expected) return { fresh: true, problem: null };
  if (!write) {
    return {
      fresh: false,
      problem: `${ORCHESTRATOR_FILE}: routing table is stale vs tools/scripts/routing.config.mjs — run \`npm run route -- --sync\``,
    };
  }
  const start = text.indexOf(ROUTING_START) + ROUTING_START.length;
  const end = text.indexOf(ROUTING_END);
  writeFileSync(file, `${text.slice(0, start)}\n${expected}\n${text.slice(end)}`, 'utf8');
  return { fresh: true, problem: null };
}

/**
 * One line per executor, then one per path with nobody — what the orchestrator reads.
 * @param {Routing} routing
 * @returns {string}
 */
export function formatRouting(routing) {
  const width = Math.max(1, ...[...routing.byAgent.keys()].map((agent) => agent.length));
  const lines = [...routing.byAgent.entries()].map(([agent, files]) => `${agent.padEnd(width)}  ${files.join(', ')}`);
  for (const { file, why } of routing.nobody) lines.push(`${'—'.padEnd(width)}  ${file}  (${why})`);
  return `${lines.join('\n')}\n`;
}

const USAGE = 'usage: route <path…> | --changed [--base=<ref>] | --json <path…> | --table | --sync | --check\n';

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function runCli(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const base = argv.find((arg) => arg.startsWith('--base='))?.slice('--base='.length);
  const files = argv.filter((arg) => !arg.startsWith('--'));
  if (flags.has('--table')) {
    process.stdout.write(`${renderRoutingTable(reviewSeats())}\n`);
    return 0;
  }
  if (flags.has('--sync') || flags.has('--check')) {
    const { problem } = syncOrchestrator(REPO, { write: flags.has('--sync') });
    if (problem !== null) {
      process.stderr.write(`FAIL route: ${problem}\n`);
      return 1;
    }
    process.stdout.write(`ok route · ${ORCHESTRATOR_FILE} routing table ${flags.has('--sync') ? 'synced' : 'fresh'}\n`);
    return 0;
  }
  let wanted = files;
  if (flags.has('--changed')) {
    const changed = changedFiles(base);
    if (changed === null) {
      process.stderr.write('route --changed: no merge base to compare against — pass the paths explicitly\n');
      return 2;
    }
    wanted = changed;
  }
  if (wanted.length === 0) {
    process.stderr.write(USAGE);
    return 2;
  }
  const routing = routePaths(wanted);
  if (flags.has('--json')) {
    process.stdout.write(
      `${JSON.stringify({ byAgent: Object.fromEntries(routing.byAgent), nobody: routing.nobody }, null, 2)}\n`,
    );
  } else process.stdout.write(formatRouting(routing));
  return routing.nobody.length === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
