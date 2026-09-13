// check-claims.mjs — the gate that guards the repository's PROMISES, now that no test does.
//
// Every other gate here checks that the repository agrees with itself on paper: `check-pins` on
// versions, `check-instruction-sync` on the instruction blocks, `index-code` on the symbol index.
// None of them runs the two binaries. The test suite did, and it is gone — so the sentences the
// prose states as facts ("each command prints ONE line", "exit 1 = FAIL", "the 120-character limit
// is hard") became claims nobody verifies. A promise nobody checks is a promise that quietly stops
// being true, and in this repository the prose is part of the product.
//
// This gate is deliberately NOT a test suite coming back through the side door:
//   - it asserts only sentences that are WRITTEN DOWN in the prose, and every assertion names the
//     file that makes the promise, so a failure says which sentence went stale, not which line of
//     code changed;
//   - it never launches a browser, never touches the network and never starts a keeper, so it is
//     as deterministic and as fast as the gates it stands next to;
//   - it checks OBSERVABLE behaviour of the two binaries, never the inside of a function.
//
// What it cannot cover is named rather than hidden: anything needing a real page (a successful
// step, `exit 0` on a failed step inside a batch, snapshot shape) is out of reach without Chrome,
// and stays a matter for review.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listSourceFiles } from './index-code.mjs';
import { sizeInBytes } from './check-instruction-sync.mjs';

import { RUNNERS } from '../packages/browser-inspector/src/steps.run.mjs';
import { STEPS } from '../packages/browser-inspector/src/steps.schema.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const BI = path.join(REPO, 'packages', 'browser-inspector', 'bin', 'browser-inspector.mjs');
const NX = path.join(REPO, 'packages', 'nx-angular-inspector', 'bin', 'nx-angular-inspector.mjs');

/** The hard per-line limit `formatLine` enforces, per .github/instructions/nx-angular-inspector.instructions.md. */
const MAX_LINE = 120;

/** The nx verbs that answer from files alone. `run` and `serve` execute things and have no place in a gate. */
const READ_ONLY_VERBS = Object.freeze([['env'], ['projects'], ['graph', 'x'], ['affected'], ['gen'], ['guide']]);

/**
 * Run a binary and collect what a caller sees: the exit code and the lines on stdout+stderr.
 * `env` is passed through so a run inherits the caller's PATH, with the overrides on top.
 * @param {string} bin
 * @param {string[]} args
 * @param {Record<string, string>} [overrides]
 * @returns {{ code: number, lines: string[], text: string }}
 */
function run(bin, args, overrides = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...overrides },
    timeout: 30_000,
  });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  return { code: result.status ?? 1, lines, text };
}

/** @typedef {{ claim: string, where: string, run: (fail: (why: string) => void) => void }} Claim */

/** @type {Claim[]} */
const CLAIMS = [
  {
    claim: 'Każda komenda nx-angular-inspector drukuje JEDNĄ linię z prefiksem ok/FAIL',
    where: 'README.md · AGENTS.md (blok nx-angular-inspector)',
    run(fail) {
      const dir = mkdtempSync(path.join(tmpdir(), 'claims-'));
      try {
        for (const verb of READ_ONLY_VERBS) {
          const { lines } = run(NX, [...verb, '--root', dir]);
          if (lines.length !== 1) fail(`${verb[0]}: ${lines.length} linii zamiast jednej`);
          else if (!/^(ok|FAIL) /u.test(lines[0])) fail(`${verb[0]}: linia bez prefiksu ok/FAIL — ${lines[0]}`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    claim: `Limit ${MAX_LINE} znaków na linię jest twardy`,
    where: '.github/instructions/nx-angular-inspector.instructions.md',
    run(fail) {
      const dir = mkdtempSync(path.join(tmpdir(), 'claims-'));
      try {
        for (const verb of READ_ONLY_VERBS) {
          for (const line of run(NX, [...verb, '--root', dir]).lines) {
            if (line.length > MAX_LINE) fail(`${verb[0]}: ${line.length} znaków`);
          }
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    claim: 'exit 1 = FAIL dla nx-angular-inspector',
    where: 'AGENTS.md (blok nx-angular-inspector)',
    run(fail) {
      const dir = mkdtempSync(path.join(tmpdir(), 'claims-'));
      try {
        for (const verb of READ_ONLY_VERBS) {
          const { code } = run(NX, [...verb, '--root', dir]);
          if (code !== 1) fail(`${verb[0]}: exit ${code} zamiast 1 poza workspace'em`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    claim: 'Błąd składni komendy to jedna linia z odesłaniem do help (exit 2), nigdy pełna tabela pomocy',
    where: '.github/instructions/nx-angular-inspector.instructions.md',
    run(fail) {
      const { code, lines } = run(NX, ['nieistniejaca']);
      if (code !== 2) fail(`exit ${code} zamiast 2`);
      if (lines.length !== 1) fail(`${lines.length} linii zamiast jednej`);
      else if (!lines[0].startsWith('FAIL ')) fail(`linia bez prefiksu FAIL — ${lines[0]}`);
    },
  },
  {
    claim: 'browser-inspector: błąd fatalny środowiska to exit 2',
    where: 'README.md (Kody wyjścia batcha)',
    run(fail) {
      const missing = run(BI, [path.join(tmpdir(), 'nie-ma-takiego-configu.json')]);
      if (missing.code !== 2) fail(`brakujący config: exit ${missing.code} zamiast 2`);
      const unknown = run(BI, ['nieistniejaca-komenda']);
      if (unknown.code !== 2) fail(`nieznana komenda: exit ${unknown.code} zamiast 2`);
      if (unknown.lines.length !== 1) fail(`nieznana komenda: ${unknown.lines.length} linii zamiast jednej`);
    },
  },
  {
    claim: 'Komendy sesji wymagają keepera i bez niego kończą się nazwanym błędem, nie ciszą',
    where: 'AGENTS.md (blok browser-inspector) · README.md',
    run(fail) {
      const { code, lines } = run(BI, ['snap'], { BROWSER_INSPECTOR_DAEMON: '0' });
      if (code !== 2) fail(`exit ${code} zamiast 2`);
      if (lines.length !== 1) fail(`${lines.length} linii zamiast jednej`);
      else if (!lines[0].startsWith('FAIL keeper unavailable')) fail(`komunikat nie nazywa przyczyny — ${lines[0]}`);
    },
  },
  {
    // NOT checked against `browser-inspector help`: that listing is GENERATED from STEPS
    // (cli.mjs:452), so the two cannot disagree and an assertion on them would be a green light
    // that means nothing. RUNNERS is a second, hand-written table — that one can drift, and its
    // own file says it must not.
    claim: 'Object.keys(RUNNERS) === Object.keys(STEPS) — tabela kroków i tabela wykonawców',
    where: 'packages/browser-inspector/src/steps.run.mjs (nagłówek pliku)',
    run(fail) {
      for (const name of Object.keys(STEPS)) {
        if (!(name in RUNNERS)) fail(`krok "${name}" jest w STEPS, ale nie ma wykonawcy w RUNNERS`);
      }
      for (const name of Object.keys(RUNNERS)) {
        if (!(name in STEPS)) fail(`wykonawca "${name}" jest w RUNNERS, ale nie ma kroku w STEPS`);
      }
    },
  },
  {
    claim: '`browser-inspector help` wypisuje użycie i kategorie kroków, exit 0',
    where: 'README.md · AGENTS.md',
    run(fail) {
      const { code, text } = run(BI, ['help']);
      if (code !== 0) fail(`exit ${code} zamiast 0`);
      for (const kind of ['actions:', 'queries:', 'control:']) {
        if (!text.includes(kind)) fail(`brak kategorii ${kind}`);
      }
    },
  },
  {
    claim: 'Każdy krok ma własną pomoc — `browser-inspector help <krok>` ma co wypisać',
    where: 'packages/browser-inspector/src/steps.schema.mjs',
    run(fail) {
      for (const [name, step] of Object.entries(STEPS)) {
        if (typeof step.help !== 'string' || step.help.trim() === '') fail(`krok "${name}" nie ma tekstu pomocy`);
      }
    },
  },
  {
    // The size of CODE-INDEX.md is a NUMBER IN PROSE, which is the class of claim this repository
    // already guards for dependency versions (`check-pins`, rule LAG). It went stale the first time
    // the index grew: AGENTS.md still promised ~6 k while the file had become 8,5 k. A reader
    // budgets on that number, so it is a promise like any other.
    //
    // The unit is kB (1000 bytes), not tokens: `gpt-tokenizer` is gone and nothing here can count
    // tokens any more — the reasoning is at the top of `check-instruction-sync.mjs`. The tolerance
    // stays ± 10 % because the number's job is unchanged: it is read to decide "whole file or just
    // the part I need", and that decision does not turn on a percent.
    claim: 'Rozmiary plików czytanych na starcie sesji, podane w AGENTS.md, zgadzają się z nimi (± 10 %)',
    where: 'AGENTS.md (sekcja „Gdzie co jest")',
    run(fail) {
      const agents = readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
      for (const name of ['CODE-INDEX.md', 'GLOSSARY.md']) {
        // The figure must sit on the SAME line as the link: two files with two budgets share this
        // section, and a regex that scanned the whole document would compare one file's size with
        // the other's number and pass while lying.
        const line = agents.split('\n').find((l) => l.includes(`(${name})`) && l.includes('kB'));
        if (!line) {
          fail(`${name}: AGENTS.md nie podaje już rozmiaru w linii z odnośnikiem`);
          continue;
        }
        const stated = /≈\s*([\d,.]+)\s*kB/u.exec(line);
        if (!stated) {
          fail(`${name}: nie umiem odczytać liczby z linii „${line.trim()}"`);
          continue;
        }
        const promised = Number.parseFloat(stated[1].replace(',', '.')) * 1000;
        const actual = sizeInBytes(readFileSync(path.join(REPO, name), 'utf8'));
        const drift = Math.abs(actual - promised) / promised;
        if (drift > 0.1) {
          fail(`${name}: obiecane ${Math.round(promised)} B, jest ${actual} B (${Math.round(drift * 100)} % różnicy)`);
        }
      }
    },
  },
  {
    // The glossary's MEANINGS are written by a human and cannot be checked. Its MAPPINGS can: every
    // path must exist and every symbol must still be somewhere in the tree. That is what turns the
    // file from documentation, which rots in silence, into a claim that goes red on a rename.
    claim: 'Każde mapowanie w GLOSSARY.md wskazuje na istniejącą ścieżkę albo żywy symbol',
    where: 'GLOSSARY.md (kolumna „w kodzie")',
    run(fail) {
      const glossary = readFileSync(path.join(REPO, 'GLOSSARY.md'), 'utf8');
      const haystack = listSourceFiles(REPO)
        .map((rel) => readFileSync(path.join(REPO, rel), 'utf8'))
        .join('\n');
      let rows = 0;
      for (const line of glossary.split('\n')) {
        const cells = line.split('|');
        // A data row is `| termin | znaczenie | w kodzie | nie mów |`: six pieces around four cells.
        if (cells.length !== 6 || /^\s*-+\s*$/u.test(cells[1]) || cells[3].trim() === 'w kodzie') continue;
        rows++;
        for (const token of cells[3].matchAll(/`([^`]+)`/gu)) {
          const value = token[1];
          if (value.includes('/')) {
            if (!existsSync(path.join(REPO, value))) fail(`ścieżka nie istnieje: ${value}`);
          } else if (!new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u').test(haystack)) {
            fail(`symbol nie występuje w kodzie: ${value}`);
          }
        }
      }
      if (rows === 0) fail('nie znaleziono ani jednego wiersza — format tabeli się zmienił, asercja jest ślepa');
    },
  },
];

let failures = 0;
for (const claim of CLAIMS) {
  /** @type {string[]} */
  const why = [];
  claim.run((reason) => why.push(reason));
  if (why.length === 0) continue;
  failures += why.length;
  console.error(`FAIL ${claim.claim}`);
  console.error(`     obiecane w: ${claim.where}`);
  for (const reason of why) console.error(`     · ${reason}`);
}

if (failures > 0) {
  console.error(
    `\nclaims: ${failures} niezgodności — kod przestał robić to, co obiecuje proza. Napraw kod albo popraw zdanie.`,
  );
  process.exit(1);
}
console.log(`ok claims: ${CLAIMS.length} obietnic z prozy sprawdzonych na obu binarkach (bez przeglądarki, offline)`);
