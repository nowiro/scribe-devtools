#!/usr/bin/env node
// doctor.mjs — environment diagnostics (0 credits, NOT part of `npm run verify`).
//
// Answers "why does it not work on my machine" before anyone opens an issue: the Node major, whether
// the hooks are armed, whether the Biome binary for this platform is installed, whether a system
// Chrome/Edge exists for browser-inspector, whether Playwright browsers were installed for e2e, and
// whether the ALM credentials file exists. Warnings never fail the run; only a wrong toolchain does.
//
// Exit codes: 0 (possibly with warnings) · 1 hard toolchain error.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from './lib/repo.mjs';

/** @type {string[]} */
const warnings = [];
/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const oks = [];

const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const required = /(\d+)/u.exec(String(pkg.engines?.node ?? ''))?.[1];
const major = Number(process.versions.node.split('.')[0]);
if (required && major < Number(required)) errors.push(`node ${process.version} — engines.node is ${pkg.engines.node}`);
else oks.push(`node ${process.version} (engines: ${pkg.engines?.node ?? 'n/a'})`);

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string | null} trimmed stdout, or null when the command could not run or failed
 */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32' });
  return result.status === 0 ? result.stdout.trim() : null;
}

const hooksPath = run('git', ['config', 'core.hooksPath']);
if (existsSync(path.join(REPO, '.git'))) {
  if (hooksPath === '.githooks') oks.push('git hooks armed (core.hooksPath = .githooks)');
  else warnings.push('git hooks NOT armed — run `npm run prepare` once (ignore-scripts skips it on install)');
}

if (!existsSync(path.join(REPO, 'node_modules'))) {
  errors.push('node_modules missing — run `npm ci`');
} else {
  const biome = spawnSync(
    process.execPath,
    [path.join(REPO, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'), '--version'],
    {
      encoding: 'utf8',
    },
  );
  if (biome.status === 0) oks.push(`biome ${biome.stdout.trim().replace(/^Version:\s*/u, '')}`);
  else warnings.push('biome binary for this platform is missing — reinstall (`npm ci`)');
}

/** Where the system browsers live per platform — browser-inspector uses them, never a download. */
const BROWSERS = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: ['/Applications/Google Chrome.app', '/Applications/Microsoft Edge.app'],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
};
const candidates = BROWSERS[/** @type {keyof typeof BROWSERS} */ (process.platform)] ?? [];
const browser = process.env.BROWSER_INSPECTOR_BROWSER_PATH ?? candidates.find((candidate) => existsSync(candidate));
if (browser) oks.push(`system browser for browser-inspector: ${browser}`);
else warnings.push('no system Chrome/Edge found — browser-inspector needs one (or BROWSER_INSPECTOR_BROWSER_PATH)');

/** Playwright's default browser cache per platform (what `playwright install` writes to). */
function defaultPlaywrightCache() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'ms-playwright');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

/**
 * The ALM credentials file, resolved exactly like the vendored ALM tool does it:
 * EXTRACT_CONFIG_PATH (a directory) › XDG_CONFIG_HOME › ~/.config/<EXTRACT_CONFIG_DIR ?? extract>/config.json.
 */
function almConfigPath() {
  const override = process.env.EXTRACT_CONFIG_PATH?.trim();
  if (override) return path.resolve(override, 'config.json');
  const slug = process.env.EXTRACT_CONFIG_DIR?.trim() || 'extract';
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.resolve(xdg, slug, 'config.json');
  return path.join(os.homedir(), '.config', slug, 'config.json');
}

const playwrightCache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? defaultPlaywrightCache();
if (existsSync(playwrightCache)) oks.push(`playwright browsers: ${playwrightCache}`);
else
  warnings.push(
    'Playwright browsers not installed — `node node_modules/@playwright/test/cli.js install chromium` before `npm run e2e`',
  );

const almConfig = almConfigPath();
if (existsSync(almConfig)) oks.push(`ALM credentials file present: ${almConfig}`);
else
  warnings.push(
    `no ALM credentials file (${almConfig}) — alm:read works only with JIRA_*/GITLAB_* environment variables`,
  );

for (const line of oks) process.stdout.write(`ok   ${line}\n`);
for (const line of warnings) process.stdout.write(`warn ${line}\n`);
for (const line of errors) process.stderr.write(`FAIL ${line}\n`);
let summary = 'all green';
if (errors.length > 0) summary = 'toolchain error';
else if (warnings.length > 0) summary = `${warnings.length} warning(s)`;
process.stdout.write(`doctor: ${summary}\n`);
process.exitCode = errors.length > 0 ? 1 : 0;
