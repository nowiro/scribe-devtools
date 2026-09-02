// fake-browser.mjs — a browser/context/page/CDP quartet that RECORDS calls and injects failures,
// so the engine's unit tests cover the step→call mapping, the failure and final-screenshot rules,
// the scrub count and the CDP evaluate path without a browser process. The page satisfies
// `PageLike` (types.d.ts); a session test (WP6) can reuse it as is.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * @typedef {object} FakeOptions
 * @property {Record<string, Error | ((...args: any[]) => any)>} [fail] method name → error to throw (or a function that throws)
 * @property {Record<string, number>} [counts] selector → `locator.count()` (default 1)
 * @property {Record<string, string>} [texts] selector → innerText / inputValue
 * @property {string} [snapshot] `ariaSnapshot` text
 * @property {string} [title]
 * @property {(fn: any, arg: any) => any} [evaluate] page.evaluate override
 * @property {(params: any) => any} [runtimeEvaluate] `Runtime.evaluate` response (or a promise)
 * @property {(method: string, params: any) => any} [cdp] every other CDP method
 * @property {boolean} [chromium]
 */

/** @param {FakeOptions} options @param {any[]} calls @param {string} method @param {any[]} args */
function record(options, calls, method, args) {
  calls.push({ method, args });
  const failure = options.fail?.[method];
  if (failure instanceof Error) throw failure;
  if (typeof failure === 'function') failure(...args);
}

/**
 * @param {FakeOptions} [options]
 * @param {any[]} [calls] shared call log (a context passes its own so every page logs into one list)
 */
export function createFakePage(options = {}, calls = []) {
  /** @type {Map<string, Function[]>} */
  const listeners = new Map();
  let url = 'about:blank';
  let closed = false;
  let viewport = { width: 1280, height: 720 };
  const frame = {
    url: () => url,
    name: () => '',
    parentFrame: () => null,
    locator: (/** @type {string} */ selector) => locator(selector),
    evaluate: async () => undefined,
  };
  const locator = (/** @type {string} */ selector) => ({
    count: async () => {
      record(options, calls, 'locator.count', [selector]);
      return options.counts?.[selector] ?? 1;
    },
    first() {
      return this;
    },
    nth() {
      return this;
    },
    innerText: async (/** @type {any} */ opts) => {
      record(options, calls, 'locator.innerText', [selector, opts]);
      return options.texts?.[selector] ?? `text of ${selector}`;
    },
    inputValue: async () => options.texts?.[selector] ?? '',
    textContent: async () => options.texts?.[selector] ?? '',
    isVisible: async () => (options.counts?.[selector] ?? 1) > 0,
    evaluate: async (/** @type {any} */ fn, /** @type {any} */ arg) => {
      record(options, calls, 'locator.evaluate', [selector, arg]);
      return typeof fn === 'function' ? fn({ style: {} }, arg) : undefined;
    },
    scrollIntoViewIfNeeded: async (/** @type {any} */ opts) =>
      record(options, calls, 'locator.scrollIntoViewIfNeeded', [selector, opts]),
    screenshot: async (/** @type {any} */ opts) => {
      record(options, calls, 'locator.screenshot', [selector, opts]);
      return PNG_1X1;
    },
    waitFor: async () => undefined,
    locator: (/** @type {string} */ inner) => locator(`${selector} ${inner}`),
    elementHandle: async () => ({ contentFrame: async () => frame }),
  });
  const page = {
    calls,
    listeners,
    /** @param {string} event @param {any[]} args */
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return page;
    },
    off(event, fn) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((f) => f !== fn),
      );
      return page;
    },
    async goto(target, opts) {
      record(options, calls, 'goto', [target, opts]);
      url = target;
      page.emit('framenavigated', frame);
      return null;
    },
    async click(selector, opts) {
      record(options, calls, 'click', [selector, opts]);
    },
    async fill(selector, value, opts) {
      record(options, calls, 'fill', [selector, value, opts]);
    },
    async type(selector, text, opts) {
      record(options, calls, 'type', [selector, text, opts]);
    },
    async press(selector, key, opts) {
      record(options, calls, 'press', [selector, key, opts]);
    },
    async hover(selector, opts) {
      record(options, calls, 'hover', [selector, opts]);
    },
    async selectOption(selector, values, opts) {
      record(options, calls, 'selectOption', [selector, values, opts]);
      return [];
    },
    async check(selector, opts) {
      record(options, calls, 'check', [selector, opts]);
    },
    async uncheck(selector, opts) {
      record(options, calls, 'uncheck', [selector, opts]);
    },
    async setInputFiles(selector, files, opts) {
      record(options, calls, 'setInputFiles', [selector, files, opts]);
    },
    async dragAndDrop(source, target, opts) {
      record(options, calls, 'dragAndDrop', [source, target, opts]);
    },
    async waitForSelector(selector, opts) {
      record(options, calls, 'waitForSelector', [selector, opts]);
      return null;
    },
    async waitForFunction(fn, arg, opts) {
      record(options, calls, 'waitForFunction', [arg, opts]);
      return null;
    },
    async waitForURL(pattern, opts) {
      record(options, calls, 'waitForURL', [String(pattern), opts]);
    },
    async waitForTimeout(ms) {
      record(options, calls, 'waitForTimeout', [ms]);
    },
    async waitForLoadState(state, opts) {
      record(options, calls, 'waitForLoadState', [state, opts]);
    },
    async screenshot(opts) {
      record(options, calls, 'screenshot', [opts]);
      return PNG_1X1;
    },
    async pdf(opts) {
      record(options, calls, 'pdf', [opts]);
      return Buffer.from('%PDF-1.4 fake');
    },
    async evaluate(fn, arg) {
      record(options, calls, 'evaluate', [typeof fn === 'function' ? fn.name : fn, arg]);
      if (options.evaluate) return options.evaluate(fn, arg);
      if (arg && typeof arg === 'object' && 'textCap' in arg) {
        return {
          text: 'Hello fake page',
          textLength: 15,
          elements: [{ kind: 'button', name: 'Go', selector: '#go' }],
          count: 1,
        };
      }
      return typeof fn === 'function' ? undefined : undefined;
    },
    locator,
    async ariaSnapshot(opts) {
      record(options, calls, 'ariaSnapshot', [opts]);
      return options.snapshot ?? '- button "Go" [ref=e1]\n- textbox "Name" [ref=e2]';
    },
    async title() {
      record(options, calls, 'title', []);
      return options.title ?? 'Fake page';
    },
    url: () => url,
    async goBack(opts) {
      record(options, calls, 'goBack', [opts]);
      return null;
    },
    async goForward(opts) {
      record(options, calls, 'goForward', [opts]);
      return null;
    },
    async reload(opts) {
      record(options, calls, 'reload', [opts]);
      return null;
    },
    async setViewportSize(size) {
      record(options, calls, 'setViewportSize', [size]);
      viewport = { ...size };
    },
    viewportSize: () => viewport,
    async emulateMedia(opts) {
      record(options, calls, 'emulateMedia', [opts]);
    },
    async route(pattern, handler) {
      record(options, calls, 'route', [pattern, handler]);
    },
    async unroute(pattern, handler) {
      record(options, calls, 'unroute', [pattern, handler]);
    },
    async unrouteAll(opts) {
      record(options, calls, 'page.unrouteAll', [opts]);
    },
    frames: () => [frame],
    mainFrame: () => frame,
    mouse: {
      click: async (x, y, opts) => record(options, calls, 'mouse.click', [x, y, opts]),
      move: async (x, y, opts) => record(options, calls, 'mouse.move', [x, y, opts]),
      down: async (opts) => record(options, calls, 'mouse.down', [opts]),
      up: async (opts) => record(options, calls, 'mouse.up', [opts]),
      wheel: async (dx, dy) => record(options, calls, 'mouse.wheel', [dx, dy]),
    },
    keyboard: {
      press: async (key, opts) => record(options, calls, 'keyboard.press', [key, opts]),
      type: async (text, opts) => record(options, calls, 'keyboard.type', [text, opts]),
    },
    isClosed: () => closed,
    async close() {
      record(options, calls, 'page.close', []);
      closed = true;
    },
    async bringToFront() {},
    video: () => undefined,
  };
  return page;
}

/** @param {FakeOptions} [options] @param {any[]} [calls] */
export function createFakeCdp(options = {}, calls = []) {
  let generation = 0;
  return {
    calls,
    /** @param {string} method @param {any} [params] */
    async send(method, params) {
      calls.push({ method: `cdp:${method}`, args: [params] });
      const failure = options.fail?.[`cdp:${method}`];
      if (failure instanceof Error) throw failure;
      if (method === 'Page.captureScreenshot') return { data: PNG_1X1.toString('base64') };
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        generation += 1;
        return { identifier: `gen-${String(generation)}` };
      }
      if (method === 'Runtime.evaluate') {
        return options.runtimeEvaluate
          ? options.runtimeEvaluate(params)
          : { result: { type: 'string', value: `evaluated ${String(params?.expression)}` } };
      }
      if (options.cdp) return options.cdp(method, params);
      return {};
    },
  };
}

/** @param {FakeOptions} [options] @param {any[]} [calls] */
export function createFakeContext(options = {}, calls = []) {
  /** @type {any[]} */
  const pages = [];
  /** @type {Map<string, Function[]>} */
  const listeners = new Map();
  const context = {
    calls,
    pages: () => pages.filter((p) => !p.isClosed()),
    async newPage() {
      record(options, calls, 'newPage', []);
      const page = createFakePage(options, calls);
      pages.push(page);
      return page;
    },
    async newCDPSession(page) {
      record(options, calls, 'newCDPSession', [page]);
      return createFakeCdp(options, calls);
    },
    async close() {
      record(options, calls, 'context.close', []);
    },
    async clearCookies(opts) {
      record(options, calls, 'clearCookies', [opts]);
    },
    async clearPermissions() {
      record(options, calls, 'clearPermissions', []);
    },
    async unrouteAll(opts) {
      record(options, calls, 'unrouteAll', [opts]);
    },
    async setOffline(offline) {
      record(options, calls, 'setOffline', [offline]);
    },
    async setExtraHTTPHeaders(headers) {
      record(options, calls, 'setExtraHTTPHeaders', [headers]);
    },
    async setGeolocation(geo) {
      record(options, calls, 'setGeolocation', [geo]);
    },
    setDefaultTimeout(ms) {
      record(options, calls, 'setDefaultTimeout', [ms]);
    },
    setDefaultNavigationTimeout(ms) {
      record(options, calls, 'setDefaultNavigationTimeout', [ms]);
    },
    async storageState(opts) {
      record(options, calls, 'storageState', [opts]);
      return { cookies: [], origins: [] };
    },
    async cookies() {
      return [{ name: 'sid', value: 's3cr3t' }];
    },
    async addCookies(cookies) {
      record(options, calls, 'addCookies', [cookies]);
    },
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return context;
    },
    tracing: {
      start: async (opts) => record(options, calls, 'tracing.start', [opts]),
      stop: async (opts) => record(options, calls, 'tracing.stop', [opts]),
    },
  };
  return context;
}

/** @param {FakeOptions} [options] */
export function createFakeBrowser(options = {}) {
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const contexts = [];
  let connected = true;
  /** @type {Map<string, Function[]>} */
  const listeners = new Map();
  const browser = {
    calls,
    contexts,
    async newContext(opts) {
      record(options, calls, 'newContext', [opts]);
      const context = createFakeContext(options, calls);
      contexts.push(context);
      return context;
    },
    version: () => '152.0.7977.65',
    isConnected: () => connected,
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return browser;
    },
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    async close() {
      record(options, calls, 'browser.close', []);
      connected = false;
    },
    process: () => undefined,
  };
  return browser;
}

/** Calls of one method, in order. @param {any[]} calls @param {string} method */
export const callsOf = (calls, method) => calls.filter((c) => c.method === method).map((c) => c.args);
