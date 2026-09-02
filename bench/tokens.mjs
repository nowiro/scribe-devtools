// tokens.mjs — token counting. There is no public tokenizer for Claude, so the bench counts
// o200k_base (GPT-4o): a PROXY, not the exact number for any given model. It is enough for this
// comparison, because both sides are measured with the same ruler and the result is a ratio, not
// an absolute. Bytes are reported next to tokens for the record.
import { encode } from 'gpt-tokenizer/encoding/o200k_base';

/** @param {string} text */
export const countTokens = (text) => encode(text).length;

/** @param {string} text */
export const bytesOf = (text) => Buffer.byteLength(text, 'utf8');

/**
 * One measured item: what it was, how many bytes, how many tokens.
 * @param {string} label
 * @param {string} text
 */
export const measure = (label, text) => ({ label, bytes: bytesOf(text), tokens: countTokens(text) });

/** @param {{ tokens: number, bytes: number }[]} items */
export const total = (items) => ({
  bytes: items.reduce((sum, item) => sum + item.bytes, 0),
  tokens: items.reduce((sum, item) => sum + item.tokens, 0),
});

/** Polish thousands separator (a narrow space), the way the reports print numbers. */
export const fmt = (n) => Math.round(n).toLocaleString('pl-PL');
