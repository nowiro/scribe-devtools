// The instruction block quoted in AGENTS.md IS the measured fixed cost of a tool's side of the
// benchmark (AC-6: ≤ 200 o200k tokens per block — the owner trades tokens for the full tool name
// `browser-inspector` in every command; the two-letter abbreviation never appears in the
// application, so the block cannot go back to the old 150). The benchmark counts `INSTRUCTION` from
// `bench/browser-inspector-run.mjs`; the agent reads AGENTS.md. If the two drift, the report lies
// about what the agent pays — so `npm run verify` compares them character for character. A third
// copy lives in `.github/copilot-instructions.md`: VS Code Copilot reads that file instead of
// AGENTS.md in some modes, and an application repository migrating from MCP Playwright copies the
// block from there — so it is compared too, and it is required, not optional.
//
// There is now more than one tool, so there is more than one block, and each block gets its own
// NAMED markers: `<!-- INSTRUCTION:nx-angular-inspector:START -->`. The original block keeps the
// unnamed markers it has always had, because renaming it would break every application repository
// that already pasted it.
//
// A block absent from BOTH files is skipped rather than failed: that is a checkout of this tooling
// in a repository that does not use that tool. Present in one and missing from the other is a FAIL —
// that is drift, and it is the whole point. THIS repository ships both tools, so `npm run verify`
// passes `--require-all` and a test asserts both of ITS blocks exist: here a block missing from
// both files is not a foreign checkout, it is the gate quietly disarmed.
//
// The block in AGENTS.md sits between the markers as a markdown blockquote (`> …` lines); the
// comparison strips the `> ` prefixes and joins the lines with `\n`, so a wrapped quote equals its
// single-line source.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const AGENTS_FILE = 'AGENTS.md';
export const COPILOT_FILE = '.github/copilot-instructions.md';

/** Per-block cap (AC-6). */
export const TOKEN_LIMIT = 200;

/**
 * Cap on all blocks together. An agent reads every block in AGENTS.md, so the per-block limit alone
 * would let the fixed cost grow one tool at a time without any single gate ever going red.
 */
export const TOTAL_TOKEN_LIMIT = 400;

/**
 * @typedef {object} Block
 * @property {string} name '' for the original, unnamed markers
 * @property {string | null} bench file exporting `INSTRUCTION`, or null when the tool has no bench harness yet
 * @property {number} limit
 */

/** @type {readonly Block[]} */
export const BLOCKS = Object.freeze([
  { name: '', bench: 'bench/browser-inspector-run.mjs', limit: TOKEN_LIMIT },
  { name: 'nx-angular-inspector', bench: 'bench/nx-angular-inspector-run.mjs', limit: TOKEN_LIMIT },
]);

/** How a block is referred to in messages. @param {string} name */
const label = (name) => (name === '' ? 'browser-inspector' : name);

/**
 * The quoted instruction from a markdown text, or `null` when the markers are missing or the text
 * between them is not one blockquote.
 *
 * A non-empty line without `>` fails the block instead of being skipped: an application repository
 * is told to paste everything between the markers (`.github/prompts/migrate-from-mcp-playwright.prompt.md`
 * §4) and markdown renders such a line as part of the quote, so skipping it would compare and
 * measure less text than the agent reads — the gate would print `ok` over exactly the drift it
 * exists to catch. Blank lines stay skippable: the copy in `.github/copilot-instructions.md`
 * separates the markers from the quote with them.
 *
 * Two blocks with the same marker return null as well. `exec` would measure the first and ship the
 * second unchecked, which is the same silent pass in a different disguise.
 * @param {string} markdown
 * @param {string} [name] '' selects the unnamed markers
 * @returns {string | null}
 */
export function extractInstruction(markdown, name = '') {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const tag = name === '' ? 'INSTRUCTION' : `INSTRUCTION:${escaped}`;
  const starts = markdown.match(new RegExp(`<!--\\s*${tag}:START\\s*-->`, 'gu'));
  if (starts !== null && starts.length > 1) return null;
  const match = new RegExp(`<!--\\s*${tag}:START\\s*-->([\\s\\S]*?)<!--\\s*${tag}:END\\s*-->`, 'u').exec(markdown);
  if (!match) return null;
  const lines = match[1]
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '');
  if (lines.length === 0 || !lines.every((line) => line.startsWith('>'))) return null;
  return lines.map((line) => line.replace(/^>\s?/u, '')).join('\n');
}

/**
 * o200k token count when gpt-tokenizer is installed (root devDependency), `null` otherwise —
 * the sync check must not depend on the bench's tokenizer to run.
 * @param {string} text
 * @returns {Promise<number | null>}
 */
export async function countTokens(text) {
  try {
    const { encode } = await import('gpt-tokenizer/encoding/o200k_base');
    return encode(text).length;
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {{ requireAll?: boolean }} [options] `requireAll`: a block missing from BOTH files is a FAIL, not a skip
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function checkInstructionSync(root, { requireAll = false } = {}) {
  const agentsPath = path.join(root, AGENTS_FILE);
  if (!existsSync(agentsPath)) return { ok: false, message: `${AGENTS_FILE} missing` };
  const copilotPath = path.join(root, COPILOT_FILE);
  if (!existsSync(copilotPath)) return { ok: false, message: `${COPILOT_FILE} missing — Copilot needs its own copy` };
  const agentsText = readFileSync(agentsPath, 'utf8');
  const copilotText = readFileSync(copilotPath, 'utf8');

  /** @type {string[]} */
  const notes = [];
  let total = 0;
  let counted = true;

  for (const block of BLOCKS) {
    const name = label(block.name);
    const fromAgents = extractInstruction(agentsText, block.name);
    const fromCopilot = extractInstruction(copilotText, block.name);

    if (fromAgents === null && fromCopilot === null) {
      const markers = block.name === '' ? 'INSTRUCTION' : `INSTRUCTION:${block.name}`;
      if (agentsText.includes(markers) || copilotText.includes(markers)) {
        return { ok: false, message: badBlock(name, AGENTS_FILE, block.name) };
      }
      if (requireAll) {
        return {
          ok: false,
          message: `${name}: block missing from both ${AGENTS_FILE} and ${COPILOT_FILE} — this repository ships ${name}, so its instruction block is not optional here (--require-all)`,
        };
      }
      notes.push(`${name}: block absent from both files, skipped`);
      continue;
    }
    if (fromAgents === null) return { ok: false, message: badBlock(name, AGENTS_FILE, block.name) };
    if (fromCopilot === null) return { ok: false, message: badBlock(name, COPILOT_FILE, block.name) };
    if (fromCopilot !== fromAgents) {
      return {
        ok: false,
        message: `${name}: ${AGENTS_FILE} block ≠ ${COPILOT_FILE} block (first difference at character ${firstDifference(fromAgents, fromCopilot)}) — Copilot would read a different instruction than the one measured`,
      };
    }

    const tokens = await countTokens(fromAgents);
    if (tokens === null) counted = false;
    else {
      total += tokens;
      if (tokens > block.limit) {
        return {
          ok: false,
          message: `${name}: instruction is ${tokens} o200k tokens, limit ${block.limit} (AC-6)`,
        };
      }
    }

    if (block.bench === null) {
      notes.push(`${name} ≡ ${COPILOT_FILE}${tokens === null ? '' : ` · ${tokens} tok`} (bez benchu)`);
      continue;
    }
    const benchPath = path.join(root, block.bench);
    if (!existsSync(benchPath)) {
      notes.push(
        `${name} ≡ ${COPILOT_FILE}${tokens === null ? '' : ` · ${tokens} tok`} (${block.bench} not present yet)`,
      );
      continue;
    }
    const mod = await import(pathToFileURL(benchPath).href);
    if (typeof mod.INSTRUCTION !== 'string') {
      return { ok: false, message: `${block.bench} does not export INSTRUCTION` };
    }
    if (mod.INSTRUCTION !== fromAgents) {
      return {
        ok: false,
        message: `${name}: ${AGENTS_FILE} block ≠ INSTRUCTION in ${block.bench} (first difference at character ${firstDifference(fromAgents, mod.INSTRUCTION)}) — the measured fixed cost would lie`,
      };
    }
    notes.push(`${name} ≡ ${block.bench} ≡ ${COPILOT_FILE}${tokens === null ? '' : ` · ${tokens} tok`}`);
  }

  if (counted && total > TOTAL_TOKEN_LIMIT) {
    return {
      ok: false,
      message: `all blocks together are ${total} o200k tokens, limit ${TOTAL_TOKEN_LIMIT} — the agent reads every block, so the caps have to add up`,
    };
  }

  return { ok: true, message: `${notes.join(' · ')}${counted ? ` · razem ${total}/${TOTAL_TOKEN_LIMIT}` : ''}` };
}

/**
 * @param {string} name
 * @param {string} file
 * @param {string} blockName
 * @returns {string}
 */
function badBlock(name, file, blockName) {
  const markers = blockName === '' ? 'INSTRUCTION' : `INSTRUCTION:${blockName}`;
  return `${name}: the text between <!-- ${markers}:START --> and <!-- ${markers}:END --> in ${file} is not one blockquote (markers missing, duplicated, or a line between them does not start with '>' — an extra sentence belongs next to the block, not inside it)`;
}

/**
 * Index of the first differing character (code point), so the message points at the drift instead of dumping both texts.
 * @param {string} expected
 * @param {string} actual
 * @returns {number}
 */
function firstDifference(expected, actual) {
  const a = [...expected];
  const b = [...actual];
  const index = a.findIndex((ch, i) => ch !== b[i]);
  return index === -1 ? Math.min(a.length, b.length) : index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { ok, message } = await checkInstructionSync(REPO, { requireAll: process.argv.includes('--require-all') });
  (ok ? process.stdout : process.stderr).write(`${ok ? 'ok' : 'FAIL'} instruction sync: ${message}\n`);
  process.exitCode = ok ? 0 : 1;
}
