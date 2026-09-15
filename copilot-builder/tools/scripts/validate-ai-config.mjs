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
//   A13 a role that forbids `edit` AND `execute` carries the deny-writes PreToolUse hook — enforcement, not a request
//   A14 every hook command (agent files and .github/hooks) is `node tools/hooks/<name>.mjs`, nothing else
//   A15 no agent lists a tool set the registry forbids for everyone (`web`: data comes in through scripts)
//   A16 every MCP server starts a pinned local binary (`node node_modules/…`), never `npx` or a moving tag
//   A17 the orchestrator's routing table names every other roster agent (no agent is unreachable)
//   A18 every review seat (registry `review.seats`: agent → promised family) is a roster reviewer whose model IS
//       of that family, and no two seats share a family — two readings by one vendor are one reading
//   A19 the orchestrator's routing table is the one route.mjs renders from routing.config.mjs (npm run route -- --sync)
//   A20 `review.seatsPerReview` (how many seats review-draw draws for one review) is an integer from 2 to the
//       pool size — one reading is no cross-check, and a review cannot draw more seats than exist
//
// Exit codes: 0 pass · 1 violation · 2 environment error.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { FORBIDDEN_PATHS } from './guard-forbidden.mjs';
import { REPO, frontmatter, isMain, readJsonc, unquote } from './lib/repo.mjs';
import { extractRoutingBlock, renderRoutingTable } from './route.mjs';

/** Files of other assistants — the same list guard:forbidden enforces, read once. */
const FORBIDDEN = FORBIDDEN_PATHS.map(([file]) => file).filter(
  (file) => !file.includes('/') && !/^(?:nx|\.nx|\.husky|pnpm|yarn|\.prettier|prettier)/u.test(file),
);

/**
 * @typedef {object} Registry
 * @property {string[]} models
 * @property {Set<string>} enabled
 * @property {Record<string, string>} tiers
 * @property {Record<string, { role: string, tier: string, visible?: boolean }>} roster
 * @property {Record<string, { requires?: string[], forbids?: string[], mcp?: boolean }>} roles
 * @property {Set<string>} toolSets
 * @property {Set<string>} forbiddenToolSets
 * @property {RegExp} namePattern
 * @property {number} maxVisible
 * @property {string} mcpOwner
 * @property {Record<string, string>} families model name → family (vendor), from `models`
 * @property {Record<string, string>} reviewSeats seat agent → the model family it promises (`review.seats`)
 * @property {unknown} seatsPerReview how many seats one review draws from the pool (`review.seatsPerReview`)
 */

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
  return Object.keys(mcpServerConfigs(repo));
}

/**
 * The server entries of .vscode/mcp.json (JSONC: comments stripped before parsing).
 * @param {string} repo
 * @returns {Record<string, { type?: string, command?: string, args?: string[] }>}
 */
export function mcpServerConfigs(repo) {
  const file = path.join(repo, '.vscode', 'mcp.json');
  if (!existsSync(file)) return {};
  return readJsonc(file).servers ?? {};
}

/**
 * A16 — a server is a pinned local binary: `node node_modules/<pkg>/…` over stdio. `npx`, a package
 * name with a tag or anything downloaded at start would run code the lockfile never saw.
 * @param {string} repo @param {Fail} fail
 */
function checkMcpConfig(repo, fail) {
  for (const [name, server] of Object.entries(mcpServerConfigs(repo))) {
    const where = `.vscode/mcp.json → ${name}`;
    if ((server.type ?? 'stdio') !== 'stdio')
      fail('A16', `${where}: type must be stdio (a remote server is a network dependency of every session)`);
    if (server.command !== 'node')
      fail('A16', `${where}: command must be "node" (got "${server.command}") — no npx, no global binaries`);
    const entry = server.args?.[0] ?? '';
    if (!/^node_modules\/\S+\.(?:m?js|cjs)$/u.test(entry))
      fail('A16', `${where}: the first argument must be a script under node_modules/ (got "${entry}")`);
    if ((server.args ?? []).some((arg) => /@(?:latest|next)\b/u.test(arg)))
      fail('A16', `${where}: a moving tag (@latest/@next) in the arguments`);
  }
}

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
    forbiddenToolSets: new Set(agents.forbiddenToolSets ?? []),
    namePattern: new RegExp(agents.namePattern ?? '^[a-z0-9-]+$', 'u'),
    maxVisible: agents.maxVisible ?? 1,
    mcpOwner: registry.mcp?.owner ?? '',
    families: Object.fromEntries(
      Object.entries(registry.models ?? {}).map(([name, model]) => [name, String(model?.family ?? '')]),
    ),
    reviewSeats: registry.review?.seats ?? {},
    seatsPerReview: registry.review?.seatsPerReview,
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
  for (const banned of registry.forbiddenToolSets) {
    if (tools.includes(banned))
      fail(
        'A15',
        `${where}: the tool set "${banned}" is forbidden for every agent (registry agents.forbiddenToolSets)`,
      );
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

/** The only shape a hook command may have: this repository's own script, run by node. */
const HOOK_COMMAND = /^node tools\/hooks\/[a-z0-9-]+\.mjs$/u;

/**
 * A11 + A14 for one command: the shape and the script's existence.
 * @param {string} repo @param {string} where @param {string} command @param {Fail} fail
 */
function checkHookCommand(repo, where, command, fail) {
  if (!HOOK_COMMAND.test(command)) {
    fail('A14', `${where}: hook command "${command}" is not \`node tools/hooks/<name>.mjs\``);
    return;
  }
  const script = command.replace(/^node\s+/u, '');
  if (!existsSync(path.join(repo, script))) fail('A11', `${where}: hook script ${script} does not exist`);
}

/**
 * The raw front matter of an agent file (between the `---` fences), for the checks the flat reader
 * cannot express — the hooks block is nested.
 * @param {string} text
 * @returns {string}
 */
function frontMatterText(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text);
  return match ? match[1] : '';
}

/**
 * A11 + A13 + A14 — hooks in .github/hooks and inside agent files.
 * @param {string} repo @param {Map<string, Record<string, string>>} fronts @param {Registry} registry @param {Fail} fail
 */
function checkHooks(repo, fronts, registry, fail) {
  const hooksDir = path.join(repo, '.github', 'hooks');
  if (existsSync(hooksDir)) {
    for (const file of readdirSync(hooksDir).filter((entry) => entry.endsWith('.json'))) {
      const config = JSON.parse(readFileSync(path.join(hooksDir, file), 'utf8'));
      for (const entries of Object.values(config.hooks ?? {})) {
        for (const entry of /** @type {any[]} */ (entries))
          checkHookCommand(repo, `.github/hooks/${file}`, String(entry.command ?? ''), fail);
      }
    }
  }
  for (const [name, front] of fronts) {
    const where = `.github/agents/${name}.agent.md`;
    const text = frontMatterText(readFileSync(path.join(repo, '.github', 'agents', `${name}.agent.md`), 'utf8'));
    for (const match of text.matchAll(/^\s*command:\s*(.+?)\s*$/gmu)) checkHookCommand(repo, where, match[1], fail);
    const forbids = registry.roles[registry.roster[name]?.role]?.forbids ?? [];
    // Pure readers only: the integration role forbids edits too, but its MCP tools are "execute" by
    // name and would trip the allowlist — its guard is A8 (one owner) plus the server's own --read-only.
    const readOnly = forbids.includes('edit') && forbids.includes('execute');
    const denies = /PreToolUse:[\s\S]*?command:\s*node tools\/hooks\/deny-writes\.mjs/u.test(text);
    if (readOnly && !denies)
      fail(
        'A13',
        `${where}: a read-only role must carry the PreToolUse hook \`node tools/hooks/deny-writes.mjs\` — the tools list is a request, the hook is the enforcement`,
      );
    if (!readOnly && denies)
      fail('A13', `${where}: carries deny-writes but its role may edit — one of the two is wrong`);
    if (front.hooks === undefined && denies)
      fail('A13', `${where}: hooks block not detected by the front matter reader`);
  }
}

/**
 * A17 + A19 — the orchestrator's routing table. A17: every other roster agent is named in some row of
 * the file, so no agent is unreachable. A19: the table between the ROUTING markers is exactly what
 * `route.mjs` renders from routing.config.mjs and the registry's review seats — the prose the
 * orchestrator reads and the answer `npm run route` gives can never disagree.
 * @param {string} repo @param {Registry} registry @param {Fail} fail
 */
function checkRouting(repo, registry, fail) {
  const orchestrators = Object.entries(registry.roster)
    .filter(([, entry]) => entry.role === 'orchestrator')
    .map(([name]) => name);
  for (const orchestrator of orchestrators) {
    const file = path.join(repo, '.github', 'agents', `${orchestrator}.agent.md`);
    if (!existsSync(file)) continue;
    const where = `.github/agents/${orchestrator}.agent.md`;
    const text = readFileSync(file, 'utf8');
    const rows = text.split('\n').filter((line) => line.trim().startsWith('|'));
    const named = new Set(rows.flatMap((row) => [...row.matchAll(/`([a-z0-9-]+)`/gu)].map((match) => match[1])));
    for (const name of Object.keys(registry.roster)) {
      if (name !== orchestrator && !named.has(name))
        fail('A17', `${where}: routing table has no row naming \`${name}\``);
    }
    const block = extractRoutingBlock(text);
    if (block === null) {
      fail(
        'A19',
        `${where}: no ROUTING:START / ROUTING:END markers — the routing table is generated (npm run route -- --sync)`,
      );
    } else if (block !== renderRoutingTable(Object.entries(registry.reviewSeats))) {
      fail('A19', `${where}: routing table is stale vs tools/scripts/routing.config.mjs — run npm run route -- --sync`);
    }
  }
}

/**
 * A18 — the review seats. Several readings are worth several main seats only when they are independent,
 * and independence is a property of the model FAMILIES, not of the prompts: the same brief read by one
 * vendor twice shares that vendor's blind spots. Each seat is NAMED after the family it promises
 * (`review.seats`: agent → family), so the gate checks the promise — the model behind the seat's tier is
 * of that family — and that no two seats end up on one family.
 * @param {Registry} registry @param {Fail} fail
 */
function checkReviewSeats(registry, fail) {
  const seats = Object.entries(registry.reviewSeats);
  if (seats.length === 0) {
    fail('A18', 'the registry declares no review.seats — code review has no independent seats');
    return;
  }
  /** @type {Map<string, string[]>} actual family → seats on it */
  const byFamily = new Map();
  for (const [seat, promised] of seats) {
    const entry = registry.roster[seat];
    if (!entry) {
      fail('A18', `review.seats names "${seat}", which is not in the roster`);
      continue;
    }
    if (entry.role !== 'reviewer') fail('A18', `review seat ${seat} has role ${entry.role}, not reviewer`);
    const model = registry.tiers[entry.tier] ?? '';
    const family = registry.families[model] ?? '';
    if (family === '') {
      fail('A18', `review seat ${seat}: tier ${entry.tier} → "${model}" has no family in models`);
      continue;
    }
    if (family !== promised)
      fail('A18', `review seat ${seat} promises ${promised} but tier ${entry.tier} → "${model}" is ${family}`);
    byFamily.set(family, [...(byFamily.get(family) ?? []), seat]);
  }
  for (const [family, seatsOnIt] of byFamily) {
    if (seatsOnIt.length > 1)
      fail(
        'A18',
        `review seats ${seatsOnIt.join(' and ')} both run on the ${family} family — two readings by one vendor are one reading`,
      );
  }
}

/**
 * A20 — how many seats one review uses. review-draw takes `review.seatsPerReview` seats of the pool at
 * random: below two there is nothing to cross-check, above the pool size there is nothing to draw, and a
 * missing or fractional number would leave the draw to the orchestrator's imagination.
 * @param {Registry} registry @param {Fail} fail
 */
function checkSeatsPerReview(registry, fail) {
  const pool = Object.keys(registry.reviewSeats).length;
  if (pool === 0) return; // A18 has already named the empty pool
  const count = registry.seatsPerReview;
  const range = `an integer from 2 to ${pool} (the size of review.seats)`;
  if (count === undefined) {
    fail('A20', `review.seatsPerReview is missing — ${range}; equal to ${pool} means every seat reads every review`);
    return;
  }
  if (typeof count !== 'number' || !Number.isInteger(count)) {
    fail('A20', `review.seatsPerReview is ${JSON.stringify(count)}, not ${range}`);
    return;
  }
  if (count < 2) fail('A20', `review.seatsPerReview is ${count} — one reading is no cross-check; ${range}`);
  if (count > pool) fail('A20', `review.seatsPerReview is ${count}, but the pool has ${pool} seats — ${range}`);
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
  checkHooks(repo, fronts, registry, fail);
  checkMcpConfig(repo, fail);
  checkRouting(repo, registry, fail);
  checkReviewSeats(registry, fail);
  checkSeatsPerReview(registry, fail);

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

  const summary = `${files.length} agents (${visible} visible), ${Object.keys(registry.tiers).length} tiers, ${servers.length} MCP server(s) owned by ${registry.mcpOwner || '—'}, ${Object.keys(registry.reviewSeats).length} review seats (${String(registry.seatsPerReview)} per review)`;
  return { ok: problems.length === 0, code: problems.length === 0 ? 0 : 1, problems, summary };
}

if (isMain(import.meta.url)) {
  const { ok, code, problems, summary } = validateAiConfig();
  if (ok) process.stdout.write(`ok ai:validate · ${summary}\n`);
  else process.stderr.write(`FAIL ai:validate\n${problems.map((p) => `  · ${p}`).join('\n')}\n`);
  process.exitCode = code;
}
