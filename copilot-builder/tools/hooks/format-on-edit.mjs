#!/usr/bin/env node
/**
 * format-on-edit.mjs — PostToolUse hook: runs oxfmt on the file an EDIT tool just wrote.
 *
 * Formatting is a rule a machine enforces, so it does not stand in the always-on context. Only the
 * edit tools trigger it — a hook that formatted on `read_file` rewrote files a reviewer was merely
 * looking at, and a "read-only" session must leave the working tree as it found it. Paths are
 * resolved against the repository root and passed to oxfmt absolute, so a file named `--check.js`
 * cannot become an option. Never blocks, prints nothing on success.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ROOT, isMain, parsePayload, readStdin, toolCall } from './lib/payload.mjs';

/** Tool names (normalised) that write a file the agent edited. */
export const EDIT_TOOLS = Object.freeze([
  'createfile',
  'editfile',
  'editfiles',
  'replacestringinfile',
  'multireplacestringinfile',
  'inserteditintofile',
  'applypatch',
]);
/** What .oxfmtrc.jsonc formats — Markdown is excluded there by choice, so it is not here either. */
const FORMATTABLE = /\.(?:ts|mts|cts|js|mjs|cjs|json|jsonc|css|html|ya?ml)$/iu;
/** Build output, caches and the vendored dist are not the agent's edits. */
const SKIP = [/^dist\//u, /^node_modules\//u, /^\.angular\//u, /^\.cache\//u, /^tools\/alm\/dist\//u];

/**
 * The absolute file oxfmt should format after this tool call, or null when nothing should happen.
 * @param {string} tool
 * @param {unknown} file the path the tool reported
 * @param {string} [root]
 * @returns {string | null}
 */
export function formatTarget(tool, file, root = ROOT) {
  const normalised = tool.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  if (!EDIT_TOOLS.some((entry) => normalised === entry || normalised.endsWith(entry))) return null;
  if (typeof file !== 'string' || file === '') return null;
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!FORMATTABLE.test(relative) || SKIP.some((pattern) => pattern.test(relative))) return null;
  return absolute;
}

if (isMain(import.meta.url)) {
  const { tool, input } = toolCall(parsePayload(await readStdin()));
  const target = formatTarget(tool, input.filePath ?? input.file_path ?? input.path ?? '');
  if (target && existsSync(target)) {
    spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'oxfmt', 'bin', 'oxfmt'), target], {
      cwd: ROOT,
      stdio: 'ignore',
    });
  }
}
