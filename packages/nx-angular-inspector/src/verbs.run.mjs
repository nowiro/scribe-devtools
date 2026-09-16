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
import { affectedProjects, changedFiles, sharedGlobals } from './affected.mjs';
import { versionParts } from './detect.mjs';
import { inferredTargets, matchProjects } from './graph.mjs';
import { findGuides } from './guide.mjs';
import { parseSpec, scanGenerators, schemaOptions } from './generators.mjs';
import { document, generatorPath, safeSegment, writeOut } from './out.mjs';
import { workspaceDataDir } from './paths.mjs';
import { formatAge, formatFail, formatInt, formatOk, plural, relPath, truncate, VERDICT } from './print.mjs';
import {
  alive,
  DEFAULT_READY,
  DEFAULT_WAIT_MS,
  logFile,
  readState,
  startServe,
  stopServe,
  waitForServe,
} from './serve.mjs';
import { errorSummary, parseTargetSpec, runTarget } from './target.mjs';
import { INFERRING_FILES } from './stamp.mjs';
import { loadModel, readJsonOrNull } from './workspace.mjs';

/**
 * @typedef {object} Context
 * @property {string} root
 * @property {string} cwd where the agent ran the command, for relative paths on the line
 * @property {string} outDir
 * @property {string[]} args
 * @property {{ root?: string, out?: string, base?: string, ready?: string, timeout?: string, fresh?: boolean, reverse?: boolean, deep?: boolean }} flags
 * @property {import('./detect.mjs').Detected} detected
 * @property {NodeJS.ProcessEnv} env
 * @property {number} now epoch ms, injected so a test does not race the clock
 */

/**
 * How much of the first error `run` puts on the line.
 *
 * The 120-character cap and the 40-token cap are two different limits, and a compiler error next to
 * a path is dense enough to pass the first and fail the second. The line carries a HINT about which
 * failure this is; the full text is in the log, one read away.
 */
const ERROR_SNIPPET_MAX = 40;

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
  const model = loadModel({
    root: ctx.root,
    detected: ctx.detected,
    fresh: ctx.flags.fresh,
    deep: ctx.flags.deep,
    env: ctx.env,
  });
  const daemon = daemonState(ctx.root, ctx.env);
  const age = model.graphMtime === 0 ? '' : `graf ${formatAge(ctx.now - model.graphMtime)}`;

  const file = writeOut(
    ctx.outDir,
    'env.md',
    document({ title: 'Środowisko', source: model.source, freshness: verdict(model) }, [
      `- workspace: \`${ctx.root.replaceAll('\\', '/')}\``,
      `- nx: ${ctx.detected.nx.version ?? 'nie zainstalowane'} (${ctx.detected.nx.present ? 'nx.json obecny' : 'brak nx.json'})`,
      `- angular: ${ctx.detected.angular.version ?? 'nie zainstalowany'} (${ctx.detected.angular.evidence || 'brak'})`,
      `- graf: \`${relPath(model.graphPath, ctx.root)}\``,
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
      // One line, not a bullet per name: the list is static and was 40 % of every env.md read.
      INFERRING_FILES.map((name) => `\`${name}\``).join(' · '),
    ]),
  );

  return {
    // The daemon state stays in env.md only: the code below says it proves nothing about freshness,
    // and a fact that proves nothing does not belong on the line.
    line: formatOk('env', [...versionParts(ctx.detected), age, verdict(model), shown(ctx, file)]),
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
  const model = loadModel({
    root: ctx.root,
    detected: ctx.detected,
    fresh: ctx.flags.fresh,
    deep: ctx.flags.deep,
    env: ctx.env,
  });
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
      document(
        { title: `Projekty pasujące do \`${pattern}\``, source: model.source, freshness: verdict(model) },
        matches.map(projectRow),
      ),
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
  const model = loadModel({
    root: ctx.root,
    detected: ctx.detected,
    fresh: ctx.flags.fresh,
    deep: ctx.flags.deep,
    env: ctx.env,
  });
  const name = ctx.args[0];
  const project = model.graph.projects.find((p) => p.name === name);
  if (project === undefined) {
    return { line: fail('graph', name, `brak projektu ${name}`, [nonHit(model)]), exit: 1 };
  }

  const dependsOn = model.graph.dependsOn.get(name) ?? [];
  const dependedOnBy = model.graph.dependedOnBy.get(name) ?? [];
  const reverse = ctx.flags.reverse === true;
  const primary = reverse ? dependedOnBy : dependsOn;

  const file = writeOut(
    ctx.outDir,
    `graph-${safeSegment(name)}.md`,
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
    document({ title: 'Generatory', source: 'node_modules (workspace)', freshness: '' }, [
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
    // An empty result is not a failure: the file was written and is correct, and the caller asked a
    // question that happens to have no answer. Exit 1 here made the bin send an `ok …` line to
    // stderr, so an agent reading stdout got silence.
    exit: 0,
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
    exit: 0,
  };
}

/**
 * `affected [--base <ref>]` — which projects a range of commits touched, closed over the
 * dependents.
 *
 * The closure is the half people leave out: changing a leaf library affects every application that
 * consumes it, and an answer listing only the library is the sort of wrong that passes review and
 * then skips a build.
 * @param {Context} ctx
 * @returns {Outcome}
 */
export function affected(ctx) {
  const model = loadModel({
    root: ctx.root,
    detected: ctx.detected,
    fresh: ctx.flags.fresh,
    deep: ctx.flags.deep,
    env: ctx.env,
  });
  const nxJson = readJsonOrNull(path.join(ctx.root, 'nx.json'));
  const base = ctx.flags.base ?? String(nxJson?.defaultBase ?? 'main');
  // A 40-character SHA on the line costs 20 o200k tokens by itself — measured. Twelve characters
  // identify a commit for a human and for `git`, and the full ref stays in the file.
  const shortBase = /^[0-9a-f]{20,40}$/iu.test(base) ? base.slice(0, 12) : base;
  const range = `${base}...HEAD`;
  const shownRange = `${shortBase}...HEAD`;

  const changed = changedFiles(ctx.root, base);
  if (!changed.ok) return { line: fail('affected', '', changed.error, [range]), exit: 1 };

  const shared = sharedGlobals(nxJson);
  const { projects: hit, sharedHit } = affectedProjects({
    files: changed.files,
    projects: model.graph.projects,
    dependedOnBy: model.graph.dependedOnBy,
    shared,
  });

  const file = writeOut(
    ctx.outDir,
    'affected.md',
    document({ title: `Dotknięte przez ${range}`, source: model.source, freshness: verdict(model) }, [
      sharedHit === null
        ? `${formatInt(hit.length)} z ${formatInt(model.graph.projects.length)} projektów, z domknięciem zależnych.`
        : `Zmieniony plik wspólny \`${sharedHit}\` — dotknięte są WSZYSTKIE projekty. Domknięcie nie ma tu nic do roboty.`,
      '',
      '## Projekty',
      '',
      ...(hit.length === 0 ? ['_żaden_'] : hit.map((name) => `- ${name}`)),
      '',
      `## Zmienione pliki (${formatInt(changed.files.length)})`,
      '',
      ...(changed.files.length === 0 ? ['_żaden_'] : changed.files.map((f) => `- \`${f}\``)),
      '',
      `Wzorce plików wspólnych: ${shared.map((g) => `\`${g}\``).join(', ')}.`,
    ]),
  );

  return {
    line: formatOk('affected', [
      `${formatInt(hit.length)}/${formatInt(model.graph.projects.length)}`,
      sharedHit === null ? plural(changed.files.length, ['plik', 'pliki', 'plików']) : `wspólny ${sharedHit}`,
      shownRange,
      verdict(model),
      shown(ctx, file),
    ]),
    exit: 0,
  };
}

/**
 * `run <projekt>:<target>` — the one verb that changes something.
 *
 * The full log lands on disk with the ANSI stripped (45-51 % of the tokens in a coloured build) and
 * the line carries the error COUNT and the FIRST error, because that pair is what decides the next
 * move. A failing TypeScript build prints hundreds of lines that are usually one mistake.
 * @param {Context} ctx
 * @returns {Outcome}
 */
export function run(ctx) {
  const spec = ctx.args[0] ?? '';
  const parsed = parseTargetSpec(spec);
  if (parsed === null) return { line: fail('run', spec, 'oczekiwano <projekt>:<target>'), exit: 1 };

  const started = Date.now();
  const result = runTarget(ctx.root, parsed.project, parsed.target, ctx.env);
  const seconds = `${((Date.now() - started) / 1000).toFixed(1).replace('.', ',')} s`;
  const logPath = writeOut(
    ctx.outDir,
    // `safeSegment`, not a hand-rolled `replaceAll('/')`: on Windows a BACKSLASH is a separator
    // too, and a project name carrying one walked the log file out of `.ws/`.
    `run/${safeSegment(parsed.project)}-${safeSegment(parsed.target)}.log`,
    result.log === '' ? '(bez wyjścia)' : result.log,
  );

  // The captured log is searched even when `spawnSync` itself reported a problem: a run cut off at
  // `maxBuffer` still produced 64 MB of output, and the compiler errors in it are exactly what the
  // caller needs. Previously that branch returned before `errorSummary` ran at all.
  const { shown: errors, total } = errorSummary(result.log);
  const first = errors[0] === undefined ? '' : truncate(errors[0], ERROR_SNIPPET_MAX);

  if (result.error !== '') {
    return { line: fail('run', spec, result.error, [shown(ctx, logPath), first]), exit: 1 };
  }
  if (result.status === 0) return { line: formatOk(`run ${spec}`, [seconds, shown(ctx, logPath)]), exit: 0 };

  return {
    line: fail(
      'run',
      spec,
      // `total`, not `errors.length`: the list is capped at five, and reporting "5 błędów" for a build
      // with 147 of them is a number small enough that nobody opens the file.
      total === 0 ? `kod ${formatInt(result.status)}` : plural(total, ['błąd', 'błędy', 'błędów']),
      [shown(ctx, logPath), first],
    ),
    exit: 1,
  };
}

/**
 * `serve [wait|stop] <projekt>` — a dev server started in the background, waited for, and stopped.
 *
 * The three modes are one verb because they are one object with a lifecycle, and the agent's
 * instruction block pays for every name it lists.
 * @param {Context} ctx
 * @returns {Outcome}
 */
export function serve(ctx) {
  const mode = ctx.args.length === 2 ? ctx.args[0] : 'start';
  const project = ctx.args.length === 2 ? ctx.args[1] : (ctx.args[0] ?? '');
  if (!['start', 'wait', 'stop'].includes(mode)) {
    return { line: fail('serve', mode, `nieznany tryb ${mode} — oczekiwano wait albo stop`), exit: 1 };
  }
  if (project === '' || project === 'wait' || project === 'stop') {
    return { line: fail('serve', mode === 'start' ? '' : mode, 'brakuje nazwy projektu'), exit: 1 };
  }
  const head = mode === 'start' ? `serve ${project}` : `serve ${mode} ${project}`;
  const state = readState(ctx.outDir, project);

  if (mode === 'stop') {
    if (state === null) return { line: formatOk(head, ['nic nie działało']), exit: 0 };
    const stopped = stopServe({ outDir: ctx.outDir, state });
    if (!stopped.ok)
      return { line: fail('serve', `stop ${project}`, stopped.error, [`pid ${String(state.pid)}`]), exit: 1 };
    return { line: formatOk(head, ['zatrzymany', `pid ${String(state.pid)}`]), exit: 0 };
  }

  if (mode === 'wait') {
    if (state === null)
      return { line: fail('serve', `wait ${project}`, 'nic nie wystartowano — najpierw `serve <projekt>`'), exit: 1 };
    const timeoutMs = Number(ctx.flags.timeout ?? 0) > 0 ? Number(ctx.flags.timeout) * 1000 : DEFAULT_WAIT_MS;
    const ready = ctx.flags.ready === undefined ? DEFAULT_READY : new RegExp(ctx.flags.ready, 'u');
    const result = waitForServe({ state, ready, timeoutMs });
    const shownLog = shown(ctx, state.log);
    if (result.status === 'ready') {
      const seconds = `${(result.waitedMs / 1000).toFixed(1).replace('.', ',')} s`;
      return { line: formatOk(head, ['gotowy', seconds, result.url, shownLog]), exit: 0 };
    }
    const why =
      result.status === 'timeout'
        ? `brak gotowości po ${formatInt(Math.round(timeoutMs / 1000))} s`
        : 'proces zakończył się';
    return { line: fail('serve', `wait ${project}`, why, [shownLog, result.tail.at(-1)]), exit: 1 };
  }

  // start
  const model = loadModel({
    root: ctx.root,
    detected: ctx.detected,
    fresh: ctx.flags.fresh,
    deep: ctx.flags.deep,
    env: ctx.env,
  });
  const found = model.graph.projects.find((p) => p.name === project);
  if (found === undefined)
    return { line: fail('serve', project, `brak projektu ${project}`, [nonHit(model)]), exit: 1 };
  const target = found.targets.includes('serve') ? 'serve' : '';
  if (target === '') {
    return { line: fail('serve', project, 'brak targetu serve', [found.targets.join(' ')]), exit: 1 };
  }
  if (state !== null && alive(state.pid)) {
    return { line: formatOk(head, ['już działa', `pid ${String(state.pid)}`, shown(ctx, state.log)]), exit: 0 };
  }

  const started = startServe({ root: ctx.root, outDir: ctx.outDir, project, target, env: ctx.env });
  if (!started.ok || started.state === null) {
    return { line: fail('serve', project, started.error, [shown(ctx, logFile(ctx.outDir, project))]), exit: 1 };
  }
  return {
    line: formatOk(head, [`pid ${String(started.state.pid)}`, 'czeka na `serve wait`', shown(ctx, started.state.log)]),
    exit: 0,
  };
}

/**
 * The table the CLI dispatches on. Same keys, same order as `VERBS` — a test asserts it, because a
 * verb present in one table and missing from the other fails silently.
 */
export const RUNNERS = Object.freeze({ env, projects, graph, affected, gen, guide, run, serve });

/**
 * `FAIL <verb> <arg> · reason · parts`.
 *
 * Delegates to `formatFail` rather than joining by hand. The hand-rolled version skipped the
 * truncation and shipped a 127-character line — over the 120 cap the whole contract rests on, and
 * caught only because the line-budget test covers every verb rather than a sample.
 * @param {string} verb
 * @param {string} arg
 * @param {string} reason
 * @param {readonly (string | undefined | false)[]} [parts]
 * @returns {string}
 */
function fail(verb, arg, reason, parts = []) {
  return formatFail(`${verb}${arg === '' ? '' : ` ${arg}`}`, reason, parts);
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
