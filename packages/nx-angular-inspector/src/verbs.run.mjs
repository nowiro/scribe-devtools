// verbs.run.mjs — the implementations, one per row of `verbs.schema.mjs`, same order.
//
// Every one returns `{ line, exit }` and writes its bulk to `.ws/`. None of them prints; the caller
// does, so a test can assert the exact line without capturing stdout.
//
// The shape of a line is fixed: `ok <verb> [<argument>] · facts · [freshness] · <path>`. Freshness
// is the second-to-last part wherever the answer came from the graph, and absent where there is no
// cache to be stale about (`gen` and `guide` read their sources live on every call — printing a
// verdict there would be a word that means nothing).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { versionParts } from './detect.mjs';
import { inferredTargets, matchProjects } from './graph.mjs';
import { findGuides } from './guide.mjs';
import { parseSpec, scanGenerators, schemaOptions } from './generators.mjs';
import { document, generatorPath, writeOut } from './out.mjs';
import { workspaceDataDir } from './paths.mjs';
import { formatAge, formatInt, formatOk, plural, relPath, VERDICT } from './print.mjs';
import { INFERRING_FILES } from './stamp.mjs';
import { loadModel, readJsonOrNull } from './workspace.mjs';

/**
 * @typedef {object} Context
 * @property {string} root
 * @property {string} cwd where the agent ran the command, for relative paths on the line
 * @property {string} outDir
 * @property {string[]} args
 * @property {{ root?: string, out?: string, fresh?: boolean, reverse?: boolean }} flags
 * @property {import('./detect.mjs').Detected} detected
 * @property {NodeJS.ProcessEnv} env
 * @property {number} now epoch ms, injected so a test does not race the clock
 */

/** @typedef {{ line: string, exit: number }} Outcome */

/**
 * The freshness word for a model, or '' when the verb does not report it.
 * @param {import('./workspace.mjs').Model} model
 * @returns {string}
 */
const verdict = (model) => VERDICT[model.cache];

/** @param {Context} ctx @param {string} absolute */
const shown = (ctx, absolute) => relPath(absolute, ctx.cwd);

/**
 * `env` — versions, how old the graph is, whether it is still the truth, and the list of files that
 * bump the freshness stamp.
 *
 * The list is printed because it is a KNOWN GAP: a plugin inferring targets from a file outside it
 * will not move the stamp. A gap you can read is one you can work around with `--fresh`; a gap you
 * cannot read is a lie told confidently.
 * @param {Context} ctx
 * @returns {Outcome}
 */
export function env(ctx) {
  const model = loadModel({ root: ctx.root, detected: ctx.detected, fresh: ctx.flags.fresh, env: ctx.env });
  const daemon = daemonState(ctx.root, ctx.env);
  const age = model.graphMtime === 0 ? '' : `graf ${formatAge(ctx.now - model.graphMtime)}`;

  const file = writeOut(
    ctx.outDir,
    'env.md',
    document({ title: 'Środowisko', source: model.source, freshness: verdict(model) }, [
      `- workspace: \`${ctx.root.replaceAll('\\', '/')}\``,
      `- nx: ${ctx.detected.nx.version ?? 'nie zainstalowane'} (${ctx.detected.nx.present ? 'nx.json obecny' : 'brak nx.json'})`,
      `- angular: ${ctx.detected.angular.version ?? 'nie zainstalowany'} (${ctx.detected.angular.evidence || 'brak'})`,
      `- graf: \`${model.graphPath.replaceAll('\\', '/')}\``,
      `- wiek grafu: ${model.graphMtime === 0 ? 'nie dotyczy (odpowiedź nie z cache)' : formatAge(ctx.now - model.graphMtime)}`,
      `- werdykt świeżości: ${verdict(model)} (\`${model.cache}\`)`,
      model.stamp.newestPath === null
        ? '- najnowsze wejście: brak — graf jest nowszy niż wszystko, co go unieważnia'
        : `- najnowsze wejście: \`${model.stamp.newestPath.replaceAll('\\', '/')}\``,
      `- sprawdzonych ścieżek: ${formatInt(model.stamp.statted)}`,
      `- demon Nx: ${daemon} — nie jest to dowód świeżości w żadną stronę, stempel liczy się osobno`,
      '',
      '## Pliki inferujące targety (zbiór wejściowy stempla)',
      '',
      'Plugin, który wnioskuje target z pliku spoza tej listy, nie podbije stempla świeżości.',
      'Wtedy `--fresh`.',
      '',
      ...INFERRING_FILES.map((name) => `- \`${name}\``),
    ]),
  );

  return {
    line: formatOk('env', [...versionParts(ctx.detected), age, `demon ${daemon}`, verdict(model), shown(ctx, file)]),
    exit: 0,
  };
}

/**
 * `projects` — the whole list to a file; `projects <name|glob>` — one line and no file, because the
 * answer already fits on the line and a file would only cost the agent a read.
 * @param {Context} ctx
 * @returns {Outcome}
 */
export function projects(ctx) {
  const model = loadModel({ root: ctx.root, detected: ctx.detected, fresh: ctx.flags.fresh, env: ctx.env });
  const pattern = ctx.args[0];

  if (pattern !== undefined) {
    const matches = matchProjects(model.graph, pattern);
    if (matches.length === 0) {
      return { line: fail('projects', pattern, `brak projektu ${pattern}`, [nonHit(model)]), exit: 1 };
    }
    if (matches.length === 1) {
      const project = matches[0];
      return {
        line: formatOk(`projects ${project.name}`, [
          project.type,
          project.root,
          project.targets.join(' '),
          project.tags.join(' '),
          nonHit(model),
        ]),
        exit: 0,
      };
    }
    const file = writeOut(
      ctx.outDir,
      'projects.md',
      document({ title: `Projekty pasujące do \`${pattern}\``, source: model.source, freshness: verdict(model) }, [
        ...matches.map(projectRow),
      ]),
    );
    return {
      line: formatOk(`projects ${pattern}`, [
        `${formatInt(matches.length)} z ${formatInt(model.graph.projects.length)}`,
        verdict(model),
        shown(ctx, file),
      ]),
      exit: 0,
    };
  }

  // Only meaningful against the Nx graph, where `project.json` is the thing targets can be missing
  // from. In an `angular.json` workspace every target IS declared — just in that one file — so the
  // same count would report `5/5 z pluginów` about a workspace that has no plugins at all.
  const targets =
    model.source === 'angular.json'
      ? null
      : inferredTargets(model.graph, ctx.root.replaceAll('\\', '/'), readJsonOrNull);
  const file = writeOut(
    ctx.outDir,
    'projects.md',
    document({ title: 'Projekty', source: model.source, freshness: verdict(model) }, [
      targets === null
        ? `${formatInt(model.graph.projects.length)} projektów`
        : `${formatInt(model.graph.projects.length)} projektów · ${formatInt(targets.inferred)} z ${formatInt(targets.total)} targetów pochodzi z pluginów, nie z \`project.json\``,
      '',
      '| projekt | typ | katalog | targety | tagi |',
      '| --- | --- | --- | --- | --- |',
      ...model.graph.projects.map(
        (p) => `| ${p.name} | ${p.type} | ${p.root} | ${p.targets.join(' ')} | ${p.tags.join(' ')} |`,
      ),
    ]),
  );

  return {
    line: formatOk('projects', [
      formatInt(model.graph.projects.length),
      ...versionParts(ctx.detected).slice(0, 1),
      targets === null ? '' : `${formatInt(targets.inferred)}/${formatInt(targets.total)} targetów z pluginów`,
      verdict(model),
      shown(ctx, file),
    ]),
    exit: 0,
  };
}

/**
 * `graph <project>` — what it depends on and what depends on it, internal edges only. External
 * edges outnumber internal ones 26 to 1 on a real workspace; printing them would answer a question
 * nobody asked with a list nobody can read.
 * @param {Context} ctx
 * @returns {Outcome}
 */
export function graph(ctx) {
  const model = loadModel({ root: ctx.root, detected: ctx.detected, fresh: ctx.flags.fresh, env: ctx.env });
  const name = ctx.args[0];
  const project = model.graph.projects.find((p) => p.name === name);
  if (project === undefined) {
    return { line: fail('graph', name, `brak projektu ${name}`, [verdict(model)]), exit: 1 };
  }

  const dependsOn = model.graph.dependsOn.get(name) ?? [];
  const dependedOnBy = model.graph.dependedOnBy.get(name) ?? [];
  const reverse = ctx.flags.reverse === true;
  const primary = reverse ? dependedOnBy : dependsOn;

  const file = writeOut(
    ctx.outDir,
    `graph-${name.replaceAll('/', '-')}.md`,
    document({ title: `Graf: ${name}`, source: model.source, freshness: verdict(model) }, [
      `\`${project.root}\` · ${project.type}`,
      '',
      `## Zależy od (${formatInt(dependsOn.length)})`,
      '',
      ...(dependsOn.length === 0 ? ['_nic wewnątrz workspace_'] : dependsOn.map((n) => `- ${n}`)),
      '',
      `## Zależą od niego (${formatInt(dependedOnBy.length)})`,
      '',
      ...(dependedOnBy.length === 0 ? ['_nic wewnątrz workspace_'] : dependedOnBy.map((n) => `- ${n}`)),
      '',
      `Krawędzie w grafie: ${formatInt(model.graph.internalEdges)} wewnętrznych z ${formatInt(model.graph.rawEdges)}.`,
    ]),
  );

  return {
    line: formatOk(`graph ${name}`, [
      reverse ? `${plural(primary.length, ['zależny', 'zależnych', 'zależnych'])} (--reverse)` : '',
      reverse ? '' : plural(dependsOn.length, ['zależność', 'zależności', 'zależności']),
      reverse ? '' : plural(dependedOnBy.length, ['zależny', 'zależnych', 'zależnych']),
      verdict(model),
      shown(ctx, file),
    ]),
    exit: 0,
  };
}

/**
 * `gen` — the installed generators; `gen <collection:generator>` — the options of one, as a digest.
 *
 * The digest is the whole point of the verb: the full `@nx/angular:library` schema is 7 999 B, and
 * every flag with its type and default is a fraction of that. The file on disk keeps the prose.
 * @param {Context} ctx
 * @returns {Outcome}
 */
export function gen(ctx) {
  const spec = ctx.args[0];
  const parsed = spec === undefined ? null : parseSpec(spec);
  const { generators, collections } = scanGenerators(ctx.root);

  if (parsed !== null) {
    const found = generators.find((g) => g.collection === parsed.collection && g.name === parsed.name);
    if (found === undefined) {
      return { line: fail('gen', spec ?? '', `brak generatora ${spec ?? ''}`), exit: 1 };
    }
    const schema = found.schemaFile === '' ? null : readJsonOrNull(found.schemaFile);
    if (schema === null) {
      return { line: fail('gen', spec ?? '', 'generator nie ma czytelnego schematu'), exit: 1 };
    }
    const { options, required } = schemaOptions(schema);
    const file = writeOut(
      ctx.outDir,
      generatorPath(found.collection, found.name),
      document({ title: `${found.collection}:${found.name}`, source: found.schemaFile, freshness: '' }, [
        found.description === '' ? '' : found.description,
        '',
        '| opcja | typ | wymagana | domyślnie | opis |',
        '| --- | --- | --- | --- | --- |',
        ...options.map(
          (o) => `| ${o.name} | ${o.type} | ${o.required ? 'tak' : ''} | ${o.default} | ${o.description} |`,
        ),
      ]),
    );
    return {
      line: formatOk(`gen ${found.collection}:${found.name}`, [
        plural(options.length, ['opcja', 'opcje', 'opcji']),
        required.length === 0 ? '' : `wymagane: ${required.join(' ')}`,
        shown(ctx, file),
      ]),
      exit: 0,
    };
  }

  const visible = generators.filter((g) => !g.hidden);
  const filtered =
    spec === undefined
      ? visible
      : visible.filter((g) => `${g.collection}:${g.name}`.toLowerCase().includes(spec.toLowerCase()));
  const file = writeOut(
    ctx.outDir,
    'gen.md',
    document({ title: 'Generatory', source: `${ctx.root.replaceAll('\\', '/')}/node_modules`, freshness: '' }, [
      '| generator | opis |',
      '| --- | --- |',
      ...filtered.map((g) => `| \`${g.collection}:${g.name}\` | ${g.description} |`),
    ]),
  );

  return {
    line: formatOk(spec === undefined ? 'gen' : `gen ${spec}`, [
      spec === undefined
        ? `${plural(filtered.length, ['generator', 'generatory', 'generatorów'])} w ${plural(collections, ['kolekcji', 'kolekcjach', 'kolekcjach'])}`
        : `${formatInt(filtered.length)} z ${formatInt(visible.length)}`,
      shown(ctx, file),
    ]),
    exit: filtered.length === 0 ? 1 : 0,
  };
}

/**
 * `guide` — where the rules for this workspace live and what reading them costs, in that order:
 * the workspace's own documents first, a framework's defaults after.
 *
 * It prints paths and sizes, never content. Whether 2,8 KB of Angular best practices is worth
 * spending on the question at hand is the caller's decision; a tool that answers by pasting the
 * file has taken that decision away.
 * @param {Context} ctx
 * @returns {Outcome}
 */
export function guide(ctx) {
  const docs = findGuides(ctx.root);
  const bytes = docs.reduce((sum, doc) => sum + doc.bytes, 0);
  const file = writeOut(
    ctx.outDir,
    'guide.md',
    document({ title: 'Zasady dla tego workspace', source: 'workspace + node_modules', freshness: '' }, [
      'Ścieżki i koszt. Treści tu nie ma — decyzja, czy ją przeczytać, należy do ciebie.',
      '',
      '| dokument | skąd | bajty | co to jest |',
      '| --- | --- | ---: | --- |',
      ...docs.map(
        (doc) =>
          `| \`${relPath(doc.file, ctx.root).replaceAll('\\', '/')}\` | ${doc.origin} | ${formatInt(doc.bytes)} | ${doc.what} |`,
      ),
    ]),
  );

  return {
    line: formatOk('guide', [
      plural(docs.length, ['dokument', 'dokumenty', 'dokumentów']),
      `${formatInt(bytes)} B`,
      shown(ctx, file),
    ]),
    exit: docs.length === 0 ? 1 : 0,
  };
}

/**
 * The table the CLI dispatches on. Same keys, same order as `VERBS` — a test asserts it, because a
 * verb present in one table and missing from the other fails silently.
 */
export const RUNNERS = Object.freeze({ env, projects, graph, gen, guide });

/**
 * `FAIL <verb> <arg> · reason · parts`.
 * @param {string} verb
 * @param {string} arg
 * @param {string} reason
 * @param {readonly (string | undefined | false)[]} [parts]
 * @returns {string}
 */
function fail(verb, arg, reason, parts = []) {
  const kept = parts.filter((p) => typeof p === 'string' && p !== '');
  return ['FAIL', `${verb}${arg === '' ? '' : ` ${arg}`}`].join(' ') + ['', reason, ...kept].join(' · ');
}

/**
 * The freshness word, but only when it is not `hit` — used on the lines that would otherwise carry
 * no verdict. Silence means fresh; a word means read it.
 * @param {import('./workspace.mjs').Model} model
 * @returns {string}
 */
function nonHit(model) {
  return model.cache === 'hit' ? '' : VERDICT[model.cache];
}

/** @param {import('./graph.mjs').Project} project */
function projectRow(project) {
  return `- \`${project.name}\` · ${project.type} · \`${project.root}\` · ${project.targets.join(' ')}`;
}

/**
 * Whether the Nx daemon looks alive. Reported by `env` and used by NOTHING: on the reference
 * machine the daemon's pid was dead and a `disabled` marker weeks old, while the graph was current.
 * A recycled pid makes the opposite error just as easy.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function daemonState(root, env) {
  const dir = path.join(workspaceDataDir(root, env), 'd');
  if (existsSync(path.join(dir, 'disabled'))) return 'wyłączony';
  const server = path.join(dir, 'server-process.json');
  if (!existsSync(server)) return 'brak';
  try {
    const pid = Number(JSON.parse(readFileSync(server, 'utf8')).processId);
    if (!Number.isInteger(pid) || pid <= 0) return 'brak';
    process.kill(pid, 0);
    return 'pid żyje';
  } catch {
    return 'martwy';
  }
}
