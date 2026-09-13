// snapshot.mjs — pure functions over the FULL `page.ariaSnapshot({ mode: 'ai' })` (DESIGN.md §4.2–§4.3).
//
// Everything here is a filter in JS over the complete YAML the keeper took. Nothing in this module
// asks the page for a subtree: playwright-core 1.62.1 keeps ONE ref map per frame — the one of the
// last `ariaSnapshot` call, whatever its root or mode — so a snapshot of a subtree would silently
// invalidate every ref an agent still holds. `resolveRef` is the only function that touches a page,
// and it refreshes that map with a full-page snapshot only.
//
// Three text shapes live here:
//   snap.full.yml — the raw YAML (`- role "name" [attrs] [ref=eN] [box=x,y,w,h]: text`);
//   snap.json     — the sidecar from `boxJoin`: `{ ref, role, name, selector?, box, sensitive? }`;
//   snap.md       — the compact view from `compactSnapshot`: `e41 button "Szukaj" [data-testid=search-submit]`.
// The compact keeps interactive and semantic lines only, flattens the indentation, and folds runs of
// look-alike siblings (33 product cards → one card + `… ×32 similar`), because the budget is
// ≤ 90 lines for the 952-line bookstore tree and ≤ 450 o200k tokens for the first 25 lines (AC-10).
//
// Refs are opaque: `e12` and `f3e7` both go to the page as `aria-ref=<ref>` literally — the `f<seq>`
// prefix is the frame sequence the engine itself uses to route to the right iframe.

import { REF_NOT_FOUND } from './print.mjs';
import { maskSnapshotValues } from './redact.mjs';

/** @typedef {import('./types.js').PageLike} PageLike */

/**
 * @typedef {object} SnapNode
 * @property {number} index        Position in document order (the parse order).
 * @property {number} depth        Indentation level (2 spaces per level in the YAML).
 * @property {number} parent       Index of the parent node, -1 for roots.
 * @property {'node'|'text'} kind  `text` = a `- text: …` leaf.
 * @property {string} role         Aria role (`generic` for anonymous containers, `text` for leaves).
 * @property {string} [name]       Accessible name (unquoted, unescaped).
 * @property {string} [ref]        `e12` / `f3e7` — only nodes with a ref are addressable.
 * @property {Record<string, string|true>} attrs  `[level=2]`, `[checked]`, `[cursor=pointer]` …
 * @property {number[]} [box]      `[x, y, width, height]` when the snapshot was taken with `boxes: true`.
 * @property {string} [text]       Inline value (`- textbox "Email" [ref=e5]: jan`) or the leaf text.
 * @property {string} [url]        `- /url: /cart` child property.
 * @property {string} [placeholder] `- /placeholder: …` child property.
 * @property {number[]} children   Indices of child nodes.
 */

/**
 * @typedef {object} WalkEntry  One interactive DOM element as `walkInteractive` reports it (in-page).
 * @property {string} tag
 * @property {string} [type]       `input.type`.
 * @property {string} [role]       Explicit `role` attribute.
 * @property {string} [testid]     `data-testid`.
 * @property {string} [id]
 * @property {string} [nameAttr]   `name` attribute (form controls).
 * @property {string} [href]       `href` attribute of links (as written, not resolved).
 * @property {string} [label]      Best-effort accessible name computed in the page (aria-label, text, placeholder, title, alt).
 * @property {number[]} box        `[x, y, width, height]`, rounded like the snapshot does.
 * @property {boolean} [sensitive] `type=password` or `autocomplete=one-time-code`.
 * @property {boolean} [disabled]
 */

/**
 * @typedef {object} SidecarEntry  One line of snap.json.
 * @property {string} ref
 * @property {string} role
 * @property {string} name
 * @property {string} [selector]   Durable Playwright selector (data-testid → #id → [name] → a[href] → role=).
 * @property {number[]} [box]
 * @property {string} [url]
 * @property {boolean} [sensitive] Never carries a value in snap.md / snap.json.
 * @property {boolean} [valueUnknown] The field holds a value but no walked element backs it, so
 *   nothing can say it is not a password — its value is cut like a sensitive one.
 * @property {boolean} [inIframe] The node sits under an `iframe` node of the tree — a selector for
 *   it is local to that document. Absent means the main one; the `f<seq>` ref prefix does NOT say
 *   this (after any navigation the main document's refs carry one too).
 */

/**
 * @typedef {object} CompactOptions
 * @property {readonly SidecarEntry[]} [sidecar]  Selector suffixes and sensitive refs come from here.
 * @property {readonly SidecarEntry[]} [entries]  Alias of `sidecar` — the name the engine's `snapshotTools.compact` uses.
 * @property {boolean} [names]    Append the nearest container's label in parentheses (`--names`).
 * @property {string} [grep]      Keep only lines containing this text (case-insensitive); disables folding.
 * @property {boolean} [fold]     Fold runs of look-alike siblings (default true).
 */

// ── Role tables ──────────────────────────────────────────────────────────────

/** Roles an agent acts on — every line with one of these and a ref stays in the compact. */
export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'spinbutton',
  'treeitem',
]);

/** Roles that carry meaning without being targets: headings orient, alerts and dialogs interrupt. */
export const SEMANTIC_ROLES = new Set(['heading', 'alert', 'status', 'dialog', 'alertdialog', 'img']);

/** Roles whose text leaves are worth a line of their own (the message IS the point of an alert). */
const TEXT_CARRIER_ROLES = new Set(['alert', 'status', 'dialog', 'alertdialog']);

/** Containers whose label becomes the `--names` context of their descendants (DESIGN.md §4.3). */
export const CONTEXT_ROLES = new Set(['article', 'listitem', 'region', 'group', 'row']);

/** Roles whose inline text is a typed value, rendered as `= value` (and never for sensitive refs). */
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);

/**
 * Attributes worth keeping in the compact, in this order; `cursor`, `box`, `active`, `level` are
 * dropped. `invalid` earns its place because it is the only one that CHANGES in answer to what the
 * agent just did: without it a rejected form renders the same line as before the submit, so
 * `snap --diff` answered `0 changed` to "did the validation pass?".
 */
const KEPT_ATTRS = ['checked', 'disabled', 'invalid', 'expanded', 'selected', 'pressed'];

/** Runs of look-alike siblings fold when there are at least this many … */
const FOLD_MIN_RUN = 3;
/** … and they would cost at least this many compact lines together. */
const FOLD_MIN_LINES = 12;

/** Longest `--names` context, in characters. */
const CONTEXT_MAX = 60;

/** `find` returns at most this many lines. */
export const FIND_MAX = 10;

export const REF_PATTERN = /^(?:f\d+)?e\d+$/u;

// ── YAML parsing ─────────────────────────────────────────────────────────────

/**
 * Unquote a YAML scalar the way playwright renders them: double quotes escape with `\`,
 * single quotes double themselves, anything else is literal.
 * @param {string} raw
 * @returns {string}
 */
function unquote(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\');
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replaceAll("''", "'");
  return s;
}

/**
 * Split a `- ` line body into the key (role, name, attrs) and the inline value after the first `:`
 * that sits outside quotes. A key containing `:` in its name is single-quoted as a whole by the
 * renderer (`- 'listitem "Otwórz krok 1: Dane firmy" [ref=f1e13]':`), so both forms are handled.
 * @param {string} body
 * @returns {{ key: string, value?: string }}
 */
function splitKeyValue(body) {
  if (body.startsWith("'") || body.startsWith('"')) {
    const quote = body[0];
    let i = 1;
    while (i < body.length) {
      if (quote === '"' && body[i] === '\\') {
        i += 2;
        continue;
      }
      if (body[i] === quote) {
        if (quote === "'" && body[i + 1] === "'") {
          i += 2;
          continue;
        }
        break;
      }
      i += 1;
    }
    const key = unquote(body.slice(0, i + 1));
    const rest = body.slice(i + 1).trim();
    return rest.startsWith(':') ? { key, value: rest.slice(1).trim() } : { key };
  }
  let inName = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\' && inName) {
      i += 1;
      continue;
    }
    if (ch === '"') inName = !inName;
    else if (ch === ':' && !inName && (i === body.length - 1 || body[i + 1] === ' ')) {
      return { key: body.slice(0, i), value: body.slice(i + 1).trim() };
    }
  }
  return { key: body };
}

/**
 * Parse a key `role "name" [attr] [attr=value] …` into its parts.
 * @param {string} key
 * @returns {{ role: string, name?: string, attrs: Record<string, string|true> }}
 */
function parseKey(key) {
  const attrs = /** @type {Record<string, string|true>} */ ({});
  let rest = key.trim();
  const roleMatch = /^([a-zA-Z][\w-]*)/u.exec(rest);
  const role = roleMatch ? roleMatch[1] : 'generic';
  rest = rest.slice(role.length).trim();
  /** @type {string | undefined} */
  let name;
  if (rest.startsWith('"')) {
    let i = 1;
    while (i < rest.length && rest[i] !== '"') i += rest[i] === '\\' ? 2 : 1;
    name = unquote(rest.slice(0, i + 1));
    rest = rest.slice(i + 1).trim();
  }
  for (const m of rest.matchAll(/\[([a-z]+)(?:=([^\]]*))?\]/gu)) attrs[m[1]] = m[2] === undefined ? true : m[2];
  return { role, name, attrs };
}

/**
 * Parse the aria YAML into a flat list of nodes in document order. Tolerant: comment lines and
 * blank lines are skipped, unknown shapes become `generic` nodes rather than errors — a snapshot
 * that the page produced is never "invalid", only more or less useful.
 * @param {string} yaml
 * @returns {SnapNode[]}
 */
export function parseSnapshot(yaml) {
  /** @type {SnapNode[]} */
  const nodes = [];
  /** @type {number[]} */
  const stack = []; // node index per depth
  for (const rawLine of String(yaml ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/u, '');
    const m = /^(\s*)- (.*)$/u.exec(line);
    if (!m) continue;
    const depth = Math.floor(m[1].length / 2);
    const body = m[2];
    stack.length = depth;
    const parent = depth > 0 ? (stack[depth - 1] ?? -1) : -1;
    const parentNode = parent >= 0 ? nodes[parent] : undefined;
    if (body.startsWith('/')) {
      // Property of the parent: `/url`, `/placeholder`, `/children` — never a node of its own.
      const colon = body.indexOf(':');
      if (parentNode && colon > 0) {
        const prop = body.slice(1, colon);
        const value = unquote(body.slice(colon + 1));
        if (prop === 'url') parentNode.url = value;
        else if (prop === 'placeholder') parentNode.placeholder = value;
      }
      continue;
    }
    if (body.startsWith('text:')) {
      const index = nodes.length;
      nodes.push({
        index,
        depth,
        parent,
        kind: 'text',
        role: 'text',
        attrs: {},
        text: unquote(body.slice(5)),
        children: [],
      });
      parentNode?.children.push(index);
      stack[depth] = index;
      continue;
    }
    const { key, value } = splitKeyValue(body);
    const { role, name, attrs } = parseKey(key);
    const index = nodes.length;
    /** @type {SnapNode} */
    const node = { index, depth, parent, kind: 'node', role, attrs, children: [] };
    if (name !== undefined) node.name = name;
    if (typeof attrs.ref === 'string') node.ref = attrs.ref;
    if (typeof attrs.box === 'string') {
      const box = attrs.box.split(',').map(Number);
      if (box.length === 4 && box.every(Number.isFinite)) node.box = box;
    }
    if (value !== undefined && value !== '') node.text = unquote(value);
    nodes.push(node);
    parentNode?.children.push(index);
    stack[depth] = index;
  }
  return nodes;
}

// ── Compact rendering ────────────────────────────────────────────────────────

/**
 * Whether a node earns a line in the compact view.
 * @param {SnapNode} node
 * @returns {boolean}
 */
function isVisible(node) {
  if (node.kind !== 'node') return false;
  if (INTERACTIVE_ROLES.has(node.role)) return true;
  if (node.role === 'heading') return true;
  if (node.role === 'img') return Boolean(node.name);
  if (SEMANTIC_ROLES.has(node.role)) return true;
  // A named element the page made clickable (`cursor: pointer`) is a target even without an
  // interactive role — the wizard's steps are `listitem "Otwórz krok 1: …" [cursor=pointer]`.
  return node.attrs.cursor === 'pointer' && Boolean(node.name) && node.role !== 'generic';
}

/**
 * All text under a node (text leaves, inline texts of descendants), joined. The inline text of a
 * VALUE role is NOT text on screen but what is typed in the field, and it is only ever allowed in
 * the `= value` slot the masker knows: promoted into a name (a password input with no label) or
 * into the message of a `dialog`, it slipped past `sensitiveRefs` and reached snap.md.
 * @param {SnapNode[]} nodes
 * @param {SnapNode} node
 * @param {number} [max]
 * @returns {string}
 */
export function textUnder(nodes, node, max = 200) {
  /** @type {string[]} */
  const parts = [];
  /** @param {SnapNode} n */
  const walk = (n) => {
    // The whole subtree, not only the node's own inline text: with a property under it (a
    // `placeholder`) the renderer moves the typed value into a `- text:` LEAF, and that leaf is not
    // a value role, so the value came back out as a label or as a dialog's message.
    if (VALUE_ROLES.has(n.role)) return;
    if (n.text) parts.push(n.text);
    for (const child of n.children) walk(nodes[child]);
  };
  walk(node);
  const joined = parts.join(' ').replace(/\s+/gu, ' ').trim();
  return joined.length > max ? `${joined.slice(0, max - 1)}…` : joined;
}

/**
 * The typed value of a value-role node: inline when the renderer could write it there, else the
 * `- text:` leaf it had to move it to (any property under the node — `- /placeholder:` — forces
 * that shape). `undefined` when the field is empty.
 * @param {SnapNode[]} nodes
 * @param {SnapNode} node
 * @returns {string | undefined}
 */
export function valueOf(nodes, node) {
  if (node.text) return node.text;
  for (const child of node.children) {
    const leaf = nodes[child];
    if (leaf?.kind === 'text' && leaf.text) return leaf.text;
  }
  return undefined;
}

/**
 * Attribute-value selector suffix for the compact line: `[data-testid=search-submit]`, `#email`,
 * `[name=q]`. Longer selectors (`a[href=…]`, `role=…`) are not shown — the line already says
 * role and name, and the sidecar keeps the full selector.
 * @param {string | undefined} selector
 * @returns {string}
 */
function selectorSuffix(selector) {
  if (!selector) return '';
  const attr = /^\[(data-testid|name)="((?:[^"\\]|\\.)*)"\]$/u.exec(selector);
  if (attr) {
    const value = attr[2].replaceAll('\\"', '"');
    return /^[\w.:-]+$/u.test(value) ? ` [${attr[1]}=${value}]` : ` [${attr[1]}="${value}"]`;
  }
  if (selector.startsWith('#') || selector.startsWith('[id=')) return ` ${selector}`;
  return '';
}

/**
 * The `--names` context: label of the nearest ancestor with a container role — its own accessible
 * name, else its first heading, else its first named link or image; cut to 60 characters.
 * @param {SnapNode[]} nodes
 * @param {SnapNode} node
 * @returns {string | undefined}
 */
export function namesContext(nodes, node) {
  for (let p = node.parent; p >= 0; p = nodes[p].parent) {
    const container = nodes[p];
    if (!CONTEXT_ROLES.has(container.role)) continue;
    const label = container.name || firstLabelUnder(nodes, container, node);
    if (!label) continue;
    return label.length > CONTEXT_MAX ? `${label.slice(0, CONTEXT_MAX - 1)}…` : label;
  }
  return undefined;
}

/**
 * @param {SnapNode[]} nodes
 * @param {SnapNode} container
 * @param {SnapNode} self  The node asking — its own name must not label its container.
 * @returns {string | undefined}
 */
function firstLabelUnder(nodes, container, self) {
  /** @type {string | undefined} */
  let heading;
  /** @type {string | undefined} */
  let named;
  /** @param {SnapNode} n */
  const walk = (n) => {
    if (heading) return;
    if (n !== self && n.name) {
      if (n.role === 'heading') heading = n.name;
      else if (!named && (n.role === 'link' || n.role === 'img')) named = n.name;
    }
    for (const child of n.children) walk(nodes[child]);
  };
  walk(container);
  return heading ?? named;
}

/**
 * Render one node as a compact line. `sidecar` lookups add the selector suffix and hide the value
 * of sensitive fields; `names` appends the container context.
 * @param {SnapNode[]} nodes
 * @param {SnapNode} node
 * @param {{ byRef: Map<string, SidecarEntry>, names?: boolean, structural?: boolean }} ctx
 * @returns {string}
 */
function renderLine(nodes, node, ctx) {
  const entry = node.ref ? ctx.byRef.get(node.ref) : undefined;
  /** @type {string[]} */
  const parts = [];
  if (node.role === 'heading') {
    // `h2 "Nowości"` — a heading orients, it is not a target, so the ref would be dead weight.
    // Unless the page made it one: an accordion `<h3 onclick>` has no other address at all —
    // `walkInteractive` does not match it either, so the sidecar has no selector to fall back on.
    // The ref goes FIRST, because `aroundRef` matches on the first token of the line.
    if (node.ref && node.attrs.cursor === 'pointer' && !ctx.structural) parts.push(node.ref);
    parts.push(`h${typeof node.attrs.level === 'string' ? node.attrs.level : '2'}`);
    if (!ctx.structural) parts.push(quote(node.name ?? textUnder(nodes, node, 80)));
  } else {
    if (node.ref && !ctx.structural) parts.push(node.ref);
    parts.push(node.role);
    if (!ctx.structural) {
      // A nameless link or button still has visible text somewhere under it (`link → /` wrapping
      // "Zobacz katalog" in a span) — that text is what the agent sees on screen.
      const label =
        node.name || node.placeholder || (INTERACTIVE_ROLES.has(node.role) ? textUnder(nodes, node, 40) : '');
      if (label) parts.push(quote(label));
    }
  }
  for (const attr of KEPT_ATTRS) {
    const v = node.attrs[attr];
    if (v === true) parts.push(`[${attr}]`);
    else if (typeof v === 'string') parts.push(`[${attr}=${v}]`);
  }
  if (!ctx.structural) {
    if (TEXT_CARRIER_ROLES.has(node.role)) {
      const text = textUnder(nodes, node);
      if (text) parts[parts.length - 1] += `: ${text}`;
    }
    if (node.url !== undefined && node.role === 'link') parts.push(`→ ${node.url}`);
    parts.push(...selectorSuffix(entry?.selector).trim().split(' ').filter(Boolean));
    if (VALUE_ROLES.has(node.role) && node.ref !== undefined && !entry?.sensitive && !entry?.valueUnknown) {
      // No ref means no sidecar entry (playwright hands none to a field that does not receive
      // pointer events), and no entry means nothing knows whether this is a password field.
      const value = valueOf(nodes, node);
      if (value) parts.push(`= ${value}`);
    }
    if (ctx.names) {
      const context = namesContext(nodes, node);
      if (context) parts.push(`(${context})`);
    }
  }
  return parts.join(' ');
}

/** @param {string} s */
const quote = (s) => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

/**
 * Visible nodes of a subtree in document order.
 * @param {SnapNode[]} nodes
 * @param {SnapNode} root
 * @returns {SnapNode[]}
 */
function visibleUnder(nodes, root) {
  /** @type {SnapNode[]} */
  const out = [];
  /** @param {SnapNode} n */
  const walk = (n) => {
    if (isVisible(n)) out.push(n);
    for (const child of n.children) walk(nodes[child]);
  };
  walk(root);
  return out;
}

/**
 * Compact lines with the fold applied: for every parent, runs of ≥ 3 consecutive children whose
 * subtrees render to the same structure (roles and attributes, names and refs ignored) and would
 * together cost ≥ 12 lines are replaced by the first child plus one `… ×N similar (eA–eZ)` line.
 * The fold never hides anything from `find` — that runs on the tree, not on this view.
 * @param {SnapNode[]} nodes
 * @param {{ byRef: Map<string, SidecarEntry>, names?: boolean, fold: boolean }} ctx
 * @returns {string[]}
 */
function renderTree(nodes, ctx) {
  /** @type {string[]} */
  const lines = [];
  const structural = { byRef: ctx.byRef, structural: true };
  /** @param {SnapNode} n */
  const signature = (n) =>
    visibleUnder(nodes, n)
      .map((v) => `${v.depth - n.depth}:${renderLine(nodes, v, structural)}`)
      .join('|');
  /** @param {SnapNode} n */
  const emit = (n) => {
    if (isVisible(n)) lines.push(renderLine(nodes, n, ctx));
    const children = n.children.map((i) => nodes[i]);
    if (!ctx.fold) {
      children.forEach(emit);
      return;
    }
    // Only children that render at least one line take part in a run; empty ones are transparent.
    const sigs = children.map((c) => signature(c));
    for (let i = 0; i < children.length; ) {
      if (sigs[i] === '') {
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < children.length && (sigs[j] === sigs[i] || sigs[j] === '')) j += 1;
      while (j > i + 1 && sigs[j - 1] === '') j -= 1;
      const run = children.slice(i, j).filter((_, k) => sigs[i + k] !== '');
      const perItem = sigs[i].split('|').length;
      // A sibling that renders to ONE line is its name and nothing else, and the signature ignores
      // names on purpose — folding such a run replaced 12 different destinations with 3 sample
      // labels, and `snap --diff` then answered `0 changed` to a relabelled entry behind the fold.
      if (perItem >= 2 && run.length >= FOLD_MIN_RUN && run.length * perItem >= FOLD_MIN_LINES) {
        emit(run[0]);
        lines.push(foldLine(nodes, run.slice(1)));
      } else {
        run.forEach(emit);
      }
      i = j;
    }
  };
  for (const n of nodes) if (n.parent === -1) emit(n);
  return lines;
}

/**
 * `… ×32 similar (e228–e1220): "The Lord of the Rings", "1984", "The Hobbit" …` — the ref range of
 * what was folded plus the first labels, so the agent knows what is behind the fold. How to reach
 * one item (`find <text>`, `snap --around eN`) is in the instruction block, not repeated per fold.
 * @param {SnapNode[]} nodes
 * @param {SnapNode[]} hidden
 * @returns {string}
 */
function foldLine(nodes, hidden) {
  const refs = hidden.flatMap((c) => visibleUnder(nodes, c).map((v) => v.ref)).filter(Boolean);
  const range = refs.length ? ` (${refs[0]}–${refs[refs.length - 1]})` : '';
  const labels = hidden
    .map((c) => visibleUnder(nodes, c).find((v) => v.name)?.name)
    .filter((name) => Boolean(name))
    .map((name) => (name && name.length > 30 ? `${name.slice(0, 29)}…` : name));
  const shown = labels.slice(0, 3).map((l) => quote(l ?? ''));
  const sample = shown.length ? `: ${shown.join(', ')}${labels.length > 3 ? ' …' : ''}` : '';
  return `… ×${hidden.length} similar${range}${sample}`;
}

/**
 * @param {readonly SidecarEntry[] | undefined} sidecar
 * @returns {Map<string, SidecarEntry>}
 */
function indexSidecar(sidecar) {
  const byRef = new Map();
  for (const entry of sidecar ?? []) if (entry?.ref) byRef.set(entry.ref, entry);
  return byRef;
}

/**
 * The compact view as lines (see the module header for the format). `grep` filters the unfolded
 * view; `names` appends the container context; `fold: false` disables the sibling fold.
 * @param {string} aiYaml
 * @param {CompactOptions} [options]
 * @returns {string[]}
 */
export function compactLines(aiYaml, options = {}) {
  const nodes = parseSnapshot(aiYaml);
  const byRef = indexSidecar(options.sidecar ?? options.entries);
  const grep = options.grep?.toLowerCase();
  const lines = renderTree(nodes, { byRef, names: options.names, fold: options.fold !== false && !grep });
  return grep ? lines.filter((line) => line.toLowerCase().includes(grep)) : lines;
}

/**
 * `snap.md`: the compact view as text, one line per node, trailing newline.
 * @param {string} aiYaml
 * @param {CompactOptions} [options]
 * @returns {string}
 */
export function compactSnapshot(aiYaml, options = {}) {
  const lines = compactLines(aiYaml, options);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * Lines of the (unfolded) compact view around a ref: `n` before and `n` after. Empty when the ref
 * is not in the snapshot.
 * @param {string} aiYaml
 * @param {string} ref
 * @param {CompactOptions & { n?: number }} [options]
 * @returns {string[]}
 */
export function aroundRef(aiYaml, ref, options = {}) {
  const n = options.n ?? 5;
  const lines = compactLines(aiYaml, { ...options, grep: undefined, fold: false });
  const at = lines.findIndex((line) => line.split(' ', 1)[0] === ref);
  if (at === -1) return [];
  return lines.slice(Math.max(0, at - n), at + n + 1);
}

/**
 * `browser-inspector find <text>`: every node whose name, inline text, url or placeholder contains the text
 * (case-insensitive), reported as the compact line of the node itself when it is visible, else of
 * its nearest visible ancestor, else as `<ref> <role> "<text>"` so the match still has an address.
 * Deduplicated by ref, capped at 10; `total` says how many there were.
 * @param {string} aiYaml
 * @param {string} text
 * @param {CompactOptions & { max?: number }} [options]
 * @returns {{ lines: string[], total: number }}
 */
export function findInSnapshot(aiYaml, text, options = {}) {
  const needle = String(text ?? '')
    .trim()
    .toLowerCase();
  if (!needle) return { lines: [], total: 0 };
  const nodes = parseSnapshot(aiYaml);
  const byRef = indexSidecar(options.sidecar ?? options.entries);
  const ctx = { byRef, names: options.names };
  const max = options.max ?? FIND_MAX;
  /** @type {string[]} */
  const lines = [];
  const seen = new Set();
  /** @param {SnapNode} n */
  const matches = (n) =>
    [n.name, n.text, n.url, n.placeholder].some((field) => field !== undefined && field.toLowerCase().includes(needle));
  for (const node of nodes) {
    if (!matches(node)) continue;
    let target = node;
    while (!isVisible(target) && target.parent >= 0) {
      const parent = nodes[target.parent];
      if (isVisible(parent)) {
        target = parent;
        break;
      }
      // Text leaves and anonymous wrappers climb; a named container (paragraph, cell) stands on its own.
      if (target.kind === 'text' || (target.role === 'generic' && !target.name && !target.ref)) target = parent;
      else break;
    }
    const key = target.ref ?? `#${target.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isVisible(target)) lines.push(renderLine(nodes, target, ctx));
    else {
      const label = target.name ?? textUnder(nodes, target, 80);
      const context = options.names ? namesContext(nodes, target) : undefined;
      lines.push(
        [target.ref, target.role, label ? quote(label) : '', context ? `(${context})` : ''].filter(Boolean).join(' '),
      );
    }
  }
  return { lines: lines.slice(0, max), total: lines.length };
}

/**
 * Lines added and removed between two compact views (arrays or newline-joined strings), in order.
 * A moved line counts as neither; a re-labelled button shows as one removed and one added — which
 * is exactly what an agent needs to know, because the old ref is dead.
 * @param {string | readonly string[]} prev
 * @param {string | readonly string[]} next
 * @returns {{ added: string[], removed: string[] }}
 */
export function diffSnapshot(prev, next) {
  const toLines = (/** @type {string | readonly string[]} */ v) =>
    (Array.isArray(v) ? v : String(v ?? '').split('\n')).filter((line) => line !== '');
  const a = toLines(prev);
  const b = toLines(next);
  const setA = new Set(a);
  const setB = new Set(b);
  return { added: b.filter((line) => !setA.has(line)), removed: a.filter((line) => !setB.has(line)) };
}

// ── Box-join: aria line ↔ DOM element ────────────────────────────────────────

/**
 * Implicit aria role of a walked element — enough to tell a link from the button inside it when
 * both have the same box. Explicit `role` wins.
 * @param {WalkEntry} e
 * @returns {string}
 */
export function implicitRole(e) {
  if (e.role) return e.role;
  switch (e.tag) {
    case 'a':
      return e.href !== undefined ? 'link' : 'generic';
    case 'button':
    case 'summary':
      return 'button';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'option':
      return 'option';
    case 'li':
      return 'listitem';
    case 'input':
      switch (e.type) {
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'range':
          return 'slider';
        case 'number':
          return 'spinbutton';
        case 'search':
          return 'searchbox';
        case 'button':
        case 'submit':
        case 'reset':
        case 'image':
          return 'button';
        default:
          return 'textbox';
      }
    default:
      return 'generic';
  }
}

/** @param {string} value */
const escapeAttr = (value) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

/**
 * Durable selector for an element described by a walk/sidecar entry — the same preference the
 * in-page `locatorForElement` applies: data-testid → #id → [name] → a[href] → role=role[name=…].
 * A candidate that `unique` rejects (four nav links sharing `data-testid=desktop-nav-link`, two
 * links to `/`) falls through to the next one — a selector that matches two elements is not a
 * locator, it is a strict-mode error waiting in the export. `undefined` when nothing durable
 * exists (a nameless div with a click handler).
 * @param {{ testid?: string, id?: string, nameAttr?: string, href?: string, tag?: string, role?: string, name?: string, label?: string }} e
 * @param {(kind: 'testid'|'id'|'nameAttr'|'href', value: string) => boolean} [unique]
 * @returns {string | undefined}
 */
export function locatorFor(e, unique = () => true) {
  if (e.testid && unique('testid', e.testid)) return `[data-testid="${escapeAttr(e.testid)}"]`;
  if (e.id && unique('id', e.id)) return /^[A-Za-z_][\w-]*$/u.test(e.id) ? `#${e.id}` : `[id="${escapeAttr(e.id)}"]`;
  if (e.nameAttr && unique('nameAttr', e.nameAttr)) return `[name="${escapeAttr(e.nameAttr)}"]`;
  if (e.tag === 'a' && e.href && unique('href', e.href)) return `a[href="${escapeAttr(e.href)}"]`;
  const role = e.role && e.tag === undefined ? e.role : implicitRole(/** @type {WalkEntry} */ (e));
  const name = e.name ?? e.label;
  if (role && role !== 'generic' && name) return `role=${role}[name="${escapeAttr(name)}"]`;
  return undefined;
}

/**
 * The `unique` predicate for `locatorFor` over a walk: an attribute value is usable when exactly
 * one walked element carries it.
 * @param {readonly WalkEntry[]} walk
 * @returns {(kind: 'testid'|'id'|'nameAttr'|'href', value: string) => boolean}
 */
export function uniqueIn(walk) {
  /** @type {Record<string, Map<string, number>>} */
  const counts = { testid: new Map(), id: new Map(), nameAttr: new Map(), href: new Map() };
  for (const e of walk) {
    for (const kind of /** @type {const} */ (['testid', 'id', 'nameAttr', 'href'])) {
      const value = e[kind];
      if (value !== undefined) counts[kind].set(value, (counts[kind].get(value) ?? 0) + 1);
    }
  }
  return (kind, value) => (counts[kind].get(value) ?? 0) <= 1;
}

/**
 * IN-PAGE function for `locator('aria-ref=eN').evaluate(locatorForElement)` (the export path of
 * DESIGN.md §4.5): the same preference as `locatorFor`, computed from the live element. Must stay
 * self-contained — it is serialized into the page and cannot see this module.
 * @param {Element} el
 * @returns {string | undefined}
 */
export function locatorForElement(el) {
  const esc = (/** @type {string} */ v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // Counted in the element's OWN root: inside an open shadow root `ownerDocument` sees nothing, so
  // every durable candidate looked "not unique" and a web component's field fell back to a brittle
  // `role=…[name=…]`. The document is still consulted, because Playwright's CSS pierces open shadow
  // roots and a selector that also matches in the light DOM would be a strict-mode error.
  const scope = /** @type {any} */ (el.getRootNode?.() ?? el.ownerDocument);
  const unique = (/** @type {string} */ selector) =>
    scope.querySelectorAll(selector).length === 1 && el.ownerDocument.querySelectorAll(selector).length <= 1;
  const testid = el.getAttribute('data-testid');
  if (testid && unique(`[data-testid="${esc(testid)}"]`)) return `[data-testid="${esc(testid)}"]`;
  if (el.id) {
    const byId = /^[A-Za-z_][\w-]*$/.test(el.id) ? `#${el.id}` : `[id="${esc(el.id)}"]`;
    if (unique(byId)) return byId;
  }
  const nameAttr = el.getAttribute('name');
  if (nameAttr && unique(`[name="${esc(nameAttr)}"]`)) return `[name="${esc(nameAttr)}"]`;
  const tag = el.tagName.toLowerCase();
  const href = el.getAttribute('href');
  if (tag === 'a' && href && unique(`a[href="${esc(href)}"]`)) return `a[href="${esc(href)}"]`;
  const input = /** @type {HTMLInputElement} */ (el);
  const type = tag === 'input' ? input.type || 'text' : undefined;
  const byTag = /** @type {Record<string, string>} */ ({
    a: 'link',
    button: 'button',
    summary: 'button',
    select: 'combobox',
    textarea: 'textbox',
    option: 'option',
    li: 'listitem',
  });
  const byType = /** @type {Record<string, string>} */ ({
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    number: 'spinbutton',
    search: 'searchbox',
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button',
  });
  const role = el.getAttribute('role') || (tag === 'input' ? byType[type ?? ''] || 'textbox' : byTag[tag]);
  const name = (
    el.getAttribute('aria-label') ||
    /** @type {HTMLElement} */ (el).innerText ||
    input.placeholder ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    ''
  )
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  if (role && role !== 'generic' && name) return `role=${role}[name="${esc(name)}"]`;
  return undefined;
}

/**
 * IN-PAGE function for `page.evaluate(walkInteractive)`: every rendered interactive element with
 * the attributes the box-join and `locatorFor` need, and its bounding box rounded exactly like
 * `ariaSnapshot({ boxes: true })` rounds (`Math.round` of `getBoundingClientRect`). Self-contained
 * for the same reason as `locatorForElement`. One pass, no layout writes — ~6 ms on the bookstore.
 * @returns {WalkEntry[]}
 */
export function walkInteractive() {
  const selector =
    'a[href], button, input, select, textarea, summary, option, [role], [tabindex], [contenteditable=""], [contenteditable="true"]';
  /** @type {WalkEntry[]} */
  const out = [];
  /** @type {(Document | ShadowRoot)[]} */
  const roots = [document];
  /** @type {Element[]} */
  const found = [];
  for (let r = 0; r < roots.length; r += 1) {
    // `ariaSnapshot` walks open shadow roots, so a walk that stops at the light DOM leaves every
    // control of a web component without a box match: no durable selector and, worse, no
    // `sensitive` — the password field of a `<login-box>` kept its value in snap.md (DESIGN.md §2.6).
    for (const host of roots[r].querySelectorAll('*')) if (host.shadowRoot) roots.push(host.shadowRoot);
    for (const el of roots[r].querySelectorAll(selector)) found.push(el);
  }
  for (const el of found) {
    if (el.getClientRects().length === 0) continue; // display:none / detached — not in the aria tree either
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const input = /** @type {HTMLInputElement} */ (el);
    /** @type {WalkEntry} */
    const entry = { tag, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
    if (tag === 'input') entry.type = input.type || 'text';
    const role = el.getAttribute('role');
    if (role) entry.role = role;
    const testid = el.getAttribute('data-testid');
    if (testid) entry.testid = testid;
    if (el.id) entry.id = el.id;
    const nameAttr = el.getAttribute('name');
    if (nameAttr) entry.nameAttr = nameAttr;
    const href = el.getAttribute('href');
    if (tag === 'a' && href !== null) entry.href = href;
    const label = (
      el.getAttribute('aria-label') ||
      (tag === 'input' || tag === 'select' || tag === 'textarea' ? '' : /** @type {HTMLElement} */ (el).innerText) ||
      input.placeholder ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    if (label) entry.label = label;
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (entry.type === 'password' || autocomplete === 'one-time-code') entry.sensitive = true;
    if ('disabled' in el && input.disabled) entry.disabled = true;
    out.push(entry);
  }
  return out;
}

/**
 * Join the aria lines of a `boxes: true` snapshot with the DOM walk by rounded bounding box, and
 * build the sidecar (`snap.json`). Every visible node with a ref gets an entry; interactive ones
 * also get a durable selector when a walked element shares their box (role-compatible first,
 * then any unused element, then a ±1 px neighbour — the two passes see the same layout, but a
 * sub-pixel edge can round differently on either side). Nodes under an `iframe` node are joined
 * against `walk.frames[seq]` (seq = the `f<seq>` prefix of their refs) when the caller walked
 * that frame too. The prefix alone does not mean "iframe": after any navigation the MAIN
 * document's refs carry one as well (`f1eN`, `f4eN` …), so the tree, not the ref, decides.
 * @param {string} boxesYaml
 * @param {readonly WalkEntry[] | { main: readonly WalkEntry[], frames?: Record<string, readonly WalkEntry[]> }} walk
 * @returns {{ entries: SidecarEntry[], interactive: number, matched: number }}
 */
export function boxJoin(boxesYaml, walk) {
  const nodes = parseSnapshot(boxesYaml);
  const walked = Array.isArray(walk)
    ? { main: /** @type {readonly WalkEntry[]} */ (walk), frames: {} }
    : /** @type {{ main: readonly WalkEntry[], frames?: Record<string, readonly WalkEntry[]> }} */ (
        walk ?? { main: [] }
      );
  const main = walked.main ?? [];
  const frames = walked.frames ?? {};
  /** @type {Map<number, boolean>} */
  const framed = new Map();
  /** @param {SnapNode} node @returns {boolean} */
  const inIframe = (node) => {
    const cached = framed.get(node.index);
    if (cached !== undefined) return cached;
    let answer = false;
    for (let p = node.parent; p >= 0; p = nodes[p].parent) {
      if (nodes[p].role === 'iframe') {
        answer = true;
        break;
      }
    }
    framed.set(node.index, answer);
    return answer;
  };
  /** @type {Map<string, { byBox: Map<string, WalkEntry[]>, all: WalkEntry[] }>} */
  const indexes = new Map();
  /** @param {readonly WalkEntry[]} list */
  const index = (list) => {
    const byBox = new Map();
    for (const e of list) {
      const key = e.box.join(',');
      if (!byBox.has(key)) byBox.set(key, []);
      byBox.get(key).push(e);
    }
    return { byBox, all: [...list] };
  };
  indexes.set('', index(main));
  for (const [seq, list] of Object.entries(frames)) indexes.set(seq, index(list));
  /** @type {Map<string, ReturnType<typeof uniqueIn>>} */
  const uniques = new Map([...indexes].map(([seq, idx]) => [seq, uniqueIn(idx.all)]));
  const used = new Set();
  /** @type {SidecarEntry[]} */
  const entries = [];
  let interactive = 0;
  let matched = 0;
  for (const node of nodes) {
    if (!node.ref || !isVisible(node)) continue;
    /** @type {SidecarEntry} */
    const entry = { ref: node.ref, role: node.role, name: node.name ?? '' };
    if (inIframe(node)) entry.inIframe = true;
    if (node.box) entry.box = node.box;
    if (node.url !== undefined) entry.url = node.url;
    const wantsSelector = INTERACTIVE_ROLES.has(node.role) || node.attrs.cursor === 'pointer';
    if (wantsSelector) interactive += 1;
    /** @type {WalkEntry | undefined} */
    let joined;
    if (wantsSelector && node.box) {
      const seq = inIframe(node) ? (/^f(\d+)e/u.exec(node.ref)?.[1] ?? '') : '';
      const idx = indexes.get(seq);
      const candidates = idx?.byBox.get(node.box.join(',')) ?? [];
      const free = candidates.filter((c) => !used.has(c));
      /** @type {WalkEntry | undefined} */
      let hit = free.find((c) => implicitRole(c) === node.role) ?? free[0];
      if (!hit && idx) {
        const [x, y, w, h] = node.box;
        hit = idx.all.find(
          (c) =>
            !used.has(c) &&
            implicitRole(c) === node.role &&
            Math.abs(c.box[0] - x) <= 1 &&
            Math.abs(c.box[1] - y) <= 1 &&
            Math.abs(c.box[2] - w) <= 1 &&
            Math.abs(c.box[3] - h) <= 1,
        );
      }
      if (hit) {
        used.add(hit);
        matched += 1;
        joined = hit;
        const selector = locatorFor({ ...hit, name: node.name || hit.label }, uniques.get(seq));
        if (selector) entry.selector = selector;
        if (hit.sensitive) entry.sensitive = true;
      }
    }
    // The aria tree does not carry the DOM type, so `sensitive` can only come from the walk. A
    // field that HOLDS a value and matched nothing (its frame's walk failed or answered for another
    // document, the box moved between the two passes) is therefore of unknown kind — and unknown
    // has to mean "cut the value", the same rule a snapshot without any walk follows.
    if (joined === undefined && VALUE_ROLES.has(node.role) && valueOf(nodes, node) !== undefined) {
      entry.valueUnknown = true;
    }
    entries.push(entry);
  }
  return { entries, interactive, matched };
}

/**
 * Refs whose value must never be shown (`maskSnapshotValues({ sensitiveRefs })` in redact.mjs):
 * the fields the walk marked sensitive AND the ones it could not identify at all — a value nothing
 * vouched for is cut, not printed.
 * @param {readonly SidecarEntry[]} entries
 * @returns {string[]}
 */
export function sensitiveRefs(entries) {
  return entries.filter((e) => e.sensitive || e.valueUnknown).map((e) => e.ref);
}

/**
 * The DOM side of the box-join, taken from a live page: `walkInteractive` in the main frame and in
 * every child frame the snapshot shows as an `iframe` node. Each `iframe` node is resolved through
 * its OWN ref (`aria-ref=eN` → `contentFrame()`), because `page.frames()` and the aria tree are not
 * the same list: a `display:none` frame (analytics, consent) is in one and not the other, and a
 * nested frame attaches out of document order — pairing by position then handed the login widget
 * the walk of a different document, which costs the `sensitive` flag, not just a selector, and left
 * the password in snap.md. Positional pairing survives only as the fallback for a page object
 * without handles (a fake). This is the shape the engine's `snapshotTools.boxJoin(page, yaml)`
 * expects; it never calls `ariaSnapshot`, so the ref map an agent holds stays intact. A frame that
 * refuses `evaluate` (cross-origin, detached) is skipped.
 * @param {PageLike} page
 * @param {string} boxesYaml  The full `ariaSnapshot({ mode: 'ai', boxes: true })` text (without boxes → no selectors).
 * @returns {Promise<SidecarEntry[]>}
 */
export async function sidecarFromPage(page, boxesYaml) {
  const nodes = parseSnapshot(boxesYaml);
  const main = /** @type {WalkEntry[]} */ ((await page.evaluate(walkInteractive)) ?? []);
  /** @type {Record<string, readonly WalkEntry[]>} */
  const frames = {};
  const children = typeof page.frames === 'function' ? page.frames().slice(1) : [];
  /** @param {string} ref */
  const frameOfRef = async (ref) => {
    try {
      const handle = await page.locator(`aria-ref=${ref}`).first().elementHandle?.();
      return (await handle?.contentFrame?.()) ?? undefined;
    } catch {
      return undefined;
    }
  };
  let position = 0;
  for (const node of nodes) {
    if (node.role !== 'iframe' || node.kind !== 'node') continue;
    // Every `iframe` node consumes one position, ref-bearing children or not — an empty frame that
    // did not consume one used to shift every frame after it.
    const fallback = children[position];
    position += 1;
    const child = nodes.find((c) => c.ref && c.parent === node.index);
    const seq = child?.ref ? (/^f(\d+)e/u.exec(child.ref)?.[1] ?? '') : '';
    if (!seq) continue;
    const frame = (node.ref ? await frameOfRef(node.ref) : undefined) ?? fallback;
    if (!frame) continue;
    const walk = await frame.evaluate(walkInteractive).catch(() => undefined);
    if (Array.isArray(walk)) frames[seq] = walk;
  }
  return boxJoin(boxesYaml, { main, frames }).entries;
}

// ── Ref resolution against a live page ───────────────────────────────────────

export class RefNotFoundError extends Error {
  /** @param {string} ref */
  constructor(ref) {
    // The message IS the stdout reason: `FAIL click e99 · ref not found (…) → browser-inspector snap`.
    super(REF_NOT_FOUND);
    this.name = 'RefNotFoundError';
    this.code = 'E_REF_NOT_FOUND';
    this.ref = ref;
  }
}

/**
 * Resolve a ref to the selector an action uses, with the precheck DESIGN.md §3.2 prescribes:
 * `aria-ref=<ref>` literally (`f3e7` included — the engine routes the frame), `count()` first; on
 * zero hits ONE full-page `ariaSnapshot({ mode: 'ai', boxes })` refreshes the ref map (an element
 * with the same role and name gets the same ref back), `count()` again; still zero → throws
 * `RefNotFoundError` immediately, without waiting for actionability. Never snapshots a subtree.
 * @param {PageLike} page
 * @param {string} ref
 * @param {{ boxes?: boolean }} [options]  `boxes` (default true) so the refreshed text can feed `boxJoin`.
 * @returns {Promise<{ selector: string, refreshed: boolean, snapshot?: string }>}
 */
export async function resolveRef(page, ref, options = {}) {
  if (!REF_PATTERN.test(String(ref))) throw new RefNotFoundError(String(ref));
  const selector = `aria-ref=${ref}`;
  const locator = page.locator(selector);
  if ((await locator.count()) > 0) return { selector, refreshed: false };
  const snapshot = await page.ariaSnapshot({ mode: 'ai', boxes: options.boxes !== false });
  if ((await locator.count()) > 0) return { selector, refreshed: true, snapshot };
  throw new RefNotFoundError(ref);
}
