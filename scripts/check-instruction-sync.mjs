// The instruction block quoted in AGENTS.md IS the measured fixed cost of a tool's side of an
// agent session (AC-6: originally ≤ 200 o200k tokens per block — the owner trades tokens for the
// full tool name `browser-inspector` in every command; the two-letter abbreviation never appears in
// the application, so the block cannot go back to the old 150). A second copy lives in
// `.github/copilot-instructions.md`: VS Code Copilot reads that file instead of AGENTS.md in some
// modes, and an application repository migrating from MCP Playwright copies the block from there —
// so it is compared too, and it is required, not optional. `pnpm run verify` compares the two
// character for character; a drift there is the agent reading one instruction and being measured
// against another.
//
// There is more than one tool, so there is more than one block, and each block gets its own NAMED
// markers: `<!-- INSTRUCTION:nx-angular-inspector:START -->`. The original block keeps the unnamed
// markers it has always had, because renaming it would break every application repository that
// already pasted it.
//
// A block absent from BOTH files is skipped rather than failed: that is a checkout of this tooling
// in a repository that does not use that tool. Present in one and missing from the other is a FAIL —
// that is drift, and it is the whole point. THIS repository ships both tools, so `pnpm run verify`
// passes `--require-all`: here a block missing from both files is not a foreign checkout, it is
// the gate quietly disarmed — deleting both copies would otherwise print `ok`.
//
// A third source — a bench harness exporting `INSTRUCTION` as a live measurement — is optional per
// block (`bench: null` when there is none) and not present on this branch at all: the benchmark
// this repository used to carry lived in `bench/`, which this branch does not have. The two-file
// comparison above still holds without it.
//
// The block in AGENTS.md sits between the markers as a markdown blockquote (`> …` lines); the
// comparison strips the `> ` prefixes and joins the lines with `\n`, so a wrapped quote equals its
// single-line source.
//
// THE UNIT IS BYTES, and that is a deliberate downgrade. The cap used to be counted in o200k tokens
// by `gpt-tokenizer`; the dependency is gone, Node has no tokenizer, and the only honest options
// left were a guessed token number or a different unit. A guessed one was never on the table — see
// `packages/nx-angular-inspector/src/guide.mjs`, which refused exactly that and reported bytes
// instead. Now the whole repository reports bytes, and `guide` is the rule rather than the
// exception. What bytes are NOT is a bound on tokens: the two blocks here measure 527 B/158 tok and
// 550 B/195 tok, so density varies by ~18 % between two files written by the same hand on the same
// day. The caps below are calibrated on those two measurements, not derived from them — they keep
// the headroom the token caps had (353/400 ≈ 88 % full, 1077/1200 ≈ 90 % full), so the gate stayed
// as tight as it was. What survives the change is the only thing the cap was ever for: an
// instruction block cannot grow unnoticed.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const AGENTS_FILE = 'AGENTS.md';
export const COPILOT_FILE = '.github/copilot-instructions.md';

/** Per-block cap in UTF-8 bytes (AC-6, restated in bytes — see the note at the top of the file). */
export const BYTE_LIMIT = 600;

/**
 * Cap on all blocks together. An agent reads every block in AGENTS.md, so the per-block limit alone
 * would let the fixed cost grow one tool at a time without any single gate ever going red.
 */
export const TOTAL_BYTE_LIMIT = 1200;

/**
 * @typedef {object} Block
 * @property {string} name '' for the original, unnamed markers
 * @property {string | null} bench file exporting `INSTRUCTION`, or null when the tool has no bench harness yet
 * @property {number} limit
 */

/** @type {readonly Block[]} */
export const BLOCKS = Object.freeze([
  { name: '', bench: null, limit: BYTE_LIMIT },
  { name: 'nx-angular-inspector', bench: null, limit: BYTE_LIMIT },
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
 * Size of the instruction in UTF-8 bytes — the unit every size in this repository is stated in.
 *
 * `Buffer.byteLength`, not `text.length`: Polish prose is full of two-byte characters, and counting
 * UTF-16 code units would make the same sentence cheaper here than it is on disk or on the wire.
 * There is no failure mode to handle and nothing to import, which is the other half of why the
 * measurement moved — the old token count lived behind a dynamic import and a `try/catch` that
 * silently turned the cap off whenever the tokenizer was missing.
 * @param {string} text
 * @returns {number}
 */
export function sizeInBytes(text) {
  return Buffer.byteLength(text, 'utf8');
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

    const bytes = sizeInBytes(fromAgents);
    total += bytes;
    if (bytes > block.limit) {
      return {
        ok: false,
        message: `${name}: instruction is ${bytes} B, limit ${block.limit} B (AC-6)`,
      };
    }

    if (block.bench === null) {
      notes.push(`${name} ≡ ${COPILOT_FILE} · ${bytes} B (bez benchu)`);
      continue;
    }
    const benchPath = path.join(root, block.bench);
    if (!existsSync(benchPath)) {
      notes.push(`${name} ≡ ${COPILOT_FILE} · ${bytes} B (${block.bench} not present yet)`);
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
    notes.push(`${name} ≡ ${block.bench} ≡ ${COPILOT_FILE} · ${bytes} B`);
  }

  if (total > TOTAL_BYTE_LIMIT) {
    return {
      ok: false,
      message: `all blocks together are ${total} B, limit ${TOTAL_BYTE_LIMIT} B — the agent reads every block, so the caps have to add up`,
    };
  }

  return { ok: true, message: `${notes.join(' · ')} · razem ${total}/${TOTAL_BYTE_LIMIT} B` };
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
