// payload.mjs — what every hook needs and none should re-implement: the repository root, the stdin
// payload parsed defensively, the entrypoint guard and the two answers a PreToolUse hook can give.
//
// A hook is a process the client starts per event; it must never throw on odd input (blank stdin,
// a payload from a newer client with fields we do not know) and it must decide from the file system
// location of THIS file, not from `process.cwd()` — the client's working directory is a convention,
// the repository root is a fact.
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Absolute repository root (tools/hooks/lib → three levels up). */
export const ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/**
 * The hook payload — an object, or an empty one when the input is blank or malformed.
 * @param {string} raw
 * @returns {Record<string, any>}
 */
export function parsePayload(raw) {
  try {
    const parsed = raw.trim() === '' ? {} : JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The tool name and tool input of a payload, whichever spelling the client uses.
 * @param {Record<string, any>} payload
 * @returns {{ tool: string, input: Record<string, any> }}
 */
export function toolCall(payload) {
  const input = payload.tool_input ?? payload.toolInput ?? {};
  return {
    tool: String(payload.tool_name ?? payload.toolName ?? ''),
    input: input !== null && typeof input === 'object' ? input : {},
  };
}

/** @returns {Promise<string>} everything the client wrote to stdin */
export function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.resume();
  });
}

/**
 * The PreToolUse answer that blocks the call. The session goes on (`continue: true`) — a hook
 * refuses one tool call, it never ends the conversation.
 * @param {string} reason shown to the agent, so it says what to do instead
 * @returns {string} JSON for stdout
 */
export function denyDecision(reason) {
  return JSON.stringify({
    continue: true,
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  });
}

/** The answer that lets the call through untouched. */
export const ALLOW = '{}';

/**
 * Whether the module at `metaUrl` is the script node was started with — the guard that keeps a hook
 * importable by its tests without running.
 * @param {string} metaUrl `import.meta.url` of the caller
 * @returns {boolean}
 */
export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(metaUrl));
}
