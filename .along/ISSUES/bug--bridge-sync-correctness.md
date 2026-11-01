---
protocol: along
protocol_version: "4.5.4"
slug: bridge-sync-correctness
type: bug
status: in-progress
priority: high
created: 2026-10-31
updated: 2026-11-01
agent: claude-code
tags: [sync, bridge]
blocked_by: []
related: []
---
# Store bridge sync correctness: per-doc queue, mutationId echo suppression, no re-broadcast

## Problem

the store bridge can lose writes (get-then-insert race), re-broadcasts remote changes,
relies on time-window echo suppression and misuses correlationId as mutation id.

Launch position: **6** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

## Requirements
- REQ-1 Commands for the same `collection:id` MUST run strictly in arrival order, one at a time (different docs MAY run concurrently).
- REQ-2 Two concurrent commands for a new id MUST NOT lose a write (one insert, then patches).
- REQ-3 "CDC came from a bus command" MUST be decided by `mutationId` membership, not time.
- REQ-4 Changes applied from a bus command MUST NOT be re-published whatever the declared origin; engine `local`/`remote` changes published per `publishOrigins` (default `['local','remote']`).
- REQ-5 `correlationId` MUST NOT be used as mutation id; absent -> `crypto.randomUUID()`.
- REQ-6 Replay dedup MUST be deterministic (bounded count-based ledger).
- REQ-7 One malformed CDC item MUST NOT end the stream; `isConnected` MUST be false after source error/complete.
- REQ-8 Bus and `cdc$` subscribers MUST receive a deep-cloned, deep-frozen `delta`.
- REQ-9 No unhandled rejections; every `bus.send` caught and routed to `errors$`.
- REQ-10 A bridge on a LiveCollection MUST reject commands for other collections and MUST NOT touch private `rawEngine`.

## Acceptance Criteria
- [x] Every test listed above exists and is green; `pnpm test` and `tsc -b` green.
- [x] `grep -rn "rawEngine" src/` and `grep -rn "void .*send" src/` return nothing.
- [x] No new test asserts "nothing happened" after a fixed `setTimeout`.
- [x] Two-bridge cross-tab test asserts the exact number of `ENTITY_CHANGED` sends (one per original local write).

## Plan

## 6. msgmesh-store: `bug--bridge-sync-correctness` (high, blocked by livestruct #2 and #3)

Problem: the store bridge can lose writes (get-then-insert race), re-broadcasts remote changes,
relies on time-window echo suppression and misuses correlationId as mutation id.

After livestruct #2/#3 local CDC is synchronous and carries `mutationId`/`kind`/`rev`/`origin`, so
the mutationId-based suppression below works without timing. Writes coming from the bus go through
the lazy-commit path; the bridge MUST call `flush()` for commands that carry `durable: true`.
msgmesh-store's worker transport stays a separate bus-level RPC (livestruct cannot depend on it).

Corrections to the review: the re-broadcast bug is specifically that a command whose payload declares
`origin:'remote'|'local'` is recorded under that origin (`storeBridge.ts:311,323`), so its CDC fails the
`origin==='bus'` check (`:208-211`) and is re-published; publishing genuine local changes is intended.
"Bad CDC event ends the stream" is real but low severity (only non-object items; engine never emits them).
Extra finding: `engineAccess.commitRaw` honours `raw.collection` (`livestruct sqliteEngine.ts:282`), so it
is not collection-scoped either. Optional dependency: livestruct `engine.upsertDoc` (not required - the per-doc queue removes the race).

Requirements
- REQ-1 Commands for the same `collection:id` MUST run strictly in arrival order, one at a time (different docs MAY run concurrently).
- REQ-2 Two concurrent commands for a new id MUST NOT lose a write (one insert, then patches).
- REQ-3 "CDC came from a bus command" MUST be decided by `mutationId` membership, not time.
- REQ-4 Changes applied from a bus command MUST NOT be re-published whatever the declared origin; engine `local`/`remote` changes published per `publishOrigins` (default `['local','remote']`).
- REQ-5 `correlationId` MUST NOT be used as mutation id; absent -> `crypto.randomUUID()`.
- REQ-6 Replay dedup MUST be deterministic (bounded count-based ledger).
- REQ-7 One malformed CDC item MUST NOT end the stream; `isConnected` MUST be false after source error/complete.
- REQ-8 Bus and `cdc$` subscribers MUST receive a deep-cloned, deep-frozen `delta`.
- REQ-9 No unhandled rejections; every `bus.send` caught and routed to `errors$`.
- REQ-10 A bridge on a LiveCollection MUST reject commands for other collections and MUST NOT touch private `rawEngine`.

Steps
1. `src/core/keyedQueue.ts`: `KeyedSerialQueue { run<T>(key, task): Promise<T>; size; drain() }` - `Map<string, Promise>`, chain `prev.then(task, task)`, per-task error isolation, delete key when tail settles.
2. `src/core/mutationLedger.ts`: `MutationLedger(capacity=4096)` - `inFlight: Map<id, origin>` (`begin/end`), `applied` insertion-ordered Map (`markApplied` evicts oldest O(1), `wasApplied`).
3. `src/core/applyMutation.ts` (this is T8's dedup extraction): `resolveMutationTarget(store, {boundCollection?}) => MutationTarget{get, insert, patch, remove, boundCollection?}` with adapters for engine, LiveStoreInstance (public `engine`), LiveCollection (`col.get` + `col.engineAccess.commitRaw` with collection forced to `col.name`, throw on mismatch), else `UnsupportedStoreError`; `applyStoreCommand(target, cmd)` - one semantics: CREATE/PATCH/PATCH_PATH create when missing, PATCH_PATH builds nested patch, DELETE on missing = no-op, use `upsertDoc` when available; `normalizeCommand(msg, defaults)` (moves topic/type parsing from `storeBridge.ts:269-309`).
4. `storeBridge.ts` `handleCommand`: synchronously normalize, assign mutationId, drop if `wasApplied || inFlight.has`; then `queue.run(`${c}:${id}`, ...)` with `ledger.begin` / `applyStoreCommand` / catch -> `errors$.next({kind:'command', collection, id, mutationId, correlationId, error})` / finally `end` + `markApplied`.
5. CDC handler: `viaBus = ledger.inFlight.has(mid)` (relies on T1 synchronous CDC); `origin = viaBus ? inFlight.get(mid) ?? 'bus' : raw.origin`; always emit on `cdc$`; publish only if `!viaBus && publishOrigins.includes(origin)`; stamp `sourceId` (bridge UUID) on published events and ignore commands with `payload.sourceId === self` (relay ping-pong guard).
6. `cdcStream.ts`: normalize inside `mergeMap(raw => { try { return of(norm(raw)) } catch(e) { onInvalid?.(e, raw); return EMPTY } })`; `delta: deepFreeze(structuredClone(delta))`, freeze event; `safeSend(bus, params, onError)` = `Promise.resolve().then(() => bus.send(params)).catch(onError)`, used in `publishCdcToBus` and the bridge.
7. Controller: `errors$`; `isConnected = !disposed && sourceAlive`; `dispose()` stops accepting commands; `whenIdle()` = `queue.drain()`.
8. Remove `EchoTracker` usage; `echoSuppressionMs` becomes a `@deprecated` no-op.

Tests (`tests/bridge.test.ts`, new `tests/applyMutation.test.ts`, `tests/keyedQueue.test.ts`)
- 2 PATCH for a new id in one tick -> both fields, one insert CDC then one update.
- PATCH (slowed mock target) then DELETE -> doc deleted.
- `origin:'remote'` command -> `cdc$` origin `remote`, bus spy 0 `ENTITY_CHANGED`.
- Direct engine `local` write -> published exactly once.
- Two commands sharing a `correlationId`, no mutationId -> both applied.
- Same mutationId twice -> second dropped even after `vi.advanceTimersByTime(10_000)`.
- Source emits `null` then valid -> valid delivered, `onInvalid` once; erroring source -> `isConnected === false`.
- Subscriber mutating `payload.delta` throws (frozen), engine doc unchanged.
- Rejecting `bus.send` -> `errors$` emission, no `unhandledRejection`.
- Bridge on `users` collection receiving `orders` topic -> rejected via `errors$`, `orders` empty.

Acceptance
- [x] Every test listed above exists and is green; `pnpm test` and `tsc -b` green.
- [x] `grep -rn "rawEngine" src/` and `grep -rn "void .*send" src/` return nothing.
- [x] No new test asserts "nothing happened" after a fixed `setTimeout`.
- [x] Two-bridge cross-tab test asserts the exact number of `ENTITY_CHANGED` sends (one per original local write).
Risks: suppression correctness depends on T1's synchronous CDC (mitigation: keep id in `inFlight` until the microtask after apply resolves); one `structuredClone` per event (opt-out `freezeEvents:false`); ledger capacity bounds replay dedup (document it).

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
