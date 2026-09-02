// steps.run.mjs — `RUNNERS[name] = async (ctx, step) => …`, the engine-side twin of `STEPS`
// (DESIGN.md §3.2). Imported ONLY by the engine: the client parses argv from `steps.schema.mjs`
// and never pays for playwright-core. A test keeps `Object.keys(RUNNERS)` ≡ `Object.keys(STEPS)`.
//
// The batch section (WP2) covers every step a config may carry. The session section (WP6) covers
// the rows marked `batch: false` in the schema (find, routes, tabs, console, net, trace, video,
// locator, run, close) and the session spellings of the shared ones (`snap --max/--diff/--around`,
// `eval` inline-or-file, `fetch` as a response, `dialog` without a policy = show). A session runner
// writes its stdout into `ctx.lines`; the engine's `runCommand` prints those lines as they are,
// because for a query command the content IS the result (DESIGN.md §4.4).
//
// Every runner sees the same `ctx` (StepContext in types.d.ts + the engine's helpers: `sel`,
// `loc`, `navigate`, `artifact`, `emit`, `value`, `setPage`). A runner THROWS on failure — the
// engine turns the throw into `steps[i].ok === false` and stops the flow; it never catches here.

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { EXTRACT_CAP, evaluateWithTimeout, saveScreenshot, stringifyResult } from './capture.mjs';
import { degradeTo, withDeadline } from './deadline.mjs';
import {
  EVAL_INLINE_MAX,
  SEP,
  formatConsoleEntry,
  formatDialogStatus,
  formatEval,
  formatNetBody,
  formatNetEntry,
  formatNetSummary,
  formatNewEntries,
  formatOk,
  formatOverflow,
  relPath,
  truncate,
  urlDisplay,
} from './print.mjs';
import { maskSnapshotValues } from './redact.mjs';
import {
  aroundRef,
  compactLines,
  diffSnapshot,
  findInSnapshot,
  locatorFor,
  locatorForElement,
  parseSnapshot,
  sensitiveRefs,
} from './snapshot.mjs';
import { MODIFIERS, isRef } from './steps.schema.mjs';

/** @typedef {import('./types.js').StepContext} StepContext */
/** @typedef {import('./types.js').Step} Step */

/** @typedef {StepContext & Record<string, any>} Ctx */

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {Ctx} ctx */
const opts = (ctx) => ({ timeout: ctx.timeoutMs });

/**
 * `ctrl,shift` (session spelling) or `Control` (Playwright's) → Playwright's list.
 * @param {unknown} mods
 * @returns {string[] | undefined}
 */
const modifiersOf = (mods) =>
  Array.isArray(mods) ? mods.map((m) => /** @type {Record<string, string>} */ (MODIFIERS)[m] ?? String(m)) : undefined;

/**
 * Where an action runs: the frame scope (`browser-inspector frame 2`) for CSS/text selectors, the page for refs —
 * an `aria-ref=` resolves from the page's last snapshot in whatever frame it lives (DESIGN.md §4.5).
 * A scope whose document is gone is dropped first: navigating the main frame detaches every child
 * frame, and `setPage` is not on that path, so a `frame <n>` set before a `goto` / `reload` /
 * `back` / a click on a link would otherwise answer `Frame was detached` for every later CSS
 * selector — in a session until the agent guesses `frame main`.
 * @param {Ctx} ctx @param {string} selector
 * @returns {any} the frame to run in, or `undefined` for the page
 */
export function frameFor(ctx, selector) {
  if (ctx.frame?.isDetached?.() === true) ctx.frame = undefined;
  return ctx.frame && !selector.startsWith('aria-ref=') ? ctx.frame : undefined;
}

/** @param {Ctx} ctx @param {string} selector */
const root = (ctx, selector) => frameFor(ctx, selector) ?? ctx.page;

/**
 * A `target` field (`drag.from`, `drag.to`): a ref or a selector in one string.
 * @param {Ctx} ctx @param {unknown} raw
 */
const targetOf = (ctx, raw) => ctx.sel(isRef(raw) ? { do: '', ref: raw } : { do: '', selector: String(raw) });

/**
 * A file named in a step: content sent by the client (`ctx.files`, base64 or an absolute path),
 * otherwise read relative to the run's cwd — the in-process path has the same cwd as the config.
 * @param {Ctx} ctx @param {string} name
 * @returns {Buffer}
 */
export function fileContent(ctx, name) {
  const sent = ctx.files?.[name];
  if (sent?.base64) return Buffer.from(sent.base64, 'base64');
  if (sent?.path) return readFileSync(sent.path);
  return readFileSync(path.resolve(ctx.cwd ?? process.cwd(), name));
}

/**
 * What `setInputFiles` gets for one step file: an inline payload when the client sent the bytes,
 * a path otherwise.
 * @param {Ctx} ctx @param {string} name
 */
function uploadPayload(ctx, name) {
  const sent = ctx.files?.[name];
  if (sent?.base64) {
    return {
      name: path.basename(name),
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(sent.base64, 'base64'),
    };
  }
  return sent?.path ?? path.resolve(ctx.cwd ?? process.cwd(), name);
}

/**
 * A Playwright URL glob (`**\/cart`, `http://localhost:*\/x`, `**\/{cart,checkout}`) → RegExp, by the
 * SAME rules `page.route` applies to the same string. It has to be the same language: `route` hands
 * its pattern to Playwright and `wait --url` / `verify url` translate theirs here, so one config
 * used to block `**\/api/{users,posts}` and then wait forever for a URL it could never match. The
 * differences that bit: `{a,b}` is an alternation, `?` is a literal, `\x` escapes, and `/**\/` may
 * match nothing at all (`http://x/**\/items` must match `http://x/items`).
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  const escaped = new Set([...'$^+.*()|\\?{}[]']);
  const tokens = ['^'];
  let inGroup = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[(i += 1)];
      tokens.push(escaped.has(next) ? `\\${next}` : next);
      continue;
    }
    if (ch === '*') {
      const before = pattern[i - 1];
      let stars = 1;
      while (pattern[i + 1] === '*') {
        stars += 1;
        i += 1;
      }
      if (stars === 1) tokens.push('([^/]*)');
      else if (pattern[i + 1] === '/') {
        tokens.push(before === '/' ? '((.+/)|)' : '(.*/)');
        i += 1;
      } else tokens.push('(.*)');
      continue;
    }
    if (ch === '{') {
      if (inGroup) throw new Error(`invalid url pattern ${JSON.stringify(pattern)}: nested '{' is not supported`);
      inGroup = true;
      tokens.push('(');
    } else if (ch === '}') {
      if (!inGroup) throw new Error(`invalid url pattern ${JSON.stringify(pattern)}: unmatched '}'`);
      inGroup = false;
      tokens.push(')');
    } else if (ch === ',' && inGroup) tokens.push('|');
    else tokens.push(escaped.has(ch) ? `\\${ch}` : ch);
  }
  if (inGroup) throw new Error(`invalid url pattern ${JSON.stringify(pattern)}: unmatched '{'`);
  tokens.push('$');
  return new RegExp(tokens.join(''), 'u');
}

/**
 * The result of a query step goes where its mode says: under `name` into `extracts` (batch, or a
 * session `--name`), otherwise onto the session's stdout lines.
 * @param {Ctx} ctx @param {Step} s @param {string} text
 */
function emit(ctx, s, text) {
  // The WHOLE value goes to the report: capping it here made `values/<name>.txt` a duplicate of the
  // head report.json already holds, and the rest of the value existed nowhere. `buildReport` keeps
  // the head in the JSON and writes the whole thing to the file report.md points at.
  if (typeof s.name === 'string') ctx.capture.extracts[s.name] = { value: text, truncated: false };
  else if (ctx.lines) ctx.lines.push(text.length > EXTRACT_CAP ? text.slice(0, EXTRACT_CAP) : text);
  return text;
}

/**
 * Poll a check until it passes or the step timeout runs out — `verify` tolerates the same render
 * lag `expect(locator)` does, without a framework.
 * @param {Ctx} ctx
 * @param {() => Promise<{ ok: boolean, detail: string }>} check
 */
async function until(ctx, check) {
  const deadline = Date.now() + ctx.timeoutMs;
  for (;;) {
    let result;
    try {
      result = await check();
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message.split('\n')[0] : String(error) };
    }
    if (result.ok || Date.now() >= deadline) return result;
    await sleep(50);
  }
}

// ── Session helpers ──────────────────────────────────────────────────────────

/** `browser-inspector snap` prints this many compact lines unless `--max` says otherwise (≈ 370 tokens, §4.3). */
export const SNAP_MAX_DEFAULT = 25;
/** `net <n> --body` / `fetch` print at most this many body lines; the whole body goes to a file. */
export const BODY_LINES_MAX = 20;
/** `net --all` lists at most this many entries unless `--tail` says otherwise. */
export const NET_LIST_MAX = 25;

/**
 * Guard for the rows the schema marks `batch: false`: outside a session there is no `ctx.lines`
 * to print into and no session state to read.
 * @param {Ctx} ctx @param {string} name
 * @returns {string[]}
 */
function sessionLines(ctx, name) {
  if (!ctx.lines || !ctx.session)
    throw new Error(`${name}: a session command, not a config step (browser-inspector ${name} …)`);
  return ctx.lines;
}

/** The session state behind a session runner (`sessionLines` has already proven it exists). */
const sessionOf = (/** @type {Ctx} */ ctx) => /** @type {Record<string, any>} */ (ctx.session);

/** A session file as the agent will `cat` it: relative to the command's cwd, forward slashes. */
const rel = (/** @type {Ctx} */ ctx, /** @type {string} */ file) => relPath(file, ctx.cwd ?? process.cwd());

/**
 * Compact lines with the same masking `snap.md` gets (password / one-time-code fields never carry
 * a value, secrets are `***`) — one place, so stdout and the file never disagree.
 * @param {Ctx} ctx @param {readonly string[]} lines
 */
function maskLines(ctx, lines) {
  if (lines.length === 0) return [];
  const entries = ctx.lastSnapshot?.entries ?? [];
  return maskSnapshotValues(lines.join('\n'), {
    sensitiveRefs: sensitiveRefs(entries),
    secretValues: ctx.secretValues,
    // The snapshot whose walk failed has no sensitivity to go by: stdout follows the file.
    maskAllValueRoles: ctx.lastSnapshot?.valuesUnknown === true,
  }).split('\n');
}

/**
 * The durable selector of a ref, resolved on the live element (`data-testid` → `#id` → `[name]` →
 * `a[href]` → `role=`), the sidecar of the last snapshot as the fallback when the element refuses
 * `evaluate` (gone with a navigation, cross-origin frame). `selector` is `undefined` when nothing
 * durable exists.
 *
 * `inFrame` is the second half of the answer, and the selector alone cannot carry it: it is
 * computed inside the element's OWN document, while a config step resolves it in the main one. A
 * ref inside an `<iframe>` therefore exported as a bare selector that replayed against a
 * like-named element of the parent — or against nothing. The ref prefix does not help: after any
 * navigation the MAIN document's refs carry an `f<seq>` too.
 * @param {Ctx} ctx @param {string} ref
 * @returns {Promise<{ selector?: string, inFrame: boolean }>}
 */
export async function durableSelector(ctx, ref) {
  const locator = ctx.page.locator(`aria-ref=${ref}`).first();
  const budget = Math.min(ctx.timeoutMs, 1000);
  const live = await degradeTo(
    undefined,
    Promise.resolve()
      .then(() => locator.evaluate(locatorForElement))
      .catch(() => undefined),
    budget,
    `locator ${ref}`,
  );
  const selector =
    typeof live === 'string' && live !== ''
      ? live
      : (() => {
          const entry = (ctx.lastSnapshot?.entries ?? []).find((/** @type {any} */ e) => e?.ref === ref);
          return entry ? (entry.selector ?? locatorFor(entry)) : undefined;
        })();
  if (selector === undefined) return { selector: undefined, inFrame: false };
  const inFrame = await degradeTo(
    false,
    Promise.resolve()
      .then(() =>
        locator.evaluate((/** @type {any} */ el) => {
          const view = el.ownerDocument?.defaultView;
          return Boolean(view && view.top !== view);
        }),
      )
      .catch(() => false),
    budget,
    `frame of ${ref}`,
  );
  return { selector, inFrame: inFrame === true };
}

/** Console entry types → the three levels of `--level`; `pageerror` counts as an error. */
const levelOf = (/** @type {string} */ type) =>
  type === 'error' || type === 'pageerror' ? 2 : type === 'warning' || type === 'warn' ? 1 : 0;

/** @param {any} entry */
const netFailed = (entry) => entry.failure !== undefined || (typeof entry.status === 'number' && entry.status >= 400);

/**
 * Write a text artifact of the session (`net/7.txt`, `eval-003.txt`) and return its path.
 * @param {Ctx} ctx @param {string} relFile @param {string} text
 */
async function writeSessionText(ctx, relFile, text) {
  const file = path.join(ctx.dir, relFile);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, ctx.redact(text), 'utf8');
  ctx.written.push(relFile);
  return file;
}

/**
 * `snap.md` / `browser-inspector snap` lines of the snapshot just written, with the session filters of §4.3:
 * `--all` names the file, `--diff` the lines added/removed since the previous snapshot, `--around`
 * the neighbourhood of a ref, `--grep`/`--names` re-render the compact view, and `--max` (25)
 * caps stdout with the overflow marker. Never a second `ariaSnapshot`.
 * @param {Ctx} ctx @param {Step} s @param {string} text the full `ai` YAML just taken
 */
function snapshotLines(ctx, s, text) {
  const lines = sessionLines(ctx, 'snap');
  const session = ctx.session;
  const entries = ctx.lastSnapshot?.entries ?? [];
  const mdFile = rel(ctx, path.join(ctx.dir, 'snap.md'));
  const compact = maskLines(ctx, compactLines(text, { sidecar: entries }));
  const max = typeof s.max === 'number' && s.max > 0 ? s.max : SNAP_MAX_DEFAULT;
  /** @param {string[]} out */
  const capped = (out) => {
    if (out.length <= max) return out;
    return [...out.slice(0, max), formatOverflow(out.length - max, mdFile)];
  };
  if (s.all === true) {
    const full = rel(ctx, path.join(ctx.dir, 'snap.full.yml'));
    lines.push(formatOk(`snap ${String(compact.length)} lines`, [full, mdFile]));
  } else if (s.diff === true) {
    const previous = /** @type {string[] | undefined} */ (session?.prevCompact) ?? [];
    const { added, removed } = diffSnapshot(previous, compact);
    if (added.length === 0 && removed.length === 0) lines.push(`0 changed${SEP}${mdFile}`);
    else lines.push(...capped([...added.map((l) => `+ ${l}`), ...removed.map((l) => `- ${l}`)]));
  } else if (typeof s.around === 'string') {
    const near = maskLines(ctx, aroundRef(text, s.around, { sidecar: entries, names: s.names === true }));
    if (near.length > 0) lines.push(...capped(near));
    else {
      // Two different answers used to share one line: a ref that is GONE and a ref that is alive
      // but has no compact line (a `generic` `find` just handed out, a heading). Telling the agent
      // "not in snapshot" about a ref it can still click is how a good ref gets thrown away.
      const alive = parseSnapshot(text).some((node) => node.ref === s.around);
      const full = rel(ctx, path.join(ctx.dir, 'snap.full.yml'));
      lines.push(
        alive ? `ref ${s.around} outside the compact${SEP}${full}` : `ref ${s.around} not in snapshot${SEP}${mdFile}`,
      );
    }
  } else {
    const view =
      s.names === true || typeof s.grep === 'string'
        ? maskLines(
            ctx,
            compactLines(text, {
              sidecar: entries,
              names: s.names === true,
              grep: typeof s.grep === 'string' ? s.grep : undefined,
            }),
          )
        : compact;
    lines.push(...(view.length === 0 ? [`0 lines${SEP}${mdFile}`] : capped(view)));
  }
  if (session) session.prevCompact = compact;
}

/**
 * Body lines as `net <n> --body` and `fetch` print them: at most BODY_LINES_MAX, each one capped.
 * @param {string} body
 */
function bodyLines(body) {
  const all = body.split(/\r?\n/u).filter((l) => l.trim() !== '');
  const shown = all.slice(0, BODY_LINES_MAX).map((l) => truncate(l));
  if (all.length > BODY_LINES_MAX) shown.push(`…+${String(all.length - BODY_LINES_MAX)} lines`);
  return shown;
}

/** @param {Ctx} ctx @param {Step} s */
async function storageInPage(ctx, s, value) {
  const result = await withDeadline(
    ctx.page.evaluate(
      (/** @type {{ kind: string, op: string, key?: string, value?: string }} */ args) => {
        const store = args.kind === 'local' ? window.localStorage : window.sessionStorage;
        switch (args.op) {
          case 'list': {
            /** @type {Record<string, string>} */
            const all = {};
            for (let i = 0; i < store.length; i += 1) {
              const key = store.key(i);
              if (key !== null) all[key] = store.getItem(key) ?? '';
            }
            return JSON.stringify(all);
          }
          case 'get':
            return store.getItem(args.key ?? '') ?? '';
          case 'set':
            store.setItem(args.key ?? '', args.value ?? '');
            return 'ok';
          case 'del':
            store.removeItem(args.key ?? '');
            return 'ok';
          default:
            store.clear();
            return 'ok';
        }
      },
      { kind: String(s.kind), op: String(s.op), key: s.key === undefined ? undefined : String(s.key), value },
    ),
    ctx.timeoutMs,
    `storage ${String(s.kind)} ${String(s.op)}`,
  );
  return String(result);
}

/** @param {Ctx} ctx @param {Step} s @param {string | undefined} value */
async function cookies(ctx, s, value) {
  const context = ctx.context;
  switch (s.op) {
    case 'list':
      return JSON.stringify((await context.cookies?.()) ?? []);
    case 'get': {
      const found = ((await context.cookies?.()) ?? []).find((c) => c.name === s.key);
      return found ? String(found.value) : '';
    }
    case 'set': {
      await context.addCookies?.([{ name: String(s.key), value: value ?? '', url: ctx.page.url() }]);
      return 'ok';
    }
    case 'del': {
      await context.clearCookies({ name: String(s.key) });
      return 'ok';
    }
    default:
      await context.clearCookies();
      return 'ok';
  }
}

/** @type {Record<string, (ctx: Ctx, s: Step) => Promise<any>>} */
export const RUNNERS = {
  goto: async (ctx, s) => ctx.navigate(String(s.url), s.waitUntil),
  back: async (ctx) => ctx.page.goBack(opts(ctx)),
  forward: async (ctx) => ctx.page.goForward(opts(ctx)),
  reload: async (ctx, s) => {
    const waitUntil = s.waitUntil ?? ctx.snapshot?.waitUntil ?? 'load';
    await ctx.page.reload({ ...opts(ctx), waitUntil: waitUntil === 'settled' ? 'load' : waitUntil });
    if (waitUntil === 'settled') await ctx.settle();
  },
  click: async (ctx, s) => {
    const sel = await ctx.sel(s);
    await root(ctx, sel).click(sel, {
      ...opts(ctx),
      clickCount: /** @type {number} */ (s.count ?? 1),
      button: /** @type {'left' | 'right' | 'middle'} */ (s.button ?? 'left'),
      ...(s.modifiers ? { modifiers: modifiersOf(s.modifiers) } : {}),
    });
  },
  fill: async (ctx, s) => {
    const sel = await ctx.sel(s);
    await root(ctx, sel).fill(sel, ctx.value('value', s), opts(ctx));
    if (s.enter === true) await root(ctx, sel).press(sel, 'Enter', opts(ctx));
  },
  type: async (ctx, s) => {
    const sel = await ctx.sel(s);
    await root(ctx, sel).type(sel, ctx.value('value', s), { ...opts(ctx), ...(s.slowly ? { delay: 50 } : {}) });
  },
  form: async (ctx, s) => {
    const fields = /** @type {Step[]} */ (s.fields ?? []);
    const address = ctx.address;
    try {
      for (const [k, field] of fields.entries()) {
        const sel = await ctx.sel(field);
        // The client addresses a field's secret as `<step>.fields[k].value` (docs/handoff/WP1.md).
        ctx.address = `${address}.fields[${String(k)}]`;
        await root(ctx, sel).fill(sel, ctx.value('value', field), opts(ctx));
      }
    } finally {
      ctx.address = address;
    }
  },
  press: async (ctx, s) => {
    if (s.ref !== undefined || s.selector !== undefined) {
      const sel = await ctx.sel(s);
      await root(ctx, sel).press(sel, String(s.key), opts(ctx));
    } else await ctx.page.keyboard.press(String(s.key));
  },
  hover: async (ctx, s) => {
    const sel = await ctx.sel(s);
    await root(ctx, sel).hover(sel, opts(ctx));
  },
  select: async (ctx, s) => {
    const sel = await ctx.sel(s);
    await root(ctx, sel).selectOption(sel, s.values ?? String(s.value), opts(ctx));
  },
  check: async (ctx, s) => {
    const sel = await ctx.sel(s);
    await root(ctx, sel).check(sel, opts(ctx));
  },
  uncheck: async (ctx, s) => {
    const sel = await ctx.sel(s);
    await root(ctx, sel).uncheck(sel, opts(ctx));
  },
  drag: async (ctx, s) => {
    const from = await targetOf(ctx, s.from);
    const to = await targetOf(ctx, s.to);
    await root(ctx, from).dragAndDrop(from, to, opts(ctx));
  },
  upload: async (ctx, s) => {
    const sel = await ctx.sel(s);
    const files = /** @type {string[]} */ (s.files ?? []).map((name) => uploadPayload(ctx, name));
    await root(ctx, sel).setInputFiles(sel, files, opts(ctx));
  },
  scroll: async (ctx, s) => {
    if (s.to === undefined) {
      const sel = await ctx.sel(s);
      await ctx.loc(sel).first().scrollIntoViewIfNeeded?.(opts(ctx));
      return;
    }
    // A deadline like every other page.evaluate — a main thread left spinning by an earlier step
    // used to hang HERE, the one evaluate the old fix round missed.
    await withDeadline(
      ctx.page.evaluate(
        (/** @type {string} */ edge) => window.scrollTo(0, edge === 'top' ? 0 : document.body.scrollHeight),
        String(s.to),
      ),
      ctx.timeoutMs,
      'scroll to page edge',
    );
  },
  mouse: async (ctx, s) => {
    const mouse = ctx.page.mouse;
    const button = s.button ? { button: /** @type {'left' | 'right' | 'middle'} */ (s.button) } : {};
    const num = (/** @type {unknown} */ v) => Number(v ?? 0);
    switch (s.action) {
      case 'click':
        return mouse.click(num(s.x), num(s.y), button);
      case 'move':
        return mouse.move(num(s.x), num(s.y));
      case 'down':
        return mouse.down(button);
      case 'up':
        return mouse.up(button);
      case 'wheel':
        return mouse.wheel(num(s.dx), num(s.dy));
      default: {
        await mouse.move(num(s.x), num(s.y));
        await mouse.down(button);
        await mouse.move(num(s.toX), num(s.toY), { steps: 5 });
        await mouse.up(button);
        return undefined;
      }
    }
  },
  wait: async (ctx, s) => {
    if (s.ms !== undefined) return ctx.page.waitForTimeout(Number(s.ms));
    if (s.selector !== undefined) return ctx.page.waitForSelector(String(s.selector), opts(ctx));
    if (s.url !== undefined) {
      const pattern = globToRegExp(String(s.url));
      return ctx.page.waitForURL
        ? ctx.page.waitForURL(pattern, opts(ctx))
        : until(ctx, async () => ({ ok: pattern.test(ctx.page.url()), detail: `url ${ctx.page.url()}` }));
    }
    const gone = s.textGone !== undefined;
    const text = String(gone ? s.textGone : s.text);
    return ctx.page.waitForFunction(
      (/** @type {{ text: string, gone: boolean }} */ args) =>
        ((document.body?.innerText ?? '').includes(args.text) ? 1 : 0) === (args.gone ? 0 : 1),
      { text, gone },
      opts(ctx),
    );
  },
  waitFor: async (ctx, s) => {
    const sel = await ctx.sel(s);
    await root(ctx, sel).waitForSelector(sel, { ...opts(ctx), state: /** @type {any} */ (s.state ?? 'visible') });
  },
  screenshot: async (ctx, s) => {
    const name = typeof s.name === 'string' ? s.name : 'shot';
    const format = s.format === 'jpeg' ? 'jpeg' : 'png';
    const target = s.ref !== undefined || s.selector !== undefined ? await ctx.sel(s) : undefined;
    const { file, rel } = ctx.artifact(name, format === 'jpeg' ? 'jpg' : 'png');
    const saved = await saveScreenshot(ctx.page, ctx.cdp, file, {
      format,
      ...(typeof s.quality === 'number' ? { quality: s.quality } : {}),
      fullPage: s.fullPage === true,
      ...(target ? { selector: target, root: frameFor(ctx, target) } : {}),
      ...(typeof s.mark === 'string' ? { mark: `aria-ref=${s.mark}` } : {}),
      timeoutMs: ctx.timeoutMs,
    });
    ctx.capture.pending?.push(saved.write);
    ctx.capture.screenshots.push(rel);
    ctx.lastShot = { file: rel, width: saved.width, height: saved.height, bytes: saved.bytes };
    return rel;
  },
  pdf: async (ctx, s) => {
    const { file, rel } = ctx.artifact(typeof s.name === 'string' ? s.name : 'page', 'pdf');
    await ctx.page.pdf({ path: file });
    ctx.written.push(rel);
    return rel;
  },
  extract: async (ctx, s) => {
    const sel = await ctx.sel(s);
    const target = ctx.loc(sel).first();
    const text = s.value === true ? await target.inputValue?.(opts(ctx)) : await target.innerText(opts(ctx));
    return emit(ctx, s, String(text ?? '').trim());
  },
  evaluate: async (ctx, s) => {
    const expression = typeof s.file === 'string' ? fileContent(ctx, s.file).toString('utf8') : String(s.expression);
    const timeoutMs = typeof s.timeout === 'number' ? s.timeout : ctx.timeoutMs;
    const label = `evaluate${typeof s.name === 'string' ? ` "${s.name}"` : ''}`;
    let text;
    if (s.ref !== undefined || s.selector !== undefined) {
      // `eval --el eN`: the expression sees the element as `el`, through the locator, not CDP.
      const sel = await ctx.sel(s);
      const value = await withDeadline(
        ctx
          .loc(sel)
          .first()
          .evaluate(
            (/** @type {any} */ el, /** @type {string} */ src) => new Function('el', `return (${src});`)(el),
            expression,
          ),
        timeoutMs,
        label,
      );
      text = stringifyResult(value);
    } else {
      // CDP evaluates in the MAIN frame's context, whatever `ctx.frame` says, and the result
      // mapping of DESIGN.md §2.2 is pinned to that path. Answering with another document's state
      // under a `frame <n>` scope is the one outcome that must not happen quietly.
      // `frame 0` / `frame main` IS the main frame — CDP already evaluates there.
      const scope = frameFor(ctx, '');
      if (scope && ctx.page.mainFrame?.() !== scope) {
        throw new Error('eval: the frame scope does not reach eval — use `eval --el <eN|selector>` or `frame main`');
      }
      text = await evaluateWithTimeout(ctx.cdp, expression, { timeoutMs, label });
    }
    if (ctx.lines && ctx.session && typeof s.name !== 'string') {
      // The session policy of §4.4: inline up to 300 chars, longer to `eval-NNN.txt`.
      let file;
      if (text.length > EVAL_INLINE_MAX) {
        ctx.session.evalSeq = (ctx.session.evalSeq ?? 0) + 1;
        const relFile = `eval-${String(ctx.session.evalSeq).padStart(3, '0')}.txt`;
        file = rel(ctx, await writeSessionText(ctx, relFile, text));
      }
      ctx.lines.push(...formatEval(text, file));
      return text;
    }
    return emit(ctx, s, text);
  },
  snapshot: async (ctx, s) => {
    // ALWAYS the full `ai` snapshot: a subtree or `default` mode would overwrite the ref map and
    // kill every other ref (DESIGN.md §4.2). Filters (--max, --grep, --around) are JS over the YAML.
    // `boxes: true` costs nothing extra (same refs, WP3 fact 5) and feeds the box-join sidecar.
    const text = await withDeadline(ctx.page.ariaSnapshot({ mode: 'ai', boxes: true }), ctx.timeoutMs, 'snapshot');
    ctx.lastSnapshot = { text, at: Date.now() };
    const md = await ctx.writeSnapshot(text, s);
    if (ctx.lines && ctx.session) snapshotLines(ctx, s, text);
    return md;
  },
  find: async (ctx, s) => {
    const lines = sessionLines(ctx, 'find');
    // `find` looks at the page NOW: one full snapshot (the ref map every later click resolves
    // against), the files refreshed, then a JS search over the whole tree — never a subtree query.
    const text = await withDeadline(ctx.page.ariaSnapshot({ mode: 'ai', boxes: true }), ctx.timeoutMs, 'find');
    ctx.lastSnapshot = { text, at: Date.now() };
    await ctx.writeSnapshot(text, {});
    const entries = ctx.lastSnapshot?.entries ?? [];
    const found = findInSnapshot(text, String(s.text), { sidecar: entries, names: s.names === true });
    if (found.lines.length === 0) {
      lines.push(`0 matches for ${JSON.stringify(String(s.text))}`);
      return 0;
    }
    lines.push(...maskLines(ctx, found.lines));
    if (found.total > found.lines.length) {
      lines.push(
        `…+${String(found.total - found.lines.length)} more${SEP}narrow the text or browser-inspector snap --grep`,
      );
    }
    if (ctx.session) ctx.session.prevCompact = maskLines(ctx, compactLines(text, { sidecar: entries }));
    return found.total;
  },
  verify: async (ctx, s) => {
    const soft = s.soft === true;
    const kind = String(s.kind);
    /** @type {string | undefined} */
    let target;
    /** @type {string | undefined} */
    let unresolved;
    if (s.ref !== undefined || s.selector !== undefined) {
      try {
        target = await ctx.sel(s);
      } catch (error) {
        // A target that does not resolve is this step's VERDICT, not an exception: `soft` has to
        // record it in `verifications[]` and the flow has to reach the next step. Resolving stays
        // OUTSIDE `until` — a dead ref costs one snapshot refresh, not the whole timeout (§4.1).
        unresolved = error instanceof Error ? error.message.split('\n')[0] : String(error);
      }
    }
    const locator = target !== undefined ? ctx.loc(target).first() : undefined;
    const address = String(s.ref ?? s.selector ?? '');
    const result = unresolved
      ? { ok: false, detail: `${address}: ${unresolved}` }
      : await until(ctx, async () => {
          switch (kind) {
            case 'visible':
            case 'hidden': {
              const visible = (await locator?.isVisible?.()) === true;
              const ok = kind === 'visible' ? visible : !visible;
              return { ok, detail: `expected ${String(target)} ${kind}, it is ${visible ? 'visible' : 'hidden'}` };
            }
            case 'text': {
              // `innerText` falls back to `textContent` on a node the page does not render, so text
              // alone would pass an assertion about a `hidden` banner nobody can see (§2.4 parity with
              // `browser_verify_text_visible`). Visibility first, then the text.
              const visible = (await locator?.isVisible?.()) !== false;
              const text = (await locator?.innerText(opts(ctx))) ?? '';
              const ok = visible && text.includes(String(s.text));
              return {
                ok,
                detail: visible
                  ? `expected ${String(target)} to contain ${JSON.stringify(s.text)}, got ${JSON.stringify(text.slice(0, 80))}`
                  : `expected ${String(target)} to contain ${JSON.stringify(s.text)}, the element is hidden`,
              };
            }
            case 'value': {
              const value = (await locator?.inputValue?.(opts(ctx))) ?? '';
              return {
                ok: value === String(s.value),
                detail: `expected ${String(target)} value ${JSON.stringify(s.value)}, got ${JSON.stringify(value)}`,
              };
            }
            case 'list': {
              // Same reason as `text`: DESIGN.md §3.2 promises the VISIBLE text of the descendants.
              const visible = (await locator?.isVisible?.()) !== false;
              const text = visible ? ((await locator?.innerText(opts(ctx))) ?? '') : '';
              const items = /** @type {string[]} */ (s.items ?? []);
              let from = 0;
              /** @type {string | undefined} */
              let missing;
              for (const item of items) {
                const at = text.indexOf(item, from);
                if (at < 0) {
                  missing = item;
                  break;
                }
                from = at + item.length;
              }
              return {
                ok: visible && missing === undefined,
                detail: !visible
                  ? `expected ${String(target)} to list ${String(items.length)} items, the element is hidden`
                  : missing === undefined
                    ? 'ok'
                    : `expected ${String(target)} to list ${JSON.stringify(missing)} in order`,
              };
            }
            case 'count': {
              const count = await ctx.loc(String(target)).count();
              return {
                ok: count === Number(s.count),
                detail: `expected ${String(s.count)} × ${String(target)}, got ${String(count)}`,
              };
            }
            case 'url': {
              const url = ctx.page.url();
              return { ok: globToRegExp(String(s.url)).test(url), detail: `expected url ${String(s.url)}, got ${url}` };
            }
            default: {
              const title = await ctx.page.title();
              return {
                ok: title.includes(String(s.title)),
                detail: `expected title ${JSON.stringify(s.title)}, got ${JSON.stringify(title)}`,
              };
            }
          }
        });
    ctx.capture.verifications.push({
      index: ctx.stepIndex ?? 0,
      kind,
      ok: result.ok,
      soft,
      ...(result.ok ? {} : { detail: result.detail }),
    });
    if (!result.ok && !soft) throw new Error(`verify ${kind}: ${result.detail}`);
    if (ctx.lines) ctx.lines.push(result.ok ? `verify ${kind} ok` : `verify ${kind} FAIL: ${result.detail}`);
    return result.ok;
  },
  resize: async (ctx, s) => ctx.page.setViewportSize({ width: Number(s.width), height: Number(s.height) }),
  route: async (ctx, s) => {
    const url = String(s.url);
    const body =
      s.file !== undefined ? fileContent(ctx, String(s.file)) : s.body !== undefined ? String(s.body) : undefined;
    const contentType =
      typeof s.contentType === 'string'
        ? s.contentType
        : s.file !== undefined && String(s.file).endsWith('.json')
          ? 'application/json'
          : undefined;
    const fulfil = s.status !== undefined || body !== undefined;
    const handler = async (/** @type {any} */ route) => {
      if (typeof s.delay === 'number' && s.delay > 0) await sleep(s.delay);
      if (s.block === true) return route.abort();
      if (fulfil) {
        return route.fulfill({
          status: typeof s.status === 'number' ? s.status : 200,
          ...(body !== undefined ? { body } : {}),
          ...(contentType ? { contentType } : {}),
        });
      }
      return route.continue();
    };
    await ctx.page.route(url, handler);
    ctx.routes.push({
      url,
      block: s.block === true,
      status: s.status,
      body: body !== undefined,
      delay: s.delay,
      handler,
    });
  },
  unroute: async (ctx, s) => {
    if (s.url === undefined) {
      await (ctx.page.unrouteAll ? ctx.page.unrouteAll({ behavior: 'ignoreErrors' }) : ctx.page.unroute('**/*'));
      ctx.routes.length = 0;
      return;
    }
    const url = String(s.url);
    for (const entry of ctx.routes.filter((r) => r.url === url)) await ctx.page.unroute(url, entry.handler);
    ctx.routes = ctx.routes.filter((r) => r.url !== url);
  },
  routes: async (ctx) => {
    const lines = sessionLines(ctx, 'routes');
    if (ctx.routes.length === 0) {
      lines.push('0 routes');
      return;
    }
    for (const r of ctx.routes) {
      const effect = r.block
        ? 'block'
        : r.status !== undefined
          ? `→ ${String(r.status)}${r.body ? ' + body' : ''}`
          : r.body
            ? '→ body'
            : 'continue';
      const delay = typeof r.delay === 'number' && r.delay > 0 ? ` +${String(r.delay)} ms` : '';
      lines.push(truncate(`${r.url} ${effect}${delay}`));
    }
  },
  offline: async (ctx, s) => ctx.context.setOffline(s.on === true),
  fetch: async (ctx, s) => {
    const result = await withDeadline(
      ctx.page.evaluate(
        async (
          /** @type {{ url: string, method: string, body?: string, headers?: Record<string, string> }} */ args,
        ) => {
          const response = await fetch(args.url, {
            method: args.method,
            ...(args.body !== undefined ? { body: args.body } : {}),
            ...(args.headers ? { headers: args.headers } : {}),
          });
          return {
            status: response.status,
            contentType: response.headers.get('content-type') ?? '',
            body: await response.text(),
          };
        },
        {
          url: String(s.url),
          method: String(s.method ?? 'GET').toUpperCase(),
          ...(s.body !== undefined ? { body: String(s.body) } : {}),
          ...(s.headers ? { headers: /** @type {Record<string, string>} */ (s.headers) } : {}),
        },
      ),
      ctx.timeoutMs,
      `fetch ${String(s.url)}`,
    );
    if (ctx.lines && ctx.session && typeof s.name !== 'string') {
      // A session prints the response like `net <n> --body`: status, type, size, ≤ 20 body lines,
      // the whole body in `net/fetch-NNN.txt`.
      ctx.session.fetchSeq = (ctx.session.fetchSeq ?? 0) + 1;
      const body = String(result.body ?? '');
      const relFile = path.posix.join('net', `fetch-${String(ctx.session.fetchSeq).padStart(3, '0')}.txt`);
      const file = await writeSessionText(
        ctx,
        relFile,
        `${String(s.method ?? 'GET').toUpperCase()} ${String(s.url)}\n\n${body}`,
      );
      ctx.lines.push(
        formatNetBody({
          status: Number(result.status),
          contentType: String(result.contentType ?? '').split(';')[0],
          size: Buffer.byteLength(body),
          file: rel(ctx, file),
        }),
        ...bodyLines(ctx.redact(body)),
      );
      return body;
    }
    return emit(ctx, s, JSON.stringify(result));
  },
  dialog: async (ctx, s) => {
    if (s.action === undefined) {
      // `browser-inspector dialog` without a policy shows the policy and the last dialog (a batch step never lacks one).
      if (ctx.lines) {
        const policy = ctx.recorder.dialogPolicy ?? { action: 'dismiss' };
        ctx.lines.push(formatDialogStatus(policy, /** @type {any} */ (ctx.recorder.dialogs.at(-1))));
      }
      return;
    }
    ctx.recorder.dialogPolicy = {
      action: /** @type {'accept' | 'dismiss'} */ (s.action),
      ...(typeof s.text === 'string' ? { text: s.text } : {}),
      ...(s.once === true ? { once: true } : {}),
    };
  },
  tab: async (ctx, s) => {
    switch (s.action) {
      case 'new': {
        const page = await ctx.context.newPage();
        ctx.attachPage(page);
        if (typeof s.url === 'string') await page.goto(s.url, opts(ctx));
        ctx.setPage(page);
        await ctx.rearmCdp?.();
        return;
      }
      case 'select': {
        const pages = ctx.context.pages();
        const page = pages[Number(s.index)];
        if (!page) throw new Error(`tab ${String(s.index)}: only ${String(pages.length)} tab(s) open`);
        await page.bringToFront?.();
        ctx.setPage(page);
        await ctx.rearmCdp?.();
        return;
      }
      default: {
        if (ctx.page === ctx.laneTab)
          throw new Error('tab close: the lane tab stays open — close a popup or `tab new` tab');
        const closing = ctx.page;
        ctx.setPage(ctx.laneTab);
        await ctx.rearmCdp?.();
        await closing.close();
      }
    }
  },
  tabs: async (ctx) => {
    const lines = sessionLines(ctx, 'tabs');
    const pages = ctx.context.pages();
    const baseOrigin = /** @type {string | undefined} */ (ctx.session?.baseOrigin);
    for (const [i, page] of pages.entries()) {
      const title = await degradeTo(
        '',
        Promise.resolve(page.title()).catch(() => ''),
        1000,
        'tab title',
      );
      const mark = page === ctx.page ? '*' : '';
      lines.push(
        truncate(
          `${String(i)}${mark} ${JSON.stringify(truncate(String(title), 40))} ${urlDisplay(page.url(), baseOrigin)}`,
        ),
      );
    }
    return pages.length;
  },
  frame: async (ctx, s) => {
    const spec = String(s.frame);
    if (spec === 'main') {
      ctx.frame = undefined;
      return;
    }
    if (/^\d+$/u.test(spec)) {
      const frame = ctx.page.frames()[Number(spec)];
      if (!frame) throw new Error(`frame ${spec}: only ${String(ctx.page.frames().length)} frame(s)`);
      ctx.frame = frame;
      return;
    }
    const handle = await ctx.page.locator(spec).first().elementHandle?.(opts(ctx));
    const frame = await handle?.contentFrame?.();
    if (!frame) throw new Error(`frame ${spec}: not an iframe`);
    ctx.frame = frame;
  },
  storage: async (ctx, s) => {
    const value = s.op === 'set' ? ctx.value('value', s) : undefined;
    const text = s.kind === 'cookies' ? await cookies(ctx, s, value) : await storageInPage(ctx, s, value);
    return emit(ctx, s, text);
  },
  state: async (ctx, s) => {
    const file = path.resolve(ctx.cwd ?? process.cwd(), String(s.file));
    if (s.op === 'save') {
      await ctx.context.storageState({ path: file });
      return;
    }
    const state = JSON.parse(fileContent(ctx, String(s.file)).toString('utf8'));
    if (Array.isArray(state.cookies) && state.cookies.length > 0) await ctx.context.addCookies?.(state.cookies);
    // localStorage is per origin and reachable only from a document of that origin: the current
    // one is set in place, the others are skipped and named (a fresh context would take them all).
    const current = new URL(ctx.page.url()).origin;
    for (const origin of state.origins ?? []) {
      if (origin.origin !== current) continue;
      await withDeadline(
        ctx.page.evaluate((/** @type {{ name: string, value: string }[]} */ items) => {
          for (const item of items) window.localStorage.setItem(item.name, item.value);
        }, origin.localStorage ?? []),
        ctx.timeoutMs,
        'state load',
      );
    }
  },
  console: async (ctx, s) => {
    const lines = sessionLines(ctx, 'console');
    const session = sessionOf(ctx);
    const rec = ctx.recorder;
    const cursors = (session.cursors ??= {});
    const all = s.all === true;
    // Since the last call by default (DESIGN.md §4.4): the cursor moves on every call, `--all`
    // reads from the start of the session without moving it back.
    const fromConsole = all ? 0 : (cursors.console ?? 0);
    const fromErrors = all ? 0 : (cursors.pageErrors ?? 0);
    const entries = /** @type {any[]} */ ([
      ...rec.console.slice(Math.min(fromConsole, rec.console.length)),
      ...rec.pageErrors.slice(Math.min(fromErrors, rec.pageErrors.length)).map((text) => ({ type: 'pageerror', text })),
    ]);
    cursors.console = rec.console.length;
    cursors.pageErrors = rec.pageErrors.length;
    const min = typeof s.level === 'string' ? levelOf(s.level === 'warn' ? 'warning' : s.level) : 0;
    let shown = entries.filter((e) => levelOf(String(e.type)) >= min);
    // `slice(-0)` is `slice(0)` — the whole list. `--tail 0` is a budget the agent asked for, so it
    // has to mean "no entries", not "every entry".
    if (typeof s.tail === 'number' && s.tail >= 0) shown = s.tail === 0 ? [] : shown.slice(-s.tail);
    lines.push(
      ...formatNewEntries(
        shown.map((e) => ctx.redact(formatConsoleEntry(e))),
        all ? 'total' : 'new',
      ),
    );
    return shown.length;
  },
  net: async (ctx, s) => {
    const lines = sessionLines(ctx, 'net');
    const session = sessionOf(ctx);
    const rec = ctx.recorder;
    const baseOrigin = /** @type {string | undefined} */ (session.baseOrigin);
    if (s.n !== undefined) {
      const id = Number(s.n);
      const entry = rec.network.find((/** @type {any} */ e) => e.id === id);
      if (!entry) throw new Error(`net #${String(id)}: no such request (browser-inspector net --all lists them)`);
      // The body read is fire-and-forget in the recorder; a request that just finished may still
      // be reading when the agent asks for it.
      await rec.settle?.();
      const body = rec.bodies?.get(id);
      const meta = /** @type {{ headers?: Record<string, string>, postData?: string } | undefined} */ (
        session.requestMeta?.get(id)
      );
      const reqHeaders = Object.entries(meta?.headers ?? {}).map(([k, v]) => `> ${k}: ${String(v)}`);
      const text = [
        `${String(entry.method)} ${String(entry.url)}`,
        ...reqHeaders,
        ...(meta?.postData ? ['', meta.postData] : []),
        '',
        `${entry.status !== undefined ? String(entry.status) : String(entry.failure ?? 'failed')} ${String(entry.contentType ?? '')}`.trimEnd(),
        '',
        body ?? '',
      ].join('\n');
      const file = await writeSessionText(ctx, path.posix.join('net', `${String(id)}.txt`), text);
      lines.push(
        formatNetBody({
          status: entry.status,
          failure: entry.failure,
          contentType: entry.contentType,
          size: entry.size ?? (body !== undefined ? Buffer.byteLength(body) : undefined),
          file: rel(ctx, file),
        }),
      );
      if (s.req === true) lines.push(...reqHeaders.slice(0, BODY_LINES_MAX).map((l) => ctx.redact(truncate(l))));
      if (s.body === true) {
        const why = /** @type {{ bodySkipped?: string }} */ (entry).bodySkipped;
        lines.push(
          ...(body === undefined
            ? [why ? `(no body captured: ${why})` : '(no body captured)']
            : bodyLines(ctx.redact(body))),
        );
      }
      return entry;
    }
    const cursors = (session.cursors ??= {});
    const all = s.all === true;
    const from = all ? 0 : Math.min(cursors.net ?? 0, rec.network.length);
    const entries = /** @type {any[]} */ (rec.network.slice(from));
    cursors.net = rec.network.length;
    const format = (/** @type {any} */ e) => ctx.redact(formatNetEntry(e, baseOrigin));
    if (all) {
      const tail = typeof s.tail === 'number' && s.tail >= 0 ? s.tail : NET_LIST_MAX;
      const listed = s.failed === true ? entries.filter(netFailed) : entries;
      const shown = tail === 0 ? [] : listed.slice(-tail);
      lines.push(
        `${String(entries.length)} total${listed.length !== entries.length ? ` · ${String(listed.length)} failed` : ''}:`,
      );
      if (shown.length < listed.length)
        lines.push(`…${String(listed.length - shown.length)} older (browser-inspector net --all --tail N)`);
      lines.push(...shown.map(format));
      return entries.length;
    }
    const failed = entries.filter(netFailed);
    const tail = typeof s.tail === 'number' && s.tail >= 0 ? s.tail : failed.length;
    lines.push(
      ...formatNetSummary({ newCount: entries.length, failed: (tail === 0 ? [] : failed.slice(-tail)).map(format) }),
    );
    return entries.length;
  },
  trace: async (ctx, s) => {
    const lines = sessionLines(ctx, 'trace');
    const tracing = ctx.context.tracing;
    if (!tracing) throw new Error('trace: this browser context has no tracing');
    if (s.action === 'start') {
      await tracing.start({ screenshots: true, snapshots: true });
      lines.push(formatOk('trace start'));
      return;
    }
    const file =
      typeof s.file === 'string' ? path.resolve(ctx.cwd ?? process.cwd(), s.file) : path.join(ctx.dir, 'trace.zip');
    await mkdir(path.dirname(file), { recursive: true });
    await tracing.stop({ path: file });
    lines.push(formatOk('trace stop', [rel(ctx, file)]));
  },
  video: async (ctx, s) => {
    const lines = sessionLines(ctx, 'video');
    const session = sessionOf(ctx);
    if (s.action === 'start') {
      // A recording context is created at open time (playwright-core records per context, from
      // its first page on) — there is no way to start one on a live session.
      throw new Error(
        'video start: open the session with `browser-inspector open <url> --video` (recording starts with the context)',
      );
    }
    if (!session.videoDir) throw new Error('video stop: nothing is recording (browser-inspector open <url> --video)');
    // The file is complete only once the page is closed: `video stop` ends the session.
    const saved = await session.end();
    lines.push(formatOk('video stop', [saved?.video ? rel(ctx, saved.video) : undefined, 'session closed']));
  },
  locator: async (ctx, s) => {
    const lines = sessionLines(ctx, 'locator');
    await ctx.sel(s);
    const { selector, inFrame } = await durableSelector(ctx, String(s.ref));
    if (!selector) {
      throw new Error(`no durable selector for ${String(s.ref)} (no data-testid, id, name or href) — see snap.json`);
    }
    lines.push(inFrame ? `${selector}${SEP}inside an iframe — a config needs a "frame" step first` : selector);
    return selector;
  },
  run: async (ctx, s) => {
    const lines = sessionLines(ctx, 'run');
    if (ctx.unsafe !== true) {
      throw new Error(
        'run --file refused: set BROWSER_INSPECTOR_UNSAFE=1 (the file runs inside the keeper — RCE-equivalent)',
      );
    }
    const session = sessionOf(ctx);
    session.runSeq = (session.runSeq ?? 0) + 1;
    const source = fileContent(ctx, String(s.file)).toString('utf8');
    const file = await writeSessionText(ctx, `run-${String(session.runSeq).padStart(3, '0')}.mjs`, source);
    const mod = await import(`${pathToFileURL(file).href}?t=${String(Date.now())}`);
    if (typeof mod.default !== 'function') {
      throw new Error(`run --file ${String(s.file)}: export default async (page, context) => … is missing`);
    }
    const value = await withDeadline(mod.default(ctx.page, ctx.context), ctx.timeoutMs, `run --file ${String(s.file)}`);
    const shown = value === undefined ? undefined : truncate(ctx.redact(stringifyResult(value)), 100);
    lines.push(formatOk(`run --file ${String(s.file)}`, [shown]));
    return value;
  },
  close: async (ctx) => {
    const lines = sessionLines(ctx, 'close');
    const session = sessionOf(ctx);
    const commands = Number(session.commands ?? 0);
    await session.end();
    lines.push(
      formatOk('close', [
        `session ${String(session.name)}`,
        `${String(commands)} commands`,
        rel(ctx, String(session.dir)),
      ]),
    );
  },
};
