import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpLogger, httpLogEntry } from './http-log.js';

const ATTEMPT = {
  script: 'read-jira',
  correlationId: 'run-123',
  attempt: 1,
  method: 'GET',
  url: 'https://jira.example.com/rest/api/2/search?jql=project%20%3D%20X',
  durationMs: 42,
};

describe('httpLogEntry', () => {
  it('sukces: outcome ok, pola opcjonalne tylko gdy sa — zadnych null w JSONL', () => {
    const entry = httpLogEntry({ ...ATTEMPT, status: 200, responseBytes: 1024 }, new Date('2026-08-30T10:00:00Z'));
    expect(entry).toEqual({
      ts: '2026-08-30T10:00:00.000Z',
      script: 'read-jira',
      correlationId: 'run-123',
      attempt: 1,
      method: 'GET',
      url: ATTEMPT.url,
      status: 200,
      durationMs: 42,
      responseBytes: 1024,
      outcome: 'ok',
    });
  });

  it('blad: pierwsza linia komunikatu, bez stack trace', () => {
    const entry = httpLogEntry({ ...ATTEMPT, error: new Error('boom\n  at deep()') });
    expect(entry.outcome).toBe('error');
    expect(entry.error).toBe('boom');
    expect(entry.error).not.toContain('at ');
  });

  it('WHITELIST kluczy: budowniczy nie ma ktoredy przepuscic naglowka autoryzacji', () => {
    // Sekret nie moze wyplynac Z KONSTRUKCJI: zadne pole wpisu nie przenosi naglowkow.
    // Ten test pilnuje, zeby przyszla "drobna" zmiana nie dolozyla takiego pola po cichu.
    const entry = httpLogEntry({ ...ATTEMPT, status: 500, responseBytes: 7, requestBytes: 3, error: 'x' });
    expect(Object.keys(entry).sort()).toEqual(
      [
        'attempt',
        'correlationId',
        'durationMs',
        'error',
        'method',
        'outcome',
        'requestBytes',
        'responseBytes',
        'script',
        'status',
        'ts',
        'url',
      ].sort(),
    );
  });
});

describe('createHttpLogger', () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'http-log-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('pisze parsowalny JSONL do katalogu z env; katalog powstaje leniwie', () => {
    const dir = tempDir();
    const logger = createHttpLogger('read-test', { EXTRACT_HTTP_LOG_DIR: join(dir, 'nested') });
    logger.log({ ...ATTEMPT, status: 200 });
    logger.log({ ...ATTEMPT, attempt: 2, error: new Error('retry me') });
    const lines = readFileSync(logger.file ?? '', 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(first?.['outcome']).toBe('ok');
    expect(second?.['attempt']).toBe(2);
    expect(second?.['error']).toBe('retry me');
  });

  it('EXTRACT_HTTP_LOG=0 wylacza log w calosci', () => {
    const logger = createHttpLogger('read-test', { EXTRACT_HTTP_LOG: '0' });
    expect(logger.file).toBeUndefined();
    expect(() => logger.log({ ...ATTEMPT })).not.toThrow();
  });

  it('blad zapisu ostrzega RAZ i nie wywraca przebiegu — log jest sladem, nie produktem', () => {
    const dir = tempDir();
    // Sciezka katalogu wskazuje na PLIK — mkdir pada deterministycznie na kazdym OS.
    const asFile = join(dir, 'plik');
    writeFileSync(asFile, 'x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = createHttpLogger('read-test', { EXTRACT_HTTP_LOG_DIR: join(asFile, 'sub') });
    expect(() => {
      logger.log({ ...ATTEMPT });
      logger.log({ ...ATTEMPT, attempt: 2 });
    }).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('http-log wyłączony');
  });
});
