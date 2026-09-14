import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { patternHeads, validateAiConfig } from './validate-ai-config.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A copy of the real Copilot configuration in a temp dir — the repository's own config is the one
 * fixture that is guaranteed to be valid, so every test mutates ONE thing and expects ONE rule.
 * @returns {string}
 */
function copyConfig() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-ai-config-'));
  for (const rel of ['.github', '.vscode', 'tools/hooks'])
    cpSync(path.join(REPO, rel), path.join(dir, rel), { recursive: true });
  cpSync(path.join(REPO, 'AGENTS.md'), path.join(dir, 'AGENTS.md'));
  // A10 checks that every `applyTo` starts at a path that exists: recreate those heads, empty.
  for (const file of readdirSync(path.join(REPO, '.github', 'instructions'))) {
    const front = readFileSync(path.join(REPO, '.github', 'instructions', file), 'utf8');
    const applyTo = /applyTo:\s*'([^']+)'/u.exec(front)?.[1] ?? '';
    for (const pattern of applyTo.split(',')) {
      for (const head of patternHeads(pattern.trim())) {
        const target = path.join(dir, head);
        if (path.extname(head) === '') {
          mkdirSync(target, { recursive: true });
        } else {
          mkdirSync(path.dirname(target), { recursive: true });
          if (!existsSync(target)) writeFileSync(target, '', 'utf8');
        }
      }
    }
  }
  return dir;
}

/** @param {string} dir @param {string} rel @param {(text: string) => string} edit */
function patch(dir, rel, edit) {
  const file = path.join(dir, rel);
  writeFileSync(file, edit(readFileSync(file, 'utf8')), 'utf8');
}

/** @param {string} dir @param {string} rule */
const rulesHit = (dir, rule) => validateAiConfig(dir).problems.filter((problem) => problem.startsWith(`${rule} ·`));

describe('validateAiConfig', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = copyConfig();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts the repository configuration', () => {
    const result = validateAiConfig(dir);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('A7 — a second visible agent', () => {
    patch(dir, '.github/agents/code-angular.agent.md', (text) =>
      text.replace('user-invocable: false', 'user-invocable: true'),
    );
    expect(rulesHit(dir, 'A7').length).toBeGreaterThan(0);
  });

  it('A5 — a model written into an agent file instead of the tier', () => {
    patch(dir, '.github/agents/code-tooling.agent.md', (text) => text.replace(/^model: .*$/mu, 'model: Claude Opus 5'));
    expect(rulesHit(dir, 'A5')).toHaveLength(1);
  });

  it('A13 — a reviewer without the deny-writes hook', () => {
    patch(dir, '.github/agents/code-reviewer-anthropic.agent.md', (text) =>
      text.replace(/hooks:[\s\S]*?timeout: 10\n/u, ''),
    );
    expect(rulesHit(dir, 'A13')).toHaveLength(1);
  });

  it('A14 — a hook command that is not one of our scripts', () => {
    patch(dir, '.github/hooks/guard-commands.json', (text) =>
      text.replace('node tools/hooks/guard-commands.mjs', 'bash tools/hooks/guard-commands.sh'),
    );
    expect(rulesHit(dir, 'A14')).toHaveLength(1);
    patch(dir, '.github/agents/code-reviewer-anthropic.agent.md', (text) =>
      text.replace('command: node tools/hooks/deny-writes.mjs', 'command: node tools/hooks/deny-writes.mjs --and-more'),
    );
    expect(rulesHit(dir, 'A14').length).toBeGreaterThan(1);
  });

  it('A15 — the web tool set anywhere', () => {
    patch(dir, '.github/agents/code-angular.agent.md', (text) =>
      text.replace(
        "tools: ['read', 'search', 'edit', 'execute']",
        "tools: ['read', 'search', 'edit', 'execute', 'web']",
      ),
    );
    expect(rulesHit(dir, 'A15')).toHaveLength(1);
  });

  it('A16 — an MCP server started through npx or a moving tag', () => {
    patch(dir, '.vscode/mcp.json', (text) =>
      text
        .replace('"command": "node"', '"command": "npx"')
        .replace('"node_modules/@angular/cli/bin/ng.js", "mcp"', '"-y", "@angular/cli@latest", "mcp"'),
    );
    expect(rulesHit(dir, 'A16').length).toBeGreaterThanOrEqual(2);
  });

  it('A8 — a second agent naming the MCP server', () => {
    patch(dir, '.github/agents/code-tooling.agent.md', (text) =>
      text.replace(
        "tools: ['read', 'search', 'edit', 'execute']",
        "tools: ['read', 'search', 'edit', 'execute', 'angular-cli']",
      ),
    );
    expect(rulesHit(dir, 'A8')).toHaveLength(1);
  });

  it('A17 — an agent the orchestrator never routes to', () => {
    patch(dir, '.github/agents/orchestrator.agent.md', (text) => text.replaceAll('`doc-reviewer`', '`doc-reviewer-x`'));
    expect(rulesHit(dir, 'A17')).toHaveLength(1);
  });

  it('A18 — a seat whose model is not from the family it promises, which also doubles a family', () => {
    patch(dir, '.github/models-registry.json', (text) =>
      text.replace('"senior-moonshot": "Kimi K3"', '"senior-moonshot": "Claude Opus 5"'),
    );
    // The agent file follows its tier, so A5 stays quiet; A18 sees a broken promise and a shared family.
    patch(dir, '.github/agents/code-reviewer-moonshot.agent.md', (text) =>
      text.replace(/^model: .*$/mu, 'model: Claude Opus 5'),
    );
    const hits = rulesHit(dir, 'A18');
    expect(hits.some((hit) => hit.includes('promises moonshot'))).toBe(true);
    expect(hits.some((hit) => hit.includes('anthropic family'))).toBe(true);
    expect(rulesHit(dir, 'A5')).toHaveLength(0);
  });

  it('A19 — a routing table edited by hand instead of regenerated from routing.config.mjs', () => {
    patch(dir, '.github/agents/orchestrator.agent.md', (text) =>
      text.replace('<!-- ROUTING:START -->', '<!-- ROUTING:START -->\n| ręczny wiersz | `code-angular` |'),
    );
    expect(rulesHit(dir, 'A19')).toHaveLength(1);
    patch(dir, '.github/agents/orchestrator.agent.md', (text) =>
      text.replaceAll(/<!-- ROUTING:(?:START|END) -->/gu, ''),
    );
    expect(rulesHit(dir, 'A19')[0]).toContain('markers');
  });

  it('A3 — a roster agent without a file and a file without a roster entry', () => {
    rmSync(path.join(dir, '.github/agents/doc-intake.agent.md'));
    mkdirSync(path.join(dir, '.github/agents'), { recursive: true });
    writeFileSync(
      path.join(dir, '.github/agents/code-ghost.agent.md'),
      "---\nname: code-ghost\ndescription: junior · ghost\nmodel: GPT-5.6 Luna\ntools: ['read']\nuser-invocable: false\n---\n",
      'utf8',
    );
    const hits = rulesHit(dir, 'A3');
    expect(hits.some((hit) => hit.includes('doc-intake'))).toBe(true);
    expect(hits.some((hit) => hit.includes('code-ghost'))).toBe(true);
  });

  it('A1 — another assistant configured next to Copilot', () => {
    writeFileSync(path.join(dir, 'CLAUDE.md'), '# no\n', 'utf8');
    expect(rulesHit(dir, 'A1')).toHaveLength(1);
  });
});

describe('patternHeads', () => {
  it('expands brace alternatives and drops unanchored globs', () => {
    expect(patternHeads('{apps,libs}/**/*.ts')).toEqual(['apps', 'libs']);
    expect(patternHeads('tools/**')).toEqual(['tools']);
    expect(patternHeads('**/*.md')).toEqual([]);
    expect(patternHeads('*.spec.ts')).toEqual([]);
  });
});
