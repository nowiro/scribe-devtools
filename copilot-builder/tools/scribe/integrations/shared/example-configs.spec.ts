/**
 * Every `examples/read.config.<source>.json` shipped in the repository is
 * parsed here with the real schema of its pipeline.
 *
 * The point is rot, not correctness-on-the-day-it-was-written. These files are
 * what a new user copies, and the schemas are strict — so a field renamed in a
 * pipeline turns its example into a file that fails on first run, with an error
 * pointing at the user's config rather than at ours. Nothing else in the suite
 * would notice, because nothing else reads them.
 *
 * The examples also have to keep covering every snapshot type: the type union is
 * the part of these configs a reader cannot guess.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { ReadConfig as ConfluenceConfig } from '../confluence/read-confluence.js';
import { ReadConfig as FigmaConfig } from '../figma/read-figma.js';
import { ReadConfig as GitLabConfig } from '../gitlab/read-gitlab.js';
import { ReadConfig as JiraConfig } from '../jira/read-jira.js';
import { ReadConfig as MiroConfig } from '../miro/read-miro.js';
import { ReadConfig as SonarConfig } from '../sonar/read-sonar.js';
import { ReadConfig as XrayConfig } from '../xray/read-xray.js';
import { ReadConfig as BrowserInspectorConfig } from '../browser-inspector/read-browser-inspector.js';

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples');

/** The snapshot `type` values each source must demonstrate; Jira has no union. */
const SOURCES: readonly {
  name: string;
  schema: z.ZodTypeAny;
  types: readonly string[];
}[] = [
  { name: 'jira', schema: JiraConfig, types: [] },
  { name: 'confluence', schema: ConfluenceConfig, types: ['page', 'tree', 'label'] },
  { name: 'gitlab', schema: GitLabConfig, types: ['issues', 'mrs', 'pipelines'] },
  { name: 'sonar', schema: SonarConfig, types: ['quality_gate', 'issues', 'hotspots', 'measures'] },
  { name: 'figma', schema: FigmaConfig, types: ['tokens', 'components', 'styles', 'file_summary'] },
  { name: 'miro', schema: MiroConfig, types: ['boards', 'board'] },
  { name: 'xray', schema: XrayConfig, types: ['tests', 'test_executions'] },
  { name: 'browser-inspector', schema: BrowserInspectorConfig, types: ['page', 'flow'] },
];

describe('the shipped example configs', () => {
  it('every example on disk is in SOURCES — the typed list cannot silently fall behind', () => {
    // SOURCES enumerates by name because schemas cannot be globbed, and this repo has
    // watched name-lists rot three times. This assertion is the loud tripwire: an eighth
    // source's example fails HERE instead of going untested forever.
    const onDisk = readdirSync(EXAMPLES_DIR)
      .filter((f) => /^read\.config\..+\.json$/.test(f))
      .map((f) => f.replace(/^read\.config\./, '').replace(/\.json$/, ''))
      .sort();
    expect(onDisk).toEqual(SOURCES.map((s) => s.name).sort());
  });

  for (const source of SOURCES) {
    const file = `read.config.${source.name}.json`;

    it(`${file} parses under the ${source.name} schema`, () => {
      const raw: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf8'));
      expect(() => source.schema.parse(raw)).not.toThrow();
    });

    it(`${file} writes into the gitignored cache, not into the tree`, () => {
      const raw: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf8'));
      const parsed = source.schema.parse(raw) as { outputDir: string };
      expect(parsed.outputDir).toBe(`./.scribe/${source.name}`);
    });

    if (source.types.length > 0) {
      it(`${file} demonstrates every snapshot type`, () => {
        const raw: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf8'));
        const parsed = source.schema.parse(raw) as { snapshots: readonly { type: string }[] };
        expect([...new Set(parsed.snapshots.map((s) => s.type))].sort()).toEqual([...source.types].sort());
      });
    }
  }
});
