/**
 * Cross-platform user-profile config loader for the upstream credentials.
 *
 * Path resolution (matches XDG Base Directory spec where applicable):
 * - $EXTRACT_CONFIG_PATH/config.json (highest, lets tests + ops override the whole path)
 * - $XDG_CONFIG_HOME/extract/config.json (Linux-conventional, set in some shells)
 * - <home>/.config/extract/config.json (default — works on Windows / macOS / Linux)
 *
 * Where `<home>` is `os.homedir()` — Node returns:
 * - `%USERPROFILE%` on Windows (e.g. `C:\Users\<you>`)
 * - `$HOME` on macOS / Linux (e.g. `/Users/<you>`, `/home/<you>`)
 *
 * Token resolution priority (read by `auth.ts`):
 * 1. Process environment variable (e.g. `JIRA_TOKEN`) — wins for CI / containers / shell exports.
 * 2. The user-profile config file (this loader).
 * 3. Throw `AuthError` — never default tokens silently.
 *
 * Security invariants:
 * - The file is read at the time it is needed, not eagerly at module load.
 * - On POSIX, a file mode looser than `0600` emits a stderr warning.
 * - Token values never appear in log lines, errors, or stack traces.
 * - No file in this repository contains a real token, and none is meant to.
 *   The config lives in the user profile precisely so that `git add .` cannot
 *   reach it.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import nodePath from 'node:path';
import { z } from 'zod';

/**
 * Leaf folder under `~/.config/`.
 *
 * Resolution order:
 *   1. `$EXTRACT_CONFIG_DIR` — the fork's override, and the migration path for an
 *      existing config directory.
 *   2. the literal `'extract'`.
 *
 * Deriving it from `package.json#name` would be the obvious move and is the one
 * to avoid: a fork renames its manifest, and that rename would silently relocate
 * the config directory of an already-working install. A pinned literal plus one
 * env override is boring and cannot surprise anyone.
 */
function resolveRepoSlug(): string {
  const override = process.env['EXTRACT_CONFIG_DIR']?.trim();
  if (override) return override;
  return 'extract';
}

const REPO_SLUG = resolveRepoSlug();

/**
 * Zod schema for the user-profile config file. Every section is optional —
 * a deployment may bind only the connectors it actually needs.
 *
 * Field naming matches the env-var convention: drop the `JIRA_` prefix and
 * lowercase. e.g. `JIRA_BASE_URL` ↔ `jira.baseUrl`.
 */
export const UserConfigSchema = z
  .object({
    jira: z
      .object({
        baseUrl: z.string().url().optional(),
        email: z.string().email().optional(),
        token: z.string().min(1).optional(),
        /** Default project KEY for write pipelines — front matter wins. */
        project: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    confluence: z
      .object({
        baseUrl: z.string().url().optional(),
        email: z.string().email().optional(),
        token: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    figma: z
      .object({
        baseUrl: z.string().url().optional(),
        token: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    sonar: z
      .object({
        baseUrl: z.string().url().optional(),
        token: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    gitlab: z
      .object({
        baseUrl: z.string().url().optional(),
        token: z.string().min(1).optional(),
        /** Default project (path or numeric id) for write pipelines — front matter wins. */
        project: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    miro: z
      .object({
        baseUrl: z.string().url().optional(),
        token: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    xray: z
      .object({
        baseUrl: z.string().url().optional(),
        clientId: z.string().min(1).optional(),
        clientSecret: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UserConfig = z.infer<typeof UserConfigSchema>;

/**
 * Resolve the absolute path of the user-profile config file.
 * Pure — does not touch the filesystem.
 *
 * Priority:
 *   1. `$EXTRACT_CONFIG_PATH/config.json`              (full override, used by tests)
 *   2. `$XDG_CONFIG_HOME/<REPO_SLUG>/config.json`     (XDG-conformant, Linux)
 *   3. `<home>/.config/<REPO_SLUG>/config.json`       (default, cross-platform)
 *
 * `<REPO_SLUG>` is `'extract'` unless `$EXTRACT_CONFIG_DIR` says otherwise (see `resolveRepoSlug`).
 * On Windows `homedir()` returns `%USERPROFILE%` (e.g. `C:\Users\you`); on
 * macOS / Linux it returns `$HOME`. Forward + backslashes are normalised
 * by `nodePath.join`.
 */
export function getUserConfigPath(): string {
  const override = process.env['EXTRACT_CONFIG_PATH']?.trim();
  if (override) return nodePath.resolve(override, 'config.json');

  const xdg = process.env['XDG_CONFIG_HOME']?.trim();
  if (xdg) return nodePath.resolve(xdg, REPO_SLUG, 'config.json');

  return nodePath.join(homedir(), '.config', REPO_SLUG, 'config.json');
}

/** Optional permission warning on POSIX systems (no-op on Windows). */
function warnIfWorldReadable(path: string): void {
  if (platform() === 'win32') return;
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode & 0o077) {
      process.stderr.write(
        `[user-config] warn: ${path} is mode ${mode.toString(8)}; recommend 0600 (chmod 600 "${path}")\n`,
      );
    }
  } catch {
    // best-effort — not fatal
  }
}

/**
 * Load and validate the user-profile config from disk. Returns an empty object
 * if the file is absent so callers can transparently fall back to env vars.
 *
 * Throws `Error` (not `AuthError` — that lives in `auth.ts`) if the file exists
 * but fails JSON parsing or schema validation. The caller must distinguish
 * "missing" (= fall back to env) from "malformed" (= hard fail).
 */
export function loadUserConfig(): UserConfig {
  const path = getUserConfigPath();
  if (!existsSync(path)) return {};

  warnIfWorldReadable(path);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`user-config: failed to read ${path}: ${message}`, { cause: error });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`user-config: ${path} is not valid JSON`);
  }

  // JSON has no native comments; we let users keep documentation strings at
  // the top level as `$comment`, `$copy_to_windows`, etc. Strip every `$`-
  // prefixed key before schema validation so the strict object keeps biting
  // on real typos.
  if (json !== null && typeof json === 'object' && !Array.isArray(json)) {
    json = Object.fromEntries(Object.entries(json as Record<string, unknown>).filter(([key]) => !key.startsWith('$')));
  }

  const parsed = UserConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`user-config: ${path} failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
