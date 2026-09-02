// task.mjs — ONE task, performed by every variant. The values, the flow and the assertions live
// here so that the comparison of tokens and time never silently turns into a comparison of two
// different tasks.
//
// The task (a typical form QA):
//   1. open the form,
//   2. submit it empty — check that validation complains about the e-mail, screenshot as proof,
//   3. fill every field, submit,
//   4. read the ticket number, category and priority from the confirmation, screenshot as proof,
//   5. check the browser console — the UI looks fine, but the POST to the API failed and the only
//      trace is a `console.error`.
//
// Point 5 is not decoration: it is the most common shape of a failure visible only in the console,
// and the place where the two roads diverge most — `browser-inspector` has the console and the screenshots in the
// report for free, MCP needs separate calls for them.
export const APP_URL = 'http://localhost:4300/';

export const INPUT = {
  name: 'Jan Kowalski',
  email: 'jan.kowalski@example.com',
  category: 'zmiana',
  categoryLabel: 'Wniosek o zmianę',
  priority: 'krytyczny',
  description: 'Formularz nie zapisuje zgloszenia po kliknieciu Wyslij.',
};

/** What every road must bring back — the same set of facts, checked by `checkFindings`. */
export const EXPECTED = {
  ticketId: 'ALM-1001',
  category: 'zmiana',
  priority: 'krytyczny',
  emailErrorContains: 'Podaj poprawny adres e-mail',
  consoleErrorContains: '[zgloszenia] zapis nie powiodl sie',
  /** Two visual proofs: the validation state and the confirmation state. */
  screenshots: 2,
};

/**
 * The 18-step flow of DESIGN.md §6 (waitFor, click, 2×extract, screenshot, 3×fill, select, click,
 * fill, 2×click, waitFor, 3×extract, evaluate, screenshot) — the batch side of the task.
 */
export const FLOW_STEPS = [
  { do: 'waitFor', selector: '[data-testid=request-form]' },
  { do: 'click', selector: '[data-testid=submit]' },
  { do: 'extract', name: 'blad-email', selector: '[data-testid=error-email]' },
  { do: 'extract', name: 'licznik-niepoprawnych', selector: '[data-testid=invalid-count]' },
  { do: 'screenshot', name: 'walidacja' },
  { do: 'fill', selector: '[data-testid=field-name]', value: INPUT.name },
  { do: 'fill', selector: '[data-testid=field-email]', value: INPUT.email },
  { do: 'select', selector: '[data-testid=field-category]', value: INPUT.category },
  { do: 'click', selector: `[data-testid=priority-${INPUT.priority}]` },
  { do: 'fill', selector: '[data-testid=field-description]', value: INPUT.description },
  { do: 'click', selector: '[data-testid=field-consent]' },
  { do: 'click', selector: '[data-testid=submit]' },
  { do: 'waitFor', selector: '[data-testid=confirmation]' },
  { do: 'extract', name: 'numer-zgloszenia', selector: '[data-testid=ticket-id]' },
  { do: 'extract', name: 'kategoria', selector: '[data-testid=ticket-category]' },
  { do: 'extract', name: 'priorytet', selector: '[data-testid=ticket-priority]' },
  {
    do: 'evaluate',
    name: 'formularz-zamkniety',
    expression:
      "(() => { const f = document.querySelector('[data-testid=request-form]'); if (f && !f.hidden) throw new Error('formularz nadal widoczny po wyslaniu'); return 'formularz zniknal, potwierdzenie widoczne'; })()",
  },
  { do: 'screenshot', name: 'potwierdzenie' },
];

export const SNAPSHOT_NAME = 'zgloszenie-serwisowe';

/**
 * The `browser-inspector` config for the task. `outputDir` is relative to the config file (loadConfig resolves it
 * that way), so the caller decides where the run lands by deciding where the config lives.
 * @param {{ outputDir?: string, url?: string }} [options]
 */
export function browserInspectorConfig(options = {}) {
  return {
    outputDir: options.outputDir ?? './out',
    browser: { channel: 'chrome', headless: true },
    snapshots: [
      {
        name: SNAPSHOT_NAME,
        type: 'flow',
        url: options.url ?? APP_URL,
        waitUntil: 'load',
        steps: FLOW_STEPS,
      },
    ],
  };
}

/**
 * The correctness gate. A variant that does not bring the facts back is not cheaper — it is
 * incomplete, and the report says so instead of comparing apples with a smaller apple.
 * @param {{ [k: string]: string | number | undefined }} got
 * @returns {string[]} problems, empty when the findings are complete
 */
export function checkFindings(got) {
  const problems = [];
  const text = (v) => (typeof v === 'string' ? v.trim() : undefined);
  if (text(got.ticketId) !== EXPECTED.ticketId)
    problems.push(`ticketId: ${String(got.ticketId)} != ${EXPECTED.ticketId}`);
  if (text(got.category) !== EXPECTED.category)
    problems.push(`category: ${String(got.category)} != ${EXPECTED.category}`);
  if (text(got.priority) !== EXPECTED.priority)
    problems.push(`priority: ${String(got.priority)} != ${EXPECTED.priority}`);
  if (!text(got.emailError)?.includes(EXPECTED.emailErrorContains))
    problems.push(`emailError: ${String(got.emailError)}`);
  if (!text(got.consoleError)?.includes(EXPECTED.consoleErrorContains)) {
    problems.push(`consoleError: ${String(got.consoleError)}`);
  }
  if ((Number(got.screenshots) || 0) < EXPECTED.screenshots) {
    problems.push(`screenshots: ${String(got.screenshots)} < ${String(EXPECTED.screenshots)}`);
  }
  return problems;
}
