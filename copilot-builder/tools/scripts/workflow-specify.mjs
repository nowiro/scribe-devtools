#!/usr/bin/env node
// workflow-specify.mjs — the deterministic "specify" step of the SDD ladder (0 credits).
//
// A spec, a plan and a run-log are three files with a fixed shape; an agent asked to "create the
// SDD artefacts" would spend tokens re-inventing that shape and get it slightly different each time.
// This script emits the three files from docs/sdd/templates/ and leaves the agent exactly one job:
// filling in the content, with `[?]` wherever it does not know.
//
//   npm run workflow:specify -- --verb=<feature|fix|refactor|deps|chore|security|docs> --slug=<kebab> [--title="…"]
//
// Emits (all three LOCAL-ONLY — docs/specs, docs/plans and docs/runs are gitignored by policy):
//   docs/specs/<slug>/spec.md                 status: draft, `[?]` markers for /clarify
//   docs/plans/<STAMP>_<verb>-<slug>.md       task table `| id | title | agent | done_when | status |`
//   docs/runs/<STAMP>_<slug>.md               the run-log the orchestrator appends to
//
// Never overwrites: an existing slug gets `-v2`, `-v3`, … — a new iteration has its own artefacts.
// The stamp is the real clock in the declared workshop timezone (tools/scripts/stamp.mjs), because
// `sdd:check` rejects artefacts dated in the future.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowStamp } from './stamp.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const VERBS = Object.freeze(['feature', 'fix', 'refactor', 'deps', 'chore', 'security', 'docs']);
const USAGE = 'usage: npm run workflow:specify -- --verb=<verb> --slug=<kebab-slug> [--title="Human title"]';

/**
 * `--key=value` and `--key value` pairs; a bare `--flag` is `true`.
 * @param {string[]} argv
 * @returns {Record<string, string | true>}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | true>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const match = /^--([\w-]+)(?:=(.*))?$/u.exec(arg);
    if (!match) continue;
    if (match[2] !== undefined) out[match[1]] = match[2];
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[match[1]] = argv[++i];
    else out[match[1]] = true;
  }
  return out;
}

/**
 * @param {{ verb: string, slug: string, title?: string, repo?: string, stamp?: string }} input
 * @returns {{ code: number, lines: string[], files: string[] }}
 */
export function specify({ verb, slug, title, repo = REPO, stamp = nowStamp() }) {
  const lines = [];
  if (!VERBS.includes(verb))
    return { code: 2, lines: [`--verb must be one of: ${VERBS.join(', ')} (got "${verb}")`, USAGE], files: [] };
  if (!/^[a-z][a-z0-9-]*$/u.test(slug))
    return { code: 2, lines: [`--slug must be kebab-case (got "${slug}")`, USAGE], files: [] };

  let effectiveSlug = slug;
  if (existsSync(path.join(repo, 'docs', 'specs', slug))) {
    let version = 2;
    while (existsSync(path.join(repo, 'docs', 'specs', `${slug}-v${version}`))) version += 1;
    effectiveSlug = `${slug}-v${version}`;
    lines.push(`slug "${slug}" already has a spec — this iteration is "${effectiveSlug}"`);
  }
  const date = stamp.slice(0, 10);
  const fill = (/** @type {string} */ text) =>
    text
      .replaceAll('{{slug}}', effectiveSlug)
      .replaceAll('{{verb}}', verb)
      .replaceAll('{{title}}', title ?? effectiveSlug)
      .replaceAll('{{date}}', date)
      .replaceAll('{{stamp}}', stamp);

  const outputs = [
    ['docs/sdd/templates/spec.md', `docs/specs/${effectiveSlug}/spec.md`],
    ['docs/sdd/templates/plan.md', `docs/plans/${stamp}_${verb}-${effectiveSlug}.md`],
    ['docs/sdd/templates/run.md', `docs/runs/${stamp}_${effectiveSlug}.md`],
  ];
  /** @type {string[]} */
  const files = [];
  for (const [templateRel, targetRel] of outputs) {
    const templatePath = path.join(repo, templateRel);
    if (!existsSync(templatePath)) return { code: 1, lines: [`template missing: ${templateRel}`], files };
    const targetPath = path.join(repo, targetRel);
    if (existsSync(targetPath)) {
      lines.push(`exists, kept: ${targetRel}`);
      continue;
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, fill(readFileSync(templatePath, 'utf8')), 'utf8');
    files.push(targetRel);
    lines.push(`wrote ${targetRel}`);
  }
  lines.push(
    '',
    `task ${stamp}_${effectiveSlug} · next: fill the spec, then /clarify ${effectiveSlug} → /plan → /analyze → implement → /review → npm run verify`,
  );
  return { code: 0, lines, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  const verb = typeof args.verb === 'string' ? args.verb : '';
  const slug = typeof args.slug === 'string' ? args.slug : '';
  if (verb === '' || slug === '') {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
  } else {
    const { code, lines } = specify({ verb, slug, title: typeof args.title === 'string' ? args.title : undefined });
    (code === 0 ? process.stdout : process.stderr).write(`${lines.join('\n')}\n`);
    process.exitCode = code;
  }
}
