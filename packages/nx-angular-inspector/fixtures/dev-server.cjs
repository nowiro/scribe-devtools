// A stand-in dev server for the `serve` tests: it binds a real port, announces itself the way a
// real one does, and then stays up until something kills it.
//
// It is spawned as a CHILD of the `nx` stand-in rather than being the stand-in itself, because that
// is the shape `stop` has to survive: `nx run <p>:serve` is a parent of the actual server, and a
// kill that does not take the tree leaves the port held by an orphan.
//
// Three behaviours, chosen by argv[2], because a `wait` that only ever succeeds proves nothing:
//   ready  bind, print the Angular-style banner after a beat, stay up
//   hang   bind, print nothing that looks ready, stay up   → `wait` must time out, not block forever
//   die    print a failure and exit 1                      → `wait` must notice, not wait it out
const http = require('node:http');

const mode = process.argv[2] || 'ready';

if (mode === 'die') {
  process.stdout.write('Application bundle generation failed\n');
  process.stdout.write('src/main.ts:1:1 - error TS2304: nie znaleziono nazwy\n');
  process.exit(1);
}

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('fixture\n');
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  process.stdout.write(`NX   Starting dev server for the fixture\n`);
  if (mode === 'hang') {
    // Something is printed, so the test can tell "no output yet" from "output, but never ready".
    process.stdout.write('kompilacja trwa\n');
    return;
  }
  setTimeout(() => {
    process.stdout.write(`  ➜  Local:   http://localhost:${String(port)}/\n`);
    process.stdout.write('Application bundle generation complete.\n');
  }, 150);
});
