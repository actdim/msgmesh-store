---
protocol: along
protocol_version: "4.5.4"
slug: perf-tests-and-types
type: debt
status: done
completed: 2026-11-01
priority: low
created: 2026-10-31
updated: 2026-11-01
agent: claude-code
tags: [perf, tests, types]
blocked_by: [bug--bridge-sync-correctness]
related: []
---
# Dedup mutation code, opt-in batching, deterministic tests, typed bus API

## Problem

duplicated mutation code between bridge and worker host, per-command O(n) echo pruning, no
batching, timing-based tests that do not test what they claim, and an untyped bus/store API.

Launch position: **8** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

## Requirements
- REQ-1 Mutation logic MUST exist once (`src/core/applyMutation.ts`, done in T6 step 3); bridge and host identical (PATCH_PATH on missing doc creates it; unsupported store throws).
- REQ-2 `EchoTracker` removed; if exported from `src/index.ts` keep `@deprecated` with fixes (`record` deletes key before set; `prune` stops at first unexpired).
- REQ-3 Optional opt-in batching: `WorkerStoreClientOptions.batch?: 'none'|'microtask'|((flush)=>void)` (function form allows RAF); client sends `{type:'BATCH', id, payload: WorkerClientRequest[]}`, host answers `BATCH_OK` with per-item result/error; host buffers CDC into `CDC_BATCH` per microtask and posts CDC only after `CDC_SUBSCRIBE` (client sends on `cdc$` refcount 0->1, `CDC_UNSUBSCRIBE` on 1->0); host still accepts unbatched messages.
- REQ-4 Typed public API: `MsgMeshBusLike` with typed `send({channel, group:'in'|'out', topic, payload}): Promise<void>` and `on(params) => (() => void) | void`; `attachStoreBridge(bus: MsgMeshBusLike, store: StoreTarget, ...)` with structural `StoreTarget` interfaces in `src/core/targets.ts`; no `any` in `src/` (`@typescript-eslint/no-explicit-any`).
- REQ-5 Deprecate (keep, normalize internally): `action` (use `type`), `data` (use `delta`), `disconnect` (use `dispose`); remove unused `WorkerHostOptions.channelPrefix`; `isConnected` keeps T6 meaning.

## Acceptance Criteria
- [x] `grep -rn "function buildNestedPathPatch" src` shows exactly 1 definition; `executeStoreMutation`/`executeWorkerMutation` deleted.
- [x] `grep -rn "setTimeout(resolve" tests` returns nothing; whole suite runs in < 3 s.
- [x] `tsc -b` green with eslint `no-explicit-any: error` on `src/`.
- [x] Type test proves `attachStoreBridge(123, ...)` does not compile.

## Plan

## 8. msgmesh-store: `debt--perf-tests-and-types` (low, blocked by #6)

Problem: duplicated mutation code between bridge and worker host, per-command O(n) echo pruning, no
batching, timing-based tests that do not test what they claim, and an untyped bus/store API.

Correction: the fatal-error test DOES reach `handleError` (microtask ordering), but depends on that
ordering and asserts nothing about client state afterwards. Dispose test and 60fps test findings confirmed.

Requirements
- REQ-1 Mutation logic MUST exist once (`src/core/applyMutation.ts`, done in T6 step 3); bridge and host identical (PATCH_PATH on missing doc creates it; unsupported store throws).
- REQ-2 `EchoTracker` removed; if exported from `src/index.ts` keep `@deprecated` with fixes (`record` deletes key before set; `prune` stops at first unexpired).
- REQ-3 Optional opt-in batching: `WorkerStoreClientOptions.batch?: 'none'|'microtask'|((flush)=>void)` (function form allows RAF); client sends `{type:'BATCH', id, payload: WorkerClientRequest[]}`, host answers `BATCH_OK` with per-item result/error; host buffers CDC into `CDC_BATCH` per microtask and posts CDC only after `CDC_SUBSCRIBE` (client sends on `cdc$` refcount 0->1, `CDC_UNSUBSCRIBE` on 1->0); host still accepts unbatched messages.
- REQ-4 Typed public API: `MsgMeshBusLike` with typed `send({channel, group:'in'|'out', topic, payload}): Promise<void>` and `on(params) => (() => void) | void`; `attachStoreBridge(bus: MsgMeshBusLike, store: StoreTarget, ...)` with structural `StoreTarget` interfaces in `src/core/targets.ts`; no `any` in `src/` (`@typescript-eslint/no-explicit-any`).
- REQ-5 Deprecate (keep, normalize internally): `action` (use `type`), `data` (use `delta`), `disconnect` (use `dispose`); remove unused `WorkerHostOptions.channelPrefix`; `isConnected` keeps T6 meaning.

Steps
1. Delete `executeStoreMutation` (`storeBridge.ts:27-150`) and `executeWorkerMutation` (`workerHost.ts:30-164`) in favor of `applyMutation` (if not already done in T6/T7).
2. EchoTracker per REQ-2.
3. Types (REQ-4/5), `tsc --noEmit`; keep `unknown` overloads `@deprecated` for one release.
4. Batching (REQ-3) as a separate final commit.
5. Tests rework: replace fixed sleeps (`bridge.test.ts` 221/245/271/329/392/526, `cdc.test.ts` 157/230/238/249/276/348) with `await bridge.whenIdle()` + synchronous spy assertions or `vi.useFakeTimers()` + `vi.runAllTimersAsync()`; two-store sync test asserts exact `send` count per channel (one per original local write); 60fps test -> deterministic `postMessage` count (100, or 1 with `batch:'microtask'`), timing only as `describe.skipIf(process.env.CI)` benchmark; dispose test awaits one microtask so the request is registered, asserts rejection via pending loop + `clearTimeout` spy; fatal-error test registers request explicitly, asserts `state==='dead'`.

Tests to add: table-driven `applyMutation` parity across engine/store/collection adapters through both bridge and host; `KeyedSerialQueue` (per-key order, cross-key parallelism, error doesn't break chain, key cleanup); `MutationLedger` eviction; batch with mixed success/failure; CDC suppressed with no subscribers; type test `attachStoreBridge(123, ...)` fails to compile.

Acceptance
- [x] `grep -rn "function buildNestedPathPatch" src` shows exactly 1 definition; `executeStoreMutation`/`executeWorkerMutation` deleted.
- [x] `grep -rn "setTimeout(resolve" tests` returns nothing; whole suite runs in < 3 s.
- [x] `tsc -b` green with eslint `no-explicit-any: error` on `src/`.
- [x] Type test proves `attachStoreBridge(123, ...)` does not compile.
Risks: stricter types break downstream `unknown` callers (deprecated overloads); batching is a wire-protocol change (host stays backward compatible).

## Ticket map and launch order

| Order | Package | Key | Prio | Blocked by |
|---|---|---|---|---|
| 1 | livestruct | `spike--livestore-integration` (new) | high | - |
| 2 | livestruct | `feat--livestore-engine` (renamed from `feat--worker-engine-lazy-sync`) | high | spike |
| 3 | livestruct | `feat--transparent-lazy-commit` (new) | high | livestore-engine |
| 4 | livestruct-demo | `bug--dnd-freeze-dual-iframe` | high | livestruct #2, #3 |
| 5 | livestruct | `bug--engine-correctness-batch` (rewritten: API-layer bugs only) | medium | transparent-lazy-commit |
| 6 | msgmesh-store | `bug--bridge-sync-correctness` | high | livestruct #2, #3 |
| 7 | msgmesh-store | `bug--worker-transport-lifecycle` | medium | #6 |
| 8 | msgmesh-store | `debt--perf-tests-and-types` | low | #6 |
| 9 | livestruct | `debt--test-coverage-and-naming` (rewritten) | low | #3, #5 |
| - | livestruct | `bug--cross-context-last-writer-wins` -> **superseded** by `feat--livestore-engine` (LiveStore leader worker is the single writer) | - | - |

Rules for every ticket:
- Start with `along start <slug>`, plan approval is already given by this plan; do not widen scope.
- Each acceptance item needs evidence in the ticket's session log: test name, command output, or measured numbers.
- A ticket is not done while any acceptance item is unchecked. No "partially done" wraps.
- Never weaken an existing test to make it pass; changed assertions must be listed with the reason.
- No `any`, no `@ts-ignore`, no `as unknown as` added in new code.
