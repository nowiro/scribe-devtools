/**
 * Tests for the deterministic surface of `read-confluence.ts`.
 *
 * Only three things leave this module without a network client: the config schema, the Markdown
 * renderer and the OKF concept builder. Everything that touches HTTP (`fetchPage`, the BFS inside
 * `resolvePageIds`, the label search) is module-private, so — unlike in `read-figma.spec.ts`,
 * where the client is injected into every processor — there is nothing here to hand a stub to.
 * That gap is reported rather than papered over; no test below reaches for the network, a token
 * or a file, because a test that needs any of the three gets skipped in CI and teaches people to
 * skip the rest too.
 *
 * What each block guards, and why that is worth the lines:
 *
 *  1. **The config schema** — a snapshot is a discriminated union of three modes, and the mode
 *     alone decides which fields are required. A `pageId` that is not a bare decimal id, or a
 *     `tree` field smuggled into a `page` snapshot, has to fail at parse time: later it either
 *     costs an upstream round or, worse, quietly extracts the wrong pages.
 *  2. **`renderPageMarkdown`** — the `.md` written next to every `.json` is what a human and an
 *     LLM actually read. It is asserted section by section, never against one big literal: a
 *     whole-document snapshot goes red on every editorial comma and stops meaning anything.
 *  3. **`buildPageConcept`** — the bundle's cross-links are the only place where the Confluence
 *     page graph survives the export. A link may only be emitted for a relative PRESENT in this
 *     snapshot, because a link to a file the bundle does not contain is a dead link in somebody
 *     else's knowledge base.
 */
import { describe, expect, it } from 'vitest';

import { buildPageConcept, ReadConfig, renderPageMarkdown, type ExtractedPage } from './read-confluence.js';

/** Fills the required-but-empty collections, so a fixture only states what the test is about. */
function makePage(overrides: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    id: '42',
    labels: [],
    ancestors: [],
    comments: [],
    attachments: [],
    childPageIds: [],
    ...overrides,
  };
}

const FULL_PAGE: ExtractedPage = makePage({
  title: 'Q3 roadmap',
  spaceId: 'ENG',
  status: 'current',
  version: 7,
  authorId: 'a-1',
  createdAt: '2026-05-01T10:00:00Z',
  url: 'https://example.atlassian.net/wiki/spaces/ENG/pages/42',
  bodyMd: '## Goals\n\nShip the thing.',
  labels: ['roadmap', 'q3'],
  ancestors: [
    { id: '1', title: 'Space home' },
    { id: '2', title: 'Planning' },
  ],
  comments: [
    { id: 'c1', title: 'Re: Q3 roadmap', authorId: 'a-2', createdAt: '2026-05-02T09:00:00Z', bodyMd: 'Looks good' },
  ],
  attachments: [{ id: 'att-1', title: 'diagram.png', mediaType: 'image/png', fileSize: 2048 }],
  childPageIds: ['101', '102'],
});

// ── Config schema ────────────────────────────────────────────────────────────

describe('ReadConfig (Confluence)', () => {
  it('rejects an unknown key rather than dropping it in silence', () => {
    // A misspelled field used to be stripped and the run used the default, which
    // is the worst possible outcome for a file that decides what data you pull.
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'h', type: 'page', pageId: '1', maxPage: 5 }] })).toThrow(
      /maxPage/,
    );
    expect(() =>
      ReadConfig.parse({ outputDirs: './x', snapshots: [{ name: 'h', type: 'page', pageId: '1' }] }),
    ).toThrow(/outputDirs/);
  });

  it('fills the defaults a minimal page snapshot leaves out', () => {
    const parsed = ReadConfig.parse({ snapshots: [{ name: 'handbook', type: 'page', pageId: '12345' }] });
    expect(parsed.outputDir).toBe('./.scribe/confluence');
    const [snap] = parsed.snapshots;
    if (!snap) throw new Error('expected snapshot');
    expect(snap.render).toEqual(['json', 'markdown']);
  });

  it('gives depth and maxPages only to the tree branch — the union is not one merged shape', () => {
    const tree = ReadConfig.parse({ snapshots: [{ name: 't', type: 'tree', rootPageId: '1' }] }).snapshots[0];
    if (!tree || tree.type !== 'tree') throw new Error('expected tree snapshot');
    expect(tree.depth).toBe(3);
    expect(tree.maxPages).toBe(500);

    const page = ReadConfig.parse({ snapshots: [{ name: 'p', type: 'page', pageId: '1' }] }).snapshots[0];
    if (!page) throw new Error('expected page snapshot');
    // A single page has no depth to descend and no page count to cap; inventing either here would
    // put a field in the manifest that nothing in the pipeline ever reads.
    expect(page).not.toHaveProperty('depth');
    expect(page).not.toHaveProperty('maxPages');
  });

  it('rejects a pageId that is not a bare decimal id — before anyone pays for a network round', () => {
    for (const pageId of ['abc', '12a', '', ' 123', '12.0', '-1', 123]) {
      expect(() => ReadConfig.parse({ snapshots: [{ name: 'p', type: 'page', pageId }] })).toThrow();
    }
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'p', type: 'page', pageId: '0' }] })).not.toThrow();
  });

  it('holds the tree branch to the same rule for rootPageId', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 't', type: 'tree', rootPageId: 'root' }] })).toThrow();
  });

  it('rejects an unknown mode instead of guessing one of the three', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'b', type: 'blogpost', pageId: '1' }] })).toThrow();
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'b', pageId: '1' }] })).toThrow();
  });

  it('rejects a page snapshot carrying the tree field instead of its own', () => {
    // `rootPageId` on `type: "page"` is a copy-paste from the mode above. The discriminator picks
    // the page branch, `pageId` is missing — and this must be loud, not an extract of nothing.
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'p', type: 'page', rootPageId: '1' }] })).toThrow();
  });

  it('keeps depth within 1..10 and rejects a fractional level', () => {
    const tree = (depth: unknown) => () =>
      ReadConfig.parse({ snapshots: [{ name: 't', type: 'tree', rootPageId: '1', depth }] });
    expect(tree(0)).toThrow();
    expect(tree(11)).toThrow();
    expect(tree(2.5)).toThrow();
    expect(tree(1)).not.toThrow();
    expect(tree(10)).not.toThrow();
  });

  it('keeps maxPages within 1..5000 — the cap is what bounds the in-memory okf collection', () => {
    const label = (maxPages: unknown) => () =>
      ReadConfig.parse({ snapshots: [{ name: 'l', type: 'label', label: 'adr', maxPages }] });
    expect(label(0)).toThrow();
    expect(label(5001)).toThrow();
    expect(label(1)).not.toThrow();
    expect(label(5000)).not.toThrow();
  });

  it('rejects an empty label — a label snapshot without a label would match the whole instance', () => {
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'l', type: 'label', label: '' }] })).toThrow();
    const parsed = ReadConfig.parse({ snapshots: [{ name: 'l', type: 'label', label: 'adr' }] }).snapshots[0];
    if (!parsed || parsed.type !== 'label') throw new Error('expected label snapshot');
    expect(parsed.space).toBeUndefined();
  });

  it('rejects a snapshot name that cannot be a directory name', () => {
    const named = (name: string) => () => ReadConfig.parse({ snapshots: [{ name, type: 'page', pageId: '1' }] });
    expect(named('Design Docs')).toThrow();
    expect(named('DesignDocs')).toThrow();
    expect(named('-leading-dash')).toThrow();
    expect(named('../escape')).toThrow();
    expect(named('design-docs-2')).not.toThrow();
  });

  it('knows the `okf` format — this pipeline does emit a bundle, unlike gitlab or sonar', () => {
    const parsed = ReadConfig.parse({
      snapshots: [{ name: 'p', type: 'page', pageId: '1', render: ['json', 'markdown', 'okf'] }],
    });
    expect(parsed.snapshots[0]?.render).toEqual(['json', 'markdown', 'okf']);
    expect(() =>
      ReadConfig.parse({ snapshots: [{ name: 'p', type: 'page', pageId: '1', render: ['yaml'] }] }),
    ).toThrow();
    // An empty render list would write no file at all — a run that produces nothing is a bug.
    expect(() => ReadConfig.parse({ snapshots: [{ name: 'p', type: 'page', pageId: '1', render: [] }] })).toThrow();
  });

  it('rejects an empty snapshot list — a pipeline without a scope has nothing to do', () => {
    expect(() => ReadConfig.parse({ snapshots: [] })).toThrow();
    expect(() => ReadConfig.parse({})).toThrow();
  });

  it('rejects an empty outputDir instead of writing into the config directory', () => {
    expect(() => ReadConfig.parse({ outputDir: '', snapshots: [{ name: 'p', type: 'page', pageId: '1' }] })).toThrow();
  });
});

// ── Markdown renderer ────────────────────────────────────────────────────────

describe('renderPageMarkdown', () => {
  it('heads the document with the title, and falls back to the id when there is none', () => {
    expect(renderPageMarkdown(FULL_PAGE)).toMatch(/^# Q3 roadmap\n/);
    expect(renderPageMarkdown(makePage({ id: '42' }))).toMatch(/^# Page 42\n/);
  });

  it('renders the primary metadata, id included even when the title carries it too', () => {
    const md = renderPageMarkdown(FULL_PAGE);
    expect(md).toContain('- **ID**: `42`');
    expect(md).toContain('- **Space**: `ENG`');
    expect(md).toContain('- **Status**: current');
    expect(md).toContain('- **Version**: 7');
    expect(md).toContain('- **Created**: 2026-05-01T10:00:00Z');
    expect(md).toContain('- **URL**: https://example.atlassian.net/wiki/spaces/ENG/pages/42');
    expect(md).toContain('- **Labels**: roadmap, q3');
  });

  it('a mapped space name renders next to the id — the id stays, the name explains it', () => {
    const md = renderPageMarkdown(makePage({ id: '42', spaceId: '123456', spaceName: 'Dokumentacja' }));
    expect(md).toContain('- **Space**: Dokumentacja (`123456`)');
    // Without a mapping the raw id is all we honestly have.
    const bare = renderPageMarkdown(makePage({ id: '42', spaceId: '123456' }));
    expect(bare).toContain('- **Space**: `123456`');
  });

  it('writes an em dash for absent metadata rather than the word "undefined"', () => {
    const md = renderPageMarkdown(makePage());
    expect(md).toContain('- **Status**: —');
    expect(md).toContain('- **Version**: —');
    expect(md).toContain('- **Created**: —');
    expect(md).not.toContain('undefined');
  });

  it('omits the optional lines entirely instead of printing empty ones', () => {
    const md = renderPageMarkdown(makePage());
    expect(md).not.toContain('**Space**');
    expect(md).not.toContain('**URL**');
    expect(md).not.toContain('**Labels**');
    expect(md).not.toContain('**Path**');
  });

  it('renders the ancestor path root-first, falling back to the id for a titleless ancestor', () => {
    const md = renderPageMarkdown(
      makePage({ ancestors: [{ id: '1', title: 'Space home' }, { id: '2' }, { id: '3', title: 'Team' }] }),
    );
    expect(md).toContain('- **Path**: Space home › 2 › Team');
  });

  it('skips every section whose data is empty — no headings over nothing', () => {
    const md = renderPageMarkdown(makePage({ title: 'Bare' }));
    expect(md).not.toContain('## Body');
    expect(md).not.toContain('## Comments');
    expect(md).not.toContain('## Attachments');
    expect(md).not.toContain('## Children');
  });

  it('treats an empty body string as no body at all', () => {
    expect(renderPageMarkdown(makePage({ bodyMd: '' }))).not.toContain('## Body');
  });

  it('keeps the sections in a fixed order, so a re-run diffs only where the content changed', () => {
    const md = renderPageMarkdown(FULL_PAGE);
    const at = (heading: string) => {
      const index = md.indexOf(heading);
      if (index === -1) throw new Error(`missing section ${heading}`);
      return index;
    };
    expect(at('## Body')).toBeLessThan(at('## Comments'));
    expect(at('## Comments')).toBeLessThan(at('## Attachments'));
    expect(at('## Attachments')).toBeLessThan(at('## Children'));
  });

  it('passes the converted body through verbatim, markdown specials and all', () => {
    // The body arrives from `adfToMarkdownSafe` already as markdown: escaping it here would
    // turn tables and code spans from Confluence into literal punctuation.
    const md = renderPageMarkdown(makePage({ bodyMd: '| a | b |\n| - | - |\nuse `npm i` & _stress_' }));
    expect(md).toContain('| a | b |');
    expect(md).toContain('use `npm i` & _stress_');
  });

  it('labels a comment that has neither title nor date instead of printing undefined', () => {
    const md = renderPageMarkdown(makePage({ comments: [{ id: 'c1', bodyMd: 'anonymous note' }] }));
    expect(md).toContain('### (no title) — —');
    expect(md).toContain('anonymous note');
    expect(md).not.toContain('undefined');
  });

  it('keeps the comments in upstream order instead of re-sorting them by date', () => {
    const md = renderPageMarkdown(
      makePage({
        comments: [
          { id: 'c2', title: 'Second', createdAt: '2026-05-09T09:00:00Z' },
          { id: 'c1', title: 'First', createdAt: '2026-05-01T09:00:00Z' },
        ],
      }),
    );
    expect(md.indexOf('### Second')).toBeLessThan(md.indexOf('### First'));
  });

  it('prints a zero-byte attachment as 0 B, not as unknown', () => {
    // `?? '?'` and `|| '?'` differ on exactly this input, and an empty upload is a real thing.
    const md = renderPageMarkdown(
      makePage({ attachments: [{ id: 'a1', title: 'empty.txt', mediaType: 'text/plain', fileSize: 0 }] }),
    );
    expect(md).toContain('- **empty.txt** (text/plain, 0 B)');
  });

  it('marks an attachment with no metadata with placeholders on every field', () => {
    const md = renderPageMarkdown(makePage({ attachments: [{ id: 'a1' }] }));
    expect(md).toContain('- **?** (?, ? B)');
  });

  it('wraps every child id in inline code so a numeric id never reads as a list number', () => {
    const md = renderPageMarkdown(makePage({ childPageIds: ['101', '102'] }));
    expect(md).toContain('- `101`');
    expect(md).toContain('- `102`');
    expect(md.indexOf('- `101`')).toBeLessThan(md.indexOf('- `102`'));
  });
});

// ── OKF concept ──────────────────────────────────────────────────────────────

describe('buildPageConcept (render okf)', () => {
  const EMPTY_SNAPSHOT: ReadonlySet<string> = new Set();

  it('maps the canonical metadata onto the frontmatter fields, in a fixed order', () => {
    const concept = buildPageConcept(FULL_PAGE, EMPTY_SNAPSHOT);
    expect(concept.slug).toBe('42');
    expect(concept.type).toBe('Confluence Page');
    expect(concept.title).toBe('Q3 roadmap');
    expect(concept.resource).toBe(FULL_PAGE.url);
    expect(concept.tags).toEqual(['roadmap', 'q3']);
    expect(concept.description).toBe('Confluence page (space ENG, version 7).');
    expect(concept.extra).toEqual([
      ['page_id', '42'],
      ['space_id', 'ENG'],
      ['status', 'current'],
    ]);
  });

  it('drops resource and tags when the page has neither, rather than emitting empty keys', () => {
    const concept = buildPageConcept(makePage(), EMPTY_SNAPSHOT);
    expect(concept.resource).toBeUndefined();
    expect(concept.tags).toBeUndefined();
    expect(concept.title).toBe('Page 42');
    expect(concept.description).toBe('Confluence page (space ?, version ?).');
    expect(concept.extra).toEqual([['page_id', '42']]);
  });

  it('links only the relatives that are in this snapshot — no dead links out of the bundle', () => {
    const page = makePage({
      ancestors: [
        { id: '1', title: 'in the snapshot' },
        { id: '9', title: 'left outside' },
      ],
      childPageIds: ['101', '999'],
    });
    const body = buildPageConcept(page, new Set(['1', '101'])).body;
    expect(body).toContain('- Ancestor: [1](1.md)');
    expect(body).toContain('- Child: [101](101.md)');
    expect(body).not.toContain('9.md');
    expect(body).not.toContain('999.md');
  });

  it('omits the Related concepts heading when no relative made it into the snapshot', () => {
    const page = makePage({ ancestors: [{ id: '9' }], childPageIds: ['999'] });
    expect(buildPageConcept(page, EMPTY_SNAPSHOT).body).not.toContain('## Related concepts');
  });

  it('lists ancestors before children, and the whole block after the page markdown', () => {
    const page = makePage({ ancestors: [{ id: '1' }], childPageIds: ['101'] });
    const body = buildPageConcept(page, new Set(['1', '101'])).body;
    expect(body.indexOf('- Ancestor: [1](1.md)')).toBeLessThan(body.indexOf('- Child: [101](101.md)'));
    expect(body.startsWith(renderPageMarkdown(page))).toBe(true);
    expect(body.indexOf('## Children')).toBeLessThan(body.indexOf('## Related concepts'));
  });

  it('emits a link that resolves to the file name the related concept is written under', () => {
    // The two sides of a cross-link are computed in different calls; if the slug and the link
    // target ever drift apart, the bundle looks fine and navigates nowhere.
    const parent = makePage({ id: '42', childPageIds: ['101'] });
    const child = makePage({ id: '101', ancestors: [{ id: '42' }] });
    const inSnapshot = new Set(['42', '101']);
    const childConcept = buildPageConcept(child, inSnapshot);
    expect(buildPageConcept(parent, inSnapshot).body).toContain(`(${childConcept.slug}.md)`);
    expect(childConcept.body).toContain('(42.md)');
  });
});
