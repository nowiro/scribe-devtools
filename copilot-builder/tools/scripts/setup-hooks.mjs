#!/usr/bin/env node
// setup-hooks.mjs — arms the committed git hooks: `git config core.hooksPath .githooks`.
//
// Native hooks instead of Husky: the hooks are three shell files in `.githooks/`, versioned like
// any other source, with zero dependencies and nothing to install. What Husky did for us was this
// one `git config` line — so this script IS that line, plus the two cases where it must do nothing:
//   - no `.git` directory (an unpacked archive, a vendored copy) — nothing to configure;
//   - `CI` set — runners never commit, and a hook that ran there would only slow the job down.
//
// Wired to `prepare`, which npm does NOT run on `npm install` here (`.npmrc` has ignore-scripts=true),
// so the call is explicit: `npm run prepare`, once per clone. `doctor` reports when it was forgotten.
//
// Exit codes: 0 always when there is nothing to do; 1 only when git itself refuses the config.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO, isMain } from './lib/repo.mjs';

const HOOKS_DIR = path.join(REPO, '.githooks');

/**
 * @param {{ repo?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ code: number, message: string }}
 */
export function setupHooks({ repo = REPO, env = process.env } = {}) {
  if (env.CI) return { code: 0, message: 'skip hooks: CI is set' };
  if (!existsSync(path.join(repo, '.git'))) return { code: 0, message: 'skip hooks: no .git directory here' };
  if (!existsSync(path.join(repo, '.githooks'))) return { code: 1, message: 'FAIL hooks: .githooks/ is missing' };

  // The executable bit is committed (`git update-index --chmod=+x`), but a checkout made with
  // `core.fileMode=false` or an unpacked archive loses it; git silently skips a hook it cannot execute.
  if (process.platform !== 'win32') {
    for (const entry of readdirSync(HOOKS_DIR)) chmodSync(path.join(HOOKS_DIR, entry), 0o755);
  }

  const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) {
    return { code: 1, message: `FAIL hooks: git config core.hooksPath failed — ${result.stderr.trim()}` };
  }
  return { code: 0, message: 'ok hooks: core.hooksPath = .githooks (pre-commit, commit-msg, pre-push)' };
}

if (isMain(import.meta.url)) {
  const { code, message } = setupHooks();
  (code === 0 ? process.stdout : process.stderr).write(`${message}\n`);
  process.exitCode = code;
}
