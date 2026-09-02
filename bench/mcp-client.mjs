// mcp-client.mjs — a minimal MCP client over stdio (port of demo/bench in scribe). The stdio
// transport is JSON-RPC line by line — no Content-Length frames, no SSE. That is enough to measure
// what really enters the agent's context window: the full `result` of every response.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 */
export function startMcp(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, ...options });
  /** @type {Map<number, (message: any) => void>} */
  const pending = new Map();
  /** @type {string[]} */
  const stderr = [];
  let nextId = 1;

  createInterface({ input: /** @type {NodeJS.ReadableStream} */ (child.stdout) }).on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // the server is chatty on stdout at start — that is not a response
    }
    // A `method` means a REQUEST from the server to us (ping, roots/list), not a response — and
    // its id can collide with our counter (both start at 1).
    if (message.method !== undefined) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter(message);
  });
  child.stderr?.on('data', (chunk) => stderr.push(String(chunk)));
  // A dead server answers every pending request with an error AT ONCE instead of letting each
  // one run into its full timeout; later calls fail immediately.
  let dead = false;
  const die = (/** @type {string} */ why) => {
    dead = true;
    for (const [, waiter] of pending) waiter({ error: { message: why } });
    pending.clear();
  };
  child.on('error', (error) => die(`MCP server did not start: ${error.message}`));
  child.on('exit', (code) => die(`MCP server exited (code ${String(code)})\n${stderr.join('')}`));
  child.stdin?.on('error', () => {
    /* EPIPE after the child died — handled by die() from 'exit' */
  });

  const send = (/** @type {object} */ payload) => {
    if (dead) throw new Error('MCP server is dead — see the earlier error');
    return child.stdin?.write(`${JSON.stringify(payload)}\n`);
  };

  /**
   * Returns `{ result, raw }` — `raw` is the exact JSON of `result`, i.e. the payload a real
   * client pastes into the model's context. That is what gets measured.
   * @param {string} method
   * @param {object} params
   * @param {number} [timeoutMs]
   * @returns {Promise<{ result: any, raw: string }>}
   */
  const request = (method, params, timeoutMs = 60_000) =>
    new Promise((ok, fail) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`MCP ${method}: no response after ${String(timeoutMs)}ms\n${stderr.join('')}`));
      }, timeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) {
          fail(new Error(`MCP ${method}: ${message.error.message ?? JSON.stringify(message.error)}`));
          return;
        }
        ok({ result: message.result, raw: JSON.stringify(message.result) });
      });
      send({ jsonrpc: '2.0', id, method, params });
    });

  const notify = (/** @type {string} */ method, /** @type {object} */ params) =>
    send({ jsonrpc: '2.0', method, params });

  return {
    request,
    notify,
    stderr,
    pid: child.pid ?? 0,
    close: () => {
      child.stdin?.end();
      child.kill();
    },
    /** Resolves when the process is gone. */
    exited: new Promise((resolve) => child.on('exit', () => resolve(undefined))),
  };
}

/**
 * The MCP handshake: initialize + notifications/initialized.
 * @param {ReturnType<typeof startMcp>} mcp
 */
export async function initialize(mcp) {
  const { result } = await mcp.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'scribe-devtools-bench', version: '0.0.0' },
  });
  mcp.notify('notifications/initialized', {});
  return result;
}

/**
 * The text of a tool response — what an MCP client pastes into the context as the result.
 * @param {any} result
 */
export const textOf = (result) =>
  (result?.content ?? [])
    .filter((/** @type {{ type: string }} */ part) => part.type === 'text')
    .map((/** @type {{ text: string }} */ part) => part.text)
    .join('\n');
