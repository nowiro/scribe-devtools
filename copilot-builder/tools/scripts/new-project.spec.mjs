import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIB_TYPES, allocatePort, existingE2ePorts } from './new-project.mjs';

describe('allocatePort', () => {
  it('derives a stable port from the name and moves up past taken ports', () => {
    const first = allocatePort('demo', new Set());
    expect(first).toBe(allocatePort('demo', new Set()));
    expect(first).toBeGreaterThanOrEqual(4300);
    expect(first).toBeLessThan(4400);
    expect(allocatePort('demo', new Set([first]))).toBe(first + 1);
    expect(allocatePort('demo', new Set([first, first + 1]))).toBe(first + 2);
  });

  it('honours an explicit port and rejects a bad or taken one', () => {
    expect(allocatePort('demo', new Set(), 5000)).toBe(5000);
    expect(() => allocatePort('demo', new Set([5000]), 5000)).toThrow(/already used/u);
    expect(() => allocatePort('demo', new Set(), 80)).toThrow(/between 1024 and 65535/u);
    expect(() => allocatePort('demo', new Set(), Number.NaN)).toThrow(/integer/u);
  });
});

describe('existingE2ePorts', () => {
  /** @type {string} */
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'cb-ports-'));
    mkdirSync(path.join(repo, 'apps', 'a-e2e'), { recursive: true });
    mkdirSync(path.join(repo, 'apps', 'b-e2e'), { recursive: true });
    mkdirSync(path.join(repo, 'apps', 'c'), { recursive: true });
    writeFileSync(path.join(repo, 'apps', 'a-e2e', 'playwright.config.ts'), 'const PORT = 4311;\n', 'utf8');
    writeFileSync(path.join(repo, 'apps', 'b-e2e', 'playwright.config.ts'), 'const PORT = 4350;\n', 'utf8');
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('reads the ports of the e2e projects that exist', () => {
    expect([...existingE2ePorts(repo)].sort()).toEqual([4311, 4350]);
    expect(existingE2ePorts(path.join(repo, 'nowhere')).size).toBe(0);
  });
});

describe('LIB_TYPES', () => {
  it('lists the four boundary types in order', () => {
    expect([...LIB_TYPES]).toEqual(['feature', 'ui', 'data-access', 'util']);
  });
});
