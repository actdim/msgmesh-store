# Living Plan: adopt-dev-config

## Revision 1 (2026-11-08T17:11:01Z, plan approve --plan-file)

# Phase 2b: adopt @actdim/dev-config in 7 submodules

Execution Mode: Direct (one issue per submodule, done sequentially by this session).

## Context
`@actdim/dev-config@1.12.2` is now on npm (verified), which unblocks `task--adopt-dev-config` in
`dynstruct`, `dynstruct-mui`, `msgmesh`, `msgmesh-remote`, `msgmesh-store`, `utico`, `livestruct`
(parent `task--shared-lint-tsconfig`, epic `task--app-core-extraction`). Goal: local ESLint / Prettier /
tsconfig boilerplate replaced by the shared presets with no change in ESLint findings, effective
compiler options (except listed intentional diffs) or Prettier `--check` lists.

Baselines already captured (scratchpad `before/<pkg>/`: eslint findings, `--print-config` rules of 2 files,
`--showConfig` of every leaf tsconfig, typecheck exit, prettier list) with `scratchpad/snap.mjs`.
All 7: typecheck 0, eslint exit 0.

## Corrections to the filed recipe (found in the code)
- `lib`: keep `["ESNext", "DOM", "DOM.Iterable"]` (code uses `Symbol.dispose` etc.; ES2022 would break). Only `DOM.Iterable` is added.
- Decorator flags: removed everywhere except `utico` (`src/decorators.ts`, `tests/metadata.test.ts` use legacy decorators).
- `isolatedModules: true` kept only if `tsc -b` and `vite build` pass; otherwise stays `false` locally.
- `msgmesh-remote`, `msgmesh-store`: no ESLint today (no config, no script). This issue migrates only tsconfig + Prettier there; adding ESLint is filed as a follow-up issue in each (`debt--add-eslint`).
- `livestruct`: linted today only by Mempart `src/eslint.config.mjs` (`legacyRoot` + `no-explicit-any: error` block). Add a local `eslint.config.mjs` (same content, files `src/**`) and devDeps `eslint`, `@actdim/dev-config` so standalone `pnpm lint` works; the Mempart root block stays.
- Prettier: msgmesh-remote/store/livestruct today resolve Mempart `src/prettier.config.js` (dev-config tailwind preset); they get `export { default } from '@actdim/dev-config/prettier'` locally. The 4 others get `{ ...base, jsxSingleQuote: false, trailingComma: 'all' }` unless the list stays equal without overrides.

## Per-package changes
1. `package.json`: devDependency `"@actdim/dev-config": ">=1.12.2"`; remove plugin devDeps now supplied by dev-config (`@eslint/js`, `@stylistic/eslint-plugin`, `@typescript-eslint/*`, `typescript-eslint`, `eslint-plugin-react*`, `eslint-plugin-jsx-a11y`, `eslint-plugin-prettier`, `eslint-config-prettier`; keep `eslint`, `prettier`, `eslint-formatter-visualstudio`, `eslint-plugin-storybook` and `globals` only if still imported). Prettier `>=3.9.6` where older (peer of dev-config).
2. `eslint.config.mjs`:
   - msgmesh, utico: `base({ tsconfigRootDir: import.meta.dirname, noExplicitAny: 'off' })` + one local overrides block.
   - dynstruct: `base({ ..., noExplicitAny: 'off', indent: 'off', jsx: true, severity: 'warn', extraIgnores: ['demo/**', '**/.storybook/**', '**/jest.config.ts'] })` + `react({ a11y: true })` + overrides.
   - dynstruct-mui: `base({ ..., noExplicitAny: 'off', indent: 'jsx', jsx: true, extraIgnores: [...] })` + `react({ a11y: true })` + overrides.
   - Overrides block = exactly the rules whose `--print-config` value differs from the baseline (expected: `no-misused-promises`, `no-prototype-builtins`, `no-useless-escape`, `no-require-imports`, `no-constant-condition`, `prefer-const` options, `no-unused-vars`, jsx-a11y set), so the rule set equals the baseline.
3. `prettier.config.js` as above.
4. `tsconfig.base.json`: `"extends": ["@actdim/dev-config/tsconfig/base.json", "@actdim/dev-config/tsconfig/loose.json"]` + only options that differ from the presets (path options, `jsx`, `composite`, `noEmit`, `incremental`, `importHelpers`, `removeComments`, `allowImportingTsExtensions`, `allowUmdGlobalAccess`, `types`, `lib`, ...).
5. Lockfiles: Mempart `src/pnpm-lock.yaml` via `pnpm install` from `src/`; each submodule's own `pnpm-lock.yaml` regenerated in a local clone of the submodule commit and copied back (livestruct has none).

Shell rule: never `cd` into a submodule in a top-level command (Along hook D16); use `git -C`, subshells or `--dir`.

## Verification (per package)
- `node snap.mjs after <pkg>` then diff against `before/<pkg>`: eslint findings identical; `rules.*.json` identical; `show.*` diffs only `lib` (+DOM.Iterable), removed decorator flags, `isolatedModules`; prettier list identical; typecheck exit 0.
- `pnpm --dir src/packages/<pkg> run build` and `run test` as at baseline.
- Standalone: `git clone <submodule path> $SCRATCH/sa-<pkg>`, `pnpm install`, `pnpm lint` (where present), `pnpm typecheck`, `pnpm build`.
- Mempart: `pnpm -r --filter "./packages/*" typecheck` and `lint` from `src/`.

## Commits / issues
- Per submodule: issue -> in-progress, commit `chore: adopt @actdim/dev-config presets (refs #adopt-dev-config)`, issue done via `along issue done` / wrap; `dynstruct-mui` blocked_by fixed implicitly.
- Mempart root: one commit with pointer bumps + `src/pnpm-lock.yaml` + epic table row update (refs #app-core-extraction).
- Push to the 7 remotes and the Mempart root only after a separate explicit yes.

## Stop and ask if
- A finding / rule / showConfig diff remains that is not in the allowed list after one override pass.
- typecheck, build or tests differ from baseline.
- A standalone clone fails install for reasons outside these files.
