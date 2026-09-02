// The CLI parser is pure: argv in, a mode + a config-shaped step out. What matters: the app-factory
// gate's `node <pipeline> <config> --stamp X` keeps working unchanged, a typo fails HERE with a hint
// (never in the keeper), secrets typed as `@{NAME}` / `--env NAME` become `valueFromEnv` (the client
// resolves them; the parser never sees process.env), and every session command has a working example.
import { describe, expect, it } from 'vitest';

import { CliError, STAMP_PATTERN, formatStamp, parseArgs, splitFlags, suggest, usage } from '../src/cli.mjs';
import { STEPS, stepNames } from '../src/steps.schema.mjs';

/** @param {string[]} argv */
const session = (argv) => {
  const parsed = parseArgs(argv);
  if (parsed.mode !== 'session') throw new Error(`expected session, got ${parsed.mode}`);
  return parsed;
};

/** @param {string[]} argv */
const batch = (argv) => {
  const parsed = parseArgs(argv);
  if (parsed.mode !== 'batch') throw new Error(`expected batch, got ${parsed.mode}`);
  return parsed;
};

describe('batch', () => {
  it('treats the first argument ending in .json as the config — the app-factory gate call, unchanged', () => {
    const parsed = parseArgs(['read.config.browser-inspector.json', '--stamp', '2026-09-01_10-15']);
    expect(parsed).toEqual({
      mode: 'batch',
      configPath: 'read.config.browser-inspector.json',
      options: { stamp: '2026-09-01_10-15', only: [], fresh: false, failOnIncomplete: false, noDaemon: false },
    });
  });

  it('accepts --stamp=X, run <config>, flags before the config and every batch flag', () => {
    expect(batch(['cfg.json', '--stamp=2026-09-01_10-15']).options.stamp).toBe('2026-09-01_10-15');
    expect(parseArgs(['run', 'cfg.json']).mode).toBe('batch');
    expect(batch(['--stamp', '2026-09-01_10-15', 'cfg.json']).configPath).toBe('cfg.json');
    const full = batch([
      'cfg.json',
      '--only',
      'a',
      '--only',
      'b,c',
      '--parallel',
      '3',
      '--fresh',
      '--junit',
      'out/j.xml',
      '--fail-on-incomplete',
      '--no-daemon',
    ]);
    expect(full.options).toEqual({
      only: ['a', 'b', 'c'],
      parallel: 3,
      fresh: true,
      junit: 'out/j.xml',
      failOnIncomplete: true,
      noDaemon: true,
    });
  });

  it('rejects a malformed stamp, a forgotten value and a second config', () => {
    expect(() => parseArgs(['cfg.json', '--stamp', 'bench'])).toThrow(/YYYY-MM-DD_HH-MM/u);
    expect(() => parseArgs(['cfg.json', '--stamp'])).toThrow(/requires a value/u);
    expect(() => parseArgs(['cfg.json', '--stamp', '--junit', 'x.xml'])).toThrow(/--stamp requires a value/u);
    expect(() => parseArgs(['a.json', 'b.json'])).toThrow(/exactly one/u);
    expect(() => parseArgs(['cfg.json', '--parallel', '0'])).toThrow(/N ≥ 1/u);
  });

  it('fails a typo in a flag with exit 2 and a suggestion', () => {
    let error;
    try {
      parseArgs(['cfg.json', '--stmap', 'x']);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(/** @type {CliError} */ (error).exit).toBe(2);
    expect(/** @type {CliError} */ (error).message).toMatch(/did you mean --stamp/u);
  });
});

describe('session commands', () => {
  it('maps a ref positional to `ref` and anything else to `selector`', () => {
    expect(session(['click', 'e12']).step).toEqual({ do: 'click', ref: 'e12' });
    expect(session(['click', 'f3e7']).step).toEqual({ do: 'click', ref: 'f3e7' });
    expect(session(['click', '#btn']).step).toEqual({ do: 'click', selector: '#btn' });
    expect(session(['click', "mat-option:has-text('Ewa')"]).step.selector).toBe("mat-option:has-text('Ewa')");
  });

  it('resolves aliases and canonicalises the command name', () => {
    const open = session(['open', 'localhost:4313/']);
    expect(open.command).toBe('goto');
    expect(open.alias).toBe('open');
    expect(open.step).toEqual({ do: 'goto', url: 'http://localhost:4313/' });
    expect(session(['shot', 'koszyk', '--full']).step).toEqual({ do: 'screenshot', name: 'koszyk', fullPage: true });
    expect(session(['get', 'e5', '--value']).step).toEqual({ do: 'extract', ref: 'e5', value: true });
    expect(session(['snap', '--max', '3', '--diff']).step).toEqual({ do: 'snapshot', max: 3, diff: true });
  });

  it('turns @{NAME} and --env NAME into valueFromEnv and keeps @literal a literal', () => {
    expect(session(['fill', 'e5', '@{APP_PASS}']).step).toEqual({ do: 'fill', ref: 'e5', valueFromEnv: 'APP_PASS' });
    expect(session(['fill', 'e5', 'x', '--env', 'APP_PASS']).step).toEqual({
      do: 'fill',
      ref: 'e5',
      valueFromEnv: 'APP_PASS',
    });
    expect(session(['fill', 'e5', '@handle']).step).toEqual({ do: 'fill', ref: 'e5', value: '@handle' });
    expect(session(['fill', 'e39', 'Harry', '--enter']).step).toEqual({
      do: 'fill',
      ref: 'e39',
      value: 'Harry',
      enter: true,
    });
    expect(() => parseArgs(['fill', 'e5', '@{}'])).toThrow(/empty @\{\}/u);
    expect(() => parseArgs(['fill', 'e5'])).toThrow(/needs a value/u);
    const form = session(['form', 'e3="Jan"', 'e5=@{APP_PASS}', '#email=a@b.c']).step;
    expect(form.fields).toEqual([
      { ref: 'e3', value: 'Jan' },
      { ref: 'e5', valueFromEnv: 'APP_PASS' },
      { selector: '#email', value: 'a@b.c' },
    ]);
    // The `=` inside an attribute selector — the selectors `bi find` / elements.md hand out — is
    // not the pair's separator; the value keeps any `=` of its own.
    const selectors = session([
      'form',
      '[data-testid=field-name]=Jan Kowalski',
      'input[name="q"]=x',
      'e5=a=b',
      "[data-testid='a=b']=@{PASS}",
    ]).step;
    expect(selectors.fields).toEqual([
      { selector: '[data-testid=field-name]', value: 'Jan Kowalski' },
      { selector: 'input[name="q"]', value: 'x' },
      { ref: 'e5', value: 'a=b' },
      { selector: "[data-testid='a=b']", valueFromEnv: 'PASS' },
    ]);
    expect(() => parseArgs(['form', '[data-testid=x]'])).toThrow(/expected <target>=<value>/u);
    expect(JSON.stringify(session(['storage', 'local', 'set', 'token', '@{TOKEN}']).step)).not.toContain('value"');
  });

  it('fails a typo in the command name with a suggestion and exit 2', () => {
    expect(() => parseArgs(['clikc', 'e1'])).toThrow(/did you mean "click"/u);
    expect(() => parseArgs(['clikc', 'e1'])).toThrow(CliError);
    expect(() => parseArgs(['click', 'e1', '--duble'])).toThrow(/did you mean --double/u);
    expect(() => parseArgs(['click'])).toThrow(/missing <target> — usage: bi click/u);
    expect(() => parseArgs(['click', 'e1', 'e2'])).toThrow(/unexpected argument "e2"/u);
    expect(() => parseArgs(['click', 'e1', '--no-daemon'])).toThrow(/unknown flag --no-daemon/u);
    expect(() => parseArgs(['verify', 'sizzle', 'e1'])).toThrow(/unknown kind/u);
    expect(() => parseArgs(['resize', '1280'])).toThrow(/<width>x<height>/u);
    expect(() => parseArgs(['offline', 'maybe'])).toThrow(/on\|off/u);
  });

  it('keeps --session, --out and --soft as options (and --soft on the step when the step knows it)', () => {
    const verify = session(['verify', 'text', 'e12', 'Koszyk', '--soft', '--session', 'b', '--out', './x']);
    expect(verify.options).toEqual({ session: 'b', out: './x', soft: true });
    expect(verify.step).toEqual({ do: 'verify', kind: 'text', ref: 'e12', text: 'Koszyk', soft: true });
    const click = session(['click', 'e1', '--soft']);
    expect(click.options.soft).toBe(true);
    expect(click.step).toEqual({ do: 'click', ref: 'e1' });
  });

  it('builds the design-grammar steps', () => {
    expect(session(['click', 'e12', '--double', '--mod', 'ctrl,shift']).step).toEqual({
      do: 'click',
      ref: 'e12',
      count: 2,
      modifiers: ['ctrl', 'shift'],
    });
    expect(session(['wait', '--text', 'Harry Potter']).step).toEqual({ do: 'wait', text: 'Harry Potter' });
    expect(session(['wait', '500']).step).toEqual({ do: 'wait', ms: 500 });
    expect(session(['route', '**/api/*', '--status', '500', '--body', '{"e":1}']).step).toEqual({
      do: 'route',
      url: '**/api/*',
      status: 500,
      body: '{"e":1}',
    });
    expect(session(['mouse', 'drag', '10', '20', '30', '40']).step).toEqual({
      do: 'mouse',
      action: 'drag',
      x: 10,
      y: 20,
      toX: 30,
      toY: 40,
    });
    expect(session(['mouse', 'wheel', '-100']).step).toEqual({ do: 'mouse', action: 'wheel', dy: -100 });
    expect(session(['tab', '2']).step).toEqual({ do: 'tab', action: 'select', index: 2 });
    expect(session(['net', '7', '--body']).step).toEqual({ do: 'net', n: 7, body: true });
    expect(session(['console', '--errors']).step).toEqual({ do: 'console', level: 'error' });
    expect(session(['eval', 'document.title']).step).toEqual({ do: 'evaluate', expression: 'document.title' });
    expect(session(['eval', 'document', '.', 'title']).step.expression).toBe('document . title');
    expect(session(['dialog']).step).toEqual({ do: 'dialog' });
    expect(session(['dialog', 'accept', '--text', 'yes', '--once']).step).toEqual({
      do: 'dialog',
      action: 'accept',
      text: 'yes',
      once: true,
    });
    expect(session(['verify', 'count', '[data-testid=row]', '3']).step).toEqual({
      do: 'verify',
      kind: 'count',
      selector: '[data-testid=row]',
      count: 3,
    });
    expect(session(['verify', 'url', '**/cart']).step).toEqual({ do: 'verify', kind: 'url', url: '**/cart' });
    expect(session(['fetch', '/api/x', '--method', 'POST', '--header', 'a:1,b:2']).step).toEqual({
      do: 'fetch',
      url: '/api/x',
      method: 'POST',
      headers: { a: '1', b: '2' },
    });
  });

  it('has a working example for EVERY session command in the table', () => {
    /** @type {Record<string, string[]>} */
    const examples = {
      goto: ['open', 'http://localhost:4313/'],
      back: ['back'],
      forward: ['forward'],
      reload: ['reload', '--wait', 'settled'],
      click: ['click', 'e45'],
      fill: ['fill', 'e39', 'Harry'],
      type: ['type', 'e39', 'Harry', '--slowly'],
      form: ['form', 'e3=Jan'],
      press: ['press', 'Enter'],
      hover: ['hover', 'e1'],
      select: ['select', 'e5', 'opt1'],
      check: ['check', 'e1'],
      uncheck: ['uncheck', 'e1'],
      drag: ['drag', 'e1', '#drop'],
      upload: ['upload', 'e1', 'a.png', 'b.png'],
      scroll: ['scroll', '--to', 'bottom'],
      mouse: ['mouse', 'click', '10', '20'],
      wait: ['wait', '--url', '**/cart'],
      waitFor: ['waitFor', '[data-testid=x]', '--state', 'hidden'],
      screenshot: ['shot'],
      pdf: ['pdf', 'koszyk'],
      extract: ['get', 'e1'],
      evaluate: ['eval', '1+1'],
      snapshot: ['snap', '--around', 'e45'],
      find: ['find', 'koszyk'],
      verify: ['verify', 'visible', 'e1'],
      resize: ['resize', '1280x720'],
      route: ['route', '**/api/*', '--block'],
      unroute: ['unroute'],
      routes: ['routes'],
      offline: ['offline', 'on'],
      fetch: ['fetch', 'http://localhost:4313/api'],
      dialog: ['dialog', 'dismiss'],
      tab: ['tab', 'new', 'http://localhost:4313/'],
      tabs: ['tabs'],
      frame: ['frame', 'main'],
      storage: ['storage', 'cookies', 'list'],
      state: ['state', 'save', 'auth.json'],
      console: ['console', '--level', 'warn'],
      net: ['net', '--failed'],
      trace: ['trace', 'start'],
      video: ['video', 'stop'],
      locator: ['locator', 'e5'],
      run: ['run', '--file', 's.mjs'],
      close: ['close'],
    };
    for (const name of stepNames({ session: true })) {
      expect(examples, `missing example for ${name}`).toHaveProperty(name);
      const parsed = session(examples[name]);
      expect(parsed.command).toBe(name);
      expect(parsed.step.do).toBe(name);
    }
    expect(Object.keys(examples).sort()).toEqual(stepNames({ session: true }).sort());
  });
});

describe('other entrances', () => {
  it('parses help, version, the control commands, script, export and lint-config', () => {
    expect(parseArgs([])).toEqual({ mode: 'help' });
    expect(parseArgs(['help', 'click'])).toEqual({ mode: 'help', command: 'click' });
    expect(parseArgs(['--help'])).toEqual({ mode: 'help' });
    expect(() => parseArgs(['help', 'clikc'])).toThrow(/did you mean "click"/u);
    expect(parseArgs(['--version'])).toEqual({ mode: 'version' });
    for (const control of ['up', 'status', 'stop', 'doctor'])
      expect(parseArgs([control])).toEqual({ mode: control, options: {} });
    expect(() => parseArgs(['status', 'x'])).toThrow(/takes no arguments/u);
    expect(parseArgs(['script', 'flow.txt', '--out', 'o', '--no-daemon'])).toEqual({
      mode: 'script',
      file: 'flow.txt',
      options: { out: 'o', noDaemon: true },
    });
    expect(parseArgs(['export', 'flows/koszyk.json', '--force'])).toEqual({
      mode: 'export',
      file: 'flows/koszyk.json',
      options: { force: true },
    });
    expect(() => parseArgs(['export', 'koszyk.txt'])).toThrow(/flow\.json/u);
    expect(parseArgs(['lint-config', 'cfg.json'])).toEqual({ mode: 'lint-config', configPath: 'cfg.json' });
  });

  it('prints a usage that names every session command and a per-command help', () => {
    const text = usage();
    for (const name of stepNames({ session: true })) expect(text).toContain(name);
    expect(usage('shot')).toContain('bi shot [name]');
    expect(usage('click')).toContain(STEPS.click.help);
  });
});

describe('helpers', () => {
  it('splitFlags: `--` ends flags, negative numbers are positionals, bool=false is honoured', () => {
    expect(splitFlags(['a', '--', '--b'], { b: 'bool' }, 'x')).toEqual({ positionals: ['a', '--b'], flags: {} });
    expect(splitFlags(['-5', '--b=false'], { b: 'bool' }, 'x')).toEqual({ positionals: ['-5'], flags: { b: false } });
    expect(() => splitFlags(['-x'], {}, 'x')).toThrow(/unknown flag "-x"/u);
    expect(() => splitFlags(['--n', 'z'], { n: 'int' }, 'x')).toThrow(/expects an integer/u);
  });

  it('suggest finds a word two edits away and nothing further', () => {
    expect(suggest('clikc', ['click', 'fill'])).toBe('click');
    expect(suggest('zzzzzz', ['click', 'fill'])).toBeUndefined();
  });

  it('formatStamp produces the read-runtime form', () => {
    const stamp = formatStamp(new Date('2026-09-01T08:05:00Z'));
    expect(stamp).toMatch(STAMP_PATTERN);
    expect(stamp).toBe('2026-09-01_10-05');
  });
});
