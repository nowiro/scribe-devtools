import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_CAP,
  CAPS,
  bodyOf,
  checkPrefix,
  isWildcard,
  measurePrefix,
  renderTable,
  settingOn,
  toolSwitches,
  unmeasurable,
} from './check-prefix.mjs';

const SCRIPT = fileURLToPath(new URL('./check-prefix.mjs', import.meta.url));

/** @param {Record<string, string>} fields @param {string} body */
const withFrontmatter = (fields, body) =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n---\n${body}`;

describe('bodyOf', () => {
  it('drops the frontmatter and keeps everything after the closing marker', () => {
    expect(bodyOf(withFrontmatter({ name: 'a' }, 'Body.\n'))).toBe('Body.\n');
  });

  it('handles CRLF line endings and a file without frontmatter', () => {
    expect(bodyOf('---\r\nname: a\r\n---\r\nBody.\r\n')).toBe('Body.\r\n');
    expect(bodyOf('Plain.\n')).toBe('Plain.\n');
  });
});

describe('settingOn', () => {
  it('reads a boolean next to glob keys that a naive JSONC comment stripper would break', () => {
    const text =
      '{\n  "files.exclude": { "**/tools/hooks/**": false, "**/.github/**": false },\n  "chat.useAgentsMdFile": false\n}';
    expect(settingOn(text, 'chat.useAgentsMdFile', true)).toBe(false);
  });

  it('falls back to the default when the key is absent and takes the last of repeated keys', () => {
    expect(settingOn('{}', 'chat.useAgentsMdFile', true)).toBe(true);
    expect(settingOn('{ "a.b": false, "a.b": true }', 'a.b', false)).toBe(true);
  });

  it('ignores a key inside a comment, and a URL earlier on the line does not hide a live key', () => {
    expect(
      settingOn(
        '{\n  "chat.useAgentsMdFile": true,\n  // "chat.useAgentsMdFile": false\n}',
        'chat.useAgentsMdFile',
        true,
      ),
    ).toBe(true);
    expect(settingOn('{ "u": "https://x.test", "chat.useAgentsMdFile": false }', 'chat.useAgentsMdFile', true)).toBe(
      false,
    );
  });
});

describe('isWildcard and toolSwitches', () => {
  it('treats **, **/* and * as matching without a file, alone or in a list', () => {
    expect(isWildcard('**')).toBe(true);
    expect(isWildcard('src/**, **/*')).toBe(true);
    expect(isWildcard('src/**')).toBe(false);
  });

  it('switches the index on with read or terminal tools and the agents block on with the subagent tool', () => {
    expect(toolSwitches(['read', 'search'])).toEqual({ seesIndex: true, callsAgents: false });
    expect(toolSwitches(['search', 'agent'])).toEqual({ seesIndex: false, callsAgents: true });
    expect(toolSwitches(['execute/runInTerminal'])).toEqual({ seesIndex: true, callsAgents: false });
    expect(toolSwitches(null)).toEqual({ seesIndex: true, callsAgents: true });
  });
});

describe('unmeasurable', () => {
  it('names multi-line values and block lists, and passes flat frontmatter', () => {
    expect(unmeasurable('---\ndescription: >-\n  long\n---\n')).toContain('multi-line');
    expect(unmeasurable("---\nname: a\nagents:\n  - 'b'\n---\n")).toContain('block list');
    expect(unmeasurable("---\nname: a\ndescription: 'x'\nagents: ['b']\n---\n")).toBeNull();
  });
});

describe('measurePrefix and checkPrefix', () => {
  /** @type {string} */
  let dir;
  /** @param {string} rel @param {string} text */
  const write = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text, 'utf8');
  };
  /** @param {string} name */
  const agent = (name) => measurePrefix(dir).agents.find((item) => item.name === name);
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'cb-prefix-'));
    write('.github/copilot-instructions.md', 'C'.repeat(100));
    write('AGENTS.md', 'A'.repeat(200));
    write(
      '.github/skills/one/SKILL.md',
      withFrontmatter({ name: 'one', description: 'd'.repeat(20) }, 'X'.repeat(5000)),
    );
    write(
      '.github/agents/worker.agent.md',
      withFrontmatter({ name: 'worker', description: "'w'", tools: "['read']" }, 'W'.repeat(50)),
    );
    write(
      '.github/agents/lead.agent.md',
      withFrontmatter(
        { name: 'lead', description: "'lead'", tools: "['read', 'agent']", agents: "['worker']" },
        'L'.repeat(30),
      ),
    );
    write(
      '.github/instructions/code.instructions.md',
      withFrontmatter({ description: "'dd'", applyTo: "'src/**'" }, 'I'.repeat(40)),
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // index entry: path ".github/instructions/code.instructions.md" (41 B) + "dd" (2 B) + "src/**" (6 B) = 49 B
  // skill card: "one" (3 B) + 20 B of description + ".github/skills/one/SKILL.md" (27 B) = 50 B
  it('adds the body, the shared files, the index, the skill cards and the cards of callable agents', () => {
    expect(agent('worker')).toMatchObject({ own: 50, shared: 300, index: 49, skills: 50, agents: 0, total: 449 });
    // lead calls worker: its card is "worker" (6 B) + "w" (1 B)
    expect(agent('lead')).toMatchObject({
      own: 30,
      shared: 300,
      index: 49,
      skills: 50,
      agents: 7,
      total: 436,
      tools: 2,
    });
  });

  it('gives no index and no skill cards to an agent that can neither read files nor run the terminal', () => {
    write(
      '.github/agents/worker.agent.md',
      withFrontmatter({ name: 'worker', description: "'w'", tools: "['search']" }, 'W'),
    );
    expect(agent('worker')).toMatchObject({ index: 0, skills: 0 });
  });

  it('counts every other agent that allows it when `agents:` is * or absent', () => {
    write(
      '.github/agents/lead.agent.md',
      withFrontmatter({ name: 'lead', description: "'lead'", tools: "['agent']", agents: "['*']" }, 'L'),
    );
    write(
      '.github/agents/quiet.agent.md',
      withFrontmatter({ name: 'quiet', description: "'q'", 'disable-model-invocation': 'true' }, 'Q'),
    );
    expect(agent('lead')?.agents).toBe(7);
  });

  it('attaches a wildcard instruction to every agent and leaves the others conditional', () => {
    write('.github/instructions/all.instructions.md', withFrontmatter({ applyTo: "'**'" }, 'Z'.repeat(70)));
    const measurement = measurePrefix(dir);
    expect(measurement.agents[0].shared).toBe(370);
    expect(measurement.instructions.map((item) => item.file)).toEqual(['.github/instructions/code.instructions.md']);
  });

  it('leaves AGENTS.md out when chat.useAgentsMdFile is off and counts CLAUDE.md unless its setting is off', () => {
    write('CLAUDE.md', 'L'.repeat(10));
    expect(agent('worker')?.shared).toBe(310);
    write('.vscode/settings.json', '{ "chat.useAgentsMdFile": false, "chat.useClaudeMdFile": false }');
    const measurement = measurePrefix(dir);
    expect(measurement.agents[0].shared).toBe(100);
    expect(measurement.off.map((item) => item.file)).toEqual(['AGENTS.md', 'CLAUDE.md']);
  });

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    write('.github/agents/worker.agent.md', withFrontmatter({ name: 'worker', description: "'w'" }, 'żółć'));
    expect(agent('worker')?.own).toBe(8);
  });

  it('passes within the caps and names what it does not count', () => {
    const result = checkPrefix(dir);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(`/${AGENT_CAP} B`);
    expect(result.message).toContain('not counted');
  });

  it('gives the orchestrator its own cap and reports it separately', () => {
    write(
      '.github/agents/orchestrator.agent.md',
      withFrontmatter({ name: 'orchestrator', description: "'o'" }, 'O'.repeat(10)),
    );
    expect(agent('orchestrator')?.cap).toBe(CAPS.orchestrator);
    expect(checkPrefix(dir).message).toMatch(new RegExp(`orchestrator \\d+/${CAPS.orchestrator} B`, 'u'));
  });

  it('fails an agent over its cap and shows where the bytes are', () => {
    write('AGENTS.md', 'A'.repeat(AGENT_CAP));
    const result = checkPrefix(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('worker');
    expect(result.message).toMatch(/own \d+ · shared \d+ · index \d+ · skills \d+ · agents \d+/u);
  });

  it('fails a frontmatter it cannot measure and names the file', () => {
    write('.github/skills/one/SKILL.md', '---\nname: one\ndescription: >-\n  folded\n---\nBody');
    const result = checkPrefix(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('.github/skills/one/SKILL.md');
  });

  it('fails when the agents directory is missing or empty', () => {
    rmSync(path.join(dir, '.github/agents'), { recursive: true, force: true });
    expect(checkPrefix(dir)).toEqual({ ok: false, message: '.github/agents missing' });
    mkdirSync(path.join(dir, '.github/agents'));
    expect(checkPrefix(dir)).toEqual({ ok: false, message: 'no *.agent.md in .github/agents' });
  });

  it('lists the conditional instructions in the table', () => {
    const table = renderTable(measurePrefix(dir));
    expect(table).toContain('| .github/instructions/code.instructions.md | `src/**` |');
    expect(table).toContain('| lead | — |');
  });
});

describe('command line', () => {
  /** @param {string[]} args */
  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('exits 2 on an unknown argument, on stderr', () => {
    const result = run(['--foo']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^FAIL prefix: unknown argument --foo/u);
  });

  it('prints the table, also behind the bare -- that pnpm passes through', () => {
    for (const args of [['--table'], ['--', '--table']]) {
      const result = run(args);
      expect(result.status).toBe(0);
      expect(result.stdout.startsWith('| agent |')).toBe(true);
    }
  });
});
