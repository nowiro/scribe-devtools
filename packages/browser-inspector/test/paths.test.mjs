// Keeper identity and placement (DESIGN.md §2.5): the hash moves with everything that shapes the
// browser or the code (a stale keeper is never addressed), the pipe name follows the platform,
// CI is a list of eight variables and `BROWSER_INSPECTOR_DAEMON=1` overrides it.
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CI_VARS,
  DEFAULT_OUTPUT_DIR,
  collectIdentity,
  daemonEnabled,
  defaultOutputDir,
  fnv1a,
  identityHash,
  isCI,
  lockFile,
  logFile,
  pidFile,
  pipeName,
  playwrightCoreVersion,
  resolveOutputDir,
  sessionDir,
  srcStamp,
} from '../src/paths.mjs';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** @type {import('../src/paths.mjs').IdentityParts} */
const BASE = {
  pkgVersion: '0.1.0',
  pwVersion: '1.62.1',
  nodeMajor: 26,
  channel: 'chrome',
  executablePath: '',
  headless: true,
  args: ['--disable-frame-rate-limit'],
  fastHeadless: true,
  motion: 'no-preference',
  browserArgsEnv: '',
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
  binRealpath: 'D:/github/scribe-devtools/packages/browser-inspector/bin/browser-inspector.mjs',
  srcStamp: 1756700000000,
};

describe('identityHash', () => {
  it('is 8 hex digits and stable for equal input', () => {
    expect(identityHash(BASE)).toMatch(/^[0-9a-f]{8}$/u);
    expect(identityHash({ ...BASE })).toBe(identityHash(BASE));
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
  });

  it.each([
    ['playwright-core version', { pwVersion: '1.62.2' }],
    ['Node major', { nodeMajor: 24 }],
    [
      'realpath of bin/browser-inspector.mjs (second checkout)',
      { binRealpath: 'D:/other/checkout/packages/browser-inspector/bin/browser-inspector.mjs' },
    ],
    ['srcStamp (an edit in src/)', { srcStamp: 1756700000001 }],
    ['HTTP_PROXY', { httpProxy: 'http://proxy:3128' }],
    ['HTTPS_PROXY', { httpsProxy: 'http://proxy:3128' }],
    ['NO_PROXY', { noProxy: 'localhost' }],
    ['package version', { pkgVersion: '0.2.0' }],
    ['channel', { channel: 'msedge' }],
    ['executablePath', { executablePath: 'C:/chrome.exe' }],
    ['headless', { headless: false }],
    ['args', { args: [] }],
    // Both shape the browser (`fastHeadless` the launch flags, `motion` every context), so two
    // configs that differ only in them must not share one keeper.
    ['browser.fastHeadless', { fastHeadless: false }],
    ['browser.motion', { motion: 'reduce' }],
    ['BROWSER_INSPECTOR_BROWSER_ARGS', { browserArgsEnv: '--no-sandbox' }],
    // `browser-inspector run --file` is gated on the KEEPER's env: an unsafe keeper must be a separate process.
    ['BROWSER_INSPECTOR_UNSAFE=1', { unsafe: true }],
  ])('changes with %s', (_, patch) => {
    expect(identityHash({ ...BASE, ...patch })).not.toBe(identityHash(BASE));
  });
});

describe('collectIdentity / srcStamp', () => {
  it('reads the real package: playwright-core 1.62.1, this checkout, a src stamp', () => {
    const parts = collectIdentity({ packageDir: PACKAGE_DIR, env: {}, nodeMajor: 26 });
    expect(parts.pwVersion).toBe('1.62.1');
    expect(parts.pkgVersion).toBe('0.1.0');
    expect(parts.binRealpath.replaceAll('\\', '/')).toMatch(
      /packages\/browser-inspector\/bin\/browser-inspector\.mjs$/u,
    );
    expect(typeof parts.srcStamp).toBe('number');
    expect(parts.srcStamp).toBeGreaterThan(0);
    expect(parts.headless).toBe(true);
    expect(playwrightCoreVersion(PACKAGE_DIR)).toBe('1.62.1');
  });

  it('honours BROWSER_INSPECTOR_CHANNEL, BROWSER_INSPECTOR_BROWSER_PATH, BROWSER_INSPECTOR_BROWSER_ARGS and the proxy variables', () => {
    const parts = collectIdentity({
      packageDir: PACKAGE_DIR,
      env: {
        BROWSER_INSPECTOR_CHANNEL: 'msedge',
        BROWSER_INSPECTOR_BROWSER_PATH: 'C:/edge.exe',
        BROWSER_INSPECTOR_BROWSER_ARGS: '--x',
        HTTP_PROXY: 'p',
        https_proxy: 'q',
        NO_PROXY: 'n',
      },
      browser: { channel: 'chrome', executablePath: 'C:/chrome.exe', headless: false, args: ['--a'] },
    });
    expect(parts).toMatchObject({
      channel: 'msedge',
      executablePath: 'C:/edge.exe',
      browserArgsEnv: '--x',
      httpProxy: 'p',
      httpsProxy: 'q',
      noProxy: 'n',
      headless: false,
      args: ['--a'],
      fastHeadless: true,
      motion: 'no-preference',
    });
  });

  it('an EMPTY variable means "not set", exactly as the launch plan reads it', () => {
    // `collectIdentity` used `??` and `launchPlan` `||`, so `BROWSER_INSPECTOR_CHANNEL=` (a CI job
    // with an empty input, `export X=` in bash) silently dropped `browser.channel`: the config's
    // channel vanished from the identity AND from the launch, and two configs naming two different
    // browsers hashed the same.
    const withEmpty = (/** @type {Record<string, string>} */ env, /** @type {any} */ browser) =>
      collectIdentity({ packageDir: PACKAGE_DIR, env, browser, nodeMajor: 26 });
    const edge = withEmpty({ BROWSER_INSPECTOR_CHANNEL: '' }, { channel: 'msedge' });
    expect(edge.channel).toBe('msedge');
    expect(withEmpty({ BROWSER_INSPECTOR_BROWSER_PATH: '' }, { executablePath: 'C:/chrome.exe' }).executablePath).toBe(
      'C:/chrome.exe',
    );
    const chrome = withEmpty({ BROWSER_INSPECTOR_CHANNEL: '' }, { channel: 'chrome' });
    expect(identityHash(edge)).not.toBe(identityHash(chrome));
    // The same rule for the flags: an empty (or blank) variable is not an override, so it cannot
    // hash like "unset" while the launch drops FAST_HEADLESS_ARGS.
    const unset = withEmpty({}, {});
    expect(identityHash(withEmpty({ BROWSER_INSPECTOR_BROWSER_ARGS: '' }, {}))).toBe(identityHash(unset));
    expect(identityHash(withEmpty({ BROWSER_INSPECTOR_BROWSER_ARGS: '   ' }, {}))).toBe(identityHash(unset));
    expect(identityHash(withEmpty({ BROWSER_INSPECTOR_BROWSER_ARGS: '--no-sandbox' }, {}))).not.toBe(
      identityHash(unset),
    );
  });

  it('carries browser.fastHeadless and browser.motion — they shape the browser, so they shape the identity', () => {
    const parts = collectIdentity({
      packageDir: PACKAGE_DIR,
      env: {},
      browser: { fastHeadless: false, motion: 'reduce' },
    });
    expect(parts).toMatchObject({ fastHeadless: false, motion: 'reduce' });
    expect(identityHash(parts)).not.toBe(identityHash(collectIdentity({ packageDir: PACKAGE_DIR, env: {} })));
  });

  it('srcStamp is the newest mtime and the PORTABLE marker turns it off', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'browser-inspector-paths-'));
    const src = path.join(dir, 'src');
    mkdirSync(src);
    writeFileSync(path.join(dir, 'package.json'), '{"version":"9.9.9"}');
    writeFileSync(path.join(src, 'a.mjs'), '', { flag: 'w' });
    const older = new Date('2020-01-01T00:00:00Z');
    const newer = new Date('2021-01-01T00:00:00Z');
    utimesSync(path.join(src, 'a.mjs'), older, older);
    writeFileSync(path.join(src, 'b.mjs'), '');
    utimesSync(path.join(src, 'b.mjs'), newer, newer);
    expect(srcStamp(src)).toBe(newer.getTime());
    expect(srcStamp(path.join(dir, 'nope'))).toBe(0);
    expect(collectIdentity({ packageDir: dir, env: {} }).srcStamp).toBe(newer.getTime());
    writeFileSync(path.join(dir, 'PORTABLE'), '');
    expect(collectIdentity({ packageDir: dir, env: {} }).srcStamp).toBe('');
    expect(collectIdentity({ packageDir: dir, env: {} }).pkgVersion).toBe('9.9.9');
  });
});

describe('pipeName and files', () => {
  it('names a Windows pipe per user and hash, sanitised', () => {
    expect(pipeName('3f9a1c2e', { platform: 'win32', env: {}, user: 'wojtek' })).toBe(
      '\\\\.\\pipe\\browser-inspector-wojtek-3f9a1c2e',
    );
    expect(pipeName('3f9a1c2e', { platform: 'win32', env: {}, user: 'DOMAIN\\Jan Kowalski' })).toBe(
      '\\\\.\\pipe\\browser-inspector-DOMAIN_Jan_Kowalski-3f9a1c2e',
    );
  });

  it('uses XDG_RUNTIME_DIR or the tmpdir with the uid elsewhere', () => {
    expect(pipeName('abcd1234', { platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, uid: 1000 })).toBe(
      path.join('/run/user/1000', 'browser-inspector-1000-abcd1234.sock'),
    );
    expect(pipeName('abcd1234', { platform: 'darwin', env: {}, uid: 501, tmpdir: '/tmp' })).toBe(
      path.join('/tmp', 'browser-inspector-501-abcd1234.sock'),
    );
  });

  it('BROWSER_INSPECTOR_SOCKET overrides everything', () => {
    expect(pipeName('x', { platform: 'win32', env: { BROWSER_INSPECTOR_SOCKET: '\\\\.\\pipe\\mine' } })).toBe(
      '\\\\.\\pipe\\mine',
    );
  });

  it('pid, lock and log files sit in the tmpdir under the hash', () => {
    expect(pidFile('h1', '/t')).toBe(path.join('/t', 'browser-inspector-h1.json'));
    expect(lockFile('h1', '/t')).toBe(path.join('/t', 'browser-inspector-h1.lock'));
    expect(logFile('h1', '/t')).toBe(path.join('/t', 'browser-inspector-h1.log'));
    expect(pidFile('h1')).toBe(path.join(os.tmpdir(), 'browser-inspector-h1.json'));
  });

  it('session and output directories', () => {
    expect(sessionDir('/out')).toBe(path.join('/out', 'session', 'default'));
    expect(sessionDir('/out', 'b')).toBe(path.join('/out', 'session', 'b'));
    expect(defaultOutputDir()).toBe(DEFAULT_OUTPUT_DIR);
    expect(resolveOutputDir(undefined, '/repo')).toBe(path.resolve('/repo', '.scribe-devtools/browser-inspector'));
    expect(resolveOutputDir('./x', '/repo')).toBe(path.resolve('/repo', 'x'));
    expect(resolveOutputDir('/abs/x', '/repo')).toBe(path.resolve('/abs/x'));
  });
});

describe('isCI / daemonEnabled', () => {
  it('lists exactly the eight variables of DESIGN.md', () => {
    expect([...CI_VARS]).toEqual([
      'CI',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'TF_BUILD',
      'JENKINS_URL',
      'TEAMCITY_VERSION',
      'BUILDKITE',
      'CIRCLECI',
    ]);
  });

  it.each(CI_VARS)('%s=1 means CI', (name) => {
    expect(isCI({ [name]: '1' })).toBe(true);
    expect(isCI({ [name]: 'true' })).toBe(true);
  });

  it('is not CI without them, with empty/false values, or with BUILD_ID alone', () => {
    expect(isCI({})).toBe(false);
    expect(isCI({ CI: '' })).toBe(false);
    expect(isCI({ CI: 'false' })).toBe(false);
    expect(isCI({ CI: '0' })).toBe(false);
    expect(isCI({ BUILD_ID: '42' })).toBe(false);
    expect(isCI({ PATH: 'x', HOME: 'y' })).toBe(false);
  });

  it('daemonEnabled: default on, off on CI and BROWSER_INSPECTOR_DAEMON=0 / --no-daemon, BROWSER_INSPECTOR_DAEMON=1 wins over CI', () => {
    expect(daemonEnabled({})).toBe(true);
    expect(daemonEnabled({ CI: 'true' })).toBe(false);
    expect(daemonEnabled({ GITHUB_ACTIONS: 'true' })).toBe(false);
    expect(daemonEnabled({ BROWSER_INSPECTOR_DAEMON: '0' })).toBe(false);
    expect(daemonEnabled({ BROWSER_INSPECTOR_DAEMON: '1', CI: 'true' })).toBe(true);
    expect(daemonEnabled({ BROWSER_INSPECTOR_DAEMON: '1' }, { noDaemon: true })).toBe(false);
    expect(daemonEnabled({}, { noDaemon: true })).toBe(false);
  });
});
