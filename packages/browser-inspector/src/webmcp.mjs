// webmcp.mjs — the in-page half of `browser-inspector tools` / `browser-inspector call` (WebMCP).
//
// A page registers WebMCP tools through `navigator.modelContext.registerTool(tool)` — the Web Machine
// Learning CG proposal that Angular 22 implements behind `provideExperimentalWebMcpTools`. Two things
// stop a script from just calling them: the native API exists only behind a Chrome flag, and even
// there the page has no way to LIST what it registered — the user agent keeps the registry. This
// init script IS that registry, installed on every session context before any page script runs.
// Without a native API it stands in for `navigator.modelContext` (registerTool / unregisterTool /
// provideContext / clearContext — the explainer's surface, mirrored on `document.modelContext` the
// way Angular and Playwright look it up); with one it wraps `registerTool` / `unregisterTool`, so the
// native registry and this one see the same tools. `window.__bi_webmcp.list()` and
// `.call(name, input)` are what the two runners evaluate. Pure strings, no imports — the client may
// import this module (DESIGN.md §2.1: the client never pays for playwright-core).

/** The window property the runners read: `globalThis[WEBMCP_GLOBAL].list()` / `.call(name, input)`. */
export const WEBMCP_GLOBAL = '__bi_webmcp';

/**
 * The shim, written as a function so the editor checks it, serialised for `addInitScript`. It runs
 * in the PAGE: nothing from this module is in scope, only what the function body carries.
 */
function webmcpShim() {
  const w = /** @type {any} */ (globalThis);
  /** @type {Map<string, any>} */
  const tools = new Map();
  const record = (/** @type {any} */ tool, /** @type {any} */ options) => {
    if (!tool || typeof tool.name !== 'string' || tool.name === '') {
      throw new TypeError('registerTool: a tool needs a non-empty name');
    }
    tools.set(tool.name, tool);
    const signal = options && options.signal;
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener(
        'abort',
        () => {
          if (tools.get(tool.name) === tool) tools.delete(tool.name);
        },
        { once: true },
      );
    }
  };
  const native = (w.document && w.document.modelContext) || (w.navigator && w.navigator.modelContext);
  if (native && typeof native.registerTool === 'function') {
    // Native WebMCP (Chrome behind its flag): keep the browser's registry AND ours in step.
    const registerNative = native.registerTool.bind(native);
    const unregisterNative = typeof native.unregisterTool === 'function' ? native.unregisterTool.bind(native) : null;
    try {
      native.registerTool = (/** @type {any} */ tool, /** @type {any} */ options) => {
        record(tool, options);
        return registerNative(tool, options);
      };
      if (unregisterNative) {
        native.unregisterTool = (/** @type {string} */ name) => {
          tools.delete(name);
          return unregisterNative(name);
        };
      }
    } catch {
      // A frozen native object: native registrations stay invisible to `tools`; nothing else breaks.
    }
  } else {
    const modelContext = {
      registerTool(/** @type {any} */ tool, /** @type {any} */ options) {
        record(tool, options);
        return Promise.resolve();
      },
      unregisterTool(/** @type {string} */ name) {
        tools.delete(name);
        return Promise.resolve();
      },
      provideContext(/** @type {any} */ context) {
        tools.clear();
        for (const tool of (context && context.tools) || []) record(tool, undefined);
        return Promise.resolve();
      },
      clearContext() {
        tools.clear();
        return Promise.resolve();
      },
    };
    for (const host of [w.navigator, w.document]) {
      try {
        Object.defineProperty(host, 'modelContext', { configurable: true, value: modelContext });
      } catch {
        // Not definable here — the other host still gets it.
      }
    }
  }
  const list = () =>
    [...tools.values()].map((tool) => ({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      inputSchema: tool.inputSchema === undefined ? null : tool.inputSchema,
      annotations: tool.annotations === undefined ? null : tool.annotations,
    }));
  const call = async (/** @type {string} */ name, /** @type {unknown} */ input) => {
    const tool = tools.get(name);
    if (!tool)
      return { ok: false, error: `unknown tool "${name}" — browser-inspector tools lists what the page registered` };
    if (typeof tool.execute !== 'function') return { ok: false, error: `tool "${name}" has no execute()` };
    try {
      const result = await tool.execute(input === undefined ? {} : input, { signal: new AbortController().signal });
      // Structured clone would carry class instances the keeper cannot print; JSON is the contract.
      return { ok: true, result: JSON.parse(JSON.stringify(result === undefined ? null : result)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  try {
    Object.defineProperty(w, '__bi_webmcp', { configurable: true, value: { list, call } });
  } catch {
    w.__bi_webmcp = { list, call };
  }
}

/** The init script `openSession` installs: the shim above, invoked once per document. */
export const WEBMCP_SHIM_SCRIPT = `(${webmcpShim.toString()})();`;
