import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, readJsonc, stripJsonComments } from './repo.mjs';

/** @param {string} text @returns {unknown} */
const parse = (text) => JSON.parse(stripJsonComments(text));

describe('stripJsonComments', () => {
  it('keeps a glob that contains both /* and */ inside a string', () => {
    const text = '{ "files.exclude": { "**/tools/hooks/**": false, "**/.github/**": true } }';
    expect(parse(text)).toEqual({ 'files.exclude': { '**/tools/hooks/**': false, '**/.github/**': true } });
  });

  it('keeps a path alias ending in /* when a later glob holds */', () => {
    // `/*` of the alias and `*/` of `src/**/*.ts` were a fake block comment that ate the keys between them.
    const text = '{ "compilerOptions": { "paths": { "@cb/*": ["libs/*"] } }, "include": ["src/**/*.ts"] }';
    expect(parse(text)).toEqual({ compilerOptions: { paths: { '@cb/*': ['libs/*'] } }, include: ['src/**/*.ts'] });
  });

  it('keeps // inside a string, including a URL and an escaped quote before it', () => {
    const text = '{ "url": "https://example.test//x", "quote": "say \\"//not a comment\\"" }';
    expect(parse(text)).toEqual({ url: 'https://example.test//x', quote: 'say "//not a comment"' });
  });

  it('removes a whole-line and an end-of-line // comment', () => {
    const text = '{\n  // whole line\n  "a": 1, // after a value\n  "b": 2\n}';
    expect(parse(text)).toEqual({ a: 1, b: 2 });
  });

  it('removes a block comment and keeps its newlines so parse errors keep their line', () => {
    const text = '{\n  /* one\n     two */ "a": 1\n}';
    const stripped = stripJsonComments(text);
    expect(stripped.split('\n')).toHaveLength(text.split('\n').length);
    expect(JSON.parse(stripped)).toEqual({ a: 1 });
  });

  it('leaves an unterminated block comment for JSON.parse to reject', () => {
    expect(() => parse('{ "a": 1 } /* never closed')).toThrow();
  });

  it('still rejects trailing commas, as JSON.parse did before', () => {
    expect(() => parse('{ "a": 1, }')).toThrow();
  });
});

describe('readJsonc', () => {
  it('parses the repository .vscode/settings.json, whose glob keys broke the regex stripper', () => {
    const settings = readJsonc(path.join(REPO, '.vscode', 'settings.json'));
    expect(settings['chat.useAgentsMdFile']).toBe(true);
  });
});
