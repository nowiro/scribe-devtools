/**
 * stamp.mjs — reading the `YYYY-MM-DD_HH-MM` stamp out of an artifact name.
 *
 * The stamp carries no timezone, and `new Date('2026-07-27T09:52:00')` reads it in the
 * READER's zone. While artifacts were written and checked on one machine nobody noticed.
 * On a UTC runner every artifact freshly stamped in Poland looked like it came from the
 * FUTURE for two hours — the gate rejected documentation for having been written in a
 * different timezone than the machine checking it.
 *
 * So the stamp is interpreted in an EXPLICITLY DECLARED workshop timezone rather than in
 * the process timezone. Moving the author to another zone is a change to this constant,
 * not a riddle in the CI log.
 */
import { isMain } from './lib/repo.mjs';

/** Timezone the artifact stamps of this repository are written in. */
export const STAMP_TIMEZONE = 'Europe/Warsaw';

/**
 * Naive stamp → instant (epoch ms).
 *
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {string} [timeZone]
 * @returns {number}
 */
export function stampToEpoch(year, month, day, hour, minute, timeZone = STAMP_TIMEZONE) {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);
  return asIfUtc - zoneOffsetMs(asIfUtc, timeZone);
}

/**
 * Offset of the zone from UTC at a given instant (ms).
 *
 * Computed through `Intl`, so DST needs no rule table. The single-step approximation is
 * off by an hour only for stamps landing inside the changeover itself, where the gate's
 * tolerance already exceeds the error.
 *
 * @param {number} epoch
 * @param {string} timeZone
 * @returns {number}
 */
function zoneOffsetMs(epoch, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epoch));

  const at = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const local = Date.UTC(
    Number(at.year),
    Number(at.month) - 1,
    Number(at.day),
    Number(at.hour) % 24,
    Number(at.minute),
    Number(at.second),
  );

  return local - epoch;
}

/**
 * The current instant as a `YYYY-MM-DD_HH-MM` stamp in the workshop timezone — the inverse of
 * `stampToEpoch`, used by every script that NAMES an artifact. One writer and one reader of the same
 * convention, in one file, so the two cannot drift apart.
 *
 * @param {Date} [now]
 * @param {string} [timeZone]
 * @returns {string}
 */
export function nowStamp(now = new Date(), timeZone = STAMP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const at = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = String(Number(at.hour) % 24).padStart(2, '0');
  return `${at.year}-${at.month}-${at.day}_${hour}-${at.minute}`;
}

// `npm run stamp`: the current stamp on stdout, so an agent never types a node -e one-liner for it.
if (isMain(import.meta.url)) process.stdout.write(`${nowStamp()}\n`);
