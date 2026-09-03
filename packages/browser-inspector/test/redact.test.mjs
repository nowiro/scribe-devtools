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
    expect(secretForms(secrets)).toHaveLength(6);
  });

  it('masks the wire forms a browser produces: form-urlencoded and base64', () => {
    const secret = 'p@ss word!';
    const secrets = [secret];
    // What a submitted <form> puts in the POST body (space is `+`, `!` is `%21`).
    expect(redact(`login=jan&haslo=${new URLSearchParams({ v: secret }).toString().slice(2)}`, secrets)).toBe(
      `login=jan&haslo=${MASK}`,
    );
    expect(redact(`token=${Buffer.from(secret, 'utf8').toString('base64')}`, secrets)).toBe(`token=${MASK}`);
    expect(redact(`token=${Buffer.from(secret, 'utf8').toString('base64url')}`, secrets)).toBe(`token=${MASK}`);
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

  it('strips the value when the accessible name carries a colon — bare key and quoted key alike', () => {
    const labels = [
      '- textbox "Hasło:" [ref=e3] [box=50,8,177,21]: S3cret',
      `- 'textbox "Kod: SMS" [ref=e4] [box=294,8,177,21]': 654321`,
      '- textbox "Zwykły" [ref=e5]: tekst',
      // A container ends with `:` and its children follow — cutting that one would break the tree.
      '- generic [ref=e1] [box=0,0,300,100]:',
    ].join('\n');
    expect(maskSnapshotValues(labels, { sensitiveRefs: ['e3', 'e4'] }).split('\n')).toEqual([
      '- textbox "Hasło:" [ref=e3] [box=50,8,177,21]',
      `- 'textbox "Kod: SMS" [ref=e4] [box=294,8,177,21]'`,
      '- textbox "Zwykły" [ref=e5]: tekst',
      '- generic [ref=e1] [box=0,0,300,100]:',
    ]);
  });

  it('redacts a line no value rule matches — a secret the page echoed into a heading', () => {
    const echoed = ['- heading "Witaj, hunter2" [ref=e2]', '- textbox "Hasło:" [ref=e3]: hunter2'].join('\n');
    expect(maskSnapshotValues(echoed, { secretValues: ['hunter2'] }).split('\n')).toEqual([
      `- heading "Witaj, ${MASK}" [ref=e2]`,
      `- textbox "Hasło:" [ref=e3]: ${MASK}`,
    ]);
  });

  it('cuts a compact value after the name, even when the name itself contains " = "', () => {
    expect(maskSnapshotValues('e5 textbox "a = b" = sekret', { sensitiveRefs: ['e5'] })).toBe('e5 textbox "a = b"');
  });

  it('takes the ref from behind the name — a `[ref=` the page put in the name cannot steal the line', () => {
    const crafted = [
      '- textbox "Hasło [ref=e1] konta" [ref=e9] [box=1,2,3,4]: TAJNE',
      `- 'textbox "Kod: SMS [ref=e1]" [ref=f2e7] [box=1,2,3,4]': 654321`,
      '- textbox "Hasło [ref=e999]" [ref=e11]: TAJNE-2',
    ].join('\n');
    expect(maskSnapshotValues(crafted, { sensitiveRefs: ['e9', 'f2e7', 'e11'] }).split('\n')).toEqual([
      '- textbox "Hasło [ref=e1] konta" [ref=e9] [box=1,2,3,4]',
      `- 'textbox "Kod: SMS [ref=e1]" [ref=f2e7] [box=1,2,3,4]'`,
      '- textbox "Hasło [ref=e999]" [ref=e11]',
    ]);
  });

  it('keeps the value of a line whose NAME mentions a sensitive ref — the ref belongs to the node', () => {
    const line = '- textbox "Powtórz [ref=e9] niżej" [ref=e5] [box=1,2,3,4]: jawna wartość';
    expect(maskSnapshotValues(line, { sensitiveRefs: ['e9'] })).toBe(line);
  });

  it('takes the ref from behind an UNQUOTED name too — playwright leaves `/…/` names bare', () => {
    // `createKey`: a name that starts and ends with `/` is written without quotes, so `afterName`
    // found no quote, returned 0 and scanned the whole key again — the `[ref=e1]` a page put in its
    // own `aria-label` took the line and the password stayed in snap.full.yml.
    const crafted = [
      '- textbox /x [ref=e1] y/ [active] [ref=e6] [box=8,68,177,21]: TAJNE',
      `- 'textbox /x: [ref=e1] y/ [ref=e7] [box=1,2,3,4]': TAJNE-2`,
    ].join('\n');
    expect(maskSnapshotValues(crafted, { sensitiveRefs: ['e6', 'e7'] }).split('\n')).toEqual([
      '- textbox /x [ref=e1] y/ [active] [ref=e6] [box=8,68,177,21]',
      `- 'textbox /x: [ref=e1] y/ [ref=e7] [box=1,2,3,4]'`,
    ]);
    // The other direction is the same bug: a bare name mentioning a sensitive ref must not cost an
    // unrelated field the value it should keep.
    const innocent = '- textbox /Powtórz [ref=e9] niżej/ [ref=e5] [box=1,2,3,4]: jawna wartość';
    expect(maskSnapshotValues(innocent, { sensitiveRefs: ['e9'] })).toBe(innocent);
    // A `/…/` name with no ref inside still resolves to the node's own ref.
    expect(maskSnapshotValues('- textbox /Szukaj/ [ref=e4]: sekret', { sensitiveRefs: ['e4'] })).toBe(
      '- textbox /Szukaj/ [ref=e4]',
    );
  });

  it('cuts a value-carrying line that has NO ref — nothing can vouch for it', () => {
    // A field under `pointer-events: none` gets no ref from playwright, so it gets no sidecar entry
    // and no `sensitive` flag: the whole protection hung on the ref, and a password field kept its
    // value in snap.full.yml, in snap.md and on the session's stdout.
    const inert = [
      '- textbox "Hasło w kontenerze" [box=139,47,177,21]: BBBpointerBBB',
      '- generic [box=0,0,1,1]:',
    ].join('\n');
    expect(maskSnapshotValues(inert).split('\n')).toEqual([
      '- textbox "Hasło w kontenerze" [box=139,47,177,21]',
      '- generic [box=0,0,1,1]:',
    ]);
    expect(maskSnapshotValues('textbox "Hasło w kontenerze" = BBBpointerBBB')).toBe('textbox "Hasło w kontenerze"');
    expect(maskSnapshotValues('textbox "Hasło" = x', { maskAllValueRoles: true })).toBe('textbox "Hasło"');
  });

  it('cuts the `- text:` leaf a value field carries when it also has a property', () => {
    // With a `placeholder` playwright cannot render the value inline, so it becomes a child leaf —
    // a shape no rule matched, and neither `sensitiveRefs` nor the fail-closed mode cut it.
    const tree = [
      '  - textbox "Hasło" [ref=e4] [box=45,80,177,21]:',
      '    - /placeholder: min. 8 znaków',
      '    - text: TAJNE-ZE-STRONY',
      '  - textbox "Imię" [ref=e5] [box=45,110,177,21]:',
      '    - /placeholder: np. Anna',
      '    - text: Anna',
    ].join('\n');
    expect(maskSnapshotValues(tree, { sensitiveRefs: ['e4'] }).split('\n')).toEqual([
      '  - textbox "Hasło" [ref=e4] [box=45,80,177,21]:',
      '    - /placeholder: min. 8 znaków',
      '    - text',
      '  - textbox "Imię" [ref=e5] [box=45,110,177,21]:',
      '    - /placeholder: np. Anna',
      '    - text: Anna',
    ]);
    // Fail-closed cuts both, and the property lines survive — they are attributes, not the value.
    expect(maskSnapshotValues(tree, { maskAllValueRoles: true }).split('\n')).toEqual([
      '  - textbox "Hasło" [ref=e4] [box=45,80,177,21]:',
      '    - /placeholder: min. 8 znaków',
      '    - text',
      '  - textbox "Imię" [ref=e5] [box=45,110,177,21]:',
      '    - /placeholder: np. Anna',
      '    - text',
    ]);
  });

  it('with `maskAllValueRoles` cuts every value-carrying line — the sensitivity of the walk is unknown', () => {
    const yaml2 = [
      '- textbox "Hasło:" [ref=e2] [box=1,2,3,4]: TAJNE',
      '- heading "Cennik" [ref=e3]: 2026',
      '- generic [ref=e1]:',
    ].join('\n');
    expect(maskSnapshotValues(yaml2, { maskAllValueRoles: true }).split('\n')).toEqual([
      '- textbox "Hasło:" [ref=e2] [box=1,2,3,4]',
      '- heading "Cennik" [ref=e3]: 2026',
      '- generic [ref=e1]:',
    ]);
    expect(maskSnapshotValues('e2 textbox "Hasło:" = TAJNE', { maskAllValueRoles: true })).toBe('e2 textbox "Hasło:"');
  });
});

describe('maskSnapshotEntries', () => {
  it('drops the value of sensitive sidecar entries and redacts the rest', () => {
    const entries = [
      { ref: 'e5', role: 'textbox', name: 'Email', value: 'jan@example.com' },
      // The name echoes the secret — dropping `value` is not enough for the rest of the entry.
      { ref: 'e6', role: 'textbox', name: 'Hasło jan@example.com', value: 'hunter2', sensitive: true },
      { ref: 'e9', role: 'textbox', name: 'OTP', value: '123456' },
    ];
    const out = maskSnapshotEntries(entries, { secretValues: ['jan@example.com'], sensitiveRefs: ['e9'] });
    expect(out).toEqual([
      { ref: 'e5', role: 'textbox', name: 'Email', value: MASK },
      { ref: 'e6', role: 'textbox', name: `Hasło ${MASK}`, sensitive: true },
      { ref: 'e9', role: 'textbox', name: 'OTP' },
    ]);
    expect(entries[1]).toHaveProperty('value');
  });
});
