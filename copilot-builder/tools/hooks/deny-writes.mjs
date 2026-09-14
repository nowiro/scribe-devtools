#!/usr/bin/env node
/**
 * deny-writes.mjs — PreToolUse hook of the read-only agents (code-reviewer-anthropic/-b/-c, code-reviewer-ui,
 * doc-reviewer): whatever the agent's `tools:` list says, only tools that READ may run.
 *
 * An allowlist, not a denylist: a list of forbidden verbs let `install_extension`, `memory` (which
 * writes instruction files) or `mkdir` through because nobody had thought of them. Unknown tools are
 * denied with a message that names the list to extend — a reviewer that cannot use a new read tool is
 * a nuisance, a reviewer that can write is a broken guarantee. Exit code 0; the decision is in stdout.
 */
import process from 'node:process';
import { ALLOW, denyDecision, isMain, parsePayload, readStdin, toolCall } from './lib/payload.mjs';

/** Tool names (normalised: lower case, no separators) that only read. Suffix match, so `copilot_readFile` counts. */
export const READ_TOOLS = Object.freeze([
  'readfile',
  'listdir',
  'filesearch',
  'grepsearch',
  'semanticsearch',
  'codebase',
  'search',
  'searchworkspacesymbols',
  'testsearch',
  'findtestfiles',
  'geterrors',
  'problems',
  'getchangedfiles',
  'changes',
  'listcodeusages',
  'usages',
  'getsearchviewresults',
  'getterminaloutput',
  'think',
  'todos',
  'managetodolist',
]);

/** Verbs that mean writing or executing, matched against every part of the name (`edit/createFile`, `runInTerminal`). */
const WRITE_VERBS = new Set([
  'edit',
  'editfiles',
  'write',
  'create',
  'replace',
  'insert',
  'patch',
  'apply',
  'delete',
  'remove',
  'execute',
  'shell',
  'bash',
  'powershell',
  'terminal',
  'run',
  'runcommands',
  'runtasks',
  'notebook',
  'install',
  'configure',
  'memory',
  'mkdir',
  'rename',
  'move',
  'copy',
  'append',
  'save',
  'upsert',
  'store',
  'fetch',
  'web',
  'browser',
  'github',
  'http',
  'url',
]);

/** @param {string} name */
const normalise = (name) => name.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');

/**
 * Why the tool may not run for a read-only agent, or null when it may.
 * @param {string} tool
 * @returns {string | null}
 */
export function decide(tool) {
  if (tool === '') return 'the call names no tool';
  const parts = tool.split(/[/_.\-:]|(?<=[a-z0-9])(?=[A-Z])/u).filter(Boolean);
  if (parts.some((part) => WRITE_VERBS.has(part.toLowerCase()))) return `'${tool}' writes or executes`;
  const normalised = normalise(tool);
  if (READ_TOOLS.some((entry) => normalised === entry || normalised.endsWith(entry))) return null;
  return `'${tool}' is not on the read-only allowlist (READ_TOOLS in tools/hooks/deny-writes.mjs — extend it only for a tool that reads)`;
}

if (isMain(import.meta.url)) {
  const { tool } = toolCall(parsePayload(await readStdin()));
  const reason = decide(tool);
  process.stdout.write(
    reason ? denyDecision(`deny-writes: this agent is read-only; ${reason}. Return findings, not fixes.`) : ALLOW,
  );
}
