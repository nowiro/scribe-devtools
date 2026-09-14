// Tests for the credential loader's two documented invariants, previously unpinned:
// the resolution priority (env beats the user-profile config file, which beats nothing —
// never a silent default token) and the stable E_AUTH_MISSING prefix with its repair path.
//
// The user-profile file is pointed into a temp directory via EXTRACT_CONFIG_PATH, so the
// suite never touches the developer's real ~/.config/extract. The config module caches its
// read per process, which is why every case here writes the file BEFORE the first load in
// its own env sandbox.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultGitLabProject,
  defaultJiraProject,
  E_AUTH_MISSING,
  loadGitLabAuth,
  loadMiroAuth,
  resetUserConfigCacheForTests,
} from './auth.js';

let dir: string;
const saved: Record<string, string | undefined> = {};
const VARS = [
  'EXTRACT_CONFIG_PATH',
  'GITLAB_BASE_URL',
  'GITLAB_TOKEN',
  'MIRO_BASE_URL',
  'MIRO_TOKEN',
  'JIRA_PROJECT',
  'GITLAB_PROJECT',
];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'auth-spec-'));
  for (const name of VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env['EXTRACT_CONFIG_PATH'] = dir;
  resetUserConfigCacheForTests();
});

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  rmSync(dir, { recursive: true, force: true });
});

const writeConfig = (config: unknown): void => {
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config), 'utf8');
};

describe('resolution priority', () => {
  it('the environment variable BEATS the user-profile config file', () => {
    writeConfig({ gitlab: { token: 'from-file' } });
    process.env['GITLAB_TOKEN'] = 'from-env';
    expect(loadGitLabAuth().token).toBe('from-env');
  });

  it('the config file serves the token when the environment is silent', () => {
    writeConfig({ gitlab: { baseUrl: 'https://git.example.com/api/v4', token: 'from-file' } });
    const auth = loadGitLabAuth();
    expect(auth.token).toBe('from-file');
    expect(auth.baseUrl).toBe('https://git.example.com/api/v4');
  });

  it('an optional baseUrl falls back to its documented default', () => {
    process.env['MIRO_TOKEN'] = 't';
    expect(loadMiroAuth().baseUrl).toBe('https://api.miro.com');
  });
});

describe('the missing-secret error', () => {
  it('carries the stable prefix, the env var name AND the config path to write to', () => {
    let message = '';
    try {
      loadMiroAuth();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(E_AUTH_MISSING);
    expect(message).toContain('MIRO_TOKEN');
    expect(message).toContain('config.json');
  });
});

describe('default projects (write pipelines)', () => {
  it('the env variable beats the user-config default', () => {
    writeConfig({ jira: { project: 'FILE' } });
    process.env['JIRA_PROJECT'] = 'ENV';
    expect(defaultJiraProject()).toBe('ENV');
  });

  it('falls back to the config file, and to undefined — never a guessed project', () => {
    writeConfig({ gitlab: { project: 'grupa/aplikacja' } });
    expect(defaultGitLabProject()).toBe('grupa/aplikacja');
    expect(defaultJiraProject()).toBeUndefined();
  });
});
