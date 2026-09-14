#!/usr/bin/env node
/**
 * guard-commands.mjs — PreToolUse hook: deny destructive shell commands before they run.
 *
 * The rules run over PARSED command lines, not over the raw text: the line is split into segments
 * (`&&`, `;`, `|`), each segment into argv, wrappers are peeled (`sudo`, `env X=1`, `sh -c "…"`,
 * `cmd /c …`, `powershell -Command …`) and every rule looks at ONE program and ITS arguments. That is
 * what lets `rm --recursive --force`, `rm x -rf`, `git push -fu`, `git -c core.hooksPath=/dev/null …`
 * and `cmd /c "rd /s /q x"` be seen for what they are, while `echo "git push --force" > notes.md` or
 * `git commit -m "rm -rf"` are not.
 *
 * A safety net for an agent with a terminal, not a sandbox: variables, encodings and interpreters can
 * still hide a command. The cheap cases are rules below (encoded PowerShell, downloads piped into a
 * shell, `eval`, interpreter one-liners that delete recursively); the rest is the approval prompt of
 * the client and the human behind it. Exit code 0 always: the decision travels in stdout.
 */
import process from 'node:process';
import { ALLOW, denyDecision, isMain, parsePayload, readStdin, toolCall } from './lib/payload.mjs';

/** Keys of a tool input that carry a command line, at any depth. Free text (`explanation`) is not one. */
const COMMAND_KEYS = /^(?:command|commandline|cmd|commands|text|script|args|argv|task)$/iu;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const INTERPRETERS = new Set([...SHELLS, 'node', 'python', 'python3', 'perl', 'ruby', 'pwsh', 'powershell', 'cmd']);
const POWERSHELLS = new Set(['pwsh', 'powershell']);
const PASSTHROUGH = new Set(['sudo', 'doas', 'command', 'exec', 'nohup', 'time', 'nice', 'env', 'busybox', 'xargs']);
/**
 * PowerShell accepts any unambiguous prefix of a parameter: `-r`, `-rec`, `-Recurse`, `-fo`, `-Force`
 * (`-f` alone is ambiguous with -Filter and stays allowed).
 * @param {string} arg
 */
const psRecurseOrForce = (arg) => {
  const lower = arg.toLowerCase();
  return (
    lower.startsWith('-') &&
    (('-recurse'.startsWith(lower) && lower.length >= 2) || ('-force'.startsWith(lower) && lower.length >= 3))
  );
};
/** A short option cluster containing the given letter: `-rf`, `-fr`, `-fu`, never a `--long` option. */
const cluster = (/** @type {string} */ letter) => new RegExp(`^-[^-]*${letter}`, 'u');

/**
 * Every command line carried by a tool input: `command`, `commandLine`, `args` (an array is one
 * line), nested `task.command` — whatever the client nests, whatever it calls it.
 * @param {unknown} input
 * @returns {string[]}
 */
export function collectCommands(input) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {unknown} */ value, /** @type {boolean} */ inCommand) => {
    if (typeof value === 'string') {
      if (inCommand && value.trim() !== '') out.push(value);
    } else if (Array.isArray(value)) {
      if (inCommand && value.every((item) => typeof item === 'string')) out.push(value.join(' '));
      else for (const item of value) walk(item, inCommand);
    } else if (value !== null && typeof value === 'object') {
      // An object is judged key by key: `task.command` is a command, `task.label` next to it is not.
      for (const [key, child] of Object.entries(value)) walk(child, COMMAND_KEYS.test(key));
    }
  };
  walk(input, false);
  return out;
}

/**
 * Line continuations joined, empty quote pairs (`--fo""rce`) removed, newlines turned into separators.
 * @param {string} line
 * @returns {string}
 */
export function normalize(line) {
  return line
    .replaceAll(/\\\r?\n/gu, ' ')
    .replaceAll(/(["'])\1/gu, '')
    .replaceAll(/\r?\n/gu, ' ; ');
}

/** @param {string} line @returns {string[]} the pipeline/list segments, in order */
export function segments(line) {
  return line
    .split(/\s*(?:&&|\|\||;|\|)\s*/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}

/** @param {string} segment @returns {string[]} whitespace-split argv with quotes stripped */
export function tokenize(segment) {
  return segment
    .split(/\s+/u)
    .map((token) => token.replaceAll(/["']/gu, ''))
    .filter((token) => token !== '');
}

/** @param {string} token @returns {string} program name: no path, no `.exe`, lower case */
const programName = (token) =>
  token
    .split(/[/\\]/u)
    .pop()
    ?.toLowerCase()
    .replace(/\.exe$/u, '') ?? '';

/**
 * Peel wrappers until the real program shows: environment assignments, `sudo`/`env`/`nohup` and
 * their flags, `sh -c`, `cmd /c`, `powershell -Command`.
 * @param {string[]} argv
 * @returns {{ program: string, args: string[], encoded: boolean }} encoded: PowerShell -EncodedCommand seen
 */
export function unwrap(argv) {
  let rest = [...argv];
  let encoded = false;
  for (let guard = 0; guard < 8 && rest.length > 0; guard += 1) {
    const program = programName(rest[0]);
    if (/^[A-Za-z_]\w*=/u.test(rest[0])) {
      rest = rest.slice(1);
    } else if (PASSTHROUGH.has(program)) {
      rest = rest.slice(1);
      while (rest.length > 0 && rest[0].startsWith('-')) rest = rest.slice(1);
    } else if (SHELLS.has(program) && /^-[a-z]*c[a-z]*$/u.test(rest[1] ?? '')) {
      rest = rest.slice(2);
    } else if (POWERSHELLS.has(program)) {
      const flagAt = rest.findIndex((token, i) => i > 0 && /^-(?:c|command|enc|encodedcommand|e)$/iu.test(token));
      if (flagAt === -1) break;
      if (/^-e(?:nc|ncodedcommand)?$/iu.test(rest[flagAt])) encoded = true;
      rest = rest.slice(flagAt + 1);
    } else if (program === 'cmd' && /^\/[ck]$/iu.test(rest[1] ?? '')) {
      rest = rest.slice(2);
    } else {
      break;
    }
  }
  return { program: programName(rest[0] ?? ''), args: rest.slice(1), encoded };
}

/**
 * `git` with its global options peeled: `-c key=value` (a hooksPath override is a bypass), `-C dir`,
 * `--git-dir=…` and friends.
 * @param {string[]} args
 * @returns {{ sub: string, rest: string[], reason: string | null }}
 */
function gitCommand(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-c' || args[i] === '-C') {
      if (args[i] === '-c' && /^core\.hookspath(?:=|$)/iu.test(args[i + 1] ?? '')) {
        return { sub: '', rest: [], reason: 'disabling git hooks (core.hooksPath)' };
      }
      i += 2;
    } else {
      i += 1;
    }
  }
  return { sub: args[i] ?? '', rest: args.slice(i + 1), reason: null };
}

/** A short option cluster (`-fu`) containing the letter — never a `--long` option. */
const shortWith = (/** @type {string} */ letter, /** @type {string[]} */ rest) =>
  rest.some((token) => cluster(letter).test(token) && !token.startsWith('--'));

/** @typedef {(rest: string[]) => string | null} GitRule */

/** @type {[string, GitRule][]} per-subcommand rules over the arguments after it */
const GIT_RULE_ENTRIES = [
  [
    'push',
    (rest) => {
      if (
        rest.includes('--mirror') ||
        rest.includes('--delete') ||
        rest.includes('-d') ||
        rest.some((t) => /^:[^:]/u.test(t))
      )
        return 'deleting remote branches';
      if (rest.includes('--force') || rest.some((t) => t.startsWith('--force=')) || shortWith('f', rest))
        return 'force push';
      return rest.some((t) => t.startsWith('+')) ? 'force push by refspec' : null;
    },
  ],
  ['reset', (rest) => (rest.includes('--hard') ? 'hard reset' : null)],
  ['clean', (rest) => (rest.includes('--force') || shortWith('f', rest) ? 'git clean -f' : null)],
  [
    'branch',
    (rest) => {
      if (rest.includes('-D') || shortWith('D', rest)) return 'branch force delete';
      return rest.includes('--delete') && (rest.includes('--force') || rest.includes('-f'))
        ? 'branch force delete'
        : null;
    },
  ],
  [
    'checkout',
    (rest) =>
      ['--', '.', '-f', '--force'].some((t) => rest.includes(t)) ? 'discarding working tree changes (checkout)' : null,
  ],
  [
    'restore',
    (rest) => {
      const staged = rest.includes('--staged') || rest.includes('-S');
      const worktree = rest.includes('--worktree') || rest.includes('-W');
      return !staged || worktree ? 'discarding working tree changes (restore)' : null;
    },
  ],
  ['stash', (rest) => (rest[0] === 'drop' || rest[0] === 'clear' ? 'dropping stashes' : null)],
  [
    'config',
    (rest) => (rest.some((t) => /^core\.hookspath$/iu.test(t)) ? 'disabling git hooks (core.hooksPath)' : null),
  ],
  ['remote', (rest) => (['set-url', 'remove', 'rm'].includes(rest[0] ?? '') ? 'rewiring remotes' : null)],
  ['filter-branch', () => 'history rewrite'],
  ['filter-repo', () => 'history rewrite'],
  ['reflog', (rest) => (rest[0] === 'expire' || rest[0] === 'delete' ? 'expiring the reflog' : null)],
  ['gc', (rest) => (rest.some((t) => t.startsWith('--prune')) ? 'pruning unreachable objects' : null)],
  ['update-ref', (rest) => (rest.includes('-d') ? 'deleting refs' : null)],
];
const GIT_RULES = new Map(GIT_RULE_ENTRIES);

/**
 * @param {string[]} args everything after `git`
 * @returns {string | null}
 */
export function gitReason(args) {
  const { sub, rest, reason } = gitCommand(args);
  if (reason) return reason;
  if (rest.includes('--no-verify') || (sub === 'commit' && rest.includes('-n')))
    return 'bypassing git hooks (--no-verify)';
  return GIT_RULES.get(sub)?.(rest) ?? null;
}

/** @typedef {(program: string, args: string[], segment: string) => string | null} Rule */

/** @type {readonly Rule[]} */
const RULES = [
  (program, args) => {
    if (program !== 'rm') return null;
    const unix = args.some(
      (a) => (cluster('[rRf]').test(a) && !a.startsWith('--')) || /^--(?:recursive|force|no-preserve-root)$/iu.test(a),
    );
    return unix || args.some((a) => psRecurseOrForce(a)) ? 'recursive or force delete' : null;
  },
  (program, args) =>
    (program === 'rd' || program === 'rmdir') && args.some((a) => /^\/s$/iu.test(a)) ? 'rd /s' : null,
  (program, args) =>
    (program === 'del' || program === 'erase') && args.some((a) => /^\/[sqf]$/iu.test(a)) ? 'del /s, /q or /f' : null,
  (program, args) =>
    (program === 'remove-item' || program === 'ri') && args.some((a) => psRecurseOrForce(a))
      ? 'Remove-Item -Recurse/-Force'
      : null,
  (program, args) =>
    program === 'find' && (args.includes('-delete') || (args.includes('-exec') && args.includes('rm')))
      ? 'find -delete'
      : null,
  (program, args) => (program === 'git' ? gitReason(args) : null),
  (program, args, segment) =>
    program.startsWith('mkfs') ||
    ['wipefs', 'shred', 'fdisk', 'parted'].includes(program) ||
    (program === 'dd' && args.some((a) => /^(?:if|of)=/u.test(a))) ||
    /(?:^|\s)>\s*\/dev\/(?:sd|nvme|hd|disk|mmcblk)/u.test(segment)
      ? 'disk-level command'
      : null,
  (_program, _args, segment) =>
    /\b(?:drop|truncate)\s+(?:table|database|schema)\b/iu.test(segment) ? 'destructive SQL' : null,
  (program) => (program === 'eval' ? 'eval of a constructed command' : null),
  (program, args) => {
    if (program === 'npx' || program === 'bunx')
      return 'unpinned package execution (npx) — run what node_modules already has';
    if ((program === 'pnpm' || program === 'yarn') && args[0] === 'dlx') return 'unpinned package execution (dlx)';
    if (program !== 'npm') return null;
    if (args[0] === 'exec') return 'unpinned package execution (npm exec)';
    if (args[0] === 'publish') return 'npm publish from an agent';
    if (/^(?:i|install|add)$/u.test(args[0] ?? '') && (args.includes('-g') || args.includes('--global')))
      return 'global npm install';
    return null;
  },
  (program, args) => {
    const yes = args.includes('--yes') || args.includes('-y');
    if (program === 'npm' && args[0] === 'run' && /^alm:(?:create|update)/u.test(args[1] ?? '') && yes)
      return 'ALM write with --yes — only a human runs that';
    if (program === 'node' && args.some((a) => /alm[/\\]scripts[/\\]write\.mjs$/u.test(a)) && yes)
      return 'ALM write with --yes — only a human runs that';
    return null;
  },
  (_program, _args, segment) =>
    (/\brmSync\s*\(/u.test(segment) && /recursive/u.test(segment)) ||
    /\brimraf\b/u.test(segment) ||
    /\brmtree\s*\(/u.test(segment)
      ? 'recursive delete through an interpreter'
      : null,
];

/**
 * Why one command line must not run, or null when it may.
 * @param {string} line
 * @returns {string | null}
 */
export function inspect(line) {
  const parts = segments(normalize(line));
  let previous = '';
  for (const segment of parts) {
    const { program, args, encoded } = unwrap(tokenize(segment));
    if (encoded) return 'an encoded PowerShell command';
    if (INTERPRETERS.has(program) && (previous === 'curl' || previous === 'wget' || previous === 'base64')) {
      return 'piping a download or a decoded blob into an interpreter';
    }
    for (const rule of RULES) {
      const reason = rule(program, args, segment);
      if (reason) return reason;
    }
    previous = program;
  }
  return null;
}

/**
 * The decision for a whole tool input: the first reason found in any command line it carries.
 * @param {unknown} input
 * @returns {string | null}
 */
export function decide(input) {
  for (const line of collectCommands(input)) {
    const reason = inspect(line);
    if (reason) return reason;
  }
  return null;
}

if (isMain(import.meta.url)) {
  const { input } = toolCall(parsePayload(await readStdin()));
  const reason = decide(input);
  process.stdout.write(
    reason
      ? denyDecision(`guard-commands: ${reason} is not allowed from an agent; run it yourself if intended.`)
      : ALLOW,
  );
}
