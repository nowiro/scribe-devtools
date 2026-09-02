// The instruction block quoted in AGENTS.md IS the measured fixed cost of the `browser-inspector` side of
// the benchmark (AC-6: ≤ 200 o200k tokens — the owner trades tokens for the full tool name `browser-inspector`
// in every command; the two-letter abbreviation never appears in the application, so the block cannot go back to
// the old 150). The benchmark counts `INSTRUCTION` from `bench/browser-inspector-run.mjs`; the agent reads
// AGENTS.md. If the two drift, the report lies about what the agent pays — so `npm run verify` compares them
// character for character. A third copy lives in `.github/copilot-instructions.md`: VS Code Copilot reads that file
// instead of AGENTS.md in some modes, and an application repository migrating from MCP Playwright copies the block
// from there — so it is compared too, and it is required, not optional.
//
// The block in AGENTS.md sits between `<!-- INSTRUCTION:START -->` and `<!-- INSTRUCTION:END -->`
// as a markdown blockquote (`> …` lines); the comparison strips the `> ` prefixes and joins the
// lines with `\n`, so a wrapped quote equals its single-line source.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const AGENTS_FILE = 'AGENTS.md';
export const BENCH_FILE = 'bench/browser-inspector-run.mjs';
export const COPILOT_FILE = '.github/copilot-instructions.md';
export const TOKEN_LIMIT = 200;

/**
 * The quoted instruction from AGENTS.md text, or `null` when the markers are missing.
 * @param {string} markdown
 * @returns {string | null}
 */
export function extractInstruction(markdown) {
  const match = /<!--\s*INSTRUCTION:START\s*-->([\s\S]*?)<!--\s*INSTRUCTION:END\s*-->/u.exec(markdown);
  if (!match) return null;
  const quoted = match[1]
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('>'))
    .map((line) => line.replace(/^>\s?/u, ''));
  return quoted.length > 0 ? quoted.join('\n') : null;
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
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function checkInstructionSync(root) {
  const agentsPath = path.join(root, AGENTS_FILE);
  if (!existsSync(agentsPath)) return { ok: false, message: `${AGENTS_FILE} missing` };
  const fromAgents = extractInstruction(readFileSync(agentsPath, 'utf8'));
  if (fromAgents === null) {
    return {
      ok: false,
      message: `${AGENTS_FILE}: no blockquote between <!-- INSTRUCTION:START --> and <!-- INSTRUCTION:END -->`,
    };
  }
  const tokens = await countTokens(fromAgents);
  const tokenNote = tokens === null ? '' : ` · ${tokens} o200k tokens`;
  if (tokens !== null && tokens > TOKEN_LIMIT) {
    return { ok: false, message: `${AGENTS_FILE}: instruction is ${tokens} o200k tokens, limit ${TOKEN_LIMIT} (AC-6)` };
  }
  const copilotPath = path.join(root, COPILOT_FILE);
  if (!existsSync(copilotPath)) return { ok: false, message: `${COPILOT_FILE} missing — Copilot needs its own copy` };
  const fromCopilot = extractInstruction(readFileSync(copilotPath, 'utf8'));
  if (fromCopilot === null) {
    return {
      ok: false,
      message: `${COPILOT_FILE}: no blockquote between <!-- INSTRUCTION:START --> and <!-- INSTRUCTION:END -->`,
    };
  }
  if (fromCopilot !== fromAgents) {
    return {
      ok: false,
      message: `${AGENTS_FILE} block ≠ ${COPILOT_FILE} block (first difference at character ${firstDifference(fromAgents, fromCopilot)}) — Copilot would read a different instruction than the one measured`,
    };
  }
  const benchPath = path.join(root, BENCH_FILE);
  if (!existsSync(benchPath)) {
    return {
      ok: true,
      message: `${BENCH_FILE} not present yet — only the ${AGENTS_FILE} and ${COPILOT_FILE} blocks were checked${tokenNote}`,
    };
  }
  const mod = await import(pathToFileURL(benchPath).href);
  if (typeof mod.INSTRUCTION !== 'string') return { ok: false, message: `${BENCH_FILE} does not export INSTRUCTION` };
  if (mod.INSTRUCTION !== fromAgents) {
    return {
      ok: false,
      message: `${AGENTS_FILE} block ≠ INSTRUCTION in ${BENCH_FILE} (first difference at character ${firstDifference(fromAgents, mod.INSTRUCTION)}) — the measured fixed cost would lie`,
    };
  }
  return {
    ok: true,
    message: `${AGENTS_FILE} block ≡ INSTRUCTION in ${BENCH_FILE} ≡ ${COPILOT_FILE} block${tokenNote}`,
  };
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
  const { ok, message } = await checkInstructionSync(REPO);
  (ok ? process.stdout : process.stderr).write(`${ok ? 'ok' : 'FAIL'} instruction sync: ${message}\n`);
  process.exitCode = ok ? 0 : 1;
}
