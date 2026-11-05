---
protocol: along
protocol_version: "4.6.0"
slug: docs-ci-pages-parity
type: task
status: done
completed: 2026-11-05
priority: high
created: 2026-11-05
updated: 2026-11-05
agent: antigravity
tags: [ci, docs, pnpm, github-pages]
blocked_by: []
related: []
---

# Standardize GitHub Pages CI and VitePress docs to match dynstruct

## Problem
In `msgmesh-store`, documentation deployment in `.github/workflows/pages.yml` currently uses a workaround with a temporary npm folder (`RUNNER_TEMP/docs-tools`) and symlinked `node_modules` instead of the standard pnpm workflow used in `dynstruct`.
Furthermore:
1. `msgmesh-store` lacks `.npmrc` with `auto-install-peers=false`.
2. Standalone `pnpm-lock.yaml` is missing in the package root.
3. Unpublished sibling `@actdim/*` packages are listed under `devDependencies` in `package.json`, which breaks standalone CI installs if peer installation is attempted.
4. `.github/workflows/pages.yml` paths triggers omit `package.json`, `pnpm-lock.yaml`, and `src/**`, and it lacks `actions/configure-pages@v5` and standard `pnpm` action setup.
5. `docs/.vitepress/config.ts` is missing the `v-pre` markdown rule for inline code, which `dynstruct` has to prevent Vue template syntax collisions.

## Requirements
- REQ-1: `package.json` MUST define `packageManager: "pnpm@10.21.0"` and keep sibling `@actdim/*` packages in `peerDependencies` only.
- REQ-2: `.npmrc` MUST exist in `msgmesh-store` with `auto-install-peers=false`.
- REQ-3: Isolated standalone `pnpm-lock.yaml` MUST be generated and committed for `msgmesh-store`.
- REQ-4: `.github/workflows/pages.yml` MUST use `pnpm/action-setup@v4`, `actions/setup-node@v4` with `cache: pnpm` and `node-version: 24`, `actions/configure-pages@v5`, `pnpm install --no-frozen-lockfile --config.auto-install-peers=false`, and `pnpm run docs:build`.
- REQ-5: `docs/.vitepress/config.ts` MUST include the `v-pre` rule for `code_inline`.
- REQ-6: Monorepo test and build integrity MUST remain fully operational.

## Acceptance Criteria
- [x] `src/packages/msgmesh-store/.npmrc` created with `auto-install-peers=false`.
- [x] `src/packages/msgmesh-store/package.json` updated (`packageManager`, devDependencies cleaned of `@actdim/*`).
- [x] `src/packages/msgmesh-store/pnpm-lock.yaml` generated and verified.
- [x] `src/packages/msgmesh-store/.github/workflows/pages.yml` matches `dynstruct` CI architecture.
- [x] `src/packages/msgmesh-store/docs/.vitepress/config.ts` matches `dynstruct` markdown rules.
- [x] `pnpm --dir src/packages/msgmesh-store run docs:build` succeeds.
- [x] `pnpm --dir src/packages/msgmesh-store test` succeeds.
- [x] Monorepo build and lint pass cleanly.
