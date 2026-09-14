/**
 * http-log — JSONL z KAŻDĄ próbą żądania HTTP i jej odpowiedzią, w osobnym pliku
 * per przebieg. Audyt i debug: retry są widoczne jako osobne linie, `correlationId`
 * spina log z nagłówkiem `x-correlation-id` po stronie upstreamu i z `_manifest.json`.
 *
 * Dwie zasady, na których stoi ten moduł:
 *
 *  1. SEKRET NIE MOŻE TU WPŁYNĄĆ Z KONSTRUKCJI. Budowniczy wpisu przyjmuje wyłącznie
 *     pola wyliczone (metoda, URL, status, czasy, rozmiary, pierwsza linia błędu) —
 *     nagłówków żądania NIE przyjmuje wcale, więc wartość `authorization` nie ma
 *     którędy wyciec. Zestaw kluczy wpisu jest przypięty testem (whitelist).
 *  2. ZŁAMANY LOG NIE ŁAMIE PRZEBIEGU. Ekstrakcja jest produktem, log jest śladem —
 *     błąd zapisu ostrzega RAZ i cichnie, zamiast wywracać snapshot.
 *
 * Plik: `<EXTRACT_HTTP_LOG_DIR | ./.alm/http-log>/<skrypt>-<stempel>-<pid>.jsonl`
 * — katalog `.alm/` jest gitignorowany jak każde dane klienta. Wyłączenie:
 * `EXTRACT_HTTP_LOG=0` (np. przebiegi masowe, gdzie ślad nie jest potrzebny).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Wynik jednej próby — dokładnie to, co wolno zapisać, i nic więcej. */
export interface HttpLogEntry {
  readonly ts: string;
  readonly script: string;
  readonly correlationId: string;
  /** Numer próby od 1 — retry to kolejne linie z tym samym żądaniem. */
  readonly attempt: number;
  readonly method: string;
  readonly url: string;
  readonly requestBytes?: number;
  readonly status?: number;
  readonly durationMs: number;
  readonly responseBytes?: number;
  readonly outcome: 'ok' | 'error';
  /** Pierwsza linia komunikatu — bez stack trace'ów i bez ciał odpowiedzi. */
  readonly error?: string;
}

export interface HttpLogAttempt {
  readonly script: string;
  readonly correlationId: string;
  readonly attempt: number;
  readonly method: string;
  readonly url: string;
  readonly requestBytes?: number;
  readonly status?: number;
  readonly durationMs: number;
  readonly responseBytes?: number;
  readonly error?: unknown;
}

/** Czysty budowniczy wpisu — bez I/O, przypięty testami (w tym whitelistą kluczy). */
export function httpLogEntry(attempt: HttpLogAttempt, now: Date = new Date()): HttpLogEntry {
  const firstLine = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
  return {
    ts: now.toISOString(),
    script: attempt.script,
    correlationId: attempt.correlationId,
    attempt: attempt.attempt,
    method: attempt.method,
    url: attempt.url,
    ...(attempt.requestBytes !== undefined ? { requestBytes: attempt.requestBytes } : {}),
    ...(attempt.status !== undefined ? { status: attempt.status } : {}),
    durationMs: attempt.durationMs,
    ...(attempt.responseBytes !== undefined ? { responseBytes: attempt.responseBytes } : {}),
    outcome: attempt.error === undefined ? 'ok' : 'error',
    ...(attempt.error !== undefined ? { error: firstLine(attempt.error) } : {}),
  };
}

export interface HttpLogger {
  readonly log: (attempt: HttpLogAttempt) => void;
  /** Ścieżka pliku — do komunikatów i testów; undefined, gdy log wyłączony. */
  readonly file: string | undefined;
}

const DISABLED: HttpLogger = { log: () => undefined, file: undefined };

/** Stempel do nazwy pliku — bez dwukropków, sortowalny leksykograficznie. */
const fileStamp = (now: Date): string => now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * Logger per przebieg. Katalog i plik powstają leniwie przy PIERWSZYM wpisie —
 * klient HTTP bywa tworzony w przebiegach, które nie wykonują żadnego żądania,
 * i nie powinny zostawiać pustych plików.
 */
export function createHttpLogger(scriptName: string, env: NodeJS.ProcessEnv = process.env): HttpLogger {
  if (env['EXTRACT_HTTP_LOG'] === '0') return DISABLED;
  const dir = resolve(env['EXTRACT_HTTP_LOG_DIR'] ?? './.alm/http-log');
  const file = join(dir, `${scriptName}-${fileStamp(new Date())}-${String(process.pid)}.jsonl`);
  let ready = false;
  let broken = false;
  return {
    file,
    log: (attempt) => {
      if (broken) return;
      try {
        if (!ready) {
          mkdirSync(dir, { recursive: true });
          ready = true;
        }
        appendFileSync(file, `${JSON.stringify(httpLogEntry(attempt))}\n`, 'utf8');
      } catch (error) {
        // Raz i cicho: log jest śladem, nie produktem — przebieg ekstrakcji ma przeżyć
        // pełny dysk czy katalog tylko-do-odczytu, a operator ma wiedzieć dlaczego.
        broken = true;
        console.warn(
          `[${scriptName}] http-log wyłączony po błędzie zapisu (${error instanceof Error ? error.message : String(error)}) — przebieg trwa dalej`,
        );
      }
    },
  };
}
