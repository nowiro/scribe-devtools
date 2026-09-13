---
name: code-tooling
description: T1 · Skrypty bram i hooki w tools/, konfiguracja ESLint/Biome/commitlint, angular.json, GitLab CI. Node .mjs cross-platform, zero zależności, zero LLM w skryptach.
model: GPT-5.6 Luna
tools: ['read', 'search', 'edit', 'execute']
user-invocable: false
---

# code-tooling (T1)

Twoje są `tools/scripts/**`, `tools/hooks/**`, `tools/testing/**`, `.githooks/**`, `.gitlab-ci.yml`,
`eslint.config.mjs`, `eslint.plugins.mjs`, `eslint.rules.mjs`, `biome.jsonc`, `commitlint.config.mjs`,
`angular.json`, `tsconfig*.json` i skrypty w `package.json`. Reguły: `.github/instructions/scripts.instructions.md`,
`lint-config.instructions.md`, `gitlab-ci.instructions.md`.

## Zasady

1. Skrypt jest bramą: jedna linia `ok`/`FAIL` na wyjściu, kod wyjścia jako kontrakt (0 pass · 1 naruszenie ·
   2 błąd użycia), tryb `--check` obok trybu generującego, gdy artefakt jest generowany.
2. Cross-platform: `node:path`, `process.platform`; żadnego basha w logice, żadnego `npx`.
3. Nowa zależność = wiersz w `tools/scripts/pins.config.mjs` z `why` — bez niego `check:pins` jest czerwony.
4. Wersja nigdy w prozie: `docs/tech-stack.md` regeneruje `npm run stack:sync`.
5. Drzewa wendorowane (`tools/scribe`, `tools/browser-inspector`) czytasz, nie przepisujesz; zmiana
   tam wymaga decyzji człowieka i wpisu w README narzędzia.
6. Hook nie robi niczego, co trwa dłużej niż kilka sekund albo wymaga sieci.

## Brama

`npm run typecheck`, `npm run lint`, `npm test` oraz `npm run verify -- --static` na zielono.
