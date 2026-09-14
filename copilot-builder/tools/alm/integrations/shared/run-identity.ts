/**
 * Identity of ONE run, for outbound attribution.
 *
 * Every request this repository sends already says WHAT is calling (`User-Agent`,
 * `X-Extract-Client`, `X-Extract-Version`, `X-Extract-Source`). This module adds WHO and
 * WHICH RUN:
 *
 *   - `X-Correlation-Id` — one id per process, so an upstream admin can group every
 *     request of a single extract/apply run in their logs. `EXTRACT_CORRELATION_ID` lets
 *     a caller (a CI job, an orchestrator) inject its own id instead; the same value goes
 *     into `_manifest.json`, which is what ties an upstream audit trail to a snapshot on
 *     disk.
 *   - `X-Extract-User` — the OS account that ran the tool. The token already identifies
 *     the API principal; this names the human/machine session behind it, which is the
 *     question an audit actually asks.
 *
 * Both values pass through {@link sanitizeHeaderValue} — even our own environment is not
 * trusted to be header-safe, because a CR/LF smuggled through an env var would otherwise
 * become header injection.
 */
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';

const MAX_HEADER_VALUE = 128;

/**
 * Printable ASCII only, no CR/LF, bounded length. Anything else becomes `_` — a mangled
 * username in a log line beats a rejected request or an injected header.
 */
export function sanitizeHeaderValue(value: string): string {
  return [...value]
    .map((ch) => (ch >= ' ' && ch <= '~' ? ch : '_'))
    .join('')
    .trim()
    .slice(0, MAX_HEADER_VALUE);
}

let correlationId: string | undefined;

/**
 * One id per PROCESS, memoized: every request of a run — and the run's manifest — must
 * carry the SAME id, or correlation stops correlating.
 */
export function getCorrelationId(env: Record<string, string | undefined> = process.env): string {
  if (correlationId === undefined) {
    const supplied = env['EXTRACT_CORRELATION_ID']?.trim();
    correlationId = supplied ? sanitizeHeaderValue(supplied) : randomUUID();
  }
  return correlationId;
}

/** Test seam only — the memo would otherwise couple tests to their execution order. */
export function resetCorrelationIdForTests(): void {
  correlationId = undefined;
}

let runUser: string | undefined;

/**
 * The OS account running the tool. `userInfo()` can throw on exotic setups (no home, no
 * passwd entry) — the env fallback keeps attribution best-effort instead of fatal, because
 * failing an extraction over a username would invert the priorities.
 *
 * Memoized like the correlation id, for the same contract (ONE identity per run): the
 * header builder calls this on every request, retry and redirect hop, and re-deriving
 * paid a syscall plus a character scan ~40k times per big run — and let a mid-run
 * `userInfo()` failure silently flip attribution to the env fallback partway through.
 */
export function getRunUser(): string {
  if (runUser !== undefined) return runUser;
  try {
    const name = userInfo().username;
    if (name) {
      runUser = sanitizeHeaderValue(name);
      return runUser;
    }
  } catch {
    // fall through to the environment
  }
  runUser = sanitizeHeaderValue(process.env['USERNAME'] ?? process.env['USER'] ?? 'unknown');
  return runUser;
}
