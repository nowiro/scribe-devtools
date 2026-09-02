// kc-token.mjs — a token endpoint stub in the shape of Keycloak, for the OAuth tests of auth.mjs.
//
// Answers `POST /realms/<realm>/protocol/openid-connect/token` (the layout `oauthTokenUrl` derives
// from `keycloak: { url, realm }`) and `POST /token` (a plain `tokenUrl`) with a form-encoded body:
// `password` grant checks `client_id` + `username` + `password`, `client_credentials` checks
// `client_id` + `client_secret`; the token is a JWT-shaped string (unsigned — nothing here verifies
// it, the fixture page only reads `preferred_username`) with `exp`, and the response carries
// `expires_in` unless the caller wants the `exp`-only path. Errors use the standard OAuth bodies
// (`invalid_grant`, `unauthorized_client`, `unsupported_grant_type`) so a test can tell them apart.
//
// `requests[]` records what was asked — grant, client, username, whether a secret was present —
// never the password or the secret itself: the test's own log must not be the place a secret shows.
import { createServer } from 'node:http';

/** @param {unknown} value */
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * @typedef {object} TokenServerOptions
 * @property {string} [realm] default `browser-inspector`
 * @property {Record<string, string>} [users] username → password (default `alice`)
 * @property {Record<string, string | null>} [clients] client_id → secret (`null` = public client)
 * @property {number} [expiresIn] seconds (default 300, Keycloak's default)
 * @property {boolean} [omitExpiresIn] leave `expires_in` out so the caller must read the JWT's `exp`
 * @property {(body: URLSearchParams) => { status: number, headers?: Record<string, string>, body: string } | undefined} [respond]
 *   override the whole answer (a 200 with HTML, a JSON without access_token, …); `undefined` = normal handling
 * @property {number} [delayMs] hold every answer (a hanging IdP)
 */

/**
 * @param {number} port
 * @param {TokenServerOptions} [options]
 */
export function startTokenServer(port, options = {}) {
  const realm = options.realm ?? 'browser-inspector';
  const users = options.users ?? { alice: 'wonderland-42' };
  const clients = options.clients ?? { 'browser-inspector-public': null, 'browser-inspector-service': 'service-secret-7' };
  const expiresIn = options.expiresIn ?? 300;
  /** @type {{ path: string, grant_type: string | null, client_id: string | null, username: string | null, hasSecret: boolean, hasPassword: boolean }[]} */
  const requests = [];
  const tokenPaths = new Set([`/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`, '/token']);

  /** @param {string} username @param {string} clientId */
  const mintToken = (username, clientId) => {
    const iat = Math.floor(Date.now() / 1000);
    const payload = { iss: `http://localhost:${String(port)}/realms/${realm}`, azp: clientId, iat, exp: iat + expiresIn };
    if (username) payload.preferred_username = username;
    return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.stub`;
  };

  const server = createServer((req, res) => {
    /** @param {number} status @param {unknown} body @param {Record<string, string>} [headers] */
    const send = (status, body, headers) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      const finish = () =>
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(text);
      if (options.delayMs) setTimeout(finish, options.delayMs);
      else finish();
    };
    const url = new URL(req.url ?? '/', `http://localhost:${String(port)}`);
    if (req.method !== 'POST' || !tokenPaths.has(url.pathname)) {
      send(404, { error: 'not_found', error_description: `${req.method ?? ''} ${url.pathname}` });
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = new URLSearchParams(raw);
      const grant = body.get('grant_type');
      const clientId = body.get('client_id');
      requests.push({
        path: url.pathname,
        grant_type: grant,
        client_id: clientId,
        username: body.get('username'),
        hasSecret: body.has('client_secret'),
        hasPassword: body.has('password'),
      });
      const custom = options.respond?.(body);
      if (custom) {
        send(custom.status, custom.body, custom.headers);
        return;
      }
      if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
        send(400, { error: 'invalid_request', error_description: 'form body expected' });
        return;
      }
      if (clientId === null || !(clientId in clients)) {
        send(401, { error: 'invalid_client', error_description: 'Invalid client or Invalid client credentials' });
        return;
      }
      const secret = clients[clientId];
      if (grant === 'password') {
        const username = body.get('username') ?? '';
        if (secret !== null && body.get('client_secret') !== secret) {
          send(401, { error: 'unauthorized_client', error_description: 'Invalid client secret' });
          return;
        }
        if (users[username] === undefined || users[username] !== body.get('password')) {
          send(401, { error: 'invalid_grant', error_description: 'Invalid user credentials' });
          return;
        }
        send(200, {
          access_token: mintToken(username, clientId),
          token_type: 'Bearer',
          ...(options.omitExpiresIn ? {} : { expires_in: expiresIn }),
          scope: body.get('scope') ?? 'profile',
        });
        return;
      }
      if (grant === 'client_credentials') {
        if (secret === null || body.get('client_secret') !== secret) {
          send(401, { error: 'unauthorized_client', error_description: 'Invalid client credentials' });
          return;
        }
        send(200, {
          access_token: mintToken(`service-account-${clientId}`, clientId),
          token_type: 'Bearer',
          ...(options.omitExpiresIn ? {} : { expires_in: expiresIn }),
        });
        return;
      }
      send(400, { error: 'unsupported_grant_type', error_description: `grant ${String(grant)}` });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const origin = `http://localhost:${String(port)}`;
      resolve({
        port,
        origin,
        realm,
        tokenUrl: `${origin}/token`,
        keycloak: { url: origin, realm },
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done(undefined));
          }),
      });
    });
  });
}
