// Tests for the write input contract: front matter split, strict validation with readable
// errors, H1-as-title extraction, the argument scan, and the create/update mode assertion.
// These are the seams every write pipeline stands on — a mistake here publishes the wrong
// thing to a real system.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  assertWriteMode,
  mapLinesOutsideFences,
  parseWriteArgs,
  parseMarkdownInput,
  stripTrailingProvenance,
  withProvenance,
} from './write-runtime.js';

const Schema = z.strictObject({ key: z.string().optional(), project: z.string().optional() });

describe('parseWriteArgs()', () => {
  it('first non-flag argument is the file; --yes flips the write switch', () => {
    expect(parseWriteArgs(['./z.md'])).toEqual({ filePath: './z.md', yes: false, mode: undefined });
    expect(parseWriteArgs(['./z.md', '--yes'])).toEqual({ filePath: './z.md', yes: true, mode: undefined });
    expect(parseWriteArgs(['--yes', './z.md'])).toEqual({ filePath: './z.md', yes: true, mode: undefined });
  });

  it('--mode carries the dispatcher-declared intent, create or update — nothing else', () => {
    expect(parseWriteArgs(['--mode', 'create', './z.md']).mode).toBe('create');
    expect(parseWriteArgs(['./z.md', '--mode', 'update']).mode).toBe('update');
    expect(() => parseWriteArgs(['--mode', 'delete', './z.md'])).toThrow(/create.*update/u);
    expect(() => parseWriteArgs(['./z.md', '--mode'])).toThrow(/--mode/u);
  });

  it('--mode=create works like --mode create — the read runtime accepts the inline form too', () => {
    // The inline form used to fall into the unknown-flag branch, producing the
    // self-contradicting "unknown flag --mode=update — pipelines know only --yes and --mode".
    expect(parseWriteArgs(['--mode=create', './z.md']).mode).toBe('create');
    expect(() => parseWriteArgs(['--mode=delete', './z.md'])).toThrow(/create.*update/u);
  });

  it('a missing file is an error — there is no default input to publish', () => {
    expect(() => parseWriteArgs([])).toThrow(/missing input file/u);
    expect(() => parseWriteArgs(['--yes'])).toThrow(/missing input file/u);
  });

  it('a SECOND positional is a loud error — nothing is silently ignored', () => {
    // `write-jira a.md b.md` used to publish a.md and drop b.md without a word.
    expect(() => parseWriteArgs(['a.md', 'b.md'])).toThrow(/unexpected extra argument/u);
  });

  it('an unknown flag is an error, not a silently ignored option', () => {
    expect(() => parseWriteArgs(['./z.md', '--force'])).toThrow(/--force/u);
  });
});

describe('assertWriteMode()', () => {
  it('agreement passes silently, both ways', () => {
    expect(() => assertWriteMode('update', 'update', 'an update of PROJ-1')).not.toThrow();
    expect(() => assertWriteMode('create', 'create', 'a new issue')).not.toThrow();
  });

  it('undefined (direct dist/ invocation) skips the check — the file alone decides', () => {
    expect(() => assertWriteMode(undefined, 'update', 'an update of PROJ-1')).not.toThrow();
  });

  it('a mismatch never runs: it names the right command and what the file IS', () => {
    expect(() => assertWriteMode('create', 'update', 'an update of PROJ-1')).toThrow(
      /an update of PROJ-1.*UPDATE mode.*command says create.*Use the "update" command/su,
    );
    expect(() => assertWriteMode('update', 'create', 'a new issue (project + type)')).toThrow(
      /CREATE mode.*Use the "create" command/su,
    );
  });
});

describe('parseMarkdownInput()', () => {
  it('splits front matter, lifts the H1 as title, keeps the rest as body', () => {
    const input = parseMarkdownInput('---\nkey: PROJ-1\n---\n# Tytuł\n\nTreść.\n', Schema, 'z.md');
    expect(input.meta).toEqual({ key: 'PROJ-1' });
    expect(input.title).toBe('Tytuł');
    expect(input.body).toBe('Treść.');
  });

  it('no H1 → title undefined, whole remainder is the body', () => {
    const input = parseMarkdownInput('---\nkey: PROJ-1\n---\nSam komentarz.\n', Schema, 'z.md');
    expect(input.title).toBeUndefined();
    expect(input.body).toBe('Sam komentarz.');
  });

  it('only the FIRST h1 is the title — a later `# ` line stays in the body', () => {
    const input = parseMarkdownInput('---\nkey: K-1\n---\n# A\n\ntekst\n\n# B\n', Schema, 'z.md');
    expect(input.title).toBe('A');
    expect(input.body).toContain('# B');
  });

  it('a file without front matter fails with instructions, not a YAML stack trace', () => {
    expect(() => parseMarkdownInput('# Tytuł\n', Schema, 'z.md')).toThrow(/front matter/u);
  });

  it('an unknown front matter key is a hard error naming the key', () => {
    expect(() => parseMarkdownInput('---\nkye: PROJ-1\n---\nx\n', Schema, 'z.md')).toThrow(/kye/u);
  });

  it('a `# ` line inside a code fence is NOT a title — and is not deleted from the body', () => {
    const raw = '---\nkey: K-1\n---\n```bash\n# install deps\nnpm i\n```\n';
    const input = parseMarkdownInput(raw, Schema, 'z.md');
    expect(input.title).toBeUndefined();
    // The shell comment stays in the body byte-for-byte — losing it silently was the bug.
    expect(input.body).toContain('# install deps');
  });

  it('a real H1 after a fence still becomes the title', () => {
    const raw = '---\nkey: K-1\n---\n```\n# not a title\n```\n\n# Prawdziwy tytuł\n\ntreść\n';
    const input = parseMarkdownInput(raw, Schema, 'z.md');
    expect(input.title).toBe('Prawdziwy tytuł');
    expect(input.body).toContain('# not a title');
    expect(input.body).toContain('treść');
  });

  it('CRLF input parses the same as LF', () => {
    const input = parseMarkdownInput('---\r\nkey: K-1\r\n---\r\n# T\r\n\r\nb\r\n', Schema, 'z.md');
    expect(input.title).toBe('T');
    expect(input.body).toBe('b');
  });
});

describe('withProvenance()', () => {
  it('appends one italic line naming the tool and its version', () => {
    expect(withProvenance('Treść.', 'created')).toMatch(
      /^Treść\.\n\n_Utworzono za pomocą narzędzia scribe v\d+\.\d+\.\d+\._$/u,
    );
  });

  it('each action carries its own verb', () => {
    expect(withProvenance('x', 'updated')).toContain('_Zaktualizowano za pomocą');
    expect(withProvenance('x', 'commented')).toContain('_Dodano za pomocą');
  });

  it('an empty body becomes just the line, with no leading blank lines', () => {
    expect(withProvenance('', 'created').startsWith('_Utworzono')).toBe(true);
  });
});

describe('stripTrailingProvenance()', () => {
  it('strips every footer form this tool has ever written — italic, asterisk, plain', () => {
    expect(stripTrailingProvenance('Treść.\n\n_Utworzono za pomocą narzędzia scribe v1.2.3._')).toBe('Treść.');
    expect(stripTrailingProvenance('Treść.\n\n*Zaktualizowano za pomocą narzędzia scribe v1.2.3.*')).toBe('Treść.');
    expect(stripTrailingProvenance('Treść.\n\nDodano za pomocą narzędzia scribe v1.2.3.')).toBe('Treść.');
  });

  it('stacked stale footers come off to a fixed point', () => {
    const body =
      'Treść.\n\n_Utworzono za pomocą narzędzia scribe v1.0.0._\n\n_Zaktualizowano za pomocą narzędzia scribe v1.2.3._';
    expect(stripTrailingProvenance(body)).toBe('Treść.');
  });

  it('a prose line merely STARTING with the phrase survives — the footer shape is exact', () => {
    const prose = 'Zawartość.\n\nUtworzono za pomocą narzędzia scribe v2 można poznać po stopce.';
    expect(stripTrailingProvenance(prose)).toBe(prose);
  });

  it('a footer-shaped last line inside an UNCLOSED fence is code, not a footer', () => {
    const body = 'Log:\n\n```\n_Utworzono za pomocą narzędzia scribe v1.2.3._';
    expect(stripTrailingProvenance(body)).toBe(body);
  });
});

describe('mapLinesOutsideFences()', () => {
  it('transforms outside; fence content and the fence lines themselves pass verbatim', () => {
    const text = '# a\n```\n# b\n```\n# c';
    expect(mapLinesOutsideFences(text, (line) => line.replace(/^# /u, ''))).toBe('a\n```\n# b\n```\nc');
  });

  it('a ``` inside a ~~~ block is content — the marker kind decides, not any fence line', () => {
    const text = '~~~\n```\n# code\n~~~\n# prose';
    expect(mapLinesOutsideFences(text, (line) => line.replace(/^# /u, ''))).toBe('~~~\n```\n# code\n~~~\nprose');
  });
});
