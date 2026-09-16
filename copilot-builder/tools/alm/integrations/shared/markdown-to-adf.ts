/**
 * Markdown → ADF (Atlassian Document Format), the WRITE-side twin of `adf.ts`.
 *
 * Jira (`description`, comments) and Confluence v2 (`atlas_doc_format`) both take ADF, so one
 * converter serves every Atlassian write in this repository. The subset is deliberately the
 * one the templates in `templates/` actually use:
 *
 *   - headings `#`–`######` · paragraphs · bullet (`-`, `*`) and ordered (`1.`) lists
 *   - fenced code blocks (``` with optional language) · blockquotes (`>`)
 *   - inline: `code` · **strong** · *em* / _em_ · [text](url)
 *
 * Anything outside the subset stays what Markdown says it is anyway — literal text in a
 * paragraph. That is a graceful floor, not silent data loss: the characters all arrive,
 * they just do not gain formatting. The reverse direction (`adfToMarkdown`) understands a
 * much wider set, because upstream authors use editors; this direction only has to carry
 * what OUR template files contain.
 */
import type { AdfMark, AdfNode } from './adf.js';

/** A complete ADF document — the only node with a top-level `version`. */
export type AdfDoc = AdfNode & { readonly version: 1 };

/** Index of a run of EXACTLY `length` backticks in `text` (not part of a longer run), or -1. */
function findEqualBacktickRun(text: string, length: number): number {
  for (let idx = 0; idx < text.length;) {
    if (text[idx] !== '`') {
      idx += 1;
      continue;
    }
    let run = 1;
    while (text[idx + run] === '`') run += 1;
    if (run === length) return idx;
    idx += run;
  }
  return -1;
}

// ── Inline parsing ───────────────────────────────────────────────────────────

/** `text` node with optional marks; the only leaf ADF has. */
function textNode(text: string, marks: readonly AdfMark[]): AdfNode {
  return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text };
}

/**
 * Parses inline Markdown into ADF text nodes. `` `code` `` wins over everything (its content
 * is never re-parsed), then `**strong**`, then `*em*`/`_em_` (whose content IS re-parsed, so
 * `**bold *nested***` works), then `[text](url)`.
 */
/**
 * Add `mark` unless a mark of that type is already inherited — ADF rejects duplicate
 * marks on one node, and `*a _b_ c*` used to emit `em` twice on 'b': a clean dry run
 * followed by a 400 from upstream.
 */
const withMark = (inherited: readonly AdfMark[], mark: AdfMark): AdfMark[] =>
  inherited.some((m) => m.type === mark.type) ? [...inherited] : [...inherited, mark];

export function parseInline(source: string, inherited: readonly AdfMark[] = []): AdfNode[] {
  const nodes: AdfNode[] = [];
  let literal = '';
  const flush = (): void => {
    if (literal !== '') {
      nodes.push(textNode(literal, inherited));
      literal = '';
    }
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);

    // A code span may be fenced by ANY equal run of backticks — the read side's
    // codeSpan emits ``double`` fences around text that itself contains a backtick,
    // and a single-backtick-only parser mangled that round-trip into a stray
    // literal '`' plus a wrongly-opened span. One padding space comes off each
    // side when both are present (CommonMark's rule, the mirror of codeSpan's pad).
    const codeOpen = /^(`+)/.exec(rest);
    if (codeOpen?.[1] !== undefined) {
      const fence = codeOpen[1];
      const after = rest.slice(fence.length);
      const close = findEqualBacktickRun(after, fence.length);
      let content = close === -1 ? '' : after.slice(0, close);
      if (content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') {
        content = content.slice(1, -1);
      }
      if (close !== -1 && content !== '') {
        flush();
        // ADF permits `code` to combine ONLY with `link` — a span inside `**bold**`
        // used to inherit `strong` and the whole document bounced with a 400. The
        // code mark wins; surrounding emphasis simply does not reach into the span.
        nodes.push(textNode(content, [...inherited.filter((m) => m.type === 'link'), { type: 'code' }]));
        i += fence.length + close + fence.length;
        continue;
      }
      // No closer (or an empty span): the WHOLE run is literal, consumed in one
      // step. That is CommonMark's rule (scanning resumes AFTER an unmatched
      // opener) — and the old one-character fallback re-ran the closer search at
      // every backtick of the run, O(n²) on a pathological input.
      literal += fence;
      i += fence.length;
      continue;
    }

    // Lazy up to a `**` that is not followed by another `*` — that trailing-star guard is
    // what lets `**a *b***` close on the LAST pair, so the nested `*b*` stays inside.
    const strong = /^\*\*(.+?)\*\*(?!\*)/.exec(rest);
    if (strong?.[1] !== undefined) {
      flush();
      nodes.push(...parseInline(strong[1], withMark(inherited, { type: 'strong' })));
      i += strong[0].length;
      continue;
    }

    // `*` may open emphasis mid-word (CommonMark), `_` may NOT: without the flanking
    // checks `EXTRACT_CONFIG_PATH` published as 'EXTRACTCONFIGPATH' with 'CONFIG' in
    // italics — both underscores eaten. The guard is two-sided: the char before the
    // opening `_` and the char after the closing `_` must not belong to a word.
    const prevChar = i > 0 ? (source[i - 1] ?? '') : '';
    const emStar = /^\*([^*\s](?:[^*]*[^*\s])?)\*/.exec(rest);
    const emUnderscore = /[\p{L}\p{N}_]/u.test(prevChar)
      ? null
      : /^_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}_])/u.exec(rest);
    const em = emStar ?? emUnderscore;
    const emText = em?.[1];
    if (em && emText !== undefined) {
      flush();
      nodes.push(...parseInline(emText, withMark(inherited, { type: 'em' })));
      i += em[0].length;
      continue;
    }

    // The target may contain one level of balanced parentheses — Wikipedia-style
    // `/wiki/Bug_(software)` URLs; stopping at the first `)` truncated the href and
    // left a stray `)` in the text.
    const link = /^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(rest);
    if (link?.[1] !== undefined && link[2] !== undefined) {
      flush();
      nodes.push(textNode(link[1], withMark(inherited, { type: 'link', attrs: { href: link[2] } })));
      i += link[0].length;
      continue;
    }

    literal += source[i];
    i += 1;
  }
  flush();
  return nodes;
}

// ── Block parsing ────────────────────────────────────────────────────────────

const paragraph = (text: string): AdfNode => ({ type: 'paragraph', content: parseInline(text) });

/**
 * Converts a Markdown document into one ADF `doc` node.
 *
 * Line-based, single pass: fences are handled first (their content is sacred), then
 * headings, list items (grouped while consecutive), blockquote lines, and finally
 * paragraphs accumulated up to a blank line.
 */
export function markdownToAdf(markdown: string): AdfDoc {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const content: AdfNode[] = [];

  let paragraphBuffer: string[] = [];
  const flushParagraph = (): void => {
    if (paragraphBuffer.length > 0) {
      content.push(paragraph(paragraphBuffer.join(' ')));
      paragraphBuffer = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // The fence is ANY run of 3+ backticks and the closer must be at least as long
    // (CommonMark) — this repo's own fencedBlock emits ````-fences around code that
    // CONTAINS ```, and a parser fixed at exactly three turned that round-trip into
    // a document swallowed from the inner fence to EOF. The info string is anything
    // without a backtick — `[\w-]*` used to reject ```c++ the same way.
    const fence = /^(`{3,})([^`]*)$/.exec(line);
    if (fence?.[1] !== undefined) {
      flushParagraph();
      const closeFence = new RegExp(`^\`{${fence[1].length},}\\s*$`);
      const language = (fence[2] ?? '').trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closeFence.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // the closing fence (or end of input — an unclosed fence swallows to EOF, visibly)
      const code = body.join('\n');
      content.push({
        type: 'codeBlock',
        ...(language === '' ? {} : { attrs: { language } }),
        // ADF rejects empty text nodes, so an empty fence ships an empty codeBlock —
        // otherwise the 400 arrived from upstream only AFTER a clean dry run.
        ...(code === '' ? {} : { content: [{ type: 'text', text: code }] }),
      });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flushParagraph();
      content.push({ type: 'heading', attrs: { level: heading[1].length }, content: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    const listKind = (candidate: string): 'bulletList' | 'orderedList' | undefined => {
      if (/^\s*[-*]\s+/.test(candidate)) return 'bulletList';
      if (/^\s*\d+[.)]\s+/.test(candidate)) return 'orderedList';
      return undefined;
    };
    const kind = listKind(line);
    if (kind !== undefined) {
      flushParagraph();
      const items: AdfNode[] = [];
      while (i < lines.length && listKind(lines[i] ?? '') === kind) {
        const itemText = (lines[i] ?? '').replace(/^\s*(?:[-*]|\d+[.)])\s+/, '');
        items.push({ type: 'listItem', content: [paragraph(itemText)] });
        i += 1;
      }
      content.push({ type: kind, content: items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        quoted.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i += 1;
      }
      // Blank quoted lines separate paragraphs inside the quote, same rule as outside.
      const quoteParagraphs = quoted
        .join('\n')
        .split(/\n\s*\n/)
        .map((part) => part.replaceAll('\n', ' ').trim())
        .filter((part) => part !== '')
        .map(paragraph);
      // ADF requires blockquote content to be non-empty — a lone `>` line gets one
      // empty paragraph instead of a content: [] the API would reject.
      content.push({
        type: 'blockquote',
        content: quoteParagraphs.length > 0 ? quoteParagraphs : [{ type: 'paragraph', content: [] }],
      });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraphBuffer.push(line.trim());
    i += 1;
  }
  flushParagraph();

  return { version: 1, type: 'doc', content };
}
