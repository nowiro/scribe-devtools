// The instruction block quoted in AGENTS.md IS the measured fixed cost of the `bi` side of the
// benchmark (DESIGN.md §8: 146 o200k tokens, AC-6: ≤ 150). The benchmark counts `INSTRUCTION` from
// `bench/bi-run.mjs`; the agent reads AGENTS.md. If the two drift, the report lies about what the
// agent pays — so `npm run verify` compares them character for character.
//
// The block in AGENTS.md sits between `<!-- INSTRUCTION:START -->` and `<!-- INSTRUCTION:END -->`
// as a markdown blockquote (`> …` lines); the comparison strips the `> ` prefixes and joins the
// lines with `\n`, so a wrapped quote equals its single-line source.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const AGENTS_FILE = 'AGENTS.md';
export const BENCH_FILE = 'bench/bi-run.mjs';
export const TOKEN_LIMIT = 150;

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
  const benchPath = path.join(root, BENCH_FILE);
  if (!existsSync(benchPath)) {
    return {
      ok: true,
      message: `${BENCH_FILE} not present yet — only the ${AGENTS_FILE} block was checked${tokenNote}`,
    };
  }
  const mod = await import(pathToFileURL(benchPath).href);
  if (typeof mod.INSTRUCTION !== 'string') return { ok: false, message: `${BENCH_FILE} does not export INSTRUCTION` };
  if (mod.INSTRUCTION !== fromAgents) {
    const firstDiff = [...fromAgents].findIndex((ch, i) => ch !== mod.INSTRUCTION[i]);
    return {
      ok: false,
      message: `${AGENTS_FILE} block ≠ INSTRUCTION in ${BENCH_FILE} (first difference at character ${firstDiff}) — the measured fixed cost would lie`,
    };
  }
  return { ok: true, message: `${AGENTS_FILE} block ≡ INSTRUCTION in ${BENCH_FILE}${tokenNote}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { ok, message } = await checkInstructionSync(REPO);
  (ok ? process.stdout : process.stderr).write(`${ok ? 'ok' : 'FAIL'} instruction sync: ${message}\n`);
  process.exitCode = ok ? 0 : 1;
}
