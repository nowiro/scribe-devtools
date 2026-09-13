/**
 * Typed error hierarchy shared by every pipeline. The CLASS is the contract —
 * callers branch on `instanceof`, never on message text: auth → ask the operator
 * for a token; rate-limit → back off; network → retry; validation → fix the
 * config. (The classes used to carry JSON-RPC numeric codes for the deleted MCP
 * wire protocol; nothing read them, no test pinned them, and a numeric contract
 * nobody guards only drifts — so the hierarchy alone is the contract now.)
 *
 * `http-client.ts` is the only thing that throws most of these; the pipelines
 * catch nothing and let `runIfMain` print one FATAL line.
 */

/** Base error — never throw this directly; subclass instead. */
export class ExtractError extends Error {
  override readonly name: string;

  // No `tool` field: it was written at ~16 throw sites and read by nobody — every
  // message already opens with the tool name, and callers branch on instanceof.
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** 401 / 403 from upstream — token missing, expired, or insufficient scope. */
export class AuthError extends ExtractError {
  constructor(message: string) {
    super('AuthError', message);
  }
}

/** 404 — referenced resource doesn't exist. */
export class NotFoundError extends ExtractError {
  constructor(message: string) {
    super('NotFoundError', message);
  }
}

/** 429 — upstream rate limit. Retried with backoff by `http-client.ts`. */
export class RateLimitError extends ExtractError {
  readonly retryAfterSeconds?: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super('RateLimitError', message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 5xx — upstream is broken. The http client retries these with backoff (see its header). */
export class UpstreamError extends ExtractError {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super('UpstreamError', message);
    this.statusCode = statusCode;
  }
}

/** Transport-level failure (DNS, TCP, TLS, abort, SSRF guard). Retryable. */
export class NetworkError extends ExtractError {
  constructor(message: string) {
    super('NetworkError', message);
  }
}

/** Defence-in-depth guard tripped (path traversal) — caller is buggy or malicious. SSRF preflight throws {@link NetworkError}, not this. */
export class SecurityError extends ExtractError {
  constructor(message: string) {
    super('SecurityError', message);
  }
}
