// The instruction block quoted in AGENTS.md IS the fixed cost of a tool's side of an agent session:
// one blockquote that tells the agent how to call `browser-inspector` or the ALM scripts (`scribe`)
// without loading a tool schema. A second copy lives in `.github/copilot-instructions.md`: VS Code
// Copilot reads that file in every mode, AGENTS.md only when `chat.useAgentsMdFile` is on — so both
// carry the block and `npm run verify` compares them character for character. A drift there is the
// agent reading one instruction while the humans review another.
//
// There is more than one tool, so there is more than one block, and each block has its own NAMED
// markers: `<!-- INSTRUCTION:browser-inspector:START -->`, `<!-- INSTRUCTION:scribe:START -->`.
//
// A block absent from BOTH files is skipped rather than failed, unless `--require-all` is passed:
// this repository ships both tools, so `npm run verify` passes it — here a block missing from both
// files is the gate quietly disarmed, and deleting both copies would otherwise print `ok`.
//
// The block in AGENTS.md sits between the markers as a markdown blockquote (`> …` lines); the
// comparison strips the `> ` prefixes and joins the lines with `\n`, so a wrapped quote equals its
// single-line source.
//
// THE UNIT IS BYTES: Node has no tokenizer, a token number divided out of bytes would look like a
// measurement and be a guess, and bytes need no dependency. Density varies by roughly a fifth between
// prose and command lines, so the caps are generous by that margin; what they guarantee is the only
// thing a cap is for — an instruction block cannot grow unnoticed.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, isMain } from './lib/repo.mjs';

export const AGENTS_FILE = 'AGENTS.md';
export const COPILOT_FILE = '.github/copilot-instructions.md';

/** Per-block cap in UTF-8 bytes (see the note at the top of the file). */
export const BYTE_LIMIT = 600;

/**
 * Cap on all blocks together. An agent reads every block in AGENTS.md, so the per-block limit alone
 * would let the fixed cost grow one tool at a time without any single gate ever going red.
 */
export const TOTAL_BYTE_LIMIT = 1300;

/**
 * @typedef {object} Block
 * @property {string} name '' for the original, unnamed markers
 * @property {number} limit
 */

/** @type {readonly Block[]} */
export const BLOCKS = Object.freeze([
  { name: 'browser-inspector', limit: BYTE_LIMIT },
  { name: 'scribe', limit: BYTE_LIMIT },
]);

/** How a block is referred to in messages. @param {string} name */
const label = (name) => (name === '' ? 'instruction' : name);

/**
 * The quoted instruction from a markdown text, or `null` when the markers are missing or the text
 * between them is not one blockquote.
 *
 * A non-empty line without `>` fails the block instead of being skipped: an application repository
 * is told to paste everything between the markers (README.md,
 * section on Copilot) and markdown renders such a line as part of the quote, so skipping it would compare and
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
 * @typedef {object} BlockResult
 * @property {string} [fail] the FAIL message — when present the check stops here
 * @property {string} [note] the ok fragment for the summary line
 * @property {number} bytes the block's size, 0 when it was skipped
 */

/** @typedef {{ root: string, agentsText: string, copilotText: string, requireAll: boolean }} SyncContext */

/**
 * Neither file carries the block: a FAIL when the markers are there but broken or when every block is
 * required, otherwise a skip.
 * @param {(typeof BLOCKS)[number]} block
 * @param {string} name
 * @param {SyncContext} ctx
 * @returns {BlockResult}
 */
function missingBlock(block, name, ctx) {
  const markers = block.name === '' ? 'INSTRUCTION' : `INSTRUCTION:${block.name}`;
  if (ctx.agentsText.includes(markers) || ctx.copilotText.includes(markers)) {
    return { fail: badBlock(name, AGENTS_FILE, block.name), bytes: 0 };
  }
  if (ctx.requireAll) {
    return {
      fail: `${name}: block missing from both ${AGENTS_FILE} and ${COPILOT_FILE} — this repository ships ${name}, so its instruction block is not optional here (--require-all)`,
      bytes: 0,
    };
  }
  return { note: `${name}: block absent from both files, skipped`, bytes: 0 };
}

/**
 * One block: present in both files (or in neither, when optional), byte-identical and within its cap.
 * @param {(typeof BLOCKS)[number]} block
 * @param {SyncContext} ctx
 * @returns {Promise<BlockResult>}
 */
async function checkBlock(block, ctx) {
  const name = label(block.name);
  const fromAgents = extractInstruction(ctx.agentsText, block.name);
  const fromCopilot = extractInstruction(ctx.copilotText, block.name);
  if (fromAgents === null && fromCopilot === null) return missingBlock(block, name, ctx);
  if (fromAgents === null) return { fail: badBlock(name, AGENTS_FILE, block.name), bytes: 0 };
  if (fromCopilot === null) return { fail: badBlock(name, COPILOT_FILE, block.name), bytes: 0 };
  if (fromCopilot !== fromAgents) {
    return {
      fail: `${name}: ${AGENTS_FILE} block ≠ ${COPILOT_FILE} block (first difference at character ${firstDifference(fromAgents, fromCopilot)}) — Copilot would read a different instruction than the one measured`,
      bytes: 0,
    };
  }
  const bytes = sizeInBytes(fromAgents);
  if (bytes > block.limit) return { fail: `${name}: instruction is ${bytes} B, limit ${block.limit} B`, bytes };
  return { note: `${name} ≡ ${COPILOT_FILE} · ${bytes} B`, bytes };
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
  /** @type {SyncContext} */
  const ctx = {
    root,
    agentsText: readFileSync(agentsPath, 'utf8'),
    copilotText: readFileSync(copilotPath, 'utf8'),
    requireAll,
  };

  /** @type {string[]} */
  const notes = [];
  let total = 0;
  for (const block of BLOCKS) {
    const result = await checkBlock(block, ctx);
    if (result.fail !== undefined) return { ok: false, message: result.fail };
    if (result.note !== undefined) notes.push(result.note);
    total += result.bytes;
  }

  if (total > TOTAL_BYTE_LIMIT) {
    return {
      ok: false,
      message: `all blocks together are ${total} B, limit ${TOTAL_BYTE_LIMIT} B — the agent reads every block, so the caps have to add up`,
    };
  }
  return { ok: true, message: `${notes.join(' · ')} · total ${total}/${TOTAL_BYTE_LIMIT} B` };
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

if (isMain(import.meta.url)) {
  const { ok, message } = await checkInstructionSync(REPO, { requireAll: process.argv.includes('--require-all') });
  (ok ? process.stdout : process.stderr).write(`${ok ? 'ok' : 'FAIL'} instruction sync: ${message}\n`);
  process.exitCode = ok ? 0 : 1;
}
