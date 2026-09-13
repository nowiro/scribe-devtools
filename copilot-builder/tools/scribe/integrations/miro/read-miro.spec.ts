// Tests for the Miro pipeline: the strict config, the HTML→text pass, the grouping/render,
// and both paginators against a stub http — cursor (items) and offset (boards), each with
// the truncation-is-said property.

import { describe, expect, it } from 'vitest';

import type { HttpClient } from '../shared/http-client.js';
import {
  ReadConfig,
  fetchBoardItems,
  fetchBoards,
  groupByType,
  renderBoardMarkdown,
  reshapeItem,
  stripHtml,
} from './read-miro.js';

describe('ReadConfig', () => {
  it('defaults land: outputDir under .scribe, maxItems per type', () => {
    const parsed = ReadConfig.parse({
      snapshots: [
        { name: 'all', type: 'boards' },
        { name: 'one', type: 'board', boardId: 'uXjVN2wR8sY=' },
      ],
    });
    expect(parsed.outputDir).toBe('./.scribe/miro');
    expect(parsed.snapshots[0]).toMatchObject({ maxItems: 200 });
    expect(parsed.snapshots[1]).toMatchObject({ maxItems: 2000 });
  });

  it('a board snapshot requires boardId; a boards snapshot refuses one (strict)', () => {
    expect(ReadConfig.safeParse({ snapshots: [{ name: 'x', type: 'board' }] }).success).toBe(false);
    expect(ReadConfig.safeParse({ snapshots: [{ name: 'x', type: 'boards', boardId: 'uXjVN2wR8sY=' }] }).success).toBe(
      false,
    );
  });

  it('an unknown key is a hard error, same as every other source', () => {
    expect(ReadConfig.safeParse({ snapshots: [{ name: 'x', type: 'boards', maxItem: 5 }] }).success).toBe(false);
  });
});

describe('stripHtml()', () => {
  it('drops tags, decodes entities, collapses whitespace', () => {
    expect(stripHtml('<p>Retry <strong>uploads</strong></p>\n<p>ASAP &amp; safely</p>')).toBe(
      'Retry uploads ASAP & safely',
    );
    expect(stripHtml('&lt;tag&gt; &quot;q&quot; &#39;a&#39;&nbsp;x')).toBe('<tag> "q" \'a\' x');
  });

  it('plain text passes through', () => {
    expect(stripHtml('just text')).toBe('just text');
  });
});

describe('reshapeItem()', () => {
  it('content wins over title; missing both → empty text', () => {
    expect(reshapeItem({ id: '1', type: 'sticky_note', data: { content: '<p>a</p>', title: 'b' } }).text).toBe('a');
    expect(reshapeItem({ id: '2', type: 'frame', data: { title: 'Sprint 42' } }).text).toBe('Sprint 42');
    expect(reshapeItem({ id: '3', type: 'image' }).text).toBe('');
  });

  it('carries the parent frame id when present', () => {
    expect(reshapeItem({ id: '1', type: 'card', parent: { id: 'f9' } }).parentId).toBe('f9');
    expect(reshapeItem({ id: '2', type: 'card' }).parentId).toBeUndefined();
  });
});

describe('rendering', () => {
  const items = [
    { id: '1', type: 'sticky_note', text: 'pomysł A' },
    { id: '2', type: 'frame', text: 'Sprint 42' },
    { id: '3', type: 'sticky_note', text: 'pomysł B' },
    { id: '4', type: 'image', text: '' },
  ];

  it('groups by type with sorted type names and preserved board order inside', () => {
    const groups = groupByType(items);
    expect([...groups.keys()]).toEqual(['frame', 'image', 'sticky_note']);
    expect(groups.get('sticky_note')?.map((i) => i.text)).toEqual(['pomysł A', 'pomysł B']);
  });

  it('the markdown counts every item but lists only the ones with text', () => {
    const md = renderBoardMarkdown({ id: 'uX=', name: 'Tablica' }, items, false);
    expect(md).toContain('# Tablica — uX=');
    expect(md).toContain('## sticky_note (2)');
    expect(md).toContain('- pomysł A');
    expect(md).toContain('## image (1)');
    expect(md).not.toContain('- \n');
  });

  it('truncation is SAID in the markdown, not swallowed', () => {
    expect(renderBoardMarkdown({ id: 'x' }, items, true)).toContain('TRUNCATED');
  });
});

describe('paginators', () => {
  const httpOf = (pages: readonly unknown[]): { http: HttpClient; queries: unknown[] } => {
    const queries: unknown[] = [];
    let call = 0;
    return {
      queries,
      http: {
        request: <T>(req: { query?: unknown }): Promise<T> => {
          queries.push(req.query);
          return Promise.resolve(pages[Math.min(call++, pages.length - 1)] as T);
        },
      },
    };
  };

  it('items: follows the cursor to the end', async () => {
    const { http, queries } = httpOf([
      { data: [{ id: '1', type: 't' }], cursor: 'c2' },
      { data: [{ id: '2', type: 't' }] },
    ]);
    const out = await fetchBoardItems(http, 'uXjVN2wR8sY=', 100);
    expect(out.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(out.truncated).toBe(false);
    expect(queries[1]).toMatchObject({ cursor: 'c2' });
  });

  it('items: the maxItems ceiling stops the walk and is reported', async () => {
    const { http } = httpOf([{ data: [{ id: '1' }, { id: '2' }, { id: '3' }], cursor: 'more' }]);
    const out = await fetchBoardItems(http, 'uXjVN2wR8sY=', 2);
    expect(out.items).toHaveLength(2);
    expect(out.truncated).toBe(true);
  });

  it('boards: offset pagination advances by the page size and stops on a short page', async () => {
    const fullPage = { data: Array.from({ length: 50 }, (_, i) => ({ id: `b${i}` })) };
    const { http, queries } = httpOf([fullPage, { data: [{ id: 'last' }] }]);
    const out = await fetchBoards(http, undefined, 1000);
    expect(out.boards).toHaveLength(51);
    expect(out.truncated).toBe(false);
    expect(queries[1]).toMatchObject({ offset: 50 });
  });

  it('boards: teamId narrows the query when given', async () => {
    const { http, queries } = httpOf([{ data: [] }]);
    await fetchBoards(http, 'team-7', 10);
    expect(queries[0]).toMatchObject({ team_id: 'team-7' });
  });
});
