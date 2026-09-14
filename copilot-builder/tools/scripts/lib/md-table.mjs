// md-table.mjs — one markdown table reader for the scripts that read or edit SDD tables (plan,
// run-log, review reports). A model editing a table by hand misaligns a pipe one time in ten; a
// script never does, so every table edit in the ladder goes through `sdd.mjs` and this file.
//
// Cells are trimmed and unescaped (`\|` inside a cell is a pipe, not a separator); `renderRow`
// escapes them back. Rows are rendered without column padding — padding is tokens a model pays for
// on every read and information nobody needs.

/** @typedef {{ start: number, end: number, header: string[], rows: string[][] }} Table */

/**
 * The cells of one markdown table row, trimmed, outer pipes dropped, `\|` unescaped.
 * @param {string} line
 * @returns {string[]}
 */
export function cells(line) {
  const trimmed = line.trim();
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const body = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  return body.split(/(?<!\\)\|/u).map((cell) => cell.trim().replaceAll('\\|', '|'));
}

/**
 * The first table whose lower-cased header `accept` approves. `start` is the header line index,
 * `end` the index of the first line after the table (so `lines.slice(start, end)` is the table).
 * @param {string} text
 * @param {(header: string[]) => boolean} accept
 * @returns {Table | null}
 */
export function parseTable(text, accept) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    const header = cells(lines[i]).map((cell) => cell.toLowerCase());
    if (!accept(header)) continue;
    /** @type {string[][]} */
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j += 1) rows.push(cells(lines[j]));
    return { start: i, end: j, header, rows };
  }
  return null;
}

/**
 * @param {readonly string[]} row
 * @returns {string}
 */
export const renderRow = (row) => `| ${row.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`;

/**
 * `text` with the body rows of `table` replaced (header and separator lines kept as they are).
 * @param {string} text
 * @param {Table} table
 * @param {readonly (readonly string[])[]} rows
 * @returns {string}
 */
export function replaceRows(text, table, rows) {
  const lines = text.split('\n');
  return [...lines.slice(0, table.start + 2), ...rows.map(renderRow), ...lines.slice(table.end)].join('\n');
}

/**
 * A list cell (`a, b, c`, backticks tolerated) → items; `—`, `-`, `n/a` and empty mean none.
 * @param {string} cell
 * @returns {string[]}
 */
export function listCell(cell) {
  return cell
    .replaceAll('`', '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '' && item !== '—' && item !== '-' && item.toLowerCase() !== 'n/a');
}
