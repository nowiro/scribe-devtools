// docs/STEPS.md — the step reference, generated from the ONE step table (`STEPS` in
// `packages/browser-inspector/src/steps.schema.mjs`) so that the config schema, the CLI grammar,
// `browser-inspector help <step>` and this document cannot disagree: the same object renders all four.
//
// `--check` compares the rendered text with the file on disk, like `index-code.mjs --check`, and
// the pre-commit hook regenerates the file. When the schema is absent (a tree before WP1) the
// generator says so and exits 0 in both modes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SCHEMA_FILE = 'packages/browser-inspector/src/steps.schema.mjs';
export const DOC_FILE = 'docs/STEPS.md';

/** Markdown table cells cannot hold a bare `|`. @param {string} text */
const cell = (text) => text.replaceAll('|', '\\|');

/** @param {unknown} value */
const code = (value) => (value === undefined || value === null || value === '' ? '—' : `\`${cell(String(value))}\``);

/**
 * @param {Record<string, unknown> | undefined} fields e.g. `{ selector: 'string?', ref: 'ref?' }`
 * @param {string} [prefix] `--` for flags
 * @returns {string}
 */
function renderFields(fields, prefix = '') {
  const entries = Object.entries(fields ?? {});
  if (entries.length === 0) return '—';
  return entries
    .map(([name, type]) =>
      prefix && type === 'bool' ? `\`${prefix}${name}\`` : `\`${prefix}${name}: ${cell(String(type))}\``,
    )
    .join(', ');
}

/**
 * Render the whole document from the step table. Pure — the tests feed it a hand-made table.
 * @param {Record<string, any>} steps the `STEPS` object
 * @param {{ fieldTypes?: Record<string, string> }} [options] the `FIELD_TYPES` legend
 * @returns {string}
 */
export function renderStepsDoc(steps, options = {}) {
  const names = Object.keys(steps);
  const where = (/** @type {any} */ step) =>
    step.batch && step.session ? 'config + sesja' : step.batch ? 'config' : 'sesja';
  const lines = [
    '# Kroki `browser-inspector` — tabela STEPS',
    '',
    `Generowane z \`${SCHEMA_FILE}\` — nie edytuj ręcznie. Regeneracja: \`npm run docs\``,
    '(hook pre-commit robi to sam; `npm run verify` pada, gdy plik jest nieświeży).',
    '',
    'Te same nazwy w configu batchu (`steps[].do`) i w sesji (`browser-inspector <krok> …`); aliasy działają tylko w sesji.',
    '`kind` steruje linią stdout: `action` drukuje delty (`dom Δ`, `el 61→63`, `+1 console.error`),',
    '`query` drukuje treść, `control` samo `ok`. Kolumna „gdzie” mówi, czy krok wolno wpisać do configu',
    '(`config`), wywołać w sesji (`sesja`), czy jedno i drugie. `browser-inspector help <krok>` drukuje ten sam wiersz.',
    '',
    `Kroków: ${String(names.length)}.`,
    '',
    '## Tabela',
    '',
    '| krok | aliasy | kind | gdzie | sesja: `browser-inspector …` | pola configu | flagi sesji |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const name of names) {
    const step = steps[name] ?? {};
    const aliases = Array.isArray(step.aliases) && step.aliases.length > 0 ? step.aliases.map(code).join(', ') : '—';
    lines.push(
      `| \`${name}\` | ${aliases} | ${code(step.kind)} | ${where(step)} | ${code(step.help)} | ${renderFields(step.config)} | ${renderFields(step.flags, '--')} |`,
    );
  }
  lines.push(
    '',
    '## Typy pól',
    '',
    'Sufiks `?` = pole opcjonalne. Nieznane pole w kroku to błąd walidacji (ścieżka `snapshots[i].steps[j].pole`).',
    '',
  );
  lines.push('| typ | znaczenie |', '| --- | --- |');
  for (const [type, meaning] of Object.entries(options.fieldTypes ?? {}))
    lines.push(`| \`${cell(type)}\` | ${cell(meaning)} |`);
  lines.push(
    '',
    '## Reguły wspólne',
    '',
    '- Wartości (`fill`, `type`, `form`, `storage set`): dokładnie jedno z `value` / `valueFromEnv`; w `auth.login.steps` wyłącznie `valueFromEnv`.',
    '  W sesji: `@{NAZWA}` albo `--env NAZWA` → `valueFromEnv`; `@literal` bez klamry zostaje literałem.',
    '- Cel (`selector` / `ref`): dokładnie jedno; w configu `ref` wolno użyć dopiero po kroku `snapshot` w tym samym flow (wcześniej mapa refów jest pusta).',
    '- Nazwy artefaktów (`name`): `[a-z0-9][a-z0-9-]*`, unikalne w flow; `final` zarezerwowane; `extract`, `evaluate`, `storage --name` i `fetch --name` dzielą jedną przestrzeń `extracts`.',
    '- `describe` kroku nigdy nie echuje wartości — tylko jej pochodzenie (`(literal)` / `(from env NAZWA)`).',
    '',
  );
  return lines.join('\n');
}

/**
 * @param {string} root
 * @returns {Promise<{ ok: boolean, message: string, text?: string }>}
 */
export async function renderFromRepo(root) {
  const schemaPath = path.join(root, SCHEMA_FILE);
  if (!existsSync(schemaPath)) return { ok: true, message: `${SCHEMA_FILE} not present yet — nothing to render` };
  const mod = await import(pathToFileURL(schemaPath).href);
  if (!mod.STEPS || typeof mod.STEPS !== 'object')
    return { ok: false, message: `${SCHEMA_FILE} does not export STEPS` };
  return {
    ok: true,
    message: `rendered ${String(Object.keys(mod.STEPS).length)} steps`,
    text: renderStepsDoc(mod.STEPS, { fieldTypes: mod.FIELD_TYPES }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = await renderFromRepo(REPO);
  const target = path.join(REPO, DOC_FILE);
  if (!result.ok) {
    process.stderr.write(`FAIL ${DOC_FILE}: ${result.message}\n`);
    process.exitCode = 1;
  } else if (result.text === undefined) {
    process.stdout.write(`${DOC_FILE}: ${result.message}\n`);
  } else if (process.argv.includes('--check')) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current === result.text) {
      process.stdout.write(`${DOC_FILE} is fresh\n`);
    } else {
      process.stderr.write(
        `${DOC_FILE} is STALE — run \`npm run docs\` (the pre-commit hook does this automatically)\n`,
      );
      process.exitCode = 1;
    }
  } else {
    writeFileSync(target, result.text, 'utf8');
    process.stdout.write(`wrote ${DOC_FILE} (${result.message})\n`);
  }
}
