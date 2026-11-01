---
protocol: along
protocol_version: "4.5.4"
slug: worker-transport-lifecycle
type: bug
status: done
completed: 2026-11-01
priority: medium
created: 2026-10-31
updated: 2026-11-01
agent: claude-code
tags: [worker]
blocked_by: [bug--bridge-sync-correctness]
related: []
---
# Worker transport lifecycle: dead state, CLOSE signalling, memoized factory, strict clone

## Problem

the worker client never detects a dead worker, close is not signalled, the lazy store
factory is not memoized and the in-memory transport hides clone errors.

Launch position: **7** in the ticket map below. Plan approved by the user on 2026-11-01; implement exactly this plan.

## Requirements
- REQ-1 Client states `'idle'|'initializing'|'ready'|'dead'|'disposed'`; in `dead` every call MUST reject immediately with `WorkerDeadError`.
- REQ-2 Fatal `error` MUST reject pending, set `dead`, reset `initPromise`; optional `reconnect(port?)` -> `idle` + re-INIT.
- REQ-3 `messageerror` MUST be non-fatal (log + `errors$`); sender MUST validate cloneability per message (client rejects that request; host answers ERROR with that request's id).
- REQ-4 Host and client `dispose()` MUST post `{type:'CLOSE', reason}`; client on CLOSE -> `dead`; `InMemoryMessagePort.close()` MUST deliver `close` to the peer.
- REQ-5 Lazy store factory MUST be memoized while pending (exactly one call under concurrency); failure clears memo, retried at most `factoryRetries` (default 1), then permanent ERROR.
- REQ-6 `safelyClone` MUST use `structuredClone` strictly (no JSON fallback).
- REQ-7 Host MUST serialize commands per `collection:docId`, enqueuing synchronously on receipt (reuse `KeyedSerialQueue`).

## Acceptance Criteria
- [x] Every test listed above exists and is green; `pnpm test` and `tsc -b` green.
- [x] After a fatal error or CLOSE no call waits for a timeout (fake-timer test: zero timers fired).
- [x] Store factory called exactly once under 5 concurrent first requests.
- [x] `grep -n "JSON.parse" src/worker/channel.ts` returns nothing.
- [x] Hosting a persisted livestruct store inside a worker fails fast with a documented error (test).

## Plan

## 7. msgmesh-store: `bug--worker-transport-lifecycle` (medium, blocked by #6)

Problem: the worker client never detects a dead worker, close is not signalled, the lazy store
factory is not memoized and the in-memory transport hides clone errors.

LiveStore note: a livestruct store with the web adapter cannot be hosted inside a Worker (the
LiveStore web adapter boot check needs `window` and `sessionStorage`). `attachWorkerStoreHost` MUST
document and enforce that a livestruct target inside a worker uses `forceMemory`/in-memory adapter,
and fail fast with a clear error otherwise (test it).

Correction: `messageerror` carries no request id, so "reject only the affected request" is impossible
as stated -> make it non-fatal and catch clone errors per request on the sending side.

Requirements
- REQ-1 Client states `'idle'|'initializing'|'ready'|'dead'|'disposed'`; in `dead` every call MUST reject immediately with `WorkerDeadError`.
- REQ-2 Fatal `error` MUST reject pending, set `dead`, reset `initPromise`; optional `reconnect(port?)` -> `idle` + re-INIT.
- REQ-3 `messageerror` MUST be non-fatal (log + `errors$`); sender MUST validate cloneability per message (client rejects that request; host answers ERROR with that request's id).
- REQ-4 Host and client `dispose()` MUST post `{type:'CLOSE', reason}`; client on CLOSE -> `dead`; `InMemoryMessagePort.close()` MUST deliver `close` to the peer.
- REQ-5 Lazy store factory MUST be memoized while pending (exactly one call under concurrency); failure clears memo, retried at most `factoryRetries` (default 1), then permanent ERROR.
- REQ-6 `safelyClone` MUST use `structuredClone` strictly (no JSON fallback).
- REQ-7 Host MUST serialize commands per `collection:docId`, enqueuing synchronously on receipt (reuse `KeyedSerialQueue`).

Steps
1. `types.ts`: `WorkerCloseMessage {type:'CLOSE'; reason?}` in both unions; `state`, `errors$`, optional `reconnect` on `WorkerStoreClient`; `errorPolicy?: 'fatal'|'log'` (default `'fatal'`).
2. `channel.ts`: strict `safelyClone`; throw synchronously inside `postMessage` (browser behavior); `close()` -> `queueMicrotask(() => peer._dispatch('close', {}))` if peer open.
3. `workerClient.ts`: `state` replaces `isReady` (keep `isReady` getter); fatal `handleError` -> reject pending, `dead`, `initPromise = null`; separate `handleMessageError`; CLOSE message / `close` event handled as fatal; `sendRequest` checks state first; `dispose()` posts CLOSE in try/catch.
4. `workerHost.ts`: `storePromise` + failure counter; COMMAND branch -> `queue.run(key, async () => applyStoreCommand(resolveMutationTarget(await resolveStoreInstance()), cmd))`; `reply(msg)` helper catching clone errors -> ERROR with same id; `dispose()` posts CLOSE; CDC stream error -> `{type:'ERROR', error}` without id -> client `errors$`.

Tests (`tests/worker.test.ts`)
- fatal error then call -> `state==='dead'`, `client.patch` rejects with no timer fired (fake timers).
- host dispose -> pending request rejects with CLOSE reason, state `dead`; `port1.close()` -> client `dead`.
- `messageerror` leaves other pending requests resolvable.
- deferred factory + 5 concurrent `ready()`/`query` -> factory called once; failing factory retried once then permanent ERROR.
- command with a function in payload -> `DataCloneError`, client stays `ready`.
- 20 PATCH to a new id run in order, all fields present.

Acceptance
- [x] Every test listed above exists and is green; `pnpm test` and `tsc -b` green.
- [x] After a fatal error or CLOSE no call waits for a timeout (fake-timer test: zero timers fired).
- [x] Store factory called exactly once under 5 concurrent first requests.
- [x] `grep -n "JSON.parse" src/worker/channel.ts` returns nothing.
- [x] Hosting a persisted livestruct store inside a worker fails fast with a documented error (test).
Risks: browser Worker `error` can be non-fatal (`errorPolicy:'log'`); strict cloning breaks callers relying on silent JSON drops (CHANGELOG).

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
