#!/usr/bin/env node
/**
 * deny-writes.mjs — PreToolUse hook scoped to read-only agents (code-reviewer, code-reviewer-ui,
 * doc-reviewer): deny any tool that edits files or runs commands, whatever the agent's `tools:` list
 * says. Belt and braces for the read-only guarantee: the tools list is a request, this hook is an
 * enforcement. Exit code 0; the decision travels in stdout.
 */
import process from 'node:process';

// Matched against the tool name split on every boundary a client uses: separators (`edit/createFile`,
// `run_in_terminal`) and camelCase humps (`createFile`, `runInTerminal`, `multiReplaceString`).
const WRITE_VERBS =
  /^(?:edit|editfiles|write|create|replace|insert|patch|apply|delete|remove|execute|shell|bash|powershell|terminal|run|runcommands|runtasks|notebook)$/i;
const isWriteTool = (name) =>
  String(name)
    .split(/[/_.-]|(?<=[a-z0-9])(?=[A-Z])/)
    .some((part) => WRITE_VERBS.test(part));

/**
 * The hook payload from stdin — an object, or an empty one when the input is blank or malformed.
 * @param {string} raw
 * @returns {Record<string, any>}
 */
function parsePayload(raw) {
  try {
    const parsed = raw.trim() === '' ? {} : JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  const payload = parsePayload(raw);
  const tool = String(payload.tool_name ?? payload.toolName ?? '');
  if (!isWriteTool(tool)) {
    process.stdout.write('{}');
    return;
  }
  process.stdout.write(
    JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `deny-writes: this agent is read-only; '${tool}' is not allowed. Return findings, not fixes.`,
      },
    }),
  );
});
