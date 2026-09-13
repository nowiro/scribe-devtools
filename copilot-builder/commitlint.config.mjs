/**
 * commitlint.config.mjs — Conventional Commits with a closed scope list.
 *
 * `type(scope): subject`, header ≤ 100 characters. The scope names an AREA of the repository, not a
 * project: `apps`, `libs` and `tools` are areas even when a commit touches one application. A new
 * application does not need a new scope; a new area of the repository does.
 *
 * Enforced by `.githooks/commit-msg` (armed with `npm run prepare`). The hook is the only place this
 * file is read — CI validates the code, humans validate the history.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'scope-empty': [2, 'never'],
    'scope-enum': [
      2,
      'always',
      [
        // code
        'apps',
        'libs',
        'tools',
        // vendored tools of the repository
        'alm',
        'browser-inspector',
        // GitHub Copilot configuration and the SDD process
        'agents',
        'sdd',
        // cross-cutting
        'ci',
        'docs',
        'deps',
        'repo',
        'release',
        'security',
      ],
    ],
  },
};
