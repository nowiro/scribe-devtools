// display-command.mjs — how a spawned command is echoed to a human: `node` for the running Node
// binary (its absolute path is noise and differs per machine), repository-relative paths for anything
// under the repository, everything else verbatim. Shared by verify.mjs and affected.mjs so that a
// "reproduce:" line pastes back into a terminal at the repository root.
import path from 'node:path';

/**
 * @param {string} part one argv element
 * @param {string} repo absolute repository root
 * @returns {string}
 */
export function displayPart(part, repo) {
  if (part === process.execPath) return 'node';
  if (!path.isAbsolute(part)) return part;
  const relative = path.relative(repo, part);
  return relative === '' || relative.startsWith('..') ? part : relative.split(path.sep).join('/');
}

/**
 * @param {readonly string[]} command argv, program first
 * @param {string} repo absolute repository root
 * @returns {string}
 */
export function displayCommand(command, repo) {
  return command.map((part) => displayPart(part, repo)).join(' ');
}
