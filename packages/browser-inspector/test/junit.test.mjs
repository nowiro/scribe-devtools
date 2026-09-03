// `--junit f.xml`: one testcase per snapshot, a failure per incomplete run naming what failed,
// XML-escaped, seconds with three decimals — the shape GitLab and every CI read as a test tab.
import { describe, expect, it } from 'vitest';

import { redact } from '../src/redact.mjs';
import { renderJUnit } from '../src/report.mjs';

describe('renderJUnit', () => {
  const xml = renderJUnit('read.config.browser-inspector.json', [
    { name: 'nowiro-glowna', completed: true, ms: 446, dir: 'X/nowiro-glowna' },
    {
      name: 'dziennik-uczen',
      completed: false,
      ms: 1812,
      failure: 'step 4 "waitFor [data-testid=dashboard-anonymous] (visible)" — Error: Timeout <8000ms> & "more"',
    },
    { name: 'bookstore', completed: false },
  ]);

  it('counts tests and failures on both suite levels and sums the time', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<testsuites name="browser-inspector" tests="3" failures="2" time="2.258">');
    expect(xml).toContain('<testsuite name="read.config.browser-inspector.json" tests="3" failures="2" time="2.258">');
    expect(xml.endsWith('</testsuites>\n')).toBe(true);
  });

  it('a completed snapshot is a bare testcase, with the directory as system-out when known', () => {
    expect(xml).toContain(
      '    <testcase name="nowiro-glowna" classname="browser-inspector.read.config.browser-inspector.json" time="0.446">\n      <system-out>X/nowiro-glowna</system-out>\n    </testcase>',
    );
  });

  it('an incomplete snapshot carries an escaped failure message', () => {
    expect(xml).toContain(
      '    <testcase name="dziennik-uczen" classname="browser-inspector.read.config.browser-inspector.json" time="1.812">\n      <failure message="step 4 &quot;waitFor [data-testid=dashboard-anonymous] (visible)&quot; — Error: Timeout &lt;8000ms&gt; &amp; &quot;more&quot;"></failure>\n    </testcase>',
    );
    expect(xml).toContain(
      '<testcase name="bookstore" classname="browser-inspector.read.config.browser-inspector.json" time="0.000">\n      <failure message="incomplete"></failure>',
    );
  });

  it('drops the control characters XML 1.0 forbids — one ANSI escape used to void the whole file', () => {
    const esc = String.fromCharCode(27);
    const junit = renderJUnit('cfg.json', [
      {
        name: `raport${String.fromCharCode(1)}`,
        completed: false,
        ms: 12,
        failure: `step 1 "evaluate boom" — Error: zapis nie powiodl sie: ${esc}[31mHTTP 500${esc}[0m`,
        dir: `out${String.fromCharCode(0)}/x`,
      },
    ]);
    const illegal = [...junit].filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code !== 9 && code !== 10 && code !== 13 && (code < 0x20 || code === 0xfffe || code === 0xffff);
    });
    expect(illegal).toEqual([]);
    expect(junit).toContain('Error: zapis nie powiodl sie:  [31mHTTP 500 [0m');
    expect(junit).toContain('<testcase name="raport "');
  });

  it('redacts BEFORE escaping — a secret with & < > " survived as its entity form', () => {
    // The caller used to redact the finished document, so `xml()` had already turned the secret
    // into `p&amp;ss&lt;word`: `secretForms` knows no entity spelling, the mask missed it, and the
    // one artifact CI publishes as a test tab carried the password in a trivially reversible form.
    const secret = 'p&ss<word';
    const junit = renderJUnit('cfg.json', [
      {
        name: 'logowanie',
        completed: false,
        ms: 12,
        failure: `step 3 "verify value #pw" — Error: expected #pw value "x", got ${JSON.stringify(secret)}`,
      },
    ]);
    expect(junit).toContain('p&amp;ss&lt;word');
    const masked = renderJUnit(
      'cfg.json',
      [
        {
          name: 'logowanie',
          completed: false,
          ms: 12,
          failure: `step 3 "verify value #pw" — Error: expected #pw value "x", got ${JSON.stringify(secret)}`,
        },
      ],
      { redact: (text) => redact(text, [secret]) },
    );
    expect(masked).not.toContain('p&amp;ss&lt;word');
    expect(masked).not.toContain(secret);
    expect(masked).toContain('***');
  });

  it('redacts the suite, the name and the directory too, not only the failure', () => {
    const secret = 'a>b';
    const masked = renderJUnit(
      `cfg-${secret}.json`,
      [{ name: `snap-${secret}`, completed: true, dir: `out/${secret}` }],
      {
        redact: (text) => redact(text, [secret]),
      },
    );
    expect(masked).not.toContain('a&gt;b');
    expect(masked).not.toContain(secret);
  });

  it('an empty run is still a valid document', () => {
    const empty = renderJUnit('cfg.json', []);
    expect(empty).toContain('<testsuites name="browser-inspector" tests="0" failures="0" time="0.000">');
    expect(empty).toContain('<testsuite name="cfg.json" tests="0" failures="0" time="0.000">\n  </testsuite>');
  });
});
