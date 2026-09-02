// trace-loads.mjs — `node --import=./test/hooks/trace-loads.mjs bin/browser-inspector.mjs help` records every
// module the process resolves into the file named by BROWSER_INSPECTOR_TRACE_LOADS (one URL per line).
//
// The client's start budget (DESIGN.md §2.4) dies quietly: one `import { something } from
// './engine.mjs'` added for convenience and `browser-inspector help` goes from 48 to 300 ms with no test red.
// test/client-imports.test.mjs reads this file and fails on playwright-core, engine.mjs or
// steps.run.mjs — the three imports that carry the browser.
//
// `module.registerHooks` (Node ≥ 22.15) runs in-thread and sees dynamic imports too; the older
// `module.register` needs a separate hooks thread and is used only when the sync API is missing.
import fs from 'node:fs';
import { register, registerHooks } from 'node:module';
import { isMainThread } from 'node:worker_threads';

const out = process.env.BROWSER_INSPECTOR_TRACE_LOADS;

/** @param {string} url */
function record(url) {
  if (!out) return;
  try {
    fs.appendFileSync(out, `${url}\n`);
  } catch {
    // A missing trace file must not change what the traced program does.
  }
}

/**
 * @param {string} specifier
 * @param {any} context
 * @param {(specifier: string, context: any) => any} next
 */
export function resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (result && typeof result.then === 'function') {
    return result.then((/** @type {{ url?: string }} */ r) => {
      if (r?.url) record(r.url);
      return r;
    });
  }
  if (result?.url) record(result.url);
  return result;
}

if (typeof registerHooks === 'function') {
  registerHooks({ resolve });
} else if (isMainThread) {
  register(import.meta.url);
}
