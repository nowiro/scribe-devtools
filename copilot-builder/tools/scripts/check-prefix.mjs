#!/usr/bin/env node
// check-prefix.mjs — the FIXED PREFIX of every agent: the bytes GitHub Copilot in VS Code puts into the
// context window on every request of that agent's session, before the task adds a single word.
//
// A turn re-sends the whole prefix, so its size multiplies by every request of every session: an agent
// that carries twenty kilobytes of shared rules pays for them on each tool call, whether the task needs
// them or not. The harness decides this number, not the model, and no diff review shows it — one sentence
// added to AGENTS.md reaches every agent at once, subagents included. This gate makes the number visible
// per agent and caps it, so the prefix cannot grow unnoticed.
//
//   npm run check:prefix              gate: one line, FAIL when an agent passes its cap
//   npm run check:prefix -- --table   per-agent breakdown plus the instructions that load conditionally
//
// What counts, per agent — what the VS Code agent prompt adds on every request (sources in the ADR on the
// fixed prefix; the subagent tool runs the same instruction collector, so a subagent gets the same files):
//   own     the body of the agent file; the frontmatter configures the host
//   shared  .github/copilot-instructions.md, AGENTS.md, CLAUDE.md and CLAUDE.local.md unless their setting in
//           .vscode/settings.json is off, plus the body of every instruction whose `applyTo` is a wildcard
//           (`**`, `**/*`, `*`) — the host attaches those without any file
//   index   path + description + applyTo of every instruction file, when the agent can read files or run
//           the terminal: the host lists them so the model reads the one a file needs
//   skills  name + description + path of every skill the model may invoke, under the same condition
//   agents  name + description + argument-hint of every agent it may call, when it has the subagent tool;
//           no `agents:` or `'*'` means every other agent without `disable-model-invocation: true`
// Not counted, and the output says so: the host's system prompt, the fixed preambles it wraps around the
// index and the tool schemas (the host decides those, not this repository), and the body of an instruction
// attached because a file of the task matches its `applyTo` — `--table` lists those with their size instead
// of guessing a task. A value the flat frontmatter reader cannot measure (a multi-line `description:`, a block
// list under `agents:` or `tools:`) fails the gate instead of passing on a number that is too small.
//
// THE UNIT IS BYTES (UTF-8), as in check-instruction-sync.mjs: Node has no tokenizer, a token count
// divided out of bytes would be a guess dressed as a measurement, and bytes need no dependency.
//
// Exit codes: 0 pass · 1 an agent over its cap, or a file the measurement needs is missing · 2 usage error.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sizeInBytes } from './check-instruction-sync.mjs';
import { REPO, frontmatter, isMain, stripJsonComments } from './lib/repo.mjs';
import { parseList } from './validate-ai-config.mjs';

export const AGENTS_DIR = '.github/agents';
export const SKILLS_DIR = '.github/skills';
export const INSTRUCTIONS_DIR = '.github/instructions';
export const SETTINGS_FILE = '.vscode/settings.json';
export const REGISTRY_FILE = '.github/models-registry.json';

/**
 * Always-on files and the setting that switches each one off (all default on in VS Code).
 * @type {readonly { file: string, key: string }[]}
 */
export const SHARED_FILES = Object.freeze([
  { file: '.github/copilot-instructions.md', key: 'github.copilot.chat.codeGeneration.useInstructionFiles' },
  { file: 'AGENTS.md', key: 'chat.useAgentsMdFile' },
  { file: 'CLAUDE.md', key: 'chat.useClaudeMdFile' },
  { file: 'CLAUDE.local.md', key: 'chat.useClaudeMdFile' },
]);

/** `applyTo` patterns the host treats as matching with no file attached. */
export const WILDCARDS = Object.freeze(['**', '**/*', '*']);

/**
 * Cap per agent in UTF-8 bytes. Measured on 2026-09-18: every subagent 19.5–20.9 kB, of which 18.5 kB is
 * the same for all (shared files, instruction index, skill cards). The cap is the largest one plus a tenth,
 * rounded down to a thousand: room for a sentence, not a section.
 */
export const AGENT_CAP = 23_000;

/**
 * Agents whose prefix is larger by design, with the reason. Raising a cap is a decision: the reason
 * changes together with the number.
 * @type {Readonly<Record<string, number>>}
 */
export const CAPS = Object.freeze({
  // The only visible agent carries the SDD ladder and the card of every subagent it may call.
  orchestrator: 41_000,
});

/**
 * @typedef {object} AgentPrefix
 * @property {string} name
 * @property {string} tier `—` when the registry does not list the agent
 * @property {number} own body of the agent file
 * @property {number} shared always-on files and wildcard instructions
 * @property {number} index the instruction index (0 without a read or terminal tool)
 * @property {number} skills the skill cards (0 without a read or terminal tool)
 * @property {number} agents the cards of the agents it may call (0 without the subagent tool)
 * @property {number} total
 * @property {number} cap
 * @property {number} tools number of entries in `tools:` (their schemas are not measured); -1 = no `tools:`
 */

/**
 * @typedef {object} Measurement
 * @property {AgentPrefix[]} agents sorted by name
 * @property {{ file: string, bytes: number }[]} shared the always-on files and wildcard instructions, with their size
 * @property {{ file: string, reason: string }[]} off always-on files a setting switches off
 * @property {number} index bytes of the instruction index
 * @property {number} skillCount skills the model may invoke
 * @property {number} skills bytes of their cards
 * @property {{ file: string, applyTo: string, bytes: number }[]} instructions attached only when a task file matches
 */

/**
 * The text after the frontmatter block — what the model reads. A file without frontmatter is all body.
 * @param {string} text
 * @returns {string}
 */
export function bodyOf(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  const afterMarker = text.indexOf('\n', end + 4);
  return afterMarker === -1 ? '' : text.slice(afterMarker + 1);
}

/**
 * A boolean VS Code setting from the text of settings.json: comments removed by the string-aware
 * `stripJsonComments` (the file holds glob keys such as `"**\/tools/hooks/**"`), then the key matched
 * directly instead of parsed, because VS Code accepts trailing commas and `JSON.parse` does not. A key
 * written twice resolves to the last one, as in VS Code; a key inside a comment is not a setting.
 * @param {string} settingsText '' when the file does not exist
 * @param {string} key
 * @param {boolean} fallback the host's default when the key is absent
 * @returns {boolean}
 */
export function settingOn(settingsText, key, fallback) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`"${escaped}"\\s*:\\s*(true|false)`, 'gu');
  const matches = [...stripJsonComments(settingsText).matchAll(pattern)];
  return matches.length === 0 ? fallback : matches.at(-1)?.[1] === 'true';
}

/**
 * Why a frontmatter cannot be measured by a flat reader, or null when it can. A multi-line YAML value
 * (`description: >-`, a block list under `agents:` or `tools:`) reads as one or two bytes, and the gate
 * would pass on a number that is wrong; it fails instead and names the form to rewrite.
 * @param {string} text the whole file
 * @returns {string | null}
 */
export function unmeasurable(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const lines = text.slice(3, end).split('\n');
  for (const [i, line] of lines.entries()) {
    const match = /^(name|description|argument-hint|agents|tools):[ \t]*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (/^[>|]/u.test(value)) return `\`${key}:\` is a multi-line YAML value — write it on one line`;
    const next = lines.slice(i + 1).find((candidate) => candidate.trim() !== '') ?? '';
    if (value === '' && next.trim().startsWith('- ')) {
      return `\`${key}:\` is a YAML block list — write it inline, as ['a', 'b']`;
    }
  }
  return null;
}

/**
 * Whether an `applyTo` value attaches its instruction with no file: one of its comma-separated patterns
 * is a wildcard.
 * @param {string} applyTo
 * @returns {boolean}
 */
export function isWildcard(applyTo) {
  return applyTo.split(',').some((pattern) => WILDCARDS.includes(pattern.trim()));
}

/**
 * What the agent's tool list switches on. No `tools:` at all means the host's whole selection, so both.
 * Tool sets (`read`, `execute`, `agent`) and single tools (`readFile`, `runInTerminal`, `runSubagent`,
 * also as `<set>/<tool>`) count alike.
 * @param {string[] | null} tools null when the frontmatter has no `tools:`
 * @returns {{ seesIndex: boolean, callsAgents: boolean }}
 */
export function toolSwitches(tools) {
  if (tools === null) return { seesIndex: true, callsAgents: true };
  const names = tools.map((tool) => tool.split('/').pop() ?? tool);
  return {
    seesIndex: names.some((name) => ['read', 'execute', 'readFile', 'read_file', 'runInTerminal'].includes(name)),
    callsAgents: names.some((name) => ['agent', 'runSubagent'].includes(name)),
  };
}

/** @param {string | undefined} value @returns {string} */
const unquoted = (value) => (value ?? '').trim().replace(/^['"]|['"]$/gu, '');

/**
 * @param {string} dir absolute
 * @param {(entry: import('node:fs').Dirent) => boolean} accept
 * @returns {import('node:fs').Dirent[]}
 */
function entries(dir, accept) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(accept)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Instruction files: every one is in the index; a wildcard one is attached in full; the rest wait for a
 * matching task file.
 * @param {string} root
 * @param {boolean} attachWildcards `chat.includeApplyingInstructions`
 */
function instructionFiles(root, attachWildcards) {
  const files = entries(
    path.join(root, INSTRUCTIONS_DIR),
    (entry) => entry.isFile() && entry.name.endsWith('.instructions.md'),
  ).map((entry) => {
    const file = `${INSTRUCTIONS_DIR}/${entry.name}`;
    const text = readFileSync(path.join(root, file), 'utf8');
    const fm = frontmatter(text) ?? {};
    const applyTo = unquoted(fm.applyTo);
    return {
      file,
      applyTo,
      card: sizeInBytes(file) + sizeInBytes(unquoted(fm.description)) + sizeInBytes(applyTo),
      bytes: sizeInBytes(bodyOf(text)),
    };
  });
  const always = files.filter((item) => attachWildcards && isWildcard(item.applyTo));
  return {
    index: files.reduce((sum, item) => sum + item.card, 0),
    always: always.map(({ file, bytes }) => ({ file, bytes })),
    conditional: files
      .filter((item) => !always.includes(item))
      .map(({ file, applyTo, bytes }) => ({ file, applyTo, bytes })),
  };
}

/**
 * Cards of the skills the model may invoke: a skill without a description or with
 * `disable-model-invocation: true` stays out of the list.
 * @param {string} root
 * @returns {{ count: number, bytes: number }}
 */
function skillCards(root) {
  let count = 0;
  let bytes = 0;
  for (const entry of entries(path.join(root, SKILLS_DIR), (item) => item.isDirectory())) {
    const file = `${SKILLS_DIR}/${entry.name}/SKILL.md`;
    if (!existsSync(path.join(root, file))) continue;
    const fm = frontmatter(readFileSync(path.join(root, file), 'utf8')) ?? {};
    const description = unquoted(fm.description);
    if (description === '' || unquoted(fm['disable-model-invocation']) === 'true') continue;
    count += 1;
    bytes += sizeInBytes(unquoted(fm.name)) + sizeInBytes(description) + sizeInBytes(file);
  }
  return { count, bytes };
}

/**
 * The always-on files, split into the ones that load and the ones a setting switches off.
 * @param {string} root
 * @param {string} settings text of settings.json, '' when absent
 */
function sharedFiles(root, settings) {
  /** @type {{ file: string, bytes: number }[]} */
  const shared = [];
  /** @type {{ file: string, reason: string }[]} */
  const off = [];
  for (const { file, key } of SHARED_FILES) {
    const abs = path.join(root, file);
    if (!existsSync(abs)) continue;
    if (settingOn(settings, key, true)) shared.push({ file, bytes: sizeInBytes(readFileSync(abs, 'utf8')) });
    else off.push({ file, reason: `${key}: false` });
  }
  return { shared, off };
}

/**
 * The tier of every roster agent, or an empty map when the registry is missing.
 * @param {string} root
 * @returns {Record<string, string>}
 */
function tiers(root) {
  const file = path.join(root, REGISTRY_FILE);
  if (!existsSync(file)) return {};
  /** @type {{ agents?: { roster?: Record<string, { tier?: string }> } }} */
  const registry = JSON.parse(readFileSync(file, 'utf8'));
  return Object.fromEntries(
    Object.entries(registry.agents?.roster ?? {}).map(([name, entry]) => [name, entry.tier ?? '—']),
  );
}

/**
 * The fixed prefix of every agent in the repository at `root`.
 * @param {string} root
 * @returns {Measurement}
 */
export function measurePrefix(root) {
  const settingsPath = path.join(root, SETTINGS_FILE);
  const settings = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
  const { shared, off } = sharedFiles(root, settings);
  const instructions = instructionFiles(root, settingOn(settings, 'chat.includeApplyingInstructions', true));
  const always = [...shared, ...instructions.always];
  const sharedBytes = always.reduce((sum, file) => sum + file.bytes, 0);
  const skills = skillCards(root);

  const parsed = entries(
    path.join(root, AGENTS_DIR),
    (entry) => entry.isFile() && entry.name.endsWith('.agent.md'),
  ).map((entry) => {
    const text = readFileSync(path.join(root, AGENTS_DIR, entry.name), 'utf8');
    const fm = frontmatter(text) ?? {};
    const name = unquoted(fm.name) || entry.name.replace(/\.agent\.md$/u, '');
    const card = sizeInBytes(name) + sizeInBytes(unquoted(fm.description)) + sizeInBytes(unquoted(fm['argument-hint']));
    const hidden = unquoted(fm['disable-model-invocation']) === 'true';
    return { name, text, fm, card, hidden };
  });
  const byName = new Map(parsed.map((agent) => [agent.name, agent]));
  const tierOf = tiers(root);

  const agents = parsed.map(({ name, text, fm }) => {
    const tools = 'tools' in fm ? parseList(fm.tools) : null;
    const { seesIndex, callsAgents } = toolSwitches(tools);
    const listed = parseList(fm.agents);
    // No `agents:` (or `*`) lets the model call every agent that allows it; a named agent is callable even
    // when it hides itself from the model.
    const callable =
      listed.length === 0 || listed.includes('*')
        ? parsed.filter((other) => other.name !== name && !other.hidden)
        : listed.map((sub) => byName.get(sub) ?? { card: sizeInBytes(sub) });
    const own = sizeInBytes(bodyOf(text));
    const index = seesIndex ? instructions.index : 0;
    const skillBytes = seesIndex ? skills.bytes : 0;
    const agentBytes = callsAgents ? callable.reduce((sum, sub) => sum + sub.card, 0) : 0;
    return {
      name,
      tier: tierOf[name] ?? '—',
      own,
      shared: sharedBytes,
      index,
      skills: skillBytes,
      agents: agentBytes,
      total: own + sharedBytes + index + skillBytes + agentBytes,
      cap: CAPS[name] ?? AGENT_CAP,
      tools: tools === null ? -1 : tools.length,
    };
  });

  return {
    agents,
    shared: always,
    off,
    index: instructions.index,
    skillCount: skills.count,
    skills: skills.bytes,
    instructions: instructions.conditional,
  };
}

/** @param {AgentPrefix} agent @returns {string} */
const parts = (agent) =>
  `own ${agent.own} · shared ${agent.shared} · index ${agent.index} · skills ${agent.skills} · agents ${agent.agents}`;

const NOT_COUNTED =
  'not counted: host system prompt and index preambles, tool schemas, instructions attached by a task file (--table)';

/**
 * The gate: every agent within its cap.
 * @param {string} root
 * @returns {{ ok: boolean, message: string }}
 */
export function checkPrefix(root) {
  if (!existsSync(path.join(root, AGENTS_DIR))) return { ok: false, message: `${AGENTS_DIR} missing` };
  const measured = [
    ...entries(path.join(root, AGENTS_DIR), (entry) => entry.isFile() && entry.name.endsWith('.agent.md')).map(
      (entry) => `${AGENTS_DIR}/${entry.name}`,
    ),
    ...entries(path.join(root, SKILLS_DIR), (entry) => entry.isDirectory())
      .map((entry) => `${SKILLS_DIR}/${entry.name}/SKILL.md`)
      .filter((file) => existsSync(path.join(root, file))),
  ];
  for (const file of measured) {
    const reason = unmeasurable(readFileSync(path.join(root, file), 'utf8'));
    if (reason !== null) return { ok: false, message: `${file}: ${reason}, so its prefix can be measured` };
  }
  const { agents, shared } = measurePrefix(root);
  if (agents.length === 0) return { ok: false, message: `no *.agent.md in ${AGENTS_DIR}` };
  const over = agents.filter((agent) => agent.total > agent.cap);
  if (over.length > 0) {
    const list = over
      .map((agent) => `${agent.name} ${agent.total} B > cap ${agent.cap} B (${parts(agent)})`)
      .join('; ');
    return {
      ok: false,
      message: `${list} — move rules into an applyTo instruction or a skill, or raise the cap in tools/scripts/check-prefix.mjs together with its reason`,
    };
  }
  const largest = [...agents].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const byCap = largest.filter((agent) => agent.cap === AGENT_CAP);
  const special = largest
    .filter((agent) => agent.cap !== AGENT_CAP)
    .map((agent) => `${agent.name} ${agent.total}/${agent.cap} B`);
  const sharedBytes = shared.reduce((sum, file) => sum + file.bytes, 0);
  const lead = byCap.length > 0 ? `largest ${byCap[0].name} ${byCap[0].total}/${AGENT_CAP} B` : '';
  const summary = [`${agents.length} agents`, ...special, lead, `shared ${sharedBytes} B in every agent`, NOT_COUNTED]
    .filter((part) => part !== '')
    .join(' · ');
  return { ok: true, message: summary };
}

/**
 * The breakdown as Markdown: one row per agent, then what stands behind the columns, then the
 * instructions that load only with a matching task file.
 * @param {Measurement} measurement
 * @returns {string}
 */
export function renderTable(measurement) {
  const rows = [...measurement.agents].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const lines = [
    '| agent | tier | own | shared | index | skills | agents | total | cap | tools |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (agent) =>
        `| ${agent.name} | ${agent.tier} | ${agent.own} | ${agent.shared} | ${agent.index} | ${agent.skills} | ${agent.agents} | ${agent.total} | ${agent.cap} | ${agent.tools === -1 ? 'all' : agent.tools} |`,
    ),
    '',
    `shared: ${measurement.shared.map((file) => `${file.file} ${file.bytes} B`).join(' · ') || 'none'}`,
    ...measurement.off.map((file) => `off: ${file.file} (${file.reason})`),
    `index: ${measurement.index} B — path, description and applyTo of every instruction file (agents with a read or terminal tool)`,
    `skills: ${measurement.skillCount} cards, ${measurement.skills} B — name, description and path (same condition; the body loads on use)`,
    `${NOT_COUNTED.replace(' (--table)', '')}; tools = entries in \`tools:\``,
    '',
    'Conditional — attached when a file of the task matches `applyTo`:',
    '',
    '| instruction | applyTo | bytes |',
    '| --- | --- | ---: |',
    ...measurement.instructions.map((item) => `| ${item.file} | \`${item.applyTo}\` | ${item.bytes} |`),
  ];
  return `${lines.join('\n')}\n`;
}

if (isMain(import.meta.url)) {
  // `pnpm run check:prefix -- --table` passes the bare separator through; npm strips it.
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const unknown = args.filter((arg) => arg !== '--table');
  if (unknown.length > 0) {
    process.stderr.write(`FAIL prefix: unknown argument ${unknown.join(' ')} — usage: check-prefix.mjs [--table]\n`);
    process.exitCode = 2;
  } else if (args.includes('--table')) {
    process.stdout.write(renderTable(measurePrefix(REPO)));
  } else {
    const { ok, message } = checkPrefix(REPO);
    (ok ? process.stdout : process.stderr).write(`${ok ? 'ok' : 'FAIL'} prefix: ${message}\n`);
    process.exitCode = ok ? 0 : 1;
  }
}
