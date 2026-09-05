// check-upstream.mjs — the calendar half of the currency doctrine.
//
// `check-pins.mjs` is offline and deterministic: it answers "does the repository agree with
// itself" and is the first step of `npm run verify`. This script answers a different question —
// "is what we declared still what upstream calls `latest`, and for how long has it not been" — and
// that question needs the network. It is therefore NOT part of `verify`: a gate that depends on
// npm's registry being reachable is a gate that goes red on a train. Run it by hand, or with
// `--strict` at release time (docs/MAINTAINING.md § Wydanie), where a stale pin should actually block.
//
//   node scripts/check-upstream.mjs                report only, exit 0 regardless
//   node scripts/check-upstream.mjs --strict        exit 1 if any pin is stale past its staleDays
//   node scripts/check-upstream.mjs --ack <id|all>  a human looked and is choosing to stay behind —
//                                                    restart that pin's clock from today
//
// THE CLOCK. Staleness is measured from `firstSeenBehind`, not from how long ago upstream
// published `latest` — that resets to zero on every release regardless of whether we are one
// version behind or ten, so a package that ships every three days would never look stale by that
// measure. `firstSeenBehind` is the first time THIS script noticed the pin behind, and it lives in
// `scripts/upstream-state.json` — committed, so the clock survives across days and machines.
// Catching up to `latest` deletes the entry; the clock for the NEXT time we fall behind starts
// fresh. A WARN does not mean "you did something wrong" — `@types/node` is pinned to major 22 on
// purpose (`pins.config.mjs`'s own `why` says so) and will warn every `staleDays` forever. It means
// "a human should look again", and `--ack` is how a human records having done that: it is not a
// bump, it is a decision, and the state file is where that decision is committed.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareVersion, compareVersions, discoverManifests, readDeclarations } from './check-pins.mjs';
import { PINS } from './pins.config.mjs';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const STATE_FILE = path.join(REPO, 'scripts', 'upstream-state.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const REGISTRY_TIMEOUT_MS = 8000;

/** @typedef {{ firstSeenBehind: string, lastChecked: string, atCheck: string, latestAtCheck: string }} StateEntry */
/** @typedef {Record<string, StateEntry>} State */

/**
 * `dist-tags.latest` from the npm registry, or null on ANY failure — offline, timeout, a renamed
 * or unpublished package, a malformed response. A network hiccup must read as "could not check
 * this one", never as "package removed" or "0.0.0".
 * @param {string} id
 * @returns {Promise<string | null>}
 */
export async function fetchLatest(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  try {
    const url = `https://registry.npmjs.org/${id.replace('/', '%2F')}`;
    const res = await fetch(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const latest = json?.['dist-tags']?.latest;
    return typeof latest === 'string' && latest !== '' ? latest : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whole days between two epoch-ms instants, floored — "how many full days has this been true".
 * @param {number} earlierMs
 * @param {number} laterMs
 * @returns {number}
 */
export function daysBetween(earlierMs, laterMs) {
  return Math.max(0, Math.floor((laterMs - earlierMs) / DAY_MS));
}

/** @param {number} ms @returns {string} */
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The next state entry for one pin, given what this check just observed. Pure — no clock, no I/O —
 * so the clock-survives-across-runs behaviour is testable without waiting real days.
 * @param {StateEntry | undefined} previous
 * @param {object} observed
 * @param {boolean} observed.behind
 * @param {string} observed.current
 * @param {string} observed.latest
 * @param {number} observed.nowMs
 * @returns {StateEntry | undefined} undefined means "delete the entry" (the pin caught up)
 */
export function nextState(previous, { behind, current, latest, nowMs }) {
  if (!behind) return undefined;
  const firstSeenBehind = previous?.firstSeenBehind ?? isoDate(nowMs);
  return { firstSeenBehind, lastChecked: isoDate(nowMs), atCheck: current, latestAtCheck: latest };
}

/**
 * One pin's verdict: current vs. latest, whether it is behind, and — if a state entry exists — how
 * many days it has been behind and whether that has crossed `staleDays`.
 * @typedef {object} Verdict
 * @property {string} id
 * @property {string | null} current null when the manifest could not be read
 * @property {string | null} latest null when the registry could not be reached
 * @property {boolean} behind
 * @property {number | null} daysBehind null when there is no state entry yet (just noticed)
 * @property {boolean} stale daysBehind >= pin.staleDays
 * @property {number} staleDays the pin's own threshold, carried along for the report line
 * @property {string} note human-readable, used when current/latest could not be determined
 */

/**
 * @param {import('./pins.config.mjs').Pin} pin
 * @param {object} options
 * @param {string | null} options.current
 * @param {string | null} options.latest
 * @param {StateEntry | undefined} options.state the entry BEFORE this check (for daysBehind)
 * @param {number} options.nowMs
 * @returns {Verdict}
 */
export function evaluatePin(pin, { current, latest, state, nowMs }) {
  const base = { id: pin.id, staleDays: pin.staleDays };
  if (current === null) {
    return {
      ...base,
      current,
      latest,
      behind: false,
      daysBehind: null,
      stale: false,
      note: 'nie udało się odczytać przypiętej wersji',
    };
  }
  if (latest === null) {
    return {
      ...base,
      current,
      latest,
      behind: false,
      daysBehind: null,
      stale: false,
      note: 'rejestr npm nieosiągalny — spróbuj ponownie',
    };
  }
  const behind = compareVersions(current, latest) < 0;
  if (!behind) return { ...base, current, latest, behind: false, daysBehind: null, stale: false, note: '' };
  const since = state?.firstSeenBehind;
  const daysBehind = since === undefined ? 0 : daysBetween(Date.parse(`${since}T00:00:00Z`), nowMs);
  return { ...base, current, latest, behind: true, daysBehind, stale: daysBehind >= pin.staleDays, note: '' };
}

/**
 * The whole check: resolve every pin's declared version, fetch `latest` for each (via the injected
 * `fetchLatest`, so tests never touch the network), evaluate against the PREVIOUS state, and
 * compute the NEXT state to persist.
 * @param {object} options
 * @param {string} options.root
 * @param {State} options.previousState
 * @param {(id: string) => Promise<string | null>} [options.fetch]
 * @param {number} [options.nowMs]
 * @param {readonly import('./pins.config.mjs').Pin[]} [options.pins]
 * @returns {Promise<{ verdicts: Verdict[], nextState: State }>}
 */
export async function checkUpstream({
  root,
  previousState,
  fetch: fetchImpl = fetchLatest,
  nowMs = Date.now(),
  pins = PINS,
}) {
  const manifests = discoverManifests(root);
  const byId = readDeclarations(root, manifests);

  const verdicts = await Promise.all(
    pins.map(async (pin) => {
      const declared = byId.get(pin.id)?.find((d) => d.where === pin.owner)?.spec ?? null;
      const current = declared === null ? null : bareVersion(declared);
      const latest = await fetchImpl(pin.id);
      return evaluatePin(pin, { current, latest, state: previousState[pin.id], nowMs });
    }),
  );

  /** @type {State} */
  const next = {};
  for (const verdict of verdicts) {
    if (verdict.current === null || verdict.latest === null) {
      // Could not determine one side this run — carry the existing entry forward unchanged rather
      // than guessing, so a single network blip does not reset or erase a real staleness clock.
      const carried = previousState[verdict.id];
      if (carried) next[verdict.id] = carried;
      continue;
    }
    const entry = nextState(previousState[verdict.id], {
      behind: verdict.behind,
      current: verdict.current,
      latest: verdict.latest,
      nowMs,
    });
    if (entry) next[verdict.id] = entry;
  }
  return { verdicts, nextState: next };
}

/**
 * `--ack <id>`: a human reviewed a stale pin and is choosing, right now, to stay behind. Restarts
 * ONLY that pin's clock (today becomes the new `firstSeenBehind`) — it is not a bump, and it does
 * nothing to a pin that is not currently behind (there is nothing to acknowledge).
 * @param {State} state
 * @param {Verdict[]} verdicts
 * @param {string} id `'all'` acknowledges every currently-behind pin
 * @param {number} nowMs
 * @returns {{ state: State, acknowledged: string[] }}
 */
export function acknowledge(state, verdicts, id, nowMs) {
  /** @type {State} */
  const out = { ...state };
  /** @type {string[]} */
  const acknowledged = [];
  for (const verdict of verdicts) {
    if (id !== 'all' && verdict.id !== id) continue;
    if (!verdict.behind || verdict.current === null || verdict.latest === null) continue;
    out[verdict.id] = {
      firstSeenBehind: isoDate(nowMs),
      lastChecked: isoDate(nowMs),
      atCheck: verdict.current,
      latestAtCheck: verdict.latest,
    };
    acknowledged.push(verdict.id);
  }
  return { state: out, acknowledged };
}

/** @param {string} file @returns {State} */
function readStateFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** @param {string} file @param {State} state */
function writeStateFile(file, state) {
  const sorted = /** @type {State} */ ({});
  for (const key of Object.keys(state).sort((a, b) => a.localeCompare(b, 'en'))) sorted[key] = state[key];
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/**
 * One report line per pin, in the style `check-pins.mjs` already uses.
 * @param {Verdict} verdict
 * @returns {string}
 */
function reportLine(verdict) {
  if (verdict.note !== '') return `  ? ${verdict.id}: ${verdict.note}`;
  if (!verdict.behind) return `  ok ${verdict.id}: ${verdict.current} = latest`;
  const days = verdict.daysBehind ?? 0;
  const mark = verdict.stale ? 'WARN' : 'ok';
  return `  ${mark} ${verdict.id}: ${verdict.current} → ${verdict.latest} dostępne, za latest od ${String(days)} dni (próg ${String(verdict.staleDays)})`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const ackIndex = args.indexOf('--ack');
  const ackId = ackIndex === -1 ? null : (args[ackIndex + 1] ?? null);

  const previousState = readStateFile(STATE_FILE);
  const first = await checkUpstream({ root: REPO, previousState });

  let { verdicts, nextState: state } = first;
  if (ackId !== null) {
    const result = acknowledge(previousState, verdicts, ackId, Date.now());
    state = result.state;
    if (result.acknowledged.length === 0) {
      process.stdout.write(`--ack ${ackId}: nic do potwierdzenia (nie jest za latest albo nieznane id)\n`);
    } else {
      process.stdout.write(`--ack: zresetowano zegar dla ${result.acknowledged.join(', ')}\n`);
    }
    // The printed report should show the RESET clock, not the pre-ack one — a reset always lands
    // at zero days (today minus today), so the new daysBehind is known without re-fetching anything.
    verdicts = verdicts.map((v) => (result.acknowledged.includes(v.id) ? { ...v, daysBehind: 0, stale: false } : v));
  }

  writeStateFile(STATE_FILE, state);

  const stale = verdicts.filter((v) => v.stale);
  const unknown = verdicts.filter((v) => v.note !== '');
  const ok = stale.length === 0;
  const headline = ok
    ? `ok upstream: ${String(verdicts.length)} pinów sprawdzonych, ${String(unknown.length)} nieosiągalnych, żaden nie przekroczył progu staleDays`
    : `WARN upstream: ${String(stale.length)}/${String(verdicts.length)} pinów za latest dłużej niż ich staleDays`;
  process.stdout.write(`${headline}\n`);
  for (const v of verdicts) process.stdout.write(`${reportLine(v)}\n`);

  process.exitCode = strict && !ok ? 1 : 0;
}
