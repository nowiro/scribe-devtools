// check-upstream.mjs never touches the real network in its tests — every case injects a fake
// `fetch: (id) => Promise<string | null>` into `checkUpstream`, and the pure clock functions
// (`nextState`, `evaluatePin`, `daysBetween`) take `nowMs` as a parameter instead of reading the
// wall clock. That is what makes "has been behind for 245 days" testable without waiting 245 days.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acknowledge, checkUpstream, daysBetween, evaluatePin, nextState } from './check-upstream.mjs';

/** @type {string[]} */
const made = [];

/** A root with one manifest declaring whatever devDependencies the case needs. @param {Record<string, string>} deps */
function fixture(deps) {
  const dir = mkdtempSync(path.join(tmpdir(), 'upstream-'));
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'root', devDependencies: deps }, null, 2));
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
/** A fixed instant so every test's "today" is the same string, regardless of when it runs. */
const NOW = Date.parse('2026-09-03T12:00:00Z');

/** @type {readonly import('./pins.config.mjs').Pin[]} */
const ONE_PIN = Object.freeze([
  { id: 'left-pad', owner: 'package.json#devDependencies', policy: 'caret', staleDays: 30, why: 'test pin' },
]);

describe('daysBetween', () => {
  it('liczy pełne dni, nie ułamki', () => {
    expect(daysBetween(NOW, NOW)).toBe(0);
    expect(daysBetween(NOW, NOW + DAY)).toBe(1);
    expect(daysBetween(NOW, NOW + DAY + 1000)).toBe(1);
    expect(daysBetween(NOW, NOW + 2 * DAY)).toBe(2);
  });

  it('nigdy nie schodzi poniżej zera', () => {
    expect(daysBetween(NOW, NOW - DAY)).toBe(0);
  });
});

describe('nextState — zegar, nie tylko fakt', () => {
  it('pin, który dogonił latest, usuwa swój wpis', () => {
    const previous = {
      firstSeenBehind: '2026-01-01',
      lastChecked: '2026-01-01',
      atCheck: '1.0.0',
      latestAtCheck: '2.0.0',
    };
    expect(nextState(previous, { behind: false, current: '2.0.0', latest: '2.0.0', nowMs: NOW })).toBeUndefined();
  });

  it('pin dopiero zauważony za latest dostaje firstSeenBehind = dziś', () => {
    const entry = nextState(undefined, { behind: true, current: '1.0.0', latest: '2.0.0', nowMs: NOW });
    expect(entry).toEqual({
      firstSeenBehind: '2026-09-03',
      lastChecked: '2026-09-03',
      atCheck: '1.0.0',
      latestAtCheck: '2.0.0',
    });
  });

  it('ponowne uruchomienie NIE przesuwa firstSeenBehind — to jest cały sens zegara', () => {
    const previous = {
      firstSeenBehind: '2026-01-01',
      lastChecked: '2026-01-01',
      atCheck: '1.0.0',
      latestAtCheck: '2.0.0',
    };
    const entry = nextState(previous, { behind: true, current: '1.0.0', latest: '2.1.0', nowMs: NOW });
    expect(entry?.firstSeenBehind).toBe('2026-01-01');
    expect(entry?.lastChecked).toBe('2026-09-03');
    expect(entry?.latestAtCheck).toBe('2.1.0');
  });
});

describe('evaluatePin', () => {
  const pin = ONE_PIN[0];

  it('nieodczytana wersja własna i nieosiągalny rejestr dają notatkę, nie awarię', () => {
    expect(evaluatePin(pin, { current: null, latest: '2.0.0', state: undefined, nowMs: NOW }).note).toContain(
      'odczytać',
    );
    expect(evaluatePin(pin, { current: '1.0.0', latest: null, state: undefined, nowMs: NOW }).note).toContain(
      'nieosiągalny',
    );
  });

  it('current równy latest to `ok`, bez wpisu staleness', () => {
    const verdict = evaluatePin(pin, { current: '2.0.0', latest: '2.0.0', state: undefined, nowMs: NOW });
    expect(verdict).toMatchObject({ behind: false, stale: false, daysBehind: null });
  });

  it('za latest krócej niż staleDays to `ok`, nie WARN', () => {
    const state = {
      firstSeenBehind: '2026-08-20',
      lastChecked: '2026-08-20',
      atCheck: '1.0.0',
      latestAtCheck: '2.0.0',
    };
    const verdict = evaluatePin(pin, { current: '1.0.0', latest: '2.0.0', state, nowMs: NOW });
    expect(verdict.stale).toBe(false);
    expect(verdict.daysBehind).toBeLessThan(pin.staleDays);
  });

  it('za latest dłużej niż staleDays przekracza próg', () => {
    const state = {
      firstSeenBehind: '2026-01-01',
      lastChecked: '2026-01-01',
      atCheck: '1.0.0',
      latestAtCheck: '2.0.0',
    };
    const verdict = evaluatePin(pin, { current: '1.0.0', latest: '2.0.0', state, nowMs: NOW });
    expect(verdict.stale).toBe(true);
    expect(verdict.daysBehind).toBeGreaterThanOrEqual(pin.staleDays);
  });

  it('pin dopiero co zauważony za latest to 0 dni, nigdy WARN w tym samym przebiegu', () => {
    const verdict = evaluatePin(pin, { current: '1.0.0', latest: '2.0.0', state: undefined, nowMs: NOW });
    expect(verdict).toMatchObject({ behind: true, daysBehind: 0, stale: false });
  });
});

describe('checkUpstream — koniec do końca, bez sieci', () => {
  it('czyta zadeklarowaną wersję z manifestu i porównuje z wstrzykniętym fetch', async () => {
    const root = fixture({ 'left-pad': '^1.0.0' });
    const { verdicts } = await checkUpstream({
      root,
      previousState: {},
      pins: ONE_PIN,
      fetch: async () => '1.2.0',
      nowMs: NOW,
    });
    expect(verdicts).toEqual([
      {
        id: 'left-pad',
        staleDays: 30,
        current: '1.0.0',
        latest: '1.2.0',
        behind: true,
        daysBehind: 0,
        stale: false,
        note: '',
      },
    ]);
  });

  it('awaria pojedynczego zapytania sieciowego NIE zeruje istniejącego zegara innych pinów', async () => {
    const root = fixture({ 'left-pad': '^1.0.0' });
    const previousState = {
      'left-pad': {
        firstSeenBehind: '2026-01-01',
        lastChecked: '2026-08-01',
        atCheck: '1.0.0',
        latestAtCheck: '1.1.0',
      },
    };
    const { verdicts, nextState: after } = await checkUpstream({
      root,
      previousState,
      pins: ONE_PIN,
      fetch: async () => null, // rejestr nieosiągalny w tym przebiegu
      nowMs: NOW,
    });
    expect(verdicts[0].note).toContain('nieosiągalny');
    // Stan NIESIONY DALEJ bez zmian — jeden network blip nie kasuje realnego zegara staleness.
    expect(after['left-pad']).toEqual(previousState['left-pad']);
  });

  it('pin, który dogonił latest, znika ze stanu', async () => {
    const root = fixture({ 'left-pad': '^2.0.0' });
    const previousState = {
      'left-pad': {
        firstSeenBehind: '2026-01-01',
        lastChecked: '2026-08-01',
        atCheck: '1.0.0',
        latestAtCheck: '2.0.0',
      },
    };
    const { nextState: after } = await checkUpstream({
      root,
      previousState,
      pins: ONE_PIN,
      fetch: async () => '2.0.0',
      nowMs: NOW,
    });
    expect(after['left-pad']).toBeUndefined();
  });

  it('zależność bez wiersza w pins po prostu nie jest sprawdzana — to zadanie check-pins, nie tego skryptu', async () => {
    const root = fixture({ 'left-pad': '^1.0.0', extra: '^1.0.0' });
    const { verdicts } = await checkUpstream({
      root,
      previousState: {},
      pins: ONE_PIN,
      fetch: async () => '1.0.0',
      nowMs: NOW,
    });
    expect(verdicts).toHaveLength(1);
  });
});

describe('acknowledge — decyzja człowieka, nie efekt uboczny odczytu', () => {
  const behindVerdict = {
    id: 'left-pad',
    staleDays: 30,
    current: '1.0.0',
    latest: '2.0.0',
    behind: true,
    daysBehind: 400,
    stale: true,
    note: '',
  };
  const upToDateVerdict = {
    id: 'prettier',
    staleDays: 180,
    current: '3.0.0',
    latest: '3.0.0',
    behind: false,
    daysBehind: null,
    stale: false,
    note: '',
  };

  it('resetuje zegar TYLKO dla nazwanego pinu, który jest za latest', () => {
    const { state, acknowledged } = acknowledge({}, [behindVerdict, upToDateVerdict], 'left-pad', NOW);
    expect(acknowledged).toEqual(['left-pad']);
    expect(state['left-pad']).toEqual({
      firstSeenBehind: '2026-09-03',
      lastChecked: '2026-09-03',
      atCheck: '1.0.0',
      latestAtCheck: '2.0.0',
    });
    expect(state['prettier']).toBeUndefined();
  });

  it('nie robi nic dla pinu, który nie jest za latest — nie ma czego potwierdzać', () => {
    const { state, acknowledged } = acknowledge({}, [upToDateVerdict], 'prettier', NOW);
    expect(acknowledged).toEqual([]);
    expect(state).toEqual({});
  });

  it('`all` resetuje każdy aktualnie zalegający pin naraz', () => {
    const second = { ...behindVerdict, id: 'other-pkg' };
    const { acknowledged } = acknowledge({}, [behindVerdict, second, upToDateVerdict], 'all', NOW);
    expect(acknowledged.sort()).toEqual(['left-pad', 'other-pkg']);
  });

  it('nieznane id nie dotyka niczego', () => {
    const { state, acknowledged } = acknowledge({ x: /** @type {any} */ ({}) }, [behindVerdict], 'nie-ma-takiego', NOW);
    expect(acknowledged).toEqual([]);
    expect(state).toEqual({ x: {} });
  });
});
