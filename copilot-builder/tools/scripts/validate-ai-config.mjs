#!/usr/bin/env node
// validate-ai-config.mjs — the gate over the GitHub Copilot configuration (0 credits; pre-commit,
// session-stop hook and `npm run verify`).
//
// The assistant's configuration is code: a typo in `applyTo` silently disables a rule, a model name
// written into an agent file bypasses the tier policy, a second visible agent doubles what a human
// has to choose from, and an MCP server named in the wrong agent puts tool schemas into every
// session. None of it shows in a diff review — it shows when an agent behaves differently than the
// documentation says. The rules below turn each of those into a red line with a file name.
//
//   A1  only GitHub Copilot is configured (no other assistant's files)
//   A2  the registry is consistent: every tier points at a known model, every model is enabled
//   A3  every roster agent has a file and every file is a roster agent (no ghosts, no strays)
//   A4  name pattern `<domain>-<subject>`, file name = `name`, description starts with the tier tag
//   A5  `model:` is the model the registry assigns to the agent's tier, and nothing else
//   A6  `tools:` honours the role: required sets present, forbidden sets absent
//   A7  exactly `maxVisible` agents are user-invocable, and they are the ones the roster marks visible
//   A8  MCP: every server in .vscode/mcp.json is named by the owner only; nobody else names any server
//   A9  every `agents:` entry of a delegating agent exists; read-only agents delegate only to read-only
//   A10 instructions have `applyTo` pointing at an existing top-level path; prompts have a description
//   A11 hook files reference existing scripts
//   A12 AGENTS.md mentions every roster agent (the human-readable roster does not drift)
//
// Exit codes: 0 pass · 1 violation · 2 environment error.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FORBIDDEN = [
  'CLAUDE.md',
  'GEMINI.md',
  '.claude',
  '.cursor',
  '.codex',
  '.opencode',
  '.gemini',
  '.ai',
  '.mcp.json',
];

/**
 * @typedef {object} Registry
 * @property {string[]} models
 * @property {Set<string>} enabled
 * @property {Record<string, string>} tiers
 * @property {Record<string, { role: string, tier: string, visible?: boolean }>} roster
 * @property {Record<string, { requires?: string[], forbids?: string[], mcp?: boolean }>} roles
 * @property {Set<string>} toolSets
 * @property {RegExp} namePattern
 * @property {number} maxVisible
 * @property {string} mcpOwner
 */

/**
 * Flat front matter reader: `key: value`, `key: ['a', 'b']`; the `hooks:` block is detected by key
 * presence only. A gate, not an editor — the agent files keep it flat on purpose.
 * @param {string} text
 * @returns {Record<string, string> | null}
 */
export function frontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.slice(3, end).split('\n')) {
    const match = /^([A-Za-z_-]+):(.*)$/u.exec(line);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

/**
 * `['read', 'edit']` → ['read', 'edit']; a bare scalar → [scalar].
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseList(value) {
  if (value === undefined || value === '') return [];
  const inner = /^\[(.*)\]$/u.exec(value.trim());
  const items = inner ? inner[1].split(',') : [value];
  return items.map((item) => item.trim().replace(/^['"]|['"]$/gu, '')).filter((item) => item !== '');
}

/**
 * Server names declared in .vscode/mcp.json (JSONC: comments stripped before parsing).
 * @param {string} repo
 * @returns {string[]}
 */
export function mcpServers(repo) {
  const file = path.join(repo, '.vscode', 'mcp.json');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return Object.keys(JSON.parse(text).servers ?? {});
}

/** @param {string} value */
const unquote = (value) => value.replace(/^['"]|['"]$/gu, '');

/**
 * @param {string} repo
 * @returns {Registry}
 */
function readRegistry(repo) {
  const registry = JSON.parse(readFileSync(path.join(repo, '.github', 'models-registry.json'), 'utf8'));
  const agents = registry.agents ?? {};
  return {
    models: Object.keys(registry.models ?? {}),
    enabled: new Set(registry.policy?.enabled ?? []),
    tiers: Object.fromEntries(Object.entries(registry.tiers ?? {}).filter(([key]) => !key.startsWith('$'))),
    roster: agents.roster ?? {},
    roles: agents.roles ?? {},
    toolSets: new Set(agents.toolSets ?? []),
    namePattern: new RegExp(agents.namePattern ?? '^[a-z0-9-]+$', 'u'),
    maxVisible: agents.maxVisible ?? 1,
    mcpOwner: registry.mcp?.owner ?? '',
  };
}

/** @typedef {(rule: string, message: string) => void} Fail */

/**
 * A1 + A2.
 * @param {string} repo @param {Registry} registry @param {Fail} fail
 */
function checkRepositoryAndRegistry(repo, registry, fail) {
  for (const entry of FORBIDDEN) {
    if (existsSync(path.join(repo, entry)))
      fail('A1', `the repository supports GitHub Copilot only, and ${entry} exists`);
  }
  for (const [tier, model] of Object.entries(registry.tiers)) {
    if (!registry.models.includes(model)) fail('A2', `tier ${tier} points at "${model}", which is not in models`);
    else if (!registry.enabled.has(model))
      fail('A2', `tier ${tier} points at "${model}", which policy.enabled does not list`);
  }
  if (registry.mcpOwner !== '' && !registry.roster[registry.mcpOwner])
    fail('A8', `mcp.owner "${registry.mcpOwner}" is not in the roster`);
}

/**
 * A4 + A5 + A7 for one agent file.
 * @param {string} name @param {Record<string, string>} front @param {Registry} registry @param {Fail} fail
 * @returns {boolean} whether the agent is user-invocable
 */
function checkIdentity(name, front, registry, fail) {
  const where = `.github/agents/${name}.agent.md`;
  const entry = registry.roster[name];
  if (front.name !== name) fail('A4', `${where}: name "${front.name ?? ''}" ≠ file name ${name}`);
  if (!registry.namePattern.test(name)) fail('A4', `${where}: name does not match ${registry.namePattern}`);
  const description = unquote(front.description ?? '');
  if (!description.startsWith(`${entry.tier} ·`))
    fail('A4', `${where}: description must start with "${entry.tier} ·" (the tier tag humans see in the picker)`);
  const expectedModel = registry.tiers[entry.tier];
  const declaredModel = unquote(front.model ?? '');
  if (declaredModel !== expectedModel)
    fail('A5', `${where}: model "${declaredModel}" ≠ tier ${entry.tier} → "${expectedModel}"`);
  const invocable = (front['user-invocable'] ?? 'true') === 'true';
  if (invocable !== Boolean(entry.visible))
    fail('A7', `${where}: user-invocable is ${invocable}, roster says visible: ${Boolean(entry.visible)}`);
  return invocable;
}

/**
 * A6 + A8 for one agent file.
 * @param {string} name @param {Record<string, string>} front @param {Registry} registry @param {string[]} servers @param {Fail} fail
 */
function checkTools(name, front, registry, servers, fail) {
  const where = `.github/agents/${name}.agent.md`;
  const entry = registry.roster[name];
  const role = registry.roles[entry.role];
  if (!role) {
    fail('A6', `${where}: roster role "${entry.role}" is not defined in agents.roles`);
    return;
  }
  const tools = parseList(front.tools);
  for (const required of role.requires ?? []) {
    if (!tools.includes(required)) fail('A6', `${where}: role ${entry.role} requires the tool set "${required}"`);
  }
  for (const forbidden of role.forbids ?? []) {
    if (tools.includes(forbidden)) fail('A6', `${where}: role ${entry.role} forbids the tool set "${forbidden}"`);
  }
  // Anything that is not a built-in set is an MCP reference (`server` or `server/tool`).
  const mcpRefs = tools.filter((tool) => !registry.toolSets.has(tool));
  if (!role.mcp) {
    if (mcpRefs.length > 0)
      fail('A8', `${where}: only ${registry.mcpOwner} may reference MCP tools — found ${mcpRefs.join(', ')}`);
    if (name === registry.mcpOwner) fail('A8', `${where}: is mcp.owner but its role ${entry.role} has mcp: false`);
    return;
  }
  for (const server of servers) {
    if (!tools.includes(server) && !mcpRefs.some((ref) => ref.startsWith(`${server}/`))) {
      fail('A8', `${where}: owns MCP but does not list the server "${server}" from .vscode/mcp.json`);
    }
  }
  for (const ref of mcpRefs) {
    const server = ref.split('/')[0];
    if (!servers.includes(server))
      fail('A8', `${where}: lists "${ref}", but .vscode/mcp.json declares no server "${server}"`);
  }
}

/**
 * A9 — delegation lists.
 * @param {Map<string, Record<string, string>>} fronts @param {Registry} registry @param {Fail} fail
 */
function checkDelegation(fronts, registry, fail) {
  const isReadOnly = (/** @type {string} */ agent) =>
    Boolean(registry.roles[registry.roster[agent]?.role]?.forbids?.includes('edit'));
  for (const [name, front] of fronts) {
    const delegates = parseList(front.agents);
    const where = `.github/agents/${name}.agent.md`;
    if (delegates.length > 0 && !parseList(front.tools).includes('agent')) {
      fail('A9', `${where}: declares agents: but lacks the "agent" tool set — delegation would be decoration`);
    }
    for (const target of delegates) {
      if (!registry.roster[target]) fail('A9', `${where}: delegates to unknown agent "${target}"`);
      else if (isReadOnly(name) && !isReadOnly(target))
        fail('A9', `${where}: a read-only agent delegates to "${target}", which can write`);
    }
  }
}

/**
 * A10 — instructions and prompts.
 * @param {string} repo @param {Fail} fail
 */
function checkInstructionsAndPrompts(repo, fail) {
  const instructionsDir = path.join(repo, '.github', 'instructions');
  if (existsSync(instructionsDir)) {
    for (const file of readdirSync(instructionsDir).filter((entry) => entry.endsWith('.instructions.md'))) {
      const front = frontmatter(readFileSync(path.join(instructionsDir, file), 'utf8'));
      const applyTo = unquote(front?.applyTo ?? '');
      if (applyTo === '') {
        fail('A10', `.github/instructions/${file}: no applyTo`);
        continue;
      }
      for (const pattern of applyTo.split(',').map((part) => part.trim())) {
        for (const head of patternHeads(pattern)) {
          if (!existsSync(path.join(repo, head)))
            fail('A10', `.github/instructions/${file}: applyTo "${pattern}" starts at ${head}, which does not exist`);
        }
      }
    }
  }
  const promptsDir = path.join(repo, '.github', 'prompts');
  if (existsSync(promptsDir)) {
    for (const file of readdirSync(promptsDir).filter((entry) => entry.endsWith('.prompt.md'))) {
      const front = frontmatter(readFileSync(path.join(promptsDir, file), 'utf8'));
      if (!front?.description)
        fail('A10', `.github/prompts/${file}: no description in front matter (VS Code shows it in the / picker)`);
    }
  }
}

/**
 * The first path segments an `applyTo` pattern starts at — `{apps,libs}/**` gives two, a glob
 * starting with `*` or a bare file name none that can be checked.
 * @param {string} pattern
 * @returns {string[]}
 */
export function patternHeads(pattern) {
  const expanded = /^\{([^}]+)\}(.*)$/u.exec(pattern);
  const variants = expanded ? expanded[1].split(',').map((alternative) => `${alternative}${expanded[2]}`) : [pattern];
  return variants
    .map((variant) => variant.split('/')[0].replace(/\*.*/u, ''))
    .filter((head) => head !== '' && head !== '.' && !head.startsWith('*'));
}

/**
 * A11 — hooks, in .github/hooks and inside agent files.
 * @param {string} repo @param {Map<string, Record<string, string>>} fronts @param {Fail} fail
 */
function checkHooks(repo, fronts, fail) {
  const hooksDir = path.join(repo, '.github', 'hooks');
  if (existsSync(hooksDir)) {
    for (const file of readdirSync(hooksDir).filter((entry) => entry.endsWith('.json'))) {
      const config = JSON.parse(readFileSync(path.join(hooksDir, file), 'utf8'));
      for (const entries of Object.values(config.hooks ?? {})) {
        for (const entry of /** @type {any[]} */ (entries)) {
          const script = String(entry.command ?? '').replace(/^node\s+/u, '');
          if (script && !existsSync(path.join(repo, script)))
            fail('A11', `.github/hooks/${file}: script ${script} does not exist`);
        }
      }
    }
  }
  for (const [name, front] of fronts) {
    if (front.hooks === undefined) continue;
    const text = readFileSync(path.join(repo, '.github', 'agents', `${name}.agent.md`), 'utf8');
    for (const match of text.matchAll(/command:\s*node\s+(\S+)/gu)) {
      if (!existsSync(path.join(repo, match[1])))
        fail('A11', `.github/agents/${name}.agent.md: hook script ${match[1]} does not exist`);
    }
  }
}

/**
 * @param {string} repo
 * @returns {{ ok: boolean, code: number, problems: string[], summary: string }}
 */
export function validateAiConfig(repo = REPO) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Fail} */
  const fail = (rule, message) => {
    problems.push(`${rule} · ${message}`);
  };
  if (!existsSync(path.join(repo, '.github', 'models-registry.json'))) {
    return { ok: false, code: 2, problems: ['.github/models-registry.json is missing'], summary: '' };
  }
  const registry = readRegistry(repo);
  const servers = mcpServers(repo);
  checkRepositoryAndRegistry(repo, registry, fail);

  // A3 — files ↔ roster.
  const agentsDir = path.join(repo, '.github', 'agents');
  const files = existsSync(agentsDir) ? readdirSync(agentsDir).filter((file) => file.endsWith('.agent.md')) : [];
  const fileNames = new Set(files.map((file) => file.replace(/\.agent\.md$/u, '')));
  for (const name of Object.keys(registry.roster)) {
    if (!fileNames.has(name)) fail('A3', `roster agent ${name} has no .github/agents/${name}.agent.md`);
  }
  /** @type {Map<string, Record<string, string>>} */
  const fronts = new Map();
  let visible = 0;
  for (const name of fileNames) {
    const front = frontmatter(readFileSync(path.join(agentsDir, `${name}.agent.md`), 'utf8'));
    if (!front) {
      fail('A4', `.github/agents/${name}.agent.md: no front matter`);
      continue;
    }
    fronts.set(name, front);
    if (!registry.roster[name]) {
      fail('A3', `.github/agents/${name}.agent.md is not in the roster of models-registry.json`);
      continue;
    }
    if (checkIdentity(name, front, registry, fail)) visible += 1;
    checkTools(name, front, registry, servers, fail);
  }
  if (visible > registry.maxVisible)
    fail('A7', `${visible} agents are user-invocable, the limit is ${registry.maxVisible}`);
  if (files.length > 0 && visible === 0) fail('A7', 'no agent is user-invocable — a human has nothing to start from');
  checkDelegation(fronts, registry, fail);
  checkInstructionsAndPrompts(repo, fail);
  checkHooks(repo, fronts, fail);

  // A12 — the human-readable roster.
  const agentsMd = path.join(repo, 'AGENTS.md');
  if (existsSync(agentsMd)) {
    const text = readFileSync(agentsMd, 'utf8');
    for (const name of Object.keys(registry.roster)) {
      if (!text.includes(`\`${name}\``))
        fail('A12', `AGENTS.md does not mention \`${name}\` — the roster table drifted`);
    }
  } else {
    fail('A12', 'AGENTS.md is missing');
  }

  const summary = `${files.length} agents (${visible} visible), ${Object.keys(registry.tiers).length} tiers, ${servers.length} MCP server(s) owned by ${registry.mcpOwner || '—'}`;
  return { ok: problems.length === 0, code: problems.length === 0 ? 0 : 1, problems, summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { ok, code, problems, summary } = validateAiConfig();
  if (ok) process.stdout.write(`ok ai:validate · ${summary}\n`);
  else process.stderr.write(`FAIL ai:validate\n${problems.map((p) => `  · ${p}`).join('\n')}\n`);
  process.exitCode = code;
}
