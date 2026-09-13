#!/usr/bin/env node
/**
 * handoff.mjs — PreCompact hook: before the client compacts the conversation, save a short resume
 * artefact to tmp/handoff/<stamp>_<session>.md: branch, working tree, newest plan and run-log,
 * open [?] markers. The next session starts from this file instead of re-exploring the repo.
 * Zero tokens at write time; the file is read on demand. Never blocks.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { nowStamp } from '../scripts/stamp.mjs';
import { ROOT, isMain, parsePayload, readStdin } from './lib/payload.mjs';

/**
 * @param {string[]} args
 * @returns {string} trimmed stdout, or an empty string when git is unavailable or fails
 */
function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} dir repository-relative directory
 * @returns {string | null} the most recently modified markdown file in it
 */
function newest(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return null;
  const files = readdirSync(abs)
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({ file, mtime: statSync(join(abs, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? `${dir}/${files[0].file}` : null;
}

/** @returns {string[]} up to 20 `[?]` lines across every local spec */
function openQuestions() {
  const specs = join(ROOT, 'docs', 'specs');
  if (!existsSync(specs)) return [];
  /** @type {string[]} */
  const out = [];
  for (const slug of readdirSync(specs)) {
    const spec = join(specs, slug, 'spec.md');
    if (!existsSync(spec)) continue;
    const lines = readFileSync(spec, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (line.includes('[?]')) out.push(`docs/specs/${slug}/spec.md:${index + 1} ${line.trim()}`);
    });
  }
  return out.slice(0, 20);
}

/**
 * @param {string[]} items
 * @param {string} empty
 * @returns {string}
 */
function bullets(items, empty) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`;
}

if (isMain(import.meta.url)) {
  const payload = parsePayload(await readStdin());
  const session = String(payload.session_id ?? payload.sessionId ?? 'session')
    .replaceAll(/[^\w-]/gu, '')
    .slice(0, 24);
  const stamp = nowStamp();
  const status = git(['status', '--short']).split('\n').filter(Boolean).slice(0, 30);
  const lines = [
    `# Handoff — ${stamp}`,
    '',
    'Written by the PreCompact hook. Read this first when resuming; then open the plan and the run-log it names.',
    '',
    `- branch: \`${git(['branch', '--show-current']) || 'n/a'}\``,
    `- newest plan: \`${newest('docs/plans') ?? 'none'}\``,
    `- newest run-log: \`${newest('docs/runs') ?? 'none'}\``,
    '- definition of done: `npm run verify`',
    '',
    '## Working tree',
    '',
    bullets(
      status.map((entry) => `\`${entry}\``),
      'clean',
    ),
    '',
    '## Open questions',
    '',
    bullets(openQuestions(), 'none'),
    '',
  ];

  const dir = join(ROOT, 'tmp', 'handoff');
  mkdirSync(dir, { recursive: true });
  const rel = `tmp/handoff/${stamp}_${session}.md`;
  writeFileSync(join(ROOT, rel), lines.join('\n'));
  process.stdout.write(JSON.stringify({ systemMessage: `Handoff saved to ${rel} — resume from it after compaction.` }));
}
