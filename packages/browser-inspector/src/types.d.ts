// types.d.ts — the shared contracts of browser-inspector 2, frozen by WP1 (docs/DESIGN.md §2–§5, §8).
//
// Every other module reaches these through JSDoc (`@typedef {import('./types.js').PageLike} PageLike`,
// resolved by tsc to this file), so a change here is a change of contract for the engine, the
// snapshot module, the keeper, the client and every FakePage in the tests. The shapes are kept
// deliberately loose where playwright-core's own types would otherwise leak in: the client must never
// import playwright-core, and a FakePage must be writable without it.

// ── Steps ────────────────────────────────────────────────────────────────────

/** `action` prints deltas after the step, `query` prints content, `control` prints a bare ok line. */
export type StepKind = 'action' | 'query' | 'control';

/** Field type mini-language of `StepDef.config` / `StepDef.flags` — see `FIELD_TYPES` in steps.schema.mjs. */
export type FieldType = string;

/** A step as it sits in a config (`{ do: 'click', selector: … }`) or as the CLI parser built it. */
export interface Step {
  do: string;
  [field: string]: unknown;
}

export interface ValidateContext {
  /** `batch` = config flow, `session` = argv command, `auth` = `auth.login.steps` (no literals). */
  mode: 'batch' | 'session' | 'auth';
}

/** One row of the `STEPS` table (`src/steps.schema.mjs`); `RUNNERS[name]` in steps.run.mjs is its twin. */
export interface StepDef {
  kind: StepKind;
  /** Session-only spellings that resolve to this step (`open` → `goto`, `shot` → `screenshot`). */
  aliases: readonly string[];
  /** Allowed as `steps[].do` in a batch config. */
  batch: boolean;
  /** Allowed as `browser-inspector <name>` in a session / `browser-inspector script`. */
  session: boolean;
  /** Positional argv names: `name`, `name?` (optional), `name...` (rest). */
  argv: readonly string[];
  /** Session flags: `--name` with a FieldType (`bool` flags take no value). */
  flags: Readonly<Record<string, FieldType>>;
  /** Config fields with their FieldType; unknown fields are validation errors. */
  config: Readonly<Record<string, FieldType>>;
  /** Cross-field rules; returns error messages (already prefixed with `where`). */
  validate?: (step: Step, where: string, ctx: ValidateContext) => string | string[] | undefined | void;
  /** One line for the report and the journal — never a fill value, only its origin. */
  describe: (step: Step) => string;
  /** `browser-inspector help <name>` one-liner: `click <eN|selector> [--double] …`. */
  help: string;
  /** Builds the config-shaped step from parsed positionals and flags (session only). */
  fromArgv?: (positionals: Record<string, any>, flags: Record<string, any>) => Record<string, unknown>;
}

// ── Page-like surface used by the runners (real playwright Page or a FakePage) ─

export type AnyAsync = (...args: any[]) => Promise<any>;

export interface LocatorLike {
  count(): Promise<number>;
  first(): LocatorLike;
  nth?(index: number): LocatorLike;
  innerText(options?: any): Promise<string>;
  inputValue?(options?: any): Promise<string>;
  textContent?(options?: any): Promise<string | null>;
  evaluate(fn: any, arg?: any, options?: any): Promise<any>;
  scrollIntoViewIfNeeded?(options?: any): Promise<void>;
  screenshot?(options?: any): Promise<Buffer>;
  boundingBox?(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  isVisible?(options?: any): Promise<boolean>;
  waitFor?(options?: any): Promise<void>;
  locator?(selector: string): LocatorLike;
  [extra: string]: any;
}

export interface MouseLike {
  click(x: number, y: number, options?: any): Promise<void>;
  move(x: number, y: number, options?: any): Promise<void>;
  down(options?: any): Promise<void>;
  up(options?: any): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
}

export interface KeyboardLike {
  press(key: string, options?: any): Promise<void>;
  type(text: string, options?: any): Promise<void>;
}

export interface FrameLike {
  locator(selector: string): LocatorLike;
  evaluate(fn: any, arg?: any): Promise<any>;
  url(): string;
  name?(): string;
  [extra: string]: any;
}

/**
 * The method list DESIGN.md §8 fixes for `PageLike`: goto, click, fill, type, press, hover,
 * selectOption, check, setInputFiles, dragAndDrop, waitForSelector, waitForFunction, waitForTimeout,
 * screenshot, pdf, evaluate, locator, ariaSnapshot, title, url, goBack, goForward, reload,
 * setViewportSize, emulateMedia, route, unroute, on/off, frames, mouse. `uncheck` and `keyboard`
 * ride along because the runners call them; a FakePage records every call and can inject errors.
 */
export interface PageLike {
  goto(url: string, options?: any): Promise<any>;
  click(selector: string, options?: any): Promise<void>;
  fill(selector: string, value: string, options?: any): Promise<void>;
  type(selector: string, text: string, options?: any): Promise<void>;
  press(selector: string, key: string, options?: any): Promise<void>;
  hover(selector: string, options?: any): Promise<void>;
  selectOption(selector: string, values: any, options?: any): Promise<any>;
  check(selector: string, options?: any): Promise<void>;
  uncheck(selector: string, options?: any): Promise<void>;
  setInputFiles(selector: string, files: any, options?: any): Promise<void>;
  dragAndDrop(source: string, target: string, options?: any): Promise<void>;
  waitForSelector(selector: string, options?: any): Promise<any>;
  waitForFunction(fn: any, arg?: any, options?: any): Promise<any>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(options?: any): Promise<Buffer>;
  pdf(options?: any): Promise<Buffer>;
  evaluate(fn: any, arg?: any): Promise<any>;
  locator(selector: string, options?: any): LocatorLike;
  ariaSnapshot(options?: any): Promise<string>;
  title(): Promise<string>;
  url(): string;
  goBack(options?: any): Promise<any>;
  goForward(options?: any): Promise<any>;
  reload(options?: any): Promise<any>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  emulateMedia(options?: any): Promise<void>;
  route(url: any, handler: any, options?: any): Promise<void>;
  unroute(url: any, handler?: any): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): any;
  off(event: string, listener: (...args: any[]) => void): any;
  frames(): FrameLike[];
  mouse: MouseLike;
  keyboard: KeyboardLike;
  [extra: string]: any;
}

export interface ContextLike {
  newPage(): Promise<PageLike>;
  pages(): PageLike[];
  close(): Promise<void>;
  clearCookies(options?: any): Promise<void>;
  clearPermissions(): Promise<void>;
  unrouteAll?(options?: any): Promise<void>;
  setOffline(offline: boolean): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  setGeolocation(geolocation: any): Promise<void>;
  setDefaultTimeout(ms: number): void;
  setDefaultNavigationTimeout(ms: number): void;
  storageState(options?: any): Promise<any>;
  cookies?(urls?: any): Promise<any[]>;
  addCookies?(cookies: any[]): Promise<void>;
  route?(url: any, handler: any, options?: any): Promise<void>;
  unroute?(url: any, handler?: any): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): any;
  off?(event: string, listener: (...args: any[]) => void): any;
  [extra: string]: any;
}

/** The CDP session of the lane's tab: `Page.captureScreenshot`, `Runtime.evaluate`, `DOMStorage.clear`, … */
export interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  on?(event: string, listener: (...args: any[]) => void): any;
  detach?(): Promise<void>;
}

// ── Recorder (attached once per page, cursors "since last call" per session) ──

export interface ConsoleEntry {
  type: string;
  text: string;
  location?: string;
  /** Epoch ms — the journal and `console --tail` sort on it. */
  at?: number;
}

export interface NetEntry {
  id: number;
  method: string;
  url: string;
  status?: number;
  contentType?: string;
  /** Response body size in bytes ON THE WIRE (compressed, framed): `Content-Length` when the server
   * sent one, otherwise `encodedDataLength` through `request.sizes()`. Absent when the request was
   * still in flight when the run ended (`ms` is absent then too — both are filled on
   * `requestfinished`, and a batch does not wait for it), or when a cached response reports no
   * usable length. */
  size?: number;
  ms?: number;
  failure?: string;
  resourceType?: string;
  /** Why the recorder kept no body: a stream, a type it does not keep, a body over the limit, a read that never returned. */
  bodySkipped?: 'stream' | 'type' | 'too large' | 'timeout';
}

export interface DialogEntry {
  type: string;
  message: string;
  action: 'accepted' | 'dismissed';
  /** The command that triggered it (`browser-inspector click e12`), when known. */
  trigger?: string;
}

export interface TabEntry {
  url: string;
  title: string;
  openedAt: number;
}

export interface RecorderLike {
  /** Everything since the recorder was attached (batch) — the report reads this. */
  console: ConsoleEntry[];
  consoleTotal: number;
  pageErrors: string[];
  network: NetEntry[];
  networkTotal: number;
  dialogs: DialogEntry[];
  tabs: TabEntry[];
  /** Origins visited on this tab since the last scrub — `scrubPlan` clears each of them. */
  visitedOrigins: string[];
  /** Requests in flight right now — the `settled` wait polls this. */
  inFlight: number;
  /** Bodies kept for `browser-inspector net <n> --body` (≤ 64 KB, json/text only). */
  bodies?: Map<number, string>;
  /** Entries after the given cursor — `browser-inspector console`/`browser-inspector net` print only those. */
  sinceLast?(kind: 'console' | 'net' | 'dialogs', cursor: number): { entries: any[]; cursor: number };
  [extra: string]: any;
}

// ── Step context — the ONE interface every runner sees (DESIGN.md §8) ────────

export interface ExtractedValue {
  value: string;
  truncated: boolean;
}

export interface Verification {
  index: number;
  kind: string;
  ok: boolean;
  soft: boolean;
  detail?: string;
}

export interface StepCapture {
  screenshots: string[];
  extracts: Record<string, ExtractedValue>;
  verifications: Verification[];
  /** Writes queued by the fast screenshot path; the engine awaits them before report.json. */
  pending?: Promise<unknown>[];
}

export interface SessionState {
  name: string;
  /** Session directory `<out>/session/<name>` chosen at `browser-inspector open`. */
  dir: string;
  cwd: string;
  out: string;
  /** Current frame scope for CSS selectors / eval / extract (`main` or a frame index). */
  frame?: string;
  dialogPolicy: { action: 'accept' | 'dismiss'; text?: string; once?: boolean };
  /** Last full `ariaSnapshot` text and its sidecar, for `--diff` and `find`. */
  lastSnapshot?: { text: string; entries: any[]; at: number };
  shotSeq: number;
  evalSeq: number;
  cursors: Record<string, number>;
  [extra: string]: any;
}

export interface StepContext {
  page: PageLike;
  context: ContextLike;
  cdp: CdpLike;
  /** Directory of the snapshot (batch) or of the session (session). */
  dir: string;
  timeoutMs: number;
  capture: StepCapture;
  recorder: RecorderLike;
  /**
   * Resolves `s.ref` (via `aria-ref=<ref>` with a `count()` precheck and one snapshot refresh) or
   * `s.selector` (verbatim) into the selector the action uses. Throws the `ref not found` failure.
   */
  sel: (step: Step, field?: string) => Promise<string>;
  /**
   * Values under step addresses (`"snapshots[3].steps[4].value"`, `"argv.fill.value"`) — what the
   * client resolved from `valueFromEnv` / `--env` / `@{NAME}`. Runners read through `value()`.
   */
  values: Record<string, string>;
  /** Address of the current step, the key prefix into `values`. */
  address: string;
  /**
   * `value('value')` returns the resolved secret for `<address>.value` when the client sent one,
   * otherwise the literal `step.value`; throws a named error when `valueFromEnv` was not resolved.
   */
  value: (field?: string, step?: Step) => string;
  /** Values that must never appear in any output; `redact()` is bound to them. */
  secretValues: string[];
  redact: (text: string) => string;
  /** Files sent by the client (`upload`, `route --file`, `eval --file`, `state load`). */
  files: Record<string, { path?: string; base64?: string; size: number }>;
  mode: 'batch' | 'session';
  session?: SessionState;
  /** Batch only: the snapshot config the step belongs to. */
  snapshot?: any;
  /** Session only: stdout lines a runner produces — the engine collects them. */
  lines?: string[];
  [extra: string]: any;
}

export interface StepResult {
  index: number;
  description: string;
  ok: boolean;
  ms?: number;
  /** `Error: uczen widzi przycisk nauczyciela` — first line, `Error:` prefix kept (compat). */
  error?: string;
}

// ── Report & manifests (DESIGN.md §5) ────────────────────────────────────────

export type TimingMode = 'warm' | 'first' | 'fallback' | 'no-daemon';

export interface Timing {
  mode: TimingMode;
  ctx: 'reused' | 'fresh';
  tab: 'kept' | 'new';
  lane: number;
  queuedMs: number;
  scrubMs: number;
  gotoMs: number;
  stepsMs: number;
  captureMs: number;
  writeMs: number;
  /** `writeMs` split in two: the screenshot write tail and the recorder's outstanding body reads. */
  shotsMs?: number;
  settleMs?: number;
  totalMs: number;
  cacheHits: number;
  cacheHitsDocument: number;
}

export interface EngineInfo {
  'browser-inspector': string;
  'playwright-core': string;
  browser: string;
  flags: string[];
  motion: 'no-preference' | 'reduce';
  serviceWorkers: 'block' | 'allow';
  generation: number;
}

export interface Report {
  name: string;
  startUrl: string;
  finalUrl: string;
  title?: string;
  completed: boolean;
  /** ONLY present when navigation failed — never `undefined` in the JSON. */
  navigationError?: string;
  steps: StepResult[];
  skipped: number;
  extracts: Record<string, ExtractedValue>;
  verifications: Verification[];
  console: { entries: ConsoleEntry[]; total: number; truncated: boolean };
  pageErrors: string[];
  network: { total: number; failed: NetEntry[] };
  failedRequests: { entries: { url: string; failure: string }[]; truncated: boolean };
  dialogs: DialogEntry[];
  tabs: TabEntry[];
  screenshots: string[];
  text: { content: string; truncated: boolean };
  elements?: { entries: any[]; total: number; truncated: boolean };
  files: Record<string, string>;
  timing: Timing;
  engine: EngineInfo;
  /** Header flag of report.md when the last executed step was a screenshot: `final: koszyk.png`. */
  final?: string;
}

/** `<outputDir>/<stamp>/<snapshot>/_manifest.json` — the read-runtime convention scribe tools read. */
export interface SnapshotManifest {
  name: string;
  type: 'page' | 'flow';
  url: string;
  completed: boolean;
  screenshots: string[];
  timing: Timing;
  stamp?: string;
  version?: string;
  [extra: string]: any;
}

/** `<outputDir>/<stamp>/_manifest.json` — one per run. */
export interface Manifest {
  stamp: string;
  config: string;
  version: string;
  timing: { mode: TimingMode; keeperStartMs?: number; launchMs?: number; clientMs: number };
  snapshots: {
    name: string;
    completed: boolean;
    dir: string;
    ms: number;
    ctx: 'reused' | 'fresh';
    tab: 'kept' | 'new';
    lane: number;
    queuedMs: number;
    scrubMs: number;
    cacheHits: number;
    failure?: string;
  }[];
}

// ── Keeper protocol (DESIGN.md §2.4) — NDJSON, one request line, progress lines, one done line ──

export interface KeeperFile {
  /** Inline content (≤ 1 MB) … */
  base64?: string;
  /** … or an absolute path for larger uploads — the keeper may have another cwd and other rights. */
  path?: string;
  size: number;
}

/**
 * No `env` — ever. The client resolves `valueFromEnv` / `--env NAME` / `@{NAME}` itself and sends
 * only the values under step addresses plus the list of those that are secrets.
 */
export interface KeeperRequest {
  v: 1;
  token: string;
  cwd: string;
  argv: string[];
  values: Record<string, string>;
  secretValues: string[];
  files: Record<string, KeeperFile>;
  session?: string;
  out?: string;
}

export interface KeeperProgress {
  progress: { snapshot: string; completed: boolean; ms: number; index: number; total: number };
}

export interface KeeperDone {
  done: true;
  exit: number;
  lines: string[];
  /** Files written, relative to `out` / the run directory — the client prints paths relative to its cwd. */
  files: string[];
  timing?: Partial<Timing> & { queuedMs?: number };
  /** `warm | first` from the keeper's point of view; the client adds `fallback` / `no-daemon`. */
  mode?: TimingMode;
}

export type KeeperResponse = KeeperProgress | KeeperDone;

// ── Isolation (DESIGN.md §2.3) ───────────────────────────────────────────────

export type ScrubOp =
  | { op: 'closePage'; page: unknown; reason: 'popup' }
  | { op: 'newTab'; reason: 'crash' }
  | { op: 'domStorageClear'; origin: string }
  | { op: 'setGeneration'; generation: number }
  | { op: 'clearOrigin'; origin: string; storageTypes: string }
  | { op: 'resetContext'; viewport: { width: number; height: number }; dialogs: 'dismiss' }
  | { op: 'resetNavigationHistory' };

export interface LaneState {
  /** Pages open in the lane context; exactly one is the lane's persistent tab. */
  pages: { page: unknown; isLaneTab: boolean }[];
  /** `page.on('crash')` fired since the last scrub. */
  crashed: boolean;
  /** Origin of the document currently loaded on the lane tab (`null` for about:blank / none). */
  currentOrigin: string | null;
  /** Origins navigated to since the last scrub (from `framenavigated`). */
  visitedOrigins: string[];
  /** Current generation number of the init script; the plan bumps it by one. */
  generation: number;
  viewport?: { width: number; height: number };
}
