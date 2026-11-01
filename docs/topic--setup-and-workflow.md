---
protocol: along
protocol_version: "4.5.4"
slug: setup-and-workflow
title: Setup, Build & Workflow
type: setup-workflow
created: 2026-10-30
updated: 2026-11-01
tags: [setup, workflow, build, tests, monorepo]
---

# @actdim/msgmesh-store Setup, Build & Workflow

## 1. Prerequisites & Installation

- **Node.js**: a release with global `crypto`, `structuredClone` and `queueMicrotask` (Node 19 or later; current LTS recommended).
- **Package manager**: `pnpm`.
- **TypeScript**: `^5.9.3` (dev dependency).

Install as a consumer:

```bash
pnpm add @actdim/msgmesh-store @actdim/msgmesh @actdim/utico rxjs
pnpm add @actdim/livestruct # optional peer
```

## 2. Scripts

| Command | Action | Description |
|---|---|---|
| `pnpm run test` | `npx vitest --config=vitest.node.config.ts --no-cache` | Runs the Node test suite in `tests/` once. |
| `pnpm run test:w` | `npx vitest --config=vitest.node.config.ts --watch` | Runs the test suite in watch mode. |
| `pnpm run build` | `tsc -b tsconfig.json && vite build` | Typechecks, then builds ESM bundles and `.d.ts` files into `dist/` for the `.`, `./cdc`, `./bridge`, `./worker` entries. |
| `pnpm run typecheck` | `tsc -b tsconfig.json` | Type checks without bundling. |
| `pnpm run format` | `prettier --write .` | Formats the package. |
| `pnpm run format:check` | `prettier --check .` | Verifies formatting. |
| `pnpm run docs:dev` | `vitepress dev docs` | Serves the documentation site locally. |
| `pnpm run docs:build` | `vitepress build docs` | Builds the documentation site. |
| `pnpm run docs:preview` | `vitepress preview docs` | Previews the built site. |

## 3. Test Suite (`tests/`)

The tests run in Node against in-memory LiveStruct stores (`forceMemory: true`) and in-memory ports, so they need no browser:

| File | Covers |
|---|---|
| `bridge.test.ts` | Command translation, origin labeling, echo suppression, ordering, errors, disposal. |
| `cdc.test.ts` | `toStoreCdcObservable`, filters, `publishCdcToBus`, `subscribeCdc`, `createCdcBridge`, secondary channels. |
| `worker.test.ts` | Handshake, lazy factories, commands, queries, CDC streaming, timeouts, close and reconnect, batching. |
| `ledger.test.ts` | `MutationLedger` semantics and capacity eviction. |
| `keyedQueue.test.ts` | `KeyedSerialQueue` ordering, isolation and `drain()`. |
| `applyMutation.test.ts` | `normalizeCommand`, `resolveMutationTarget`, `applyStoreCommand`. |
| `types.test.ts` | Compile-time constraints of the public API. |

Tests are hermetic: they await `whenIdle()`, CDC promises or microtasks rather than fixed timers.

## 4. Development Inside the Mempart Monorepo

- The package lives at `src/packages/msgmesh-store` and is a Git submodule of the mempart repository (`https://github.com/actdim/msgmesh-store.git`).
- It is a member of the pnpm workspace (`src/pnpm-workspace.yaml` includes `packages/*`). With `link-workspace-packages=true` in `src/.npmrc`, the dev dependencies `@actdim/livestruct`, `@actdim/msgmesh` and `@actdim/utico` resolve to the sibling packages in `src/packages/`, so changes there are picked up without publishing.
- Run package scripts from the package folder, or from `src/` with a filter, for example `pnpm --filter @actdim/msgmesh-store test`.
- Versions are synchronized monorepo-wide; do not bump this package's version on its own (the root `pnpm run version:sync <version>` script updates every package together).
- When `@actdim/livestruct` changes its engine or collection shape, run this package's `typecheck` and `test` to confirm the structural targets still match.

## 5. Cross-Links

- [Knowledge Base Index](./INDEX.md) - Knowledge Base Root
- [System Architecture](./topic--architecture.md) - Architecture
- [Domain Model](./topic--domain-model.md) - Domain Model
- [Integration Guide](./topic--04-integration-guide.md) - Integration Guide
- [API Reference](./topic--05-api-reference.md) - API Reference
- [License](./topic--license.md) - License Information
