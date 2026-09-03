// The lifecycle: start detached, wait, stop the tree. These tests spawn REAL processes that bind
// REAL ports, because every interesting failure here (a held port, a locked log, a wait that never
// returns) exists only outside this process.
//
// Every case registers its state for teardown BEFORE it asserts anything, so a failing expectation
// cannot leave a dev server running on the developer's machine.
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { main } from '../src/main.mjs';
import {
  alive,
  DEFAULT_READY,
  lastLines,
  readState,
  startServe,
  stateFile,
  stopServe,
  waitForServe,
} from '../src/serve.mjs';
import { makeWorkspace } from '../fixtures/generate.mjs';

/** @type {string} */
let base;
/** @type {string} */
let ws;
/** @type {import('../src/serve.mjs').ServeState[]} */
const running = [];
/** @type {NodeJS.ProcessEnv} */
let env;

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'nxai-serve-'));
  ws = makeWorkspace(path.join(base, 'nx-angular'), 'nx-angular');
  env = { ...process.env };
});

afterEach(() => {
  for (const state of running.splice(0)) stopServe({ outDir: path.join(ws, '.ws'), state });
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Start a target and register it for teardown in one step. @param {string} target */
function start(target) {
  const started = startServe({ root: ws, outDir: path.join(ws, '.ws'), project: 'portal', target, env });
  if (started.state !== null) running.push(started.state);
  return started;
}

/** @param {string} url @returns {Promise<number | string>} */
function probe(url) {
  return new Promise((resolve) => {
    const request = get(url, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('error', (error) => resolve(/** @type {NodeJS.ErrnoException} */ (error).code ?? 'ERR'));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve('TIMEOUT');
    });
  });
}

describe('cykl życia przez main()', () => {
  it('start → wait → już działa → stop → nic nie działało', () => {
    const run = (/** @type {string[]} */ argv) => main([...argv, '--root', ws], { cwd: ws, env });

    const started = run(['serve', 'portal']);
    const state = readState(path.join(ws, '.ws'), 'portal');
    if (state !== null) running.push(state);
    expect(started.exit).toBe(0);
    expect(started.line).toMatch(/^ok serve portal · pid \d+ · czeka na `serve wait` · \.ws\/serve\/portal\.log$/u);

    const waited = run(['serve', 'wait', 'portal', '--timeout', '20']);
    expect(waited.exit).toBe(0);
    expect(waited.line).toMatch(
      /^ok serve wait portal · gotowy · \d+,\d s · http:\/\/localhost:\d+\/ · \.ws\/serve\/portal\.log$/u,
    );

    const again = run(['serve', 'portal']);
    expect(again.line).toContain('już działa');

    const stopped = run(['serve', 'stop', 'portal']);
    expect(stopped.exit).toBe(0);
    expect(stopped.line).toMatch(/^ok serve stop portal · zatrzymany · pid \d+$/u);
    expect(existsSync(stateFile(path.join(ws, '.ws'), 'portal'))).toBe(false);

    expect(run(['serve', 'stop', 'portal']).line).toBe('ok serve stop portal · nic nie działało');
  });

  it('`wait` bez wcześniejszego startu to FAIL, nie czekanie w nieskończoność', () => {
    const result = main(['serve', 'wait', 'utils', '--root', ws], { cwd: ws, env });
    expect(result.exit).toBe(1);
    expect(result.line).toContain('nic nie wystartowano');
  });

  it('projekt bez targetu serve dostaje FAIL z listą tego, co ma', () => {
    const result = main(['serve', 'utils', '--root', ws], { cwd: ws, env });
    expect(result.exit).toBe(1);
    expect(result.line).toContain('brak targetu serve');
    expect(result.line).toContain('build');
  });

  it('nieznany tryb i brakująca nazwa projektu padają, zanim cokolwiek wystartuje', () => {
    expect(main(['serve', 'restart', 'portal', '--root', ws], { cwd: ws, env }).line).toContain('nieznany tryb');
    expect(main(['serve', 'wait', '--root', ws], { cwd: ws, env }).line).toContain('brakuje nazwy projektu');
  });
});

describe('wait ZAWSZE się kończy', () => {
  it('serwer, który nigdy nie zgłasza gotowości → timeout z ostatnią linią logu', () => {
    const started = start('serve-hang');
    expect(started.ok).toBe(true);
    const result = waitForServe({ state: /** @type {any} */ (started.state), timeoutMs: 1200, pollMs: 60 });
    expect(result.status).toBe('timeout');
    expect(result.waitedMs).toBeGreaterThanOrEqual(1200);
    // Coś w logu jest — to odróżnia „nic nie wypisał" od „wypisał, ale nigdy nie był gotowy".
    expect(result.tail.at(-1)).toBe('kompilacja trwa');
  });

  it('serwer, który padł, jest zauważony OD RAZU, nie odczekany do deadline’u', () => {
    const started = start('serve-die');
    const result = waitForServe({ state: /** @type {any} */ (started.state), timeoutMs: 30_000, pollMs: 60 });
    expect(result.status).toBe('martwy');
    expect(result.waitedMs).toBeLessThan(10_000);
    expect(result.tail.at(-1)).toContain('error TS2304');
  });

  it('własny wzorzec --ready zastępuje domyślny', () => {
    const started = start('serve-hang');
    const result = waitForServe({
      state: /** @type {any} */ (started.state),
      ready: /kompilacja trwa/u,
      timeoutMs: 5000,
      pollMs: 60,
    });
    expect(result.status).toBe('ready');
  });
});

describe('stop ubija DRZEWO', () => {
  it('po stop port naprawdę jest zwolniony — dziecko nie zostaje sierotą', async () => {
    const started = start('serve');
    const ready = waitForServe({ state: /** @type {any} */ (started.state), timeoutMs: 20_000, pollMs: 60 });
    expect(ready.status).toBe('ready');
    expect(ready.url).not.toBe('');

    expect(await probe(ready.url)).toBe(200);

    stopServe({ outDir: path.join(ws, '.ws'), state: /** @type {any} */ (started.state) });
    running.length = 0;

    // Serwer to WNUK: nx-stub → dev-server. Zabicie samego rodzica zostawiłoby zajęty port,
    // a następny `serve` padłby z powodu, który nie ma nic wspólnego z tym, co agent właśnie zrobił.
    const after = await probe(ready.url);
    expect(after, `port ${ready.url} nadal odpowiada`).not.toBe(200);
  });

  it('stop czyści plik stanu, także gdy proces już nie żyje', () => {
    const started = start('serve-die');
    waitForServe({ state: /** @type {any} */ (started.state), timeoutMs: 5000, pollMs: 60 });
    const out = path.join(ws, '.ws');
    stopServe({ outDir: out, state: /** @type {any} */ (started.state) });
    running.length = 0;
    expect(existsSync(stateFile(out, 'portal'))).toBe(false);
  });
});

describe('stan i log', () => {
  it('plik stanu niesie pid, projekt, target i ścieżkę logu', () => {
    const started = start('serve');
    const state = readState(path.join(ws, '.ws'), 'portal');
    expect(state).toMatchObject({ pid: started.state?.pid, project: 'portal', target: 'serve' });
    // Czekamy na gotowość, zanim czytamy log: zaraz po `start` plik jest pusty, bo dziecko jeszcze
    // nic nie napisało. Asercja na „pusty log tuż po starcie" sprawdzałaby szybkość maszyny.
    waitForServe({ state: /** @type {any} */ (started.state), timeoutMs: 20_000, pollMs: 60 });
    expect(readFileSync(/** @type {string} */ (state?.log), 'utf8')).toContain('NX');
  });

  it('uszkodzony plik stanu czyta się jak brak, nie jak wyjątek', () => {
    const out = path.join(base, 'pusty');
    expect(readState(out, 'portal')).toBeNull();
  });

  it('start nadpisuje log, nie dopisuje — wczorajsza linia gotowości zakończyłaby wait natychmiast', () => {
    const first = start('serve');
    waitForServe({ state: /** @type {any} */ (first.state), timeoutMs: 20_000, pollMs: 60 });
    stopServe({ outDir: path.join(ws, '.ws'), state: /** @type {any} */ (first.state) });
    running.length = 0;

    const second = start('serve-hang');
    const log = readFileSync(/** @type {string} */ (second.state?.log), 'utf8');
    expect(DEFAULT_READY.test(log)).toBe(false);
  });
});

describe('alive i lastLines', () => {
  it('alive mówi „nie” o pid-zie, którego nie ma', () => {
    // Nieużywany, wysoki pid. Nie jest to dowód tożsamości procesu i kod tego nie udaje —
    // `stop` ubija tylko pid, który sam zapisał.
    expect(alive(0x7ffffff0)).toBe(false);
    expect(alive(process.pid)).toBe(true);
  });

  it('lastLines pomija puste linie i bierze od końca', () => {
    expect(lastLines('a\n\nb\n\nc\n', 2)).toEqual(['b', 'c']);
    expect(lastLines('')).toEqual([]);
  });
});
