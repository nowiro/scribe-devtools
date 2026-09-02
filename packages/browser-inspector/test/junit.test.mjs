// `--junit f.xml`: one testcase per snapshot, a failure per incomplete run naming what failed,
// XML-escaped, seconds with three decimals — the shape GitLab and every CI read as a test tab.
import { describe, expect, it } from 'vitest';

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
    expect(xml).toContain('<testsuites name="bi" tests="3" failures="2" time="2.258">');
    expect(xml).toContain('<testsuite name="read.config.browser-inspector.json" tests="3" failures="2" time="2.258">');
    expect(xml.endsWith('</testsuites>\n')).toBe(true);
  });

  it('a completed snapshot is a bare testcase, with the directory as system-out when known', () => {
    expect(xml).toContain(
      '    <testcase name="nowiro-glowna" classname="bi.read.config.browser-inspector.json" time="0.446">\n      <system-out>X/nowiro-glowna</system-out>\n    </testcase>',
    );
  });

  it('an incomplete snapshot carries an escaped failure message', () => {
    expect(xml).toContain(
      '    <testcase name="dziennik-uczen" classname="bi.read.config.browser-inspector.json" time="1.812">\n      <failure message="step 4 &quot;waitFor [data-testid=dashboard-anonymous] (visible)&quot; — Error: Timeout &lt;8000ms&gt; &amp; &quot;more&quot;"></failure>\n    </testcase>',
    );
    expect(xml).toContain(
      '<testcase name="bookstore" classname="bi.read.config.browser-inspector.json" time="0.000">\n      <failure message="incomplete"></failure>',
    );
  });

  it('an empty run is still a valid document', () => {
    const empty = renderJUnit('cfg.json', []);
    expect(empty).toContain('<testsuites name="bi" tests="0" failures="0" time="0.000">');
    expect(empty).toContain('<testsuite name="cfg.json" tests="0" failures="0" time="0.000">\n  </testsuite>');
  });
});
