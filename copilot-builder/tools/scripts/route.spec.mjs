import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ROUTING_END,
  ROUTING_START,
  extractRoutingBlock,
  globToRegExp,
  renderRoutingTable,
  reviewSeats,
  routePath,
  routePaths,
  syncOrchestrator,
} from './route.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('globToRegExp', () => {
  it.each([
    ['apps/**', 'apps/portal/src/app/a.ts', true],
    ['apps/**', 'libs/a.ts', false],
    ['**/*.spec.ts', 'a.spec.ts', true],
    ['**/*.spec.ts', 'apps/x/src/a.spec.ts', true],
    ['**/*.spec.ts', 'apps/x/src/a.ts', false],
    ['tsconfig*.json', 'tsconfig.app.json', true],
    ['tsconfig*.json', 'apps/x/tsconfig.app.json', false],
    ['apps/*-e2e/**', 'apps/portal-e2e/tests/login.spec.ts', true],
    ['apps/*-e2e/**', 'apps/portal/tests/login.spec.ts', false],
    ['oxlint.*.mts', 'oxlint.rules.mts', true],
    ['CODE-INDEX.md', 'CODE-INDEX.md', true],
    ['CODE-INDEX.md', 'docs/CODE-INDEX.md', false],
  ])('%s vs %s → %s', (glob, file, expected) => {
    expect(globToRegExp(glob).test(file)).toBe(expected);
  });
});

describe('routePath — first match wins, specific before general', () => {
  it.each([
    ['apps/portal-e2e/tests/login.spec.ts', 'code-tester-e2e'],
    ['apps/portal/src/app/a.spec.ts', 'code-tester-unit'],
    ['tools/scripts/route.spec.mjs', 'code-tester-unit'],
    ['apps/portal/src/app/a.ts', 'code-angular'],
    ['libs/shared/ui/src/public-api.ts', 'code-angular'],
    ['tools/scripts/route.mjs', 'code-tooling'],
    ['.github/hooks/guard-commands.json', 'code-tooling'],
    ['.github/models-registry.json', 'code-tooling'],
    ['.gitlab/issue_templates/Default.md', 'code-tooling'],
    ['tsconfig.json', 'code-tooling'],
    ['.github/agents/orchestrator.agent.md', 'doc-spec'],
    ['.github/prompts/review.prompt.md', 'doc-spec'],
    ['docs/decisions/2026-01-01_00-00_adr-x.md', 'doc-spec'],
    ['README.md', 'doc-spec'],
  ])('%s → %s', (file, agent) => {
    expect(routePath(file)?.agent).toBe(agent);
  });

  it('vendored and generated files route to nobody on purpose; an unknown path has no rule', () => {
    expect(routePath('tools/alm/scripts/read.mjs')?.agent).toBeNull();
    expect(routePath('tools/browser-inspector/src/cli.mjs')?.agent).toBeNull();
    expect(routePath('CODE-INDEX.md')?.agent).toBeNull();
    expect(routePath('weird.bin')).toBeNull();
  });

  it('accepts backslashes and a leading ./', () => {
    expect(routePath(String.raw`.\apps\portal\src\app\a.ts`)?.agent).toBe('code-angular');
  });
});

describe('routePaths', () => {
  it('groups by executor and lists nobody with a reason', () => {
    const routing = routePaths([
      'apps/x/src/a.ts',
      'apps/x/src/a.spec.ts',
      'libs/y/src/b.ts',
      'tools/alm/x.ts',
      'nope.bin',
    ]);
    expect(routing.byAgent.get('code-angular')).toEqual(['apps/x/src/a.ts', 'libs/y/src/b.ts']);
    expect(routing.byAgent.get('code-tester-unit')).toEqual(['apps/x/src/a.spec.ts']);
    expect(routing.nobody.map((entry) => entry.file)).toEqual(['tools/alm/x.ts', 'nope.bin']);
    expect(routing.nobody[1].why).toContain('STOP-AND-ASK');
  });
});

describe('renderRoutingTable', () => {
  it('names every roster agent of the real registry, seats expanded from review.seats', () => {
    const registry = JSON.parse(readFileSync(path.join(REPO, '.github', 'models-registry.json'), 'utf8'));
    const table = renderRoutingTable(reviewSeats(REPO));
    for (const name of Object.keys(registry.agents.roster)) {
      if (name === 'orchestrator') continue;
      expect(table, name).toContain(`\`${name}\``);
    }
    for (const family of Object.values(registry.review.seats)) expect(table).toContain(`w rodzinie ${family}`);
    expect(table.split('\n')[0]).toMatch(/^\| Dotykany plik \/ praca/u);
  });
});

describe('syncOrchestrator', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cb-route-'));
    mkdirSync(path.join(dir, '.github', 'agents'), { recursive: true });
    writeFileSync(
      path.join(dir, '.github', 'models-registry.json'),
      JSON.stringify({ review: { seats: { 'code-reviewer-anthropic': 'anthropic' } } }),
      'utf8',
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a stale block, rewrites it on --sync and then calls it fresh', () => {
    const file = path.join(dir, '.github', 'agents', 'orchestrator.agent.md');
    writeFileSync(file, `# o\n\n${ROUTING_START}\n| stale |\n${ROUTING_END}\n\ntail\n`, 'utf8');
    expect(syncOrchestrator(dir, { write: false })).toMatchObject({ fresh: false });
    expect(syncOrchestrator(dir, { write: true })).toEqual({ fresh: true, problem: null });
    const text = readFileSync(file, 'utf8');
    expect(extractRoutingBlock(text)).toBe(renderRoutingTable([['code-reviewer-anthropic', 'anthropic']]));
    expect(text.endsWith('\ntail\n')).toBe(true);
    expect(syncOrchestrator(dir, { write: false })).toEqual({ fresh: true, problem: null });
  });

  it('refuses a file without markers', () => {
    writeFileSync(path.join(dir, '.github', 'agents', 'orchestrator.agent.md'), '# o\n', 'utf8');
    expect(syncOrchestrator(dir, { write: true }).problem).toContain('markers');
  });
});
