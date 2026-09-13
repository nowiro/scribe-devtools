#!/usr/bin/env node
/**
 * format-on-edit.mjs — PostToolUse hook: runs Biome on the file the agent just wrote.
 *
 * Formatting is a rule a machine can enforce, so it does not stand in the always-on context: the
 * sentence "format with Biome" paid on every turn costs more than this script over the lifetime of
 * the repository. Files Biome does not format (Markdown, HTML templates) and vendored trees are
 * skipped. Never blocks, prints nothing on success — a hook that talks on every edit teaches
 * everyone to ignore it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd());
const FORMATTABLE = /\.(?:ts|mts|cts|js|mjs|cjs|json|jsonc|css)$/iu;
const SKIP = [
  /^dist[/\\]/u,
  /^node_modules[/\\]/u,
  /^\.angular[/\\]/u,
  /^\.cache[/\\]/u,
  /^tools[/\\]scribe[/\\]dist[/\\]/u,
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
  const file = input.filePath ?? input.file_path ?? input.path ?? '';
  if (typeof file !== 'string' || file === '') process.exit(0);
  const relative = path.relative(ROOT, path.resolve(ROOT, file));
  if (relative.startsWith('..') || !FORMATTABLE.test(relative) || SKIP.some((pattern) => pattern.test(relative))) {
    process.exit(0);
  }
  if (!existsSync(path.resolve(ROOT, file))) process.exit(0);
  spawnSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'), 'format', '--write', file],
    {
      cwd: ROOT,
      stdio: 'ignore',
    },
  );
  process.exit(0);
});
