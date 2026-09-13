#!/usr/bin/env node
/**
 * guard-commands.mjs — PreToolUse hook: deny destructive shell commands before they run.
 *
 * Reads the hook payload from stdin (JSON), looks for a command string in the tool input, and answers
 * with a permissionDecision. Anything that is not a shell command is allowed through untouched.
 * Exit code 0 always: the decision travels in stdout, not in the exit code.
 */
import process from 'node:process';

/** @type {readonly [RegExp, string][]} */
const DENY = [
  [/\brm\s+(-[a-z]+\s+)*-[a-z]*[rf]/i, 'recursive or force delete'],
  [/\b(rd|rmdir)\s+\/s\b/i, 'rd /s'],
  [/\bdel\s+(\/[a-z]\s+){0,3}\/[qs]\b/i, 'del /q'],
  // --force-with-lease is the safe form and stays allowed; a leading + in the refspec is not.
  [/\bgit\s+push\b.*(--force(?!-with-lease)\b|\s-f\b)/i, 'force push'],
  [/\bgit\s+push\b[^|;&]*\s\+[\w/.-]+/i, 'force push by refspec'],
  [/\bgit\s+reset\s+--hard\b/i, 'hard reset'],
  [/\bgit\s+clean\s+-[a-z]*f/i, 'git clean -f'],
  [/\bgit\s+branch\s+-D\b/i, 'branch force delete'],
  [/\bRemove-Item\b.*-Recurse/i, 'Remove-Item -Recurse'],
  [/\b(DROP|TRUNCATE)\s+(TABLE|DATABASE)\b/i, 'destructive SQL'],
  [/\bmkfs\b|\bdd\s+if=/i, 'disk-level command'],
];

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
  const input = payload.tool_input ?? payload.toolInput ?? {};
  const command = [input.command, input.commandLine, input.cmd, input.text]
    .filter((value) => typeof value === 'string')
    .join('\n');

  const hit = command ? DENY.find(([pattern]) => pattern.test(command)) : undefined;
  if (!hit) {
    process.stdout.write('{}');
    return;
  }
  process.stdout.write(
    JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `guard-commands: ${hit[1]} is not allowed from an agent; run it yourself if intended.`,
      },
    }),
  );
});
