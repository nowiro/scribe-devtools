// config.mjs — loading, validating and linting a batch config (DESIGN.md §3.3, §3.4).
//
// The OLD app-factory schema (`read.config.browser-inspector.json`: outputDir, browser, auth,
// snapshots with page/flow, networkidle, `wait ms`, `evaluate` that throws) parses UNCHANGED and is
// a fixture; the new fields (parallel, isolation, finalScreenshot, captureSnapshot, captureBodies,
// dialogs, routes, settleMs, trace, video) are optional. Every error names its path
// (`snapshots[2].steps[4].selector: …`) and ALL errors are reported at once — a config author
// fixes one file, not one field per run. Unknown keys are errors, like the strict objects of the
// TypeScript version: a typo in `waitUntil` must not silently mean `load`.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveOutputDir } from './paths.mjs';
import { ARTIFACT_NAME, checkField, validateSteps } from './steps.schema.mjs';

/** Defaults DESIGN.md §3.3 fixes; the report header names the ones that differ from them. */
export const DEFAULTS = Object.freeze({
  outputDir: './.scribe-devtools/browser-inspector',
  parallel: 1,
  settleMs: 2000,
  browser: Object.freeze({ headless: true, fastHeadless: true, motion: 'no-preference' }),
  auth: Object.freeze({ maxAgeMinutes: 60, reuse: true }),
  snapshot: Object.freeze({
    waitUntil: 'load',
    fullPage: false,
    viewport: Object.freeze({ width: 1280, height: 720 }),
    navTimeoutMs: 30_000,
    stepTimeoutMs: 10_000,
    captureElements: true,
    captureNetwork: true,
    captureSnapshot: false,
    captureBodies: true,
    render: Object.freeze(['json', 'markdown']),
    isolation: 'reuse',
    finalScreenshot: 'auto',
    dialogs: 'dismiss',
  }),
});

const TOP_FIELDS = Object.freeze({
  outputDir: 'string?',
  parallel: 'int?',
  settleMs: 'int?',
  browser: 'object?',
  auth: 'object?',
  snapshots: 'array',
});
const BROWSER_FIELDS = Object.freeze({
  channel: 'enum:chrome,msedge?',
  executablePath: 'string?',
  headless: 'bool?',
  args: 'list?',
  fastHeadless: 'bool?',
  motion: 'enum:no-preference,reduce?',
});
const SNAPSHOT_FIELDS = Object.freeze({
  name: 'name',
  type: 'enum:page,flow',
  url: 'url',
  waitUntil: 'enum:load,domcontentloaded,networkidle,settled?',
  fullPage: 'bool?',
  viewport: 'object?',
  steps: 'array?',
  stepTimeoutMs: 'int?',
  navTimeoutMs: 'int?',
  captureElements: 'bool?',
  captureNetwork: 'bool?',
  captureSnapshot: 'bool?',
  captureBodies: 'bool?',
  auth: 'bool?',
  render: 'list?',
  isolation: 'enum:reuse,fresh?',
  finalScreenshot: 'enum:auto,always,never?',
  dialogs: 'enum:accept,dismiss?',
  routes: 'array?',
  settleMs: 'int?',
  trace: 'bool?',
  video: 'bool?',
  storageState: 'string?',
});

export class ConfigError extends Error {
  /** @param {string[]} errors @param {string} [file] */
  constructor(errors, file) {
    super(
      `${file ? `config ${file}: ` : 'config: '}${errors.length === 1 ? errors[0] : `${String(errors.length)} problems\n  - ${errors.join('\n  - ')}`}`,
    );
    this.name = 'ConfigError';
    this.code = 'E_CONFIG';
    this.errors = errors;
    this.file = file;
  }
}

/**
 * Check every field of an object against a spec, unknown keys included.
 * @param {Record<string, unknown>} object
 * @param {Readonly<Record<string, string>>} spec
 * @param {string} where
 * @returns {string[]}
 */
function checkObject(object, spec, where) {
  const errors = [];
  for (const key of Object.keys(object)) {
    if (!Object.hasOwn(spec, key))
      errors.push(`${where}.${key}: unknown field (known: ${Object.keys(spec).join(', ')})`);
  }
  for (const [key, type] of Object.entries(spec)) {
    const error = checkField(object[key], type, `${where}.${key}`);
    if (error) errors.push(error);
  }
  return errors;
}

/**
 * @param {unknown} value @param {string} where @param {number} min @param {number} max
 * @returns {string | undefined}
 */
const range = (value, where, min, max) =>
  typeof value === 'number' && (value < min || value > max) ? `${where}: ${String(min)}…${String(max)}` : undefined;

/**
 * @param {any} auth
 * @returns {string[]}
 */
function validateAuth(auth) {
  const errors = [];
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return ['auth: expected an object'];
  if (typeof auth.storageState !== 'string' || auth.storageState === '') {
    errors.push('auth.storageState: the session file path is required');
  }
  const modes = ['login', 'oauth'].filter((mode) => auth[mode] !== undefined);
  if (modes.length !== 1) {
    errors.push('auth: exactly one of "login" (a form in the browser) / "oauth" (a token endpoint)');
  }
  for (const key of Object.keys(auth)) {
    if (!['storageState', 'login', 'oauth', 'maxAgeMinutes', 'reuse'].includes(key))
      errors.push(`auth.${key}: unknown field`);
  }
  if (auth.maxAgeMinutes !== undefined && !(Number.isInteger(auth.maxAgeMinutes) && auth.maxAgeMinutes > 0)) {
    errors.push('auth.maxAgeMinutes: a positive integer');
  }
  if (auth.reuse !== undefined && typeof auth.reuse !== 'boolean') errors.push('auth.reuse: true or false');
  if (auth.login !== undefined) {
    const login = auth.login;
    if (!login || typeof login !== 'object') {
      errors.push('auth.login: expected { url, steps }');
    } else {
      if (!URL.canParse(login.url ?? '')) errors.push('auth.login.url: must be an absolute URL');
      if (!Array.isArray(login.steps) || login.steps.length === 0) errors.push('auth.login.steps: at least one step');
      // `mode: 'auth'` forbids a literal `value` — a password in a versioned config is the one
      // thing this tool has refused since day one, and the login gate is not the exception.
      else errors.push(...validateSteps(login.steps, 'auth.login.steps', { mode: 'auth' }));
      for (const key of Object.keys(login)) {
        if (!['url', 'steps', 'waitUntil', 'stepTimeoutMs'].includes(key))
          errors.push(`auth.login.${key}: unknown field`);
      }
    }
  }
  if (auth.oauth !== undefined) {
    const oauth = auth.oauth;
    if (!oauth || typeof oauth !== 'object') {
      errors.push('auth.oauth: expected an object');
      return errors;
    }
    const hasKeycloak = oauth.keycloak && oauth.keycloak.url && oauth.keycloak.realm;
    if (!oauth.tokenUrl && !hasKeycloak) errors.push('auth.oauth: give tokenUrl or keycloak { url, realm }');
    if (oauth.tokenUrl && !URL.canParse(oauth.tokenUrl)) errors.push('auth.oauth.tokenUrl: must be an absolute URL');
    if (!['password', 'client_credentials'].includes(oauth.grantType)) {
      errors.push('auth.oauth.grantType: "password" or "client_credentials"');
    }
    if (!oauth.clientId) errors.push('auth.oauth.clientId: required');
    // A secret as a literal is the same rule as for fill: a validation error, not a convenience.
    if (oauth.password !== undefined || oauth.clientSecret !== undefined) {
      errors.push('auth.oauth: the password / client secret only through "passwordFromEnv" / "clientSecretFromEnv"');
    }
    if (oauth.grantType === 'password' && (!(oauth.username || oauth.usernameFromEnv) || !oauth.passwordFromEnv)) {
      errors.push('auth.oauth (password): username/usernameFromEnv and passwordFromEnv are required');
    }
    if (oauth.grantType === 'client_credentials' && !oauth.clientSecretFromEnv) {
      errors.push('auth.oauth (client_credentials): clientSecretFromEnv is required');
    }
    if (!oauth.store || !URL.canParse(oauth.store.origin ?? '') || !oauth.store.key) {
      errors.push('auth.oauth.store: { origin, key } — the localStorage key the application reads the token from');
    }
  }
  return errors;
}

/**
 * @param {any} snapshot
 * @param {string} where
 * @returns {string[]}
 */
function validateSnapshot(snapshot, where) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [`${where}: expected an object`];
  /** @type {(string | undefined)[]} */
  const errors = checkObject(snapshot, SNAPSHOT_FIELDS, where);
  if (snapshot.viewport !== undefined && typeof snapshot.viewport === 'object' && snapshot.viewport !== null) {
    errors.push(...checkObject(snapshot.viewport, { width: 'int', height: 'int' }, `${where}.viewport`));
    errors.push(range(snapshot.viewport.width, `${where}.viewport.width`, 200, 4000));
    errors.push(range(snapshot.viewport.height, `${where}.viewport.height`, 200, 4000));
  }
  errors.push(range(snapshot.navTimeoutMs, `${where}.navTimeoutMs`, 1000, 120_000));
  errors.push(range(snapshot.stepTimeoutMs, `${where}.stepTimeoutMs`, 100, 60_000));
  errors.push(range(snapshot.settleMs, `${where}.settleMs`, 0, 60_000));
  if (Array.isArray(snapshot.render)) {
    if (snapshot.render.length === 0) errors.push(`${where}.render: at least one of json, markdown`);
    for (const format of snapshot.render) {
      if (!['json', 'markdown'].includes(format))
        errors.push(`${where}.render: "${String(format)}" is not json | markdown`);
    }
  }
  if (snapshot.type === 'page' && snapshot.steps !== undefined) {
    // A typo in `type` used to give a run "completed: yes" without executing a single step.
    errors.push(`${where}: type "page" runs no steps — remove "steps" or set type "flow"`);
  }
  if (snapshot.type === 'flow') {
    if (!Array.isArray(snapshot.steps) || snapshot.steps.length === 0) errors.push(`${where}.steps: at least one step`);
    else errors.push(...validateSteps(snapshot.steps, `${where}.steps`, { mode: 'batch' }));
  }
  if (Array.isArray(snapshot.routes)) {
    snapshot.routes.forEach((/** @type {any} */ route, /** @type {number} */ k) => {
      const at = `${where}.routes[${String(k)}]`;
      if (!route || typeof route !== 'object' || Array.isArray(route)) {
        errors.push(`${at}: expected { url, block|status|body|file|delay }`);
        return;
      }
      // A route is exactly the `route` step's shape — validated by the same row of the table.
      errors.push(
        ...validateSteps([{ do: 'route', ...route }], at, { mode: 'batch' }).map((e) => e.replace(`${at}[0]`, at)),
      );
    });
  }
  return errors.filter((e) => e !== undefined);
}

/**
 * Validate a raw (parsed JSON) config and return it normalized: defaults applied, `outputDir`
 * absolute (relative to the config file, like scribe), snapshots and steps otherwise untouched.
 * @param {unknown} raw
 * @param {{ configPath?: string, cwd?: string }} [options] `configPath` anchors `outputDir`
 * @returns {Record<string, any>}
 */
export function parseConfig(raw, options = {}) {
  const file = options.configPath;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ConfigError(['the config must be a JSON object'], file);
  const config = /** @type {Record<string, any>} */ (raw);
  /** @type {(string | undefined)[]} */
  const errors = checkObject(config, TOP_FIELDS, 'config').map((e) => e.replace(/^config\./u, ''));
  if (config.parallel !== undefined && Number.isInteger(config.parallel) && config.parallel < 1)
    errors.push('parallel: N ≥ 1');
  errors.push(range(config.settleMs, 'settleMs', 0, 60_000));
  if (config.browser !== undefined && config.browser !== null && typeof config.browser === 'object') {
    errors.push(...checkObject(config.browser, BROWSER_FIELDS, 'browser'));
  }
  if (config.auth !== undefined) errors.push(...validateAuth(config.auth));
  if (Array.isArray(config.snapshots)) {
    if (config.snapshots.length === 0) errors.push('snapshots: at least one snapshot');
    const names = new Set();
    config.snapshots.forEach((/** @type {any} */ snapshot, /** @type {number} */ i) => {
      const where = `snapshots[${String(i)}]`;
      errors.push(...validateSnapshot(snapshot, where));
      const name = snapshot?.name;
      if (typeof name === 'string' && ARTIFACT_NAME.test(name)) {
        // The name is the output directory: two snapshots sharing one race their manifests.
        if (names.has(name))
          errors.push(`${where}.name: duplicate snapshot name "${name}" — the name is the output directory`);
        names.add(name);
      }
    });
  }
  const problems = errors.filter((e) => typeof e === 'string');
  if (problems.length > 0) throw new ConfigError(problems, file);

  const baseDir = file
    ? path.dirname(path.resolve(options.cwd ?? process.cwd(), file))
    : (options.cwd ?? process.cwd());
  return {
    outputDir: resolveOutputDir(config.outputDir, baseDir),
    parallel: config.parallel ?? DEFAULTS.parallel,
    settleMs: config.settleMs ?? DEFAULTS.settleMs,
    browser: { ...DEFAULTS.browser, ...(config.browser ?? {}) },
    ...(config.auth ? { auth: { ...DEFAULTS.auth, ...config.auth } } : {}),
    snapshots: config.snapshots.map((/** @type {any} */ snapshot) => ({
      ...DEFAULTS.snapshot,
      settleMs: config.settleMs ?? DEFAULTS.settleMs,
      ...snapshot,
      viewport: { ...DEFAULTS.snapshot.viewport, ...(snapshot.viewport ?? {}) },
      render: [...(snapshot.render ?? DEFAULTS.snapshot.render)],
    })),
    ...(file ? { configPath: path.resolve(options.cwd ?? process.cwd(), file) } : {}),
  };
}

/**
 * Read + parse + validate. A missing file and invalid JSON are `ConfigError`s too (exit 2 in the
 * client), so the caller has one error type to print.
 * @param {string} configPath
 * @param {string} [cwd]
 * @returns {Record<string, any>}
 */
export function loadConfig(configPath, cwd = process.cwd()) {
  const abs = path.resolve(cwd, configPath);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (error) {
    throw new ConfigError(
      [`cannot read ${abs}: ${error instanceof Error ? error.message : String(error)}`],
      configPath,
    );
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError([`not valid JSON: ${error instanceof Error ? error.message : String(error)}`], configPath);
  }
  return parseConfig(raw, { configPath, cwd });
}

/**
 * @typedef {{ kind: 'networkidle' | 'wait-ms' | 'parallel', path: string, message: string }} LintFinding
 */

/**
 * `browser-inspector lint-config`: the migration a config author MAY do (DESIGN.md §3.4). Three rules, measured:
 * `networkidle` → `settled` (666–2056 ms per goto on app-factory), `wait ms` → `waitFor` / `wait --text`
 * (never `settled` — Material animations are invisible to it), `parallel` for a multi-flow config.
 * Nothing is changed; the config works as it is.
 * @param {Record<string, any>} config a parsed (normalized or raw) config
 * @returns {{ findings: LintFinding[], lines: string[] }}
 */
export function lintConfig(config) {
  /** @type {LintFinding[]} */
  const findings = [];
  const snapshots = /** @type {any[]} */ (config.snapshots ?? []);
  let sleepMs = 0;
  snapshots.forEach((snapshot, i) => {
    const where = `snapshots[${String(i)}]`;
    if (snapshot.waitUntil === 'networkidle') {
      findings.push({
        kind: 'networkidle',
        path: `${where}.waitUntil`,
        message: 'waitUntil "networkidle" → "settled"',
      });
    }
    /** @type {any[]} */ (snapshot.steps ?? []).forEach((step, j) => {
      if (step && (step.do === 'goto' || step.do === 'reload') && step.waitUntil === 'networkidle') {
        findings.push({
          kind: 'networkidle',
          path: `${where}.steps[${String(j)}].waitUntil`,
          message: 'waitUntil "networkidle" → "settled"',
        });
      }
      if (step && step.do === 'wait' && typeof step.ms === 'number') {
        sleepMs += step.ms;
        findings.push({
          kind: 'wait-ms',
          path: `${where}.steps[${String(j)}]`,
          message: `wait ${String(step.ms)} ms → waitFor <selector> / wait --text`,
        });
      }
    });
  });
  const lanes = Math.min(3, Math.ceil(snapshots.length / 2));
  if (snapshots.length > 1 && lanes > 1 && (config.parallel ?? 1) < lanes) {
    findings.push({
      kind: 'parallel',
      path: 'parallel',
      message: `parallel: ${String(lanes)} (${String(snapshots.length)} flow → ${String(lanes)} lane)`,
    });
  }
  const lines = [];
  const idle = findings.filter((f) => f.kind === 'networkidle').length;
  if (idle > 0)
    lines.push(`${String(idle)}× waitUntil "networkidle" → "settled" (−500…−1900 ms każdy; sonda: 666–2056 ms)`);
  const waits = findings.filter((f) => f.kind === 'wait-ms').length;
  if (waits > 0)
    lines.push(`${String(waits)}× wait ms (razem ${String(sleepMs)} ms snu) → waitFor <selector> / wait --text`);
  for (const finding of findings) if (finding.kind === 'parallel') lines.push(finding.message);
  return { findings, lines };
}
