// A stand-in for the `nx` binary, copied into a generated fixture as `node_modules/nx/bin/nx.js`.
//
// It exists so the two code paths that LEAVE this process can be tested at all: the CLI fallback
// (`--fresh`, and an unknown graph `version`) and `run`. Everything else in the package is pure and
// testable in-process; these two are not, and an untested spawn is where the platform-specific
// surprises live.
//
// It answers exactly the two calls the tool makes. `portal:build` fails ON PURPOSE and IN COLOUR,
// so the ANSI stripping and the error extraction have something real to chew on rather than a
// hand-written string that agrees with the regex by construction.
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const workspace = path.resolve(__dirname, '..', '..', '..');
const ESC = String.fromCharCode(27);

if (argv[0] === 'graph') {
  const flag = argv.find((arg) => arg.startsWith('--file=')) || '';
  const target = flag.slice('--file='.length);
  const source = path.join(workspace, '.nx', 'workspace-data', 'project-graph.json');
  // `nx graph --file` writes the graph wrapped under `graph` and prints a notice, NOT JSON — which
  // is why the tool reads the file rather than parsing stdout.
  fs.writeFileSync(target, JSON.stringify({ graph: JSON.parse(fs.readFileSync(source, 'utf8')) }));
  process.stdout.write('NX   Project graph written\n');
  process.exit(0);
}

if (argv[0] === 'run' && argv[1] === 'portal:build') {
  process.stdout.write(
    `${ESC}[31mERROR${ESC}[0m apps/portal/src/app/x.ts(12,5): error TS2322: typ nie pasuje\n`,
  );
  process.stdout.write('apps/portal/src/app/y.ts(3,1): error TS2304: nie znaleziono nazwy\n');
  process.stdout.write('NX   Ran target build for project portal\n');
  process.exit(1);
}

// The three serve targets. The dev server is a CHILD, not this process, because that is the shape
// `stop` has to survive: killing the parent alone leaves the real server holding the port.
const SERVE_MODES = { 'portal:serve': 'ready', 'portal:serve-hang': 'hang', 'portal:serve-die': 'die' };
if (argv[0] === 'run' && SERVE_MODES[argv[1]] !== undefined) {
  const child = require('node:child_process').spawn(
    process.execPath,
    [path.join(__dirname, 'dev-server.cjs'), SERVE_MODES[argv[1]]],
    { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true },
  );
  child.on('exit', (code) => process.exit(code === null ? 1 : code));
  return;
}

if (argv[0] === 'run') {
  process.stdout.write(`${ESC}[32mok${ESC}[0m ${argv[1]}\n`);
  process.exit(0);
}

process.stderr.write(`nieznana komenda: ${argv.join(' ')}\n`);
process.exit(2);
