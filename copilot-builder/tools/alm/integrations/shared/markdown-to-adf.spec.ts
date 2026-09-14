// Tests for the write-side Markdown → ADF converter. The other direction (`adf.spec.ts`)
// answers "can we read what upstream wrote"; this one answers "does what we write round-trip"
// — the last test literally pushes a template-shaped document through markdownToAdf and back
// through adfToMarkdown.

import { describe, expect, it } from 'vitest';

import { adfToMarkdown } from './adf.js';
import { markdownToAdf, parseInline } from './markdown-to-adf.js';

describe('parseInline()', () => {
  it('plain text is one unmarked node', () => {
    expect(parseInline('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('code, strong, em and link each get their mark', () => {
    expect(parseInline('`x`')).toEqual([{ type: 'text', text: 'x', marks: [{ type: 'code' }] }]);
    expect(parseInline('**x**')).toEqual([{ type: 'text', text: 'x', marks: [{ type: 'strong' }] }]);
    expect(parseInline('*x*')).toEqual([{ type: 'text', text: 'x', marks: [{ type: 'em' }] }]);
    expect(parseInline('_x_')).toEqual([{ type: 'text', text: 'x', marks: [{ type: 'em' }] }]);
    expect(parseInline('[a](https://x.pl)')).toEqual([
      { type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'https://x.pl' } }] },
    ]);
  });

  it('an unmatched opener run is wholly literal (CommonMark), consumed in one step', () => {
    expect(parseInline('``a`')).toEqual([{ type: 'text', text: '``a`' }]);
  });

  it('code content is never re-parsed — backticks protect their inside', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ type: 'text', text: '**not bold**', marks: [{ type: 'code' }] }]);
  });

  it('nesting: bold containing em stacks both marks', () => {
    expect(parseInline('**a *b***')).toEqual([
      { type: 'text', text: 'a ', marks: [{ type: 'strong' }] },
      { type: 'text', text: 'b', marks: [{ type: 'strong' }, { type: 'em' }] },
    ]);
  });

  it('a lone asterisk stays literal instead of eating the rest of the line', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }]);
  });

  it('intraword underscores are literal — snake_case survives publication', () => {
    // `EXTRACT_CONFIG_PATH` used to publish as 'EXTRACT' + em('CONFIG') + 'PATH':
    // both underscores eaten, the middle italicised. CommonMark forbids intraword `_`.
    expect(parseInline('set EXTRACT_CONFIG_PATH first')).toEqual([
      { type: 'text', text: 'set EXTRACT_CONFIG_PATH first' },
    ]);
    // …while a properly flanked `_em_` still works right after punctuation or a space.
    expect(parseInline('a _b_ c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'em' }] },
      { type: 'text', text: ' c' },
    ]);
  });

  it('a link target may contain balanced parentheses — Wikipedia-style URLs stay whole', () => {
    expect(parseInline('[bug](https://en.wikipedia.org/wiki/Bug_(software))')).toEqual([
      {
        type: 'text',
        text: 'bug',
        marks: [{ type: 'link', attrs: { href: 'https://en.wikipedia.org/wiki/Bug_(software)' } }],
      },
    ]);
  });
});

describe('markdownToAdf()', () => {
  it('produces a versioned doc node', () => {
    const doc = markdownToAdf('hello');
    expect(doc.version).toBe(1);
    expect(doc.type).toBe('doc');
    expect(doc.content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }]);
  });

  it('headings carry their level', () => {
    const doc = markdownToAdf('## Kontekst');
    expect(doc.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  it('consecutive bullet lines fold into ONE bulletList', () => {
    const doc = markdownToAdf('- a\n- b');
    expect(doc.content).toHaveLength(1);
    expect(doc.content?.[0]?.type).toBe('bulletList');
    expect(doc.content?.[0]?.content).toHaveLength(2);
  });

  it('ordered lists accept both `1.` and `1)`', () => {
    expect(markdownToAdf('1. a\n2) b').content?.[0]?.type).toBe('orderedList');
  });

  it('a fenced block keeps its language and its content verbatim — including blank lines', () => {
    const doc = markdownToAdf('```bash\nnpm test\n\necho ok\n```');
    expect(doc.content?.[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'bash' },
      content: [{ type: 'text', text: 'npm test\n\necho ok' }],
    });
  });

  it('an info string with symbols (```c++) opens the fence — its closer must not swallow the document', () => {
    // `[\w-]*` used to reject ```c++, so the closing ``` OPENED a block that
    // consumed every following section to EOF in the published page.
    const doc = markdownToAdf('```c++\nint f();\n```\n# Next section\nprose');
    expect(doc.content?.[0]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'c++' },
      content: [{ type: 'text', text: 'int f();' }],
    });
    expect(doc.content?.[1]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  });

  it('an empty fence ships an empty codeBlock — ADF rejects empty text nodes', () => {
    expect(markdownToAdf('```\n```').content?.[0]).toEqual({ type: 'codeBlock' });
  });

  it('a lone `>` line ships a blockquote with one empty paragraph, not content: []', () => {
    expect(markdownToAdf('>').content?.[0]).toEqual({
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [] }],
    });
  });

  it('adjacent paragraph lines join with a space; a blank line splits paragraphs', () => {
    const doc = markdownToAdf('linia a\nlinia b\n\ndruga');
    expect(doc.content).toHaveLength(2);
    expect(doc.content?.[0]?.content?.[0]?.text).toBe('linia a linia b');
  });

  it('blockquote lines become a blockquote of paragraphs', () => {
    const doc = markdownToAdf('> cytat\n> dalej\n>\n> nowy akapit');
    expect(doc.content?.[0]?.type).toBe('blockquote');
    expect(doc.content?.[0]?.content).toHaveLength(2);
  });

  it('round-trips a template-shaped document through adfToMarkdown', () => {
    const source = [
      '## Kontekst',
      '',
      'Od migracji ~2% uploadów **pada** na `503`.',
      '',
      '## Kryteria akceptacji',
      '',
      '- upload udaje się przy ponowieniu',
      '- brak duplikatów',
    ].join('\n');
    const back = adfToMarkdown(markdownToAdf(source));
    expect(back).toContain('## Kontekst');
    expect(back).toContain('## Kryteria akceptacji');
    expect(back).toContain('**pada**');
    expect(back).toContain('`503`');
    expect(back).toContain('- upload udaje się przy ponowieniu');
  });
});
