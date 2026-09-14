/**
 * Unit tests — ADF → Markdown converter.
 */
import { describe, expect, it } from 'vitest';

import { adfToMarkdown, adfToMarkdownSafe, codeSpan, type AdfNode } from './adf.js';

const para = (text: string): AdfNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

describe('adfToMarkdown', () => {
  it('handles null/undefined/string passthrough', () => {
    expect(adfToMarkdown(null)).toBe('');
    expect(adfToMarkdown(undefined)).toBe('');
    expect(adfToMarkdown('plain')).toBe('plain');
  });

  it('renders a doc with a single paragraph', () => {
    const doc: AdfNode = { type: 'doc', content: [para('Hello world')] };
    expect(adfToMarkdown(doc)).toBe('Hello world');
  });

  it('renders headings with correct level', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }],
    };
    expect(adfToMarkdown(doc)).toBe('## Title');
  });

  it('clamps heading level to 1..6', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 99 }, content: [{ type: 'text', text: 'Big' }] }],
    };
    expect(adfToMarkdown(doc)).toBe('###### Big');
  });

  it('applies marks (strong + em + code + link)', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
            { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
            { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://x.com' } }] },
          ],
        },
      ],
    };
    const md = adfToMarkdown(doc);
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
    expect(md).toContain('`code`');
    expect(md).toContain('[link](https://x.com)');
  });

  it('renders bullet lists', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [para('one')] },
            { type: 'listItem', content: [para('two')] },
          ],
        },
      ],
    };
    const md = adfToMarkdown(doc);
    expect(md).toContain('- one');
    expect(md).toContain('- two');
  });

  it('renders ordered lists with `1.` marker', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [para('first')] }],
        },
      ],
    };
    expect(adfToMarkdown(doc)).toContain('1. first');
  });

  it('renders code block with language', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1;' }] }],
    };
    const md = adfToMarkdown(doc);
    expect(md).toContain('```ts');
    expect(md).toContain('const x = 1;');
  });

  it('renders panel with variant marker', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'panel', attrs: { panelType: 'warning' }, content: [para('Mind the gap')] }],
    };
    const md = adfToMarkdown(doc);
    expect(md).toContain('[WARNING]');
    expect(md).toContain('> Mind the gap');
  });

  it('renders mention as @name', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { text: '@alice' } }] }],
    };
    expect(adfToMarkdown(doc)).toBe('@alice');
  });

  it('renders inlineCard as link', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'inlineCard', attrs: { url: 'https://jira/PROJ-1' } }] }],
    };
    expect(adfToMarkdown(doc)).toContain('[https://jira/PROJ-1](https://jira/PROJ-1)');
  });

  it('renders a table with header + body rows', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [para('A')] },
                { type: 'tableHeader', content: [para('B')] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [para('1')] },
                { type: 'tableCell', content: [para('2')] },
              ],
            },
          ],
        },
      ],
    };
    const md = adfToMarkdown(doc);
    expect(md).toContain('| A | B |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('emits diagnostic comment for unknown block', () => {
    const doc: AdfNode = { type: 'doc', content: [{ type: 'futureNode', content: [para('secret')] }] };
    const md = adfToMarkdown(doc);
    expect(md).toContain('<!-- adf:unknown:futureNode -->');
    expect(md).toContain('secret');
  });

  it('renders deeply nested lists without throwing and without losing the leaf', () => {
    // The previous version of this test built a ONE-paragraph document and
    // asserted only that a pure function does not throw — it could not fail.
    let node: AdfNode = { type: 'listItem', content: [para('leaf')] };
    for (let depth = 0; depth < 60; depth += 1) {
      node = { type: 'listItem', content: [{ type: 'bulletList', content: [node] }] };
    }
    const deep: AdfNode = { type: 'doc', content: [{ type: 'bulletList', content: [node] }] };
    let out = '';
    expect(() => (out = adfToMarkdown(deep))).not.toThrow();
    expect(out).toContain('leaf');
  });

  it('lengthens the fence when the code itself contains backticks', () => {
    // Three backticks inside a three-backtick fence close it early, and the rest
    // of the document renders as prose.
    const doc: AdfNode = {
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'a ``` b' }] }],
    };
    const out = adfToMarkdown(doc);
    expect(out.startsWith('````')).toBe(true);
    expect(out.trimEnd().endsWith('````')).toBe(true);
  });

  it('escapes a pipe inside a table cell instead of opening a new column', () => {
    const doc: AdfNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [para('h1')] },
                { type: 'tableHeader', content: [para('h2')] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [para('a | b')] },
                { type: 'tableCell', content: [para('c')] },
              ],
            },
          ],
        },
      ],
    };
    const body = adfToMarkdown(doc)
      .split('\n')
      .find((line) => line.includes('a '));
    expect(body).toBe('| a \\| b | c |');
  });
});

describe('adfToMarkdownSafe', () => {
  it('returns undefined for null / undefined / a non-string primitive / blank text', () => {
    expect(adfToMarkdownSafe(null)).toBeUndefined();
    expect(adfToMarkdownSafe(undefined)).toBeUndefined();
    expect(adfToMarkdownSafe(42)).toBeUndefined();
    expect(adfToMarkdownSafe(true)).toBeUndefined();
    expect(adfToMarkdownSafe('   ')).toBeUndefined();
  });

  it('returns a plain string as text rather than discarding it', () => {
    expect(adfToMarkdownSafe('plain string')).toBe('plain string');
  });

  // Confluence v2 returns `body.atlas_doc_format.value` as a JSON-encoded STRING,
  // not an object. Rejecting strings dropped every page body in the snapshot,
  // silently — the field was simply absent, which reads as "the page is empty".
  it('parses a JSON-encoded ADF document handed over as a string', () => {
    const encoded = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'from Confluence' }] }],
    });
    expect(adfToMarkdownSafe(encoded)).toBe('from Confluence');
  });

  it('treats a string that only looks like JSON as plain text', () => {
    expect(adfToMarkdownSafe('{not really json')).toBe('{not really json');
  });

  it('returns undefined for valid ADF that renders to empty string', () => {
    expect(adfToMarkdownSafe({ type: 'doc', content: [] })).toBeUndefined();
  });

  it('returns Markdown for non-empty ADF', () => {
    const doc: AdfNode = { type: 'doc', content: [para('hello')] };
    expect(adfToMarkdownSafe(doc)).toBe('hello');
  });

  it('accepts unknown type — TypeScript guards against this but runtime is tolerant', () => {
    const doc = { type: 'doc', content: [para('x')] };
    expect(adfToMarkdownSafe(doc)).toBe('x');
  });
});

describe('codeSpan', () => {
  it('space-padded content gets an extra pad — CommonMark readers strip one space per side', () => {
    expect(codeSpan(' x ')).toBe('`  x  `');
  });

  it('plain content and one-sided spaces need no padding', () => {
    expect(codeSpan('x')).toBe('`x`');
    expect(codeSpan(' x')).toBe('` x`');
  });

  it('an interior backtick only outsizes the fence; a fence-touching one also pads', () => {
    expect(codeSpan('a`b')).toBe('``a`b``');
    expect(codeSpan('`x')).toBe('`` `x ``');
  });
});
