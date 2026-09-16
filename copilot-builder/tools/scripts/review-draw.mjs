#!/usr/bin/env node
// review-draw.mjs — which seats read THIS change: `review.seatsPerReview` seats of the `review.seats`
// pool, drawn at random (0 credits).
//
//   node tools/scripts/review-draw.mjs <katalog>   one line per drawn seat, `<agent>  <rodzina>`, in
//                                                   registry order; the draw is recorded in <katalog>/draw.json
//
// The pool holds more families than one review pays for: every review reads `seatsPerReview` seats, so
// the cost of a review is constant whatever the pool size, and the vendor mix rotates between reviews
// instead of being the same names every time. The draw is a script, not a choice of the orchestrator —
// a model asked to pick "at random" picks the first names it remembers — and it is RECORDED:
// review-merge reads draw.json as the list of families that owe a report, so a missing seat is named in
// the merged table, never averaged away.
//
// A second run over a directory that already holds draw.json reprints the recorded draw and draws
// nothing: the briefs may already be out, and a new draw would make the reports and the expectation
// disagree. To draw again, remove the file — a decision for a human.
//
// The target must NOT be a committed docs category (docs/decisions, docs/reviews): those are policed
// by sdd:check (C1) and a directory can never satisfy its `<stamp>_<slug>.md` naming, so the draw is
// refused up front instead of failing later in a gate that talks about naming rather than the draw.
// The working directory belongs in docs/runs/, and review:merge --out writes the merged report into
// docs/reviews/ (orchestrator.agent.md).
//
// Exit codes: 0 drawn (or the recorded draw reprinted) · 2 usage error, or a registry `ai:validate`
// (A18 / A20) would refuse.
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COMMITTED_DOCS, REPO, isMain } from './lib/repo.mjs';
import { nowStamp } from './stamp.mjs';

/** The record of one draw, written next to the seat reports. */
export const DRAW_FILE = 'draw.json';

/**
 * @typedef {object} Draw
 * @property {string} drawnAt `YYYY-MM-DD_HH-MM` stamp of the draw
 * @property {number} seatsPerReview how many seats the registry asked for
 * @property {string[]} pool every family of `review.seats`, registry order
 * @property {Record<string, string>} seats the drawn seat agents → their families, registry order
 */

/**
 * The review block of the registry: the pool (seat agent → family, registry order) and how many seats
 * one review uses.
 * @param {string} [repo]
 * @returns {{ seats: [string, string][], seatsPerReview: number }}
 */
export function reviewPool(repo = REPO) {
  const registry = JSON.parse(readFileSync(path.join(repo, '.github', 'models-registry.json'), 'utf8'));
  /** @type {[string, string][]} */
  const seats = Object.entries(registry.review?.seats ?? {}).map(([seat, family]) => [seat, String(family)]);
  return { seats, seatsPerReview: Number(registry.review?.seatsPerReview) };
}

/**
 * `count` of `items`, drawn without replacement and returned in their ORIGINAL order — the merge orders
 * families the way the registry does, so the draw keeps that order too. `random(n)` gives an integer in
 * `[0, n)`; injected so a test can pin the draw.
 * @template T
 * @param {readonly T[]} items
 * @param {number} count
 * @param {(max: number) => number} [random]
 * @returns {T[]}
 */
export function drawSeats(items, count, random = randomInt) {
  const indexes = items.map((_, index) => index);
  // Partial Fisher–Yates: after `count` swaps the first `count` positions hold a uniform sample.
  for (let i = 0; i < count && i < indexes.length; i += 1) {
    const j = i + random(indexes.length - i);
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((index) => items[index]);
}

/**
 * The draw recorded in `file`, or null when there is none.
 * @param {string} file absolute or relative path of a draw.json
 * @returns {Draw | null}
 */
export function readDraw(file) {
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return {
    drawnAt: String(raw.drawnAt ?? ''),
    seatsPerReview: Number(raw.seatsPerReview),
    pool: (raw.pool ?? []).map(String),
    seats: Object.fromEntries(Object.entries(raw.seats ?? {}).map(([seat, family]) => [seat, String(family)])),
  };
}

/**
 * The draw for `dir`: the one already recorded there, or a fresh one written to `dir/draw.json`.
 * @param {string} dir the review run directory (created when missing)
 * @param {{ repo?: string, random?: (max: number) => number, now?: Date }} [options]
 * @returns {{ draw: Draw, recorded: boolean }} `recorded`: an earlier draw was reused, nothing was drawn
 */
export function drawForDirectory(dir, { repo = REPO, random = randomInt, now = new Date() } = {}) {
  const file = path.join(dir, DRAW_FILE);
  const existing = readDraw(file);
  if (existing !== null) return { draw: existing, recorded: true };
  const { seats, seatsPerReview } = reviewPool(repo);
  if (!Number.isInteger(seatsPerReview) || seatsPerReview < 2 || seatsPerReview > seats.length) {
    throw new Error(
      `review.seatsPerReview is ${seatsPerReview} and the pool has ${seats.length} seats — run npm run ai:validate (A20)`,
    );
  }
  /** @type {Draw} */
  const draw = {
    drawnAt: nowStamp(now),
    seatsPerReview,
    pool: seats.map(([, family]) => family),
    seats: Object.fromEntries(drawSeats(seats, seatsPerReview, random)),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(draw, null, 2)}\n`, 'utf8');
  return { draw, recorded: false };
}

/**
 * One line per drawn seat: the agent (padded), two spaces, its family — what the orchestrator copies
 * into the briefs and the plan.
 * @param {Draw} draw
 * @returns {string}
 */
export function formatDraw(draw) {
  const entries = Object.entries(draw.seats);
  const width = Math.max(1, ...entries.map(([seat]) => seat.length));
  return `${entries.map(([seat, family]) => `${seat.padEnd(width)}  ${family}`).join('\n')}\n`;
}

/**
 * The committed `docs/` category a target directory would land in, or null when it lands anywhere
 * else. Exact segment match, so `docs/reviewsomething` is not `docs/reviews`, and a path outside the
 * repository answers null because `path.relative` then starts with `..`.
 * @param {string} dir as typed on the command line
 * @param {string} [repo]
 * @returns {string | null}
 */
export function committedCategoryFor(dir, repo = REPO) {
  const [docs, category] = path.relative(repo, path.resolve(repo, dir)).replaceAll('\\', '/').split('/');
  return docs === 'docs' && COMMITTED_DOCS.includes(category) ? category : null;
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function runCli(argv) {
  const dir = argv.find((arg) => !arg.startsWith('--'));
  if (dir === undefined) {
    process.stderr.write('usage: review:draw <katalog>\n');
    return 2;
  }
  if (existsSync(dir) && !statSync(dir).isDirectory()) {
    process.stderr.write(`review:draw: ${dir} is not a directory\n`);
    return 2;
  }
  // A draw directory under docs/decisions or docs/reviews is accepted by every step here and then
  // fails two steps later, in a gate that talks about something else: sdd:check (C1) requires every
  // entry of those directories to be named `YYYY-MM-DD_HH-MM_<slug>.md`, which a directory can never
  // be, so the message names the naming rule and says nothing about the draw. Refusing up front, at
  // the moment the wrong path is typed, is the difference between one honest error and a confusing
  // one — and the seat reports are not written yet, so nothing is lost by stopping here.
  const committed = committedCategoryFor(dir);
  if (committed !== null) {
    process.stderr.write(
      `review:draw: docs/${committed}/ holds committed artefacts that sdd:check (C1) requires to be named ` +
        `YYYY-MM-DD_HH-MM_<slug>.md, so a draw directory there cannot pass. Draw into ` +
        `docs/runs/<stempel>_review-<slug> and let review:merge --out write the merged report into ` +
        `docs/${committed}/.\n`,
    );
    return 2;
  }
  try {
    const { draw, recorded } = drawForDirectory(dir);
    const file = path.join(dir, DRAW_FILE);
    const count = Object.keys(draw.seats).length;
    process.stdout.write(formatDraw(draw));
    process.stdout.write(
      recorded
        ? `ok review:draw · losowanie z ${draw.drawnAt} zachowane: ${count} z ${draw.pool.length} miejsc · ${file}\n`
        : `ok review:draw · ${count} z ${draw.pool.length} miejsc → ${file}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`review:draw: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (isMain(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
