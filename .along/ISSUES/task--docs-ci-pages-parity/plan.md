# Plan: Standardize GitHub Pages CI and VitePress docs to match dynstruct

Execution Mode: Direct

## Overview
Align `src/packages/msgmesh-store` documentation build and GitHub Actions Pages CI with `src/packages/dynstruct`. Replace the ad-hoc temporary toolchain workaround in `.github/workflows/pages.yml` with a standard pnpm workflow powered by isolated standalone `.npmrc` and `pnpm-lock.yaml`.

## Steps
- [x] Step 1: Package and npmrc Configuration
  - Add "packageManager": "pnpm@10.21.0" to src/packages/msgmesh-store/package.json.
  - Remove "@actdim/livestruct", "@actdim/msgmesh", and "@actdim/utico" from devDependencies in package.json (they are declared under peerDependencies).
  - Create src/packages/msgmesh-store/.npmrc with "auto-install-peers=false".
- [x] Step 2: Generate Standalone Lockfile
  - Generate isolated src/packages/msgmesh-store/pnpm-lock.yaml using "pnpm install --ignore-workspace --lockfile-only --config.auto-install-peers=false".
- [x] Step 3: VitePress Markdown Config Parity
  - Update src/packages/msgmesh-store/docs/.vitepress/config.ts to add the code_inline v-pre markdown rule, matching dynstruct.
- [x] Step 4: GitHub Actions Workflow Parity
  - Update src/packages/msgmesh-store/.github/workflows/pages.yml to replicate dynstruct:
    - Add missing triggers: package.json, pnpm-lock.yaml, src/**.
    - Set up pnpm with actions/checkout@v4, pnpm/action-setup@v4, actions/setup-node@v4 (node-version: 24, cache: pnpm).
    - Add actions/configure-pages@v5.
    - Use "pnpm install --no-frozen-lockfile --config.auto-install-peers=false".
    - Copy llms.txt and llms-full.txt to docs/public.
    - Run "pnpm run docs:build" instead of node_modules/.bin/vitepress.
    - Upload artifact from .dist-docs and deploy with actions/deploy-pages@v4.
- [x] Step 5: Verification
  - Run "pnpm --dir src/packages/msgmesh-store run docs:build".
  - Run "pnpm --dir src/packages/msgmesh-store test".
  - Run monorepo build and lint to confirm no regressions.
