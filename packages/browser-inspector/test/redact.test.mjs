// One redaction function for every artifact (DESIGN.md §2.6): the raw value, its JSON-escaped and
// URL-encoded forms, nested objects, snapshot lines — and password / one-time-code fields that
// never carry a value at all.
import { describe, expect, it } from 'vitest';

import { MASK, maskSnapshotEntries, maskSnapshotValues, redact, redactDeep, secretForms } from '../src/redact.mjs';

const SECRET = 'p@ss"w/ord ą';

describe('redact', () => {
  it('masks every form a secret can take in text', () => {
    const secrets = [SECRET];
    expect(redact(`typed ${SECRET} here`, secrets)).toBe(`typed ${MASK} here`);
    expect(redact(JSON.stringify({ v: SECRET }), secrets)).toBe(`{"v":"${MASK}"}`);
    expect(redact(`body=${encodeURIComponent(SECRET)}`, secrets)).toBe(`body=${MASK}`);
    expect(secretForms(secrets)).toHaveLength(3);
  });

  it('masks the longer secret first and leaves innocent text alone', () => {
    expect(redact('ab abc abcd', ['abc', 'abcd'])).toBe(`ab ${MASK} ${MASK}`);
    expect(redact('nothing here', ['zzz'])).toBe('nothing here');
    expect(redact('', ['zzz'])).toBe('');
  });

  it('ignores empty and non-string secrets instead of masking everything', () => {
    expect(redact('keep me', ['', /** @type {any} */ (null), /** @type {any} */ (42)])).toBe('keep me');
    expect(redact('keep me', undefined)).toBe('keep me');
    expect(redact(/** @type {any} */ (12), ['1'])).toBe(12);
  });

  it('redactDeep walks arrays, objects and keys without mutating the input', () => {
    const input = { a: SECRET, list: [SECRET, { deep: `x${SECRET}y` }], [SECRET]: 1, n: 5 };
    const out = redactDeep(input, [SECRET]);
    expect(out).toEqual({ a: MASK, list: [MASK, { deep: `x${MASK}y` }], [MASK]: 1, n: 5 });
    expect(input.a).toBe(SECRET);
    expect(redactDeep(input, [])).toBe(input);
  });
});

describe('maskSnapshotValues', () => {
  const yaml = [
    '- textbox "Email" [ref=e5]: jan@example.com',
    '- textbox "Hasło" [ref=e6]: hunter2',
    '- textbox "Kod" [ref=f2e3]: 123456',
    '- button "Zaloguj" [ref=e7]',
    '- combobox "Kraj" [ref=e8] [expanded]: Polska',
    '- text: hunter2 is not a value here',
  ].join('\n');

  it('strips the value of sensitive refs and redacts secrets elsewhere in the aria YAML', () => {
    const masked = maskSnapshotValues(yaml, { secretValues: ['jan@example.com'], sensitiveRefs: ['e6', 'f2e3'] });
    expect(masked.split('\n')).toEqual([
      `- textbox "Email" [ref=e5]: ${MASK}`,
      '- textbox "Hasło" [ref=e6]',
      '- textbox "Kod" [ref=f2e3]',
      '- button "Zaloguj" [ref=e7]',
      '- combobox "Kraj" [ref=e8] [expanded]: Polska',
      '- text: hunter2 is not a value here',
    ]);
  });

  it('handles the compact form (snap.md) too', () => {
    const compact = [
      'e39 textbox "Szukaj produktów…" = Harry',
      'e6 textbox "Hasło" = hunter2',
      'e41 button "Szukaj" [data-testid=search-submit]',
    ].join('\n');
    expect(maskSnapshotValues(compact, { secretValues: ['Harry'], sensitiveRefs: ['e6'] }).split('\n')).toEqual([
      `e39 textbox "Szukaj produktów…" = ${MASK}`,
      'e6 textbox "Hasło"',
      'e41 button "Szukaj" [data-testid=search-submit]',
    ]);
  });

  it('is a no-op without secrets or sensitive refs', () => {
    expect(maskSnapshotValues(yaml)).toBe(yaml);
  });
});

describe('maskSnapshotEntries', () => {
  it('drops the value of sensitive sidecar entries and redacts the rest', () => {
    const entries = [
      { ref: 'e5', role: 'textbox', name: 'Email', value: 'jan@example.com' },
      { ref: 'e6', role: 'textbox', name: 'Hasło', value: 'hunter2', sensitive: true },
      { ref: 'e9', role: 'textbox', name: 'OTP', value: '123456' },
    ];
    const out = maskSnapshotEntries(entries, { secretValues: ['jan@example.com'], sensitiveRefs: ['e9'] });
    expect(out).toEqual([
      { ref: 'e5', role: 'textbox', name: 'Email', value: MASK },
      { ref: 'e6', role: 'textbox', name: 'Hasło', sensitive: true },
      { ref: 'e9', role: 'textbox', name: 'OTP' },
    ]);
    expect(entries[1]).toHaveProperty('value');
  });
});
