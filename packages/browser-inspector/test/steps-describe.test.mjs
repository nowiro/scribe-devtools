// The STEPS table is the contract: every row is complete, `describe` never echoes a typed value
// (only its origin), validation names the field, and the names cover the full list of DESIGN.md §3.2.
import { describe, expect, it } from 'vitest';

import {
  ALL_SPELLINGS,
  FIELD_TYPES,
  STEPS,
  STEP_NAMES,
  checkField,
  describeStep,
  helpFor,
  isRef,
  parseFieldType,
  refFieldsOf,
  resolveStepName,
  stepNames,
  validateSteps,
} from '../src/steps.schema.mjs';

const DESIGN_LIST = [
  'goto',
  'back',
  'forward',
  'reload',
  'click',
  'fill',
  'type',
  'form',
  'press',
  'hover',
  'select',
  'check',
  'uncheck',
  'drag',
  'upload',
  'scroll',
  'wait',
  'waitFor',
  'screenshot',
  'pdf',
  'extract',
  'evaluate',
  'snapshot',
  'find',
  'verify',
  'resize',
  'route',
  'unroute',
  'routes',
  'offline',
  'fetch',
  'dialog',
  'tab',
  'tabs',
  'frame',
  'mouse',
  'storage',
  'state',
  'console',
  'net',
  'trace',
  'video',
  'locator',
  'run',
  'close',
];

describe('table shape', () => {
  it('has every step of DESIGN.md §3.2 and nothing undocumented', () => {
    expect([...STEP_NAMES].sort()).toEqual([...DESIGN_LIST].sort());
  });

  it('every row is complete and its field types parse', () => {
    for (const [name, def] of Object.entries(STEPS)) {
      expect(['action', 'query', 'control'], name).toContain(def.kind);
      expect(Array.isArray(def.aliases), name).toBe(true);
      expect(typeof def.batch, name).toBe('boolean');
      expect(typeof def.session, name).toBe('boolean');
      expect(Array.isArray(def.argv), name).toBe(true);
      expect(typeof def.help, name).toBe('string');
      expect(def.help.length, name).toBeGreaterThan(0);
      expect(typeof def.describe, name).toBe('function');
      for (const type of [...Object.values(def.config), ...Object.values(def.flags)]) {
        const { base } = parseFieldType(type);
        expect(
          Object.keys(FIELD_TYPES).map((t) => t.split(':')[0]),
          `${name}: ${type}`,
        ).toContain(base);
      }
      // A rest positional must be last; an optional one must not precede a required one.
      const rest = def.argv.findIndex((a) => a.endsWith('...'));
      if (rest !== -1) expect(rest, name).toBe(def.argv.length - 1);
      if (def.session && def.argv.length > 0)
        expect(typeof def.fromArgv === 'function' || def.argv.every((a) => a in def.config), name).toBe(true);
    }
  });

  it('aliases resolve to their canonical names', () => {
    expect(resolveStepName('open')).toBe('goto');
    expect(resolveStepName('shot')).toBe('screenshot');
    expect(resolveStepName('get')).toBe('extract');
    expect(resolveStepName('eval')).toBe('evaluate');
    expect(resolveStepName('snap')).toBe('snapshot');
    expect(resolveStepName('click')).toBe('click');
    expect(resolveStepName('nope')).toBeUndefined();
    expect(resolveStepName(undefined)).toBeUndefined();
    expect(ALL_SPELLINGS).toContain('open');
    expect(new Set(ALL_SPELLINGS).size).toBe(ALL_SPELLINGS.length);
  });

  it('separates config steps from session-only commands', () => {
    expect(stepNames({ batch: true })).not.toContain('find');
    expect(stepNames({ batch: true })).not.toContain('run');
    expect(stepNames({ batch: true })).not.toContain('console');
    expect(stepNames({ session: true })).toContain('find');
    expect(stepNames()).toEqual([...STEP_NAMES]);
    expect(STEPS.run.batch).toBe(false);
  });
});

describe('describe never echoes a typed value', () => {
  const SECRET = 'S3cr3t-hunter2';
  it.each([
    [{ do: 'fill', selector: '#p', value: SECRET }, 'fill #p (literal)'],
    [{ do: 'fill', selector: '[data-testid=field-name]', value: 'Jan' }, 'fill [data-testid=field-name] (literal)'],
    [{ do: 'fill', ref: 'e5', valueFromEnv: 'APP_PASS' }, 'fill e5 (from env APP_PASS)'],
    [{ do: 'fill', ref: 'e39', value: SECRET, enter: true }, 'fill e39 (literal) + Enter'],
    [{ do: 'type', ref: 'e1', value: SECRET, slowly: true }, 'type e1 (literal) (slowly)'],
    [
      {
        do: 'form',
        fields: [
          { ref: 'e3', value: SECRET },
          { ref: 'e5', valueFromEnv: 'APP_PASS' },
        ],
      },
      'form 2 fields (1 from env)',
    ],
    [{ do: 'storage', kind: 'local', op: 'set', key: 'token', value: SECRET }, 'storage local set token (literal)'],
    [
      { do: 'storage', kind: 'local', op: 'set', key: 'token', valueFromEnv: 'TOKEN' },
      'storage local set token (from env TOKEN)',
    ],
  ])('%j → %s', (step, expected) => {
    const text = describeStep(step);
    expect(text).toBe(expected);
    expect(text).not.toContain(SECRET);
  });

  it('matches the report samples of DESIGN.md §5.2', () => {
    expect(describeStep({ do: 'waitFor', selector: '[data-testid=request-form]' })).toBe(
      'waitFor [data-testid=request-form] (visible)',
    );
    expect(describeStep({ do: 'click', ref: 'e12', count: 2 })).toBe('click e12 (double)');
    expect(describeStep({ do: 'click', selector: '[data-testid=lang-en]' })).toBe('click [data-testid=lang-en]');
    expect(describeStep({ do: 'extract', name: 'naglowek-pl', selector: 'h1' })).toBe('extract naglowek-pl ← h1');
    expect(describeStep({ do: 'evaluate', name: 'jezyk-dokumentu', expression: 'document.documentElement.lang' })).toBe(
      'evaluate jezyk-dokumentu',
    );
    expect(describeStep({ do: 'wait', ms: 500 })).toBe('wait 500ms');
    expect(describeStep({ do: 'screenshot', name: 'wersja-en' })).toBe('screenshot wersja-en');
    expect(describeStep({ do: 'select', selector: '#s', value: 'opt' })).toBe('select #s = opt');
    expect(describeStep({ do: 'goto', url: 'http://x/' })).toBe('goto http://x/');
  });

  it('never throws, even for a stranger or a broken step', () => {
    expect(describeStep({ do: 'nope' })).toBe('nope');
    expect(describeStep(/** @type {any} */ ({}))).toBe('?');
    expect(describeStep({ do: 'form' })).toBe('form 0 fields');
    for (const name of STEP_NAMES) expect(typeof describeStep({ do: name })).toBe('string');
  });
});

describe('validateSteps', () => {
  it('accepts the batch grammar and rejects strangers, unknown fields and session-only steps', () => {
    expect(
      validateSteps([
        { do: 'click', selector: 'a' },
        { do: 'wait', ms: 1 },
      ]),
    ).toEqual([]);
    expect(validateSteps([{ do: 'clack' }], 's')).toEqual([
      expect.stringMatching(/^s\[0\]\.do: unknown step "clack" — known: goto, back/u),
    ]);
    expect(validateSteps([{ do: 'click', selector: 'a', foo: 1 }], 's')).toEqual([
      's[0].foo: unknown field for "click" (known: selector, ref, button, count, modifiers)',
    ]);
    expect(validateSteps([{ do: 'find', text: 'x' }], 's')).toEqual([
      's[0].do: "find" is a session-only command, not a config step',
    ]);
    expect(validateSteps('nope', 's')).toEqual(['s: expected an array of steps']);
    expect(validateSteps([null], 's')).toEqual(['s[0]: a step is an object with "do"']);
  });

  it('checks the cross-field rules of each row', () => {
    expect(validateSteps([{ do: 'click' }], 's')).toEqual(['s[0]: needs one of "selector" / "ref"']);
    expect(validateSteps([{ do: 'snapshot' }, { do: 'click', selector: 'a', ref: 'e1' }], 's')).toEqual([
      's[1]: exactly one of "selector" / "ref", got "selector" + "ref"',
    ]);
    expect(validateSteps([{ do: 'fill', selector: 'a', value: 'x', valueFromEnv: 'Y' }], 's')).toEqual([
      's[0]: exactly one of "value" / "valueFromEnv", got "value" + "valueFromEnv"',
    ]);
    expect(validateSteps([{ do: 'click', selector: 'a', count: 5 }], 's')).toEqual(['s[0].count: 1, 2 or 3']);
    expect(validateSteps([{ do: 'click', selector: 'a', modifiers: ['hyper'] }], 's')).toEqual([
      's[0].modifiers: "hyper" is not one of ctrl, shift, alt, meta',
    ]);
    expect(validateSteps([{ do: 'scroll' }], 's')).toEqual(['s[0]: needs one of "selector" / "ref" / "to"']);
    expect(validateSteps([{ do: 'wait', ms: 99_999 }], 's')).toEqual(['s[0].ms: 0…60000']);
    expect(validateSteps([{ do: 'wait', ms: 1, text: 'x' }], 's')).toEqual([
      's[0]: exactly one of "ms" / "text" / "textGone" / "url" / "selector", got "ms" + "text"',
    ]);
    expect(validateSteps([{ do: 'verify', kind: 'text', selector: 'a' }], 's')).toEqual([
      's[0].text: required for kind "text"',
    ]);
    expect(validateSteps([{ do: 'verify', kind: 'url' }], 's')).toEqual(['s[0].url: required for kind "url"']);
    expect(validateSteps([{ do: 'storage', kind: 'local', op: 'get' }], 's')).toEqual([
      's[0].key: required for storage get',
    ]);
    expect(validateSteps([{ do: 'storage', kind: 'local', op: 'set', key: 'k' }], 's')).toEqual([
      's[0]: needs one of "value" / "valueFromEnv"',
    ]);
    expect(validateSteps([{ do: 'mouse', action: 'click', x: 1 }], 's')).toEqual(['s[0].y: required for mouse click']);
    expect(validateSteps([{ do: 'route', url: 'x' }], 's')).toEqual([
      's[0]: a route needs an effect — block, status, body, file or delay',
    ]);
    expect(validateSteps([{ do: 'screenshot', name: 'a', quality: 80 }], 's')).toEqual([
      's[0].quality: only with format "jpeg"',
    ]);
    expect(validateSteps([{ do: 'evaluate', name: 'a', expression: 'x'.repeat(2001) }], 's')).toEqual([
      's[0].expression: max 2000 chars',
    ]);
    expect(validateSteps([{ do: 'evaluate', name: 'a', file: 'x.js' }], 's')).toEqual([
      's[0].expression: required in a config',
      's[0].file: only in a session (eval --file) — a config carries the expression',
    ]);
    expect(validateSteps([{ do: 'dialog' }], 's')).toEqual(['s[0].action: "accept" or "dismiss"']);
    expect(validateSteps([{ do: 'extract', selector: 'h1' }], 's')).toEqual([
      's[0].name: required in a config (the report key)',
    ]);
    expect(validateSteps([{ do: 'screenshot' }], 's')).toEqual(['s[0].name: required in a config (the file basename)']);
  });

  it('enforces the artifact namespaces of a flow', () => {
    expect(
      validateSteps(
        [
          { do: 'screenshot', name: 'a' },
          { do: 'screenshot', name: 'a' },
          { do: 'extract', name: 'v', selector: 'h1' },
          { do: 'evaluate', name: 'v', expression: '1' },
          { do: 'storage', kind: 'local', op: 'get', key: 'k', name: 'v' },
        ],
        's',
      ),
    ).toEqual([
      expect.stringMatching(/^s\[1\]\.name: duplicate screenshot name "a"/u),
      expect.stringMatching(/^s\[3\]\.name: duplicate capture name "v"/u),
      expect.stringMatching(/^s\[4\]\.name: duplicate capture name "v"/u),
    ]);
  });

  it('applies the ref rule per mode: batch needs a snapshot first, session never does, auth forbids literals', () => {
    expect(validateSteps([{ do: 'click', ref: 'e1' }], 's')[0]).toMatch(/before any "snapshot" step/u);
    expect(validateSteps([{ do: 'snapshot' }, { do: 'click', ref: 'e1' }], 's')).toEqual([]);
    expect(validateSteps([{ do: 'click', ref: 'e1' }], 's', { mode: 'session' })).toEqual([]);
    expect(validateSteps([{ do: 'find', text: 'x' }], 's', { mode: 'session' })).toEqual([]);
    expect(validateSteps([{ do: 'fill', selector: '#p', value: 'x' }], 'auth.login.steps', { mode: 'auth' })).toEqual([
      'auth.login.steps[0]: in auth.login only "valueFromEnv" is allowed, never a literal "value"',
    ]);
    expect(validateSteps([{ do: 'extract', ref: 'e1' }], 's', { mode: 'session' })).toEqual([]);
  });
});

describe('helpers', () => {
  it('isRef, refFieldsOf and checkField', () => {
    expect(isRef('e12')).toBe(true);
    expect(isRef('f3e7')).toBe(true);
    expect(isRef('#e12')).toBe(false);
    expect(isRef('e')).toBe(false);
    expect(refFieldsOf({ do: 'drag', from: 'e1', to: '#x' }, STEPS.drag)).toEqual(['from']);
    expect(refFieldsOf({ do: 'screenshot', name: 'a', ref: 'e2', mark: 'e3' }, STEPS.screenshot)).toEqual([
      'ref',
      'mark',
    ]);
    expect(checkField(undefined, 'string', 'p')).toBe('p: required (string)');
    expect(checkField(undefined, 'string?', 'p')).toBeUndefined();
    expect(checkField('', 'string', 'p')).toMatch(/non-empty/u);
    expect(checkField('', 'text', 'p')).toBeUndefined();
    expect(checkField(1.5, 'int', 'p')).toMatch(/integer/u);
    expect(checkField('x', 'enum:a,b', 'p')).toBe('p: expected one of a | b, got "x"');
    expect(checkField(['a'], 'list', 'p')).toBeUndefined();
    expect(checkField('x', 'url', 'p')).toMatch(/absolute URL/u);
    expect(checkField('Final', 'name', 'p')).toMatch(/\[a-z0-9\]/u);
    expect(checkField({}, 'object', 'p')).toBeUndefined();
    expect(checkField(1, 'mystery', 'p')).toMatch(/unknown field type/u);
  });

  it('helpFor renders one row, undefined for a stranger', () => {
    const text = helpFor('shot');
    expect(text).toContain('browser-inspector shot [name] [--full]');
    expect(text).toContain('names: screenshot, shot');
    expect(text).toContain('config fields: name: name?');
    expect(text).toContain('--full --el <string>');
    expect(helpFor('nope')).toBeUndefined();
  });
});
