// Tests for the instruction-sync gate. What matters is not that the parser reads a blockquote — it is
// that WHAT THE GATE MEASURES IS WHAT A READER GETS. `.github/prompts/migrate-from-mcp-playwright.prompt.md`
// §4 tells an application repository to paste "exactly the block between the markers", so a line the gate
// silently drops is a line that ships to that repository and to the agent while costing nothing in the
// measurement (AC-6). The blank lines around the quote are the one thing that MUST stay droppable: the copy
// in `.github/copilot-instructions.md` separates the markers from the quote with them.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BLOCKS,
  checkInstructionSync,
  extractInstruction,
  TOKEN_LIMIT,
  TOTAL_TOKEN_LIMIT,
} from './check-instruction-sync.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUOTE = '> Przeglądarka: `browser-inspector <config.json>` wykonuje flow, wynik na dysku.';

/**
 * The text between the markers, framed the way AGENTS.md frames it.
 * @param {...string} lines
 * @returns {string}
 */
function block(...lines) {
  return ['<!-- INSTRUCTION:START -->', ...lines, '<!-- INSTRUCTION:END -->'].join('\n');
}

/** @type {string[]} */
const roots = [];

/**
 * A minimal repository root: AGENTS.md plus the Copilot copy, no `bench/browser-inspector-run.mjs`
 * (the check reports that one as "not present yet" and still compares the two blocks).
 * @param {string} agentsBlock
 * @param {string} copilotBlock
 * @returns {string}
 */
function fakeRepo(agentsBlock, copilotBlock) {
  const root = mkdtempSync(path.join(tmpdir(), 'instruction-sync-test-'));
  roots.push(root);
  writeFileSync(path.join(root, 'AGENTS.md'), `# Instrukcje\n\n${agentsBlock}\n`, 'utf8');
  mkdirSync(path.join(root, '.github'), { recursive: true });
  writeFileSync(path.join(root, '.github', 'copilot-instructions.md'), `# Copilot\n\n${copilotBlock}\n`, 'utf8');
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(/** @type {string} */ (roots.pop()), { recursive: true, force: true });
});

describe('extractInstruction', () => {
  it('strips the `> ` prefixes and joins the lines, ignoring blank lines around the quote', () => {
    const hugged = extractInstruction(block(QUOTE, '> Sesja: `browser-inspector open <url>`.'));
    expect(hugged).toBe(
      'Przeglądarka: `browser-inspector <config.json>` wykonuje flow, wynik na dysku.\nSesja: `browser-inspector open <url>`.',
    );
    // The Copilot copy puts a blank line on each side of the quote and must still be equal.
    expect(extractInstruction(block('', QUOTE, '> Sesja: `browser-inspector open <url>`.', ''))).toBe(hugged);
  });

  it('is null without the markers, and null when the markers hold nothing quoted', () => {
    expect(extractInstruction('# Instrukcje\n\n> Przeglądarka: …\n')).toBeNull();
    expect(extractInstruction(block('', ''))).toBeNull();
  });

  it('is null when a non-empty line between the markers is not part of the blockquote', () => {
    // Markdown renders this line as part of the quote (lazy continuation) and the migration prompt
    // copies it — measuring only the `>` lines would report a cost nobody pays.
    expect(extractInstruction(block(QUOTE, 'Uwaga: zawsze dodawaj --parallel 4.'))).toBeNull();
    // A separate paragraph between the markers is copied too, so it is just as much a block error.
    expect(extractInstruction(block(QUOTE, '', 'Uwaga: zawsze dodawaj --parallel 4.'))).toBeNull();
  });
});

describe('checkInstructionSync', () => {
  it('passes when both copies carry the same quote in their own layout', async () => {
    const { ok, message } = await checkInstructionSync(fakeRepo(block(QUOTE), block('', QUOTE, '')));
    expect(ok).toBe(true);
    expect(message).toMatch(/not present yet/u);
  });

  it('fails on a sentence appended to the AGENTS.md block instead of reporting the copies equal', async () => {
    const root = fakeRepo(block(QUOTE, 'Uwaga: zawsze dodawaj --parallel 4.'), block('', QUOTE, ''));
    const { ok, message } = await checkInstructionSync(root);
    expect(ok).toBe(false);
    expect(message).toMatch(/AGENTS\.md/u);
    expect(message).toMatch(/blockquote/u);
  });

  it('the repository itself passes the check', async () => {
    const { ok, message } = await checkInstructionSync(REPO);
    expect(ok, message).toBe(true);
  });

  it('this repository really carries EVERY block in the table', async () => {
    // The "absent from both files, skipped" branch exists for a checkout of this tooling in a
    // repository that does not use the tool. Here it would be a disarmed gate, so it is asserted
    // away: deleting a block from AGENTS.md must not turn the check green.
    const agents = readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
    const copilot = readFileSync(path.join(REPO, '.github', 'copilot-instructions.md'), 'utf8');
    for (const block of BLOCKS) {
      expect(extractInstruction(agents, block.name), `AGENTS.md: ${block.name || 'unnamed'}`).not.toBeNull();
      expect(extractInstruction(copilot, block.name), `copilot: ${block.name || 'unnamed'}`).not.toBeNull();
    }
    const { message } = await checkInstructionSync(REPO);
    expect(message).not.toMatch(/skipped/u);
  });
});

describe('named blocks', () => {
  const NX_QUOTE = '> Nx/Angular: `nx-angular-inspector env`, `projects [nazwa]`.';

  /** @param {string} name @param {...string} lines */
  const named = (name, ...lines) =>
    [`<!-- INSTRUCTION:${name}:START -->`, ...lines, `<!-- INSTRUCTION:${name}:END -->`].join('\n');

  it('the unnamed markers do not match a named block, and the reverse', () => {
    const nx = named('nx-angular-inspector', NX_QUOTE);
    expect(extractInstruction(nx)).toBeNull();
    expect(extractInstruction(nx, 'nx-angular-inspector')).toBe(
      'Nx/Angular: `nx-angular-inspector env`, `projects [nazwa]`.',
    );
  });

  it('two blocks under one marker are null — `exec` would measure the first and ship the second', () => {
    expect(extractInstruction([block(QUOTE), block(QUOTE)].join('\n\n'))).toBeNull();
  });

  it('a block in AGENTS.md and missing from the Copilot copy is a FAIL, not a skip', async () => {
    const root = fakeRepo([block(QUOTE), named('nx-angular-inspector', NX_QUOTE)].join('\n\n'), block(QUOTE));
    const { ok, message } = await checkInstructionSync(root);
    expect(ok).toBe(false);
    expect(message).toMatch(/copilot-instructions\.md/u);
  });

  it('a block absent from both files is skipped — this tooling in a repo without that tool', async () => {
    const { ok, message } = await checkInstructionSync(fakeRepo(block(QUOTE), block(QUOTE)));
    expect(ok).toBe(true);
    expect(message).toMatch(/nx-angular-inspector: block absent from both files, skipped/u);
  });

  it('with `requireAll` (what `npm run verify` passes) the same absence is a FAIL — deleting both copies cannot disarm the gate', async () => {
    const { ok, message } = await checkInstructionSync(fakeRepo(block(QUOTE), block(QUOTE)), { requireAll: true });
    expect(ok).toBe(false);
    expect(message).toMatch(/nx-angular-inspector: block missing from both/u);
  });

  it('the per-block cap and the sum of the caps are both real numbers, and the sum is the tighter one', () => {
    expect(BLOCKS.every((b) => b.limit === TOKEN_LIMIT)).toBe(true);
    expect(TOTAL_TOKEN_LIMIT).toBeLessThan(BLOCKS.length * TOKEN_LIMIT + 1);
  });
});
