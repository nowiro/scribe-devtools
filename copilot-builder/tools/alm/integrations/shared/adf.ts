/**
 * ADF (Atlassian Document Format) → Markdown converter.
 *
 * ADF is the JSON document format used by Jira issue descriptions / comments
 * and Confluence page bodies (when the API is asked for ADF instead of HTML).
 * Spec: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 *
 * Why convert here:
 *   - LLMs read Markdown well. ADF JSON is verbose noise.
 *   - Markdown survives a round-trip through a plain text file, which is what a
 *     snapshot is.
 *
 * Coverage (the ~95 % path):
 *   - paragraph · heading (1–6) · bulletList · orderedList · listItem
 *   - text · marks (strong · em · code · strike · link)
 *   - codeBlock (with language hint)
 *   - blockquote · rule
 *   - panel (info / warning / error / success / note)
 *   - mention (@displayName) · emoji (:short_name:)
 *   - inlineCard (Jira issue link) · table · tableRow · tableHeader · tableCell
 *   - mediaSingle / mediaGroup / media (returns alt text + URL)
 *
 * Unknown nodes degrade gracefully — emit any inline text we can find and a
 * `<!-- adf:unknown:<type> -->` HTML comment so problem nodes are debuggable.
 */

export interface AdfMark {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
}

export interface AdfNode {
  readonly type: string;
  readonly text?: string;
  readonly content?: readonly AdfNode[];
  readonly marks?: readonly AdfMark[];
  readonly attrs?: Record<string, unknown>;
}

/**
 * Convert ADF (or a plain string, or null/undefined) to Markdown.
 * Always returns a string — never throws.
 */
export function adfToMarkdown(input: AdfNode | string | null | undefined): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  if (typeof input !== 'object' || !('type' in input)) return '';
  return walkBlock(input).trim();
}

/**
 * Tolerant wrapper over `adfToMarkdown` for `unknown` values (typically from
 * raw API responses). Returns `undefined` instead of `''` for empty / invalid
 * input, so it fits the `...(value ? { key: value } : {})` pattern.
 *
 * A **JSON-encoded string** is parsed first. Jira returns ADF as an object, but
 * Confluence v2 returns `body.atlas_doc_format.value` as a *string* holding the
 * same document — and rejecting strings outright silently dropped every page
 * body and every comment in the Confluence snapshot. A string that is not JSON
 * is plain text and is returned as-is.
 */
export function adfToMarkdownSafe(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.length === 0) return undefined;
    if (text.startsWith('{')) {
      // Only take the parsed form when it actually converts. Valid JSON that is
      // not an ADF document renders to nothing, and returning that `undefined`
      // would drop the text — the exact failure this branch exists to end.
      try {
        const converted = adfToMarkdownSafe(JSON.parse(text) as unknown);
        if (converted !== undefined) return converted;
      } catch {
        // Not JSON at all — fall through and treat it as plain text.
      }
    }
    return text;
  }
  if (typeof raw !== 'object') return undefined;
  const md = adfToMarkdown(raw as AdfNode);
  return md.length > 0 ? md : undefined;
}

// ── Block-level walker ──────────────────────────────────────────────────────

function walkBlock(node: AdfNode): string {
  switch (node.type) {
    case 'doc': {
      return joinBlocks(node.content);
    }
    case 'paragraph': {
      return walkInline(node.content) + '\n';
    }
    case 'heading': {
      const level = clampLevel(node.attrs?.['level']);
      return `${'#'.repeat(level)} ${walkInline(node.content)}\n`;
    }
    case 'bulletList': {
      return renderList(node.content, '-') + '\n';
    }
    case 'orderedList': {
      return renderList(node.content, '1.') + '\n';
    }
    case 'codeBlock': {
      const language = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : '';
      // The fence must be LONGER than the longest run of backticks inside the
      // code, or that run closes it early and the remainder of the document
      // renders as prose — fencedBlock owns that rule.
      return `${fencedBlock(joinText(node.content), language)}\n`;
    }
    case 'blockquote': {
      const inner = joinBlocks(node.content);
      const quoted = inner
        .split('\n')
        .map((line) => (line.length > 0 ? `> ${line}` : '>'))
        .join('\n');
      // Plain string ops — no regex backtracking risk.
      return `${quoted.trimEnd()}\n`;
    }
    case 'rule': {
      return '\n---\n';
    }
    case 'panel': {
      const variant = typeof node.attrs?.['panelType'] === 'string' ? node.attrs['panelType'] : 'info';
      const inner = joinBlocks(node.content).trim();
      return (
        `> **[${variant.toUpperCase()}]**\n` +
        inner
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n') +
        '\n'
      );
    }
    case 'table': {
      return renderTable(node) + '\n';
    }
    case 'mediaSingle':
    case 'mediaGroup': {
      return walkInline(node.content) + '\n';
    }
    default: {
      // Unknown block: emit any inline text + diagnostic comment.
      const inline = walkInline(node.content);
      return inline ? `${inline}\n<!-- adf:unknown:${node.type} -->\n` : `<!-- adf:unknown:${node.type} -->\n`;
    }
  }
}

function joinBlocks(content: readonly AdfNode[] | undefined): string {
  if (!content || content.length === 0) return '';
  return content.map((child) => walkBlock(child)).join('\n');
}

// ── Inline-level walker ─────────────────────────────────────────────────────

function walkInline(content: readonly AdfNode[] | undefined): string {
  if (!content || content.length === 0) return '';
  return content.map((node) => inlineNode(node)).join('');
}

function inlineNode(node: AdfNode): string {
  switch (node.type) {
    case 'text': {
      return applyMarks(node.text ?? '', node.marks);
    }
    case 'hardBreak': {
      return '  \n';
    }
    case 'mention': {
      const name = typeof node.attrs?.['text'] === 'string' ? node.attrs['text'] : 'user';
      return `@${name.replace(/^@/, '')}`;
    }
    case 'emoji': {
      const short = typeof node.attrs?.['shortName'] === 'string' ? node.attrs['shortName'] : '';
      return short || '';
    }
    case 'inlineCard': {
      const url = typeof node.attrs?.['url'] === 'string' ? node.attrs['url'] : '';
      return url ? `[${url}](${url})` : '';
    }
    case 'media': {
      const alt = typeof node.attrs?.['alt'] === 'string' ? node.attrs['alt'] : 'attachment';
      const id = typeof node.attrs?.['id'] === 'string' ? node.attrs['id'] : '';
      return `![${alt}](attachment://${id})`;
    }
    default: {
      // Unknown inline: fall back to any text content.
      return walkInline(node.content) || (typeof node.text === 'string' ? node.text : '');
    }
  }
}

function applyMarks(text: string, marks: readonly AdfMark[] | undefined): string {
  if (!marks || marks.length === 0) return text;
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'strong': {
        out = `**${out}**`;
        break;
      }
      case 'em': {
        out = `*${out}*`;
        break;
      }
      case 'code': {
        // Span-sized version of the codeBlock defence: a single-backtick fence around
        // text that itself contains a backtick closed the span early and the tail
        // leaked out as prose.
        out = codeSpan(out);
        break;
      }
      case 'strike': {
        out = `~~${out}~~`;
        break;
      }
      case 'link': {
        const href = typeof mark.attrs?.['href'] === 'string' ? mark.attrs['href'] : '#';
        out = `[${out}](${href})`;
        break;
      }
      default: {
        // unknown mark — leave text as-is
        break;
      }
    }
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clampLevel(level: unknown): number {
  if (typeof level !== 'number') return 1;
  return Math.max(1, Math.min(6, Math.round(level)));
}

function joinText(content: readonly AdfNode[] | undefined): string {
  if (!content) return '';
  return content.map((node) => (node.type === 'text' ? (node.text ?? '') : walkInline(node.content))).join('');
}

function renderList(items: readonly AdfNode[] | undefined, marker: string): string {
  if (!items) return '';
  return items
    .filter((item) => item.type === 'listItem')
    .map((item) => {
      const inner = joinBlocks(item.content).trim();
      const lines = inner.split('\n');
      return (
        `${marker} ${lines[0] ?? ''}` +
        (lines.length > 1
          ? '\n' +
            lines
              .slice(1)
              .map((l) => `  ${l}`)
              .join('\n')
          : '')
      );
    })
    .join('\n');
}

function renderTable(table: AdfNode): string {
  const rows = (table.content ?? []).filter((node): node is AdfNode => node.type === 'tableRow');
  if (rows.length === 0) return '';

  const cells: string[][] = rows.map((row) =>
    (row.content ?? []).map((cell) => joinBlocks(cell.content).trim().replaceAll(/\n+/g, ' ')),
  );

  const header = cells[0] ?? [];
  const rest = cells.slice(1);
  const separator = header.map(() => '---');

  return [renderRow(header), renderRow(separator), ...rest.map((row) => renderRow(row))].join('\n');
}

function renderRow(columns: readonly string[]): string {
  return `| ${columns.map(escapeTableCell).join(' | ')} |`;
}

/**
 * Make a cell safe to sit between pipes. An unescaped `|` opens an extra column
 * and shifts every value after it — worse than losing the character, because
 * the table still renders, just wrong, and nothing signals it.
 *
 * Only the pipe is escaped. The value is ALREADY rendered markdown (it can carry
 * `**bold**`, a link, an inline code span), so doubling backslashes here would
 * corrupt escapes the renderer itself emitted. GFM's row splitter consumes
 * nothing but `|`.
 */
function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|');
}

/**
 * Length of the longest consecutive run of backticks in `text`. Exported because the
 * fence-lengthening defence it powers is needed wherever markdown is EMITTED around
 * upstream content — this file, jira's field renderer, browser-inspector's report —
 * and the loop used to exist as three private copies that could drift.
 */
export function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const character of text) {
    if (character === '`') {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * Inline code span whose fence outlives any backtick run inside. CommonMark strips
 * exactly one leading/trailing space, hence the padding when the text touches the
 * fence. Exported next to the run counter for the same reason it is: the sizing
 * rule used to be re-implemented wherever markdown is emitted.
 */
export function codeSpan(text: string): string {
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  // Padding when the text touches a backtick — AND when it is space-padded on both
  // sides, because CommonMark's reader strips one space from each side exactly
  // then: without the extra pad, code content ' x ' round-tripped to 'x' and the
  // write-back silently altered upstream content.
  const pad =
    text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '')
      ? ' '
      : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Fenced code block whose fence outlives any backtick run inside; optional info string. */
export function fencedBlock(content: string, language = ''): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(content) + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

/**
 * Upstream text destined for ONE markdown line — a heading, a reference bullet.
 * The API allows newlines the UI forbids, and an unflattened one splits the line
 * and injects sibling structure. Exported next to codeSpan for the same reason:
 * every pipeline that puts upstream text into a heading was growing its own copy.
 */
export const flatLine = (text: string): string => text.replaceAll(/\s*[\r\n]+\s*/gu, ' ');
