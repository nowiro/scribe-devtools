/**
 * Token loading. One discriminated union per source — env vars and the
 * user-profile config file are read HERE and nowhere else in the codebase, so
 * there is exactly one place to audit when asking "where can a secret come
 * from".
 *
 * Resolution priority:
 *   1. Process environment variable (highest — wins for CI / containers).
 *   2. User-profile config file (`~/.config/extract/config.json`, see `user-config.ts`).
 *   3. Throw `AuthError` — never default a token silently.
 *
 * **Never call a loader at module scope.** A pipeline whose `loadXAuth()` runs on
 * import dies with a stack trace before `main()` gets a chance to print a
 * readable error, and it dies even for `--help`. Every integration ported into
 * this repository had that bug at least once; assume a new one has it too.
 *
 * A missing secret is reported with the stable prefix {@link E_AUTH_MISSING} so
 * it can be told apart from an upstream 401 without parsing prose.
 */
import { AuthError } from './errors.js';
import { getUserConfigPath, loadUserConfig, type UserConfig } from './user-config.js';

interface JiraAuth {
  readonly tool: 'jira';
  readonly baseUrl: string;
  readonly email: string;
  readonly token: string;
}

interface ConfluenceAuth {
  readonly tool: 'confluence';
  readonly baseUrl: string;
  readonly email: string;
  readonly token: string;
}

interface FigmaAuth {
  readonly tool: 'figma';
  readonly baseUrl: string;
  readonly token: string;
}

interface SonarAuth {
  readonly tool: 'sonar';
  readonly baseUrl: string;
  readonly token: string;
}

interface GitLabAuth {
  readonly tool: 'gitlab';
  readonly baseUrl: string;
  readonly token: string;
}

interface MiroAuth {
  readonly tool: 'miro';
  readonly baseUrl: string;
  readonly token: string;
}

export type AuthConfig = JiraAuth | ConfluenceAuth | FigmaAuth | SonarAuth | GitLabAuth | MiroAuth;

/**
 * Stable error code for "no secret in the environment and in the user config".
 * Distinct from an upstream 401/403 (also {@link AuthError}) — there the token exists, it
 * is merely rejected. The stable prefix lets callers and docs grep for it reliably.
 */
export const E_AUTH_MISSING = 'E_AUTH_MISSING';

/** Cache the user-config read for a single Node process (file lookups are cheap but not free). */
let cached: UserConfig | undefined;
function userConfig(): UserConfig {
  cached ??= loadUserConfig();
  return cached;
}

/** Test seam only — the per-process cache would otherwise couple test cases to their order. */
export function resetUserConfigCacheForTests(): void {
  cached = undefined;
}

function fromEnvironment(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

function fromUserConfig<Section extends keyof UserConfig>(
  section: Section,
  key: keyof NonNullable<UserConfig[Section]>,
): string | undefined {
  const block = userConfig()[section];
  if (!block) return undefined;
  const value = (block as Record<string, unknown>)[key as string];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Resolve a required string from env first, user-profile config second; throw
 * `AuthError` otherwise. Renamed from `require` to avoid shadowing the
 * CommonJS built-in (this repo is ESM, but linters and humans both prefer
 * non-shadowing).
 */
function requireSecret<Section extends keyof UserConfig>(
  envVariable: string,
  section: Section,
  key: keyof NonNullable<UserConfig[Section]>,
  tool: string,
): string {
  const value = fromEnvironment(envVariable) ?? fromUserConfig(section, key);
  if (!value) {
    throw new AuthError(
      `${E_AUTH_MISSING}: missing ${tool} secret — set env ${envVariable}, or add ${section as string}.${key as string} to ` +
        `${getUserConfigPath()} (mode 0600 on POSIX; EXTRACT_CONFIG_PATH overrides the directory).`,
    );
  }
  return value;
}

function optional<Section extends keyof UserConfig>(
  envVariable: string,
  section: Section,
  key: keyof NonNullable<UserConfig[Section]>,
  fallback: string,
): string {
  return fromEnvironment(envVariable) ?? fromUserConfig(section, key) ?? fallback;
}

/**
 * The HTTP auth header for a loaded config: Atlassian → Basic, Figma → its own
 * `X-Figma-Token` (the REST API ignores `Authorization: Bearer` — see
 * https://www.figma.com/developers/api#authentication), everything else → Bearer.
 *
 * It lives HERE, next to the loaders, so source #8 is a change to this one file.
 * The transport used to switch on the source union itself, which made every new
 * source a mandatory edit in TWO shared modules — the "no second place to forget"
 * rule the dispatchers are built around, broken one layer down. The header VALUE
 * still never leaves the client's request builder.
 */
export function authHeaderFor(auth: AuthConfig): { readonly name: string; readonly value: string } {
  switch (auth.tool) {
    case 'jira':
    case 'confluence': {
      const token = Buffer.from(`${auth.email}:${auth.token}`).toString('base64');
      return { name: 'authorization', value: `Basic ${token}` };
    }
    case 'figma': {
      return { name: 'x-figma-token', value: auth.token };
    }
    case 'sonar':
    case 'gitlab':
    case 'miro': {
      return { name: 'authorization', value: `Bearer ${auth.token}` };
    }
  }
}

export function loadJiraAuth(): JiraAuth {
  return {
    tool: 'jira',
    baseUrl: requireSecret('JIRA_BASE_URL', 'jira', 'baseUrl', 'jira'),
    email: requireSecret('JIRA_EMAIL', 'jira', 'email', 'jira'),
    token: requireSecret('JIRA_TOKEN', 'jira', 'token', 'jira'),
  };
}

export function loadConfluenceAuth(): ConfluenceAuth {
  return {
    tool: 'confluence',
    baseUrl: requireSecret('CONFLUENCE_BASE_URL', 'confluence', 'baseUrl', 'confluence'),
    email: requireSecret('CONFLUENCE_EMAIL', 'confluence', 'email', 'confluence'),
    token: requireSecret('CONFLUENCE_TOKEN', 'confluence', 'token', 'confluence'),
  };
}

export function loadFigmaAuth(): FigmaAuth {
  return {
    tool: 'figma',
    baseUrl: optional('FIGMA_BASE_URL', 'figma', 'baseUrl', 'https://api.figma.com'),
    token: requireSecret('FIGMA_TOKEN', 'figma', 'token', 'figma'),
  };
}

export function loadSonarAuth(): SonarAuth {
  return {
    tool: 'sonar',
    baseUrl: requireSecret('SONAR_BASE_URL', 'sonar', 'baseUrl', 'sonar'),
    token: requireSecret('SONAR_TOKEN', 'sonar', 'token', 'sonar'),
  };
}

export function loadGitLabAuth(): GitLabAuth {
  return {
    tool: 'gitlab',
    baseUrl: optional('GITLAB_BASE_URL', 'gitlab', 'baseUrl', 'https://gitlab.com/api/v4'),
    token: requireSecret('GITLAB_TOKEN', 'gitlab', 'token', 'gitlab'),
  };
}

export function loadMiroAuth(): MiroAuth {
  return {
    tool: 'miro',
    // One public cloud, one address — unlike GitLab or Sonar there is no self-hosted Miro,
    // so the default is right for everyone and the override exists only for proxies.
    baseUrl: optional('MIRO_BASE_URL', 'miro', 'baseUrl', 'https://api.miro.com'),
    token: requireSecret('MIRO_TOKEN', 'miro', 'token', 'miro'),
  };
}

/**
 * Default WRITE-side project for jira / gitlab. Front matter always WINS — these
 * only fill the gap, so a repo working against one project stops repeating it in
 * every file. An instance property like `baseUrl`, hence the same home and the
 * same env-then-config resolution; absence resolves to undefined, never a guess.
 */
export function defaultJiraProject(): string | undefined {
  return fromEnvironment('JIRA_PROJECT') ?? fromUserConfig('jira', 'project');
}

export function defaultGitLabProject(): string | undefined {
  return fromEnvironment('GITLAB_PROJECT') ?? fromUserConfig('gitlab', 'project');
}
