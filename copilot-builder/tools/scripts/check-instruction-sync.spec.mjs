import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BYTE_LIMIT,
  TOTAL_BYTE_LIMIT,
  checkInstructionSync,
  extractInstruction,
  sizeInBytes,
} from './check-instruction-sync.mjs';

/** @param {string} name @param {string} body */
const block = (name, body) => `<!-- INSTRUCTION:${name}:START -->\n> ${body}\n<!-- INSTRUCTION:${name}:END -->`;

describe('extractInstruction', () => {
  it('returns the blockquote text between the named markers', () => {
    expect(extractInstruction(`intro\n${block('scribe', 'use alm:read')}\noutro`, 'scribe')).toBe('use alm:read');
  });

  it('is null when the markers are missing or the content is not a blockquote', () => {
    expect(extractInstruction('nothing here', 'scribe')).toBeNull();
    expect(
      extractInstruction('<!-- INSTRUCTION:scribe:START -->\nplain line\n<!-- INSTRUCTION:scribe:END -->', 'scribe'),
    ).toBeNull();
  });
});

describe('checkInstructionSync', () => {
  /** @type {string} */
  let dir;
  const agents = 'AGENTS.md';
  const copilot = '.github/copilot-instructions.md';
  /** @param {string} agentsText @param {string} copilotText */
  const write = (agentsText, copilotText) => {
    mkdirSync(path.join(dir, '.github'), { recursive: true });
    writeFileSync(path.join(dir, agents), agentsText, 'utf8');
    writeFileSync(path.join(dir, copilot), copilotText, 'utf8');
  };
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cb-instruction-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes identical blocks within the caps and reports the total', async () => {
    const text = `${block('browser-inspector', 'run browser-inspector')}\n${block('scribe', 'run alm:read')}`;
    write(text, text);
    const result = await checkInstructionSync(dir, { requireAll: true });
    expect(result.ok).toBe(true);
    expect(result.message).toContain(`/${TOTAL_BYTE_LIMIT} B`);
  });

  it('points at the first differing character when the copies drift', async () => {
    write(block('scribe', 'run alm:read'), block('scribe', 'run alm:reed'));
    const result = await checkInstructionSync(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('first difference at character 10');
  });

  it('fails a block over its cap and blocks over the total', async () => {
    const long = 'x'.repeat(BYTE_LIMIT + 1);
    write(block('scribe', long), block('scribe', long));
    expect((await checkInstructionSync(dir)).message).toContain(`limit ${BYTE_LIMIT} B`);
    const half = 'y'.repeat(BYTE_LIMIT - 1);
    const both = `${block('browser-inspector', half)}\n${block('scribe', half)}`;
    write(both, both);
    const result = await checkInstructionSync(dir);
    expect(result.ok).toBe(TOTAL_BYTE_LIMIT >= 2 * (BYTE_LIMIT - 1));
  });

  it('skips a block absent from both files unless every block is required', async () => {
    write(block('scribe', 'run alm:read'), block('scribe', 'run alm:read'));
    expect((await checkInstructionSync(dir)).ok).toBe(true);
    const required = await checkInstructionSync(dir, { requireAll: true });
    expect(required.ok).toBe(false);
    expect(required.message).toContain('browser-inspector');
  });

  it('fails when a block is in one file only or its markers are broken', async () => {
    write(block('scribe', 'run alm:read'), 'no block');
    expect((await checkInstructionSync(dir)).ok).toBe(false);
    write(
      '<!-- INSTRUCTION:scribe:START -->\nnot a quote\n<!-- INSTRUCTION:scribe:END -->',
      block('scribe', 'run alm:read'),
    );
    expect((await checkInstructionSync(dir)).message).toContain('not one blockquote');
  });

  it('counts bytes, not characters', () => {
    expect(sizeInBytes('zażółć')).toBe(10);
  });
});
