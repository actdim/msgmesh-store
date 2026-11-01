---
protocol: along
slug: 01-overview-and-advantages
title: Overview & Key Advantages
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [01-overview-and-advantages, overview, msgmesh, livestruct, cdc]
---

# Overview & Key Advantages

[<- Back to README](../README.md) | [Next: 02. Core Concepts ->](./topic--02-core-concepts.md)

---

## What is @actdim/msgmesh-store?

**`@actdim/msgmesh-store`** is a small TypeScript library that connects a typed message bus (`@actdim/msgmesh`) with a document store (`@actdim/livestruct` or any structurally compatible engine). It provides three building blocks:

- **Store bridge** (`attachStoreBridge`) - listens for mutation commands on bus channels, applies them to the store, and republishes the resulting store changes as normalized Change Data Capture (CDC) events, without feeding its own writes back into the bus.
- **CDC stream** (`toStoreCdcObservable`, `createCdcBridge`, `publishCdcToBus`, `subscribeCdc`, `filterCdc`) - turns any engine, collection or observable into an RxJS stream of frozen `StoreCdcEvent` records and optionally publishes them on `<prefix>.ENTITY_CHANGED`.
- **Worker transport** (`createWorkerStoreClient`, `attachWorkerStoreHost`) - runs the store inside a Web Worker (or behind any `postMessage` port) and exposes a promise-based client on the main thread with request timeouts, lifecycle states, optional batching and a refcounted CDC stream.

The library imports only `rxjs` at runtime. The bus, the store and the port are all accepted through structural interfaces (`MsgMeshBusLike`, `StoreTarget`, `WorkerMessagePortLike`), so tests can pass plain objects and production code can pass a real `createMsgBus()` bus and a `createLiveStruct()` store.

---

## Why is this Integration Needed?

A local-first store already handles persistence and, with LiveStruct, cross-tab synchronization. It does not handle *communication*. A bus is needed when interactions cross execution or module boundaries:

1. **Worker boundary crossing.** When SQLite and heavy computation run in a Web Worker, the UI thread cannot hold the live document proxies. The worker transport serializes commands (`CREATE`, `PATCH`, `PATCH_PATH`, `DELETE`), raw SQL queries and CDC deltas across `postMessage` using the structured clone algorithm.
2. **CDC for decoupled services.** Audit logs, analytics, minimaps and sync watermarks want to know that a record changed without importing the collection or holding a query subscription. They subscribe to `STORE.ENTITY_CHANGED` (or a filtered `subscribeCdc(...)` stream) instead.
3. **Command bus.** UI code can emit store intents on `STORE.COMMAND` instead of calling the store directly. The bridge normalizes the payload, serializes writes per document and reports failures on `errors$`.
4. **Feedback loop protection.** When a store change is published on the bus and a bus listener writes back to the store, a loop forms easily. The bridge tracks every bus-applied mutation in a bounded `MutationLedger`, so changes that originated from the bus are never republished to it.

---

## When to Use (and When NOT to Use)

| Scenario | Recommended approach | Reason |
|---|---|---|
| Local UI form in the same thread | Direct LiveStruct document access | Direct property access is faster, fully typed and avoids string channels. |
| UI thread to a store hosted in a Web Worker | `createWorkerStoreClient` + `attachWorkerStoreHost` | Typed request/response protocol with timeouts and a CDC stream. |
| Decoupled services (audit, analytics, sync) | `attachStoreBridge` or `createCdcBridge` + `subscribeCdc` | Consumers listen to `STORE.ENTITY_CHANGED` without coupling to models. |
| Remote or cross-module writers | `attachStoreBridge` command channels | Commands are validated, serialized per document and deduplicated by `mutationId`. |
| High-frequency transient interactions (60 fps drag) | Plain in-memory `@actdim/msgmesh` messages | Transient events do not need to touch the store at all. |

---

## Key Advantages

### 1. Deterministic echo suppression
- Every command applied through the bridge is recorded in a count-bounded `MutationLedger` (default capacity 4096).
- CDC events whose `mutationId` is in the ledger are emitted on the local `cdc$` stream but never republished to the bus.
- No time windows or debounce timers are involved; the old time-based `EchoTracker` is kept only for backwards compatibility and is deprecated.

### 2. Per-document ordering without global locks
- `KeyedSerialQueue` serializes commands per `collection:id` key in arrival order while unrelated documents execute concurrently.
- A failed command never blocks later commands for the same key.
- `whenIdle()` resolves when every queued command has settled - convenient in tests and shutdown paths.

### 3. One mutation semantics everywhere
- Both the bridge and the worker host call the same `applyStoreCommand` function, so `CREATE`, `PATCH`, `PATCH_PATH` and `DELETE` behave identically on the bus and across the worker boundary.
- `resolveMutationTarget` adapts a LiveStruct store instance, a low-level engine, a single collection or a custom object into one `MutationTarget` interface using only public members.

### 4. Safe, immutable CDC events
- CDC deltas are cloned and deep-frozen by default (`freezeEvents`), so a subscriber cannot corrupt store state or another subscriber's view.
- Malformed source items are dropped (and reported through `onInvalid`) without terminating the stream.
- `bus.send` failures are caught by `safeSend` and routed to `errors$` instead of becoming unhandled rejections.

### 5. Explicit worker lifecycle
- Client state is one of `idle`, `initializing`, `ready`, `dead`, `disposed`; calls on a dead or disposed client fail immediately with `WorkerDeadError`.
- Pending requests are rejected on timeout, on a `CLOSE` message, on a port `close` event or on a fatal `error` event.
- `reconnect(port?)` resets a dead client and re-establishes the handshake (and CDC subscription) on the same or a new port.

### 6. Hermetic testing
- `createMessageChannelPair()` returns two connected `InMemoryMessagePort` instances that behave like asynchronous `postMessage` ports, so the full worker protocol runs in Node without DOM globals.
- Every public entry point accepts structural types, so a mock bus is just an object with `send` and `on`.

---

## Package Entry Points

| Import path | Contents |
|---|---|
| `@actdim/msgmesh-store` | Everything below plus the shared `core` module (`MutationLedger`, `KeyedSerialQueue`, `applyStoreCommand`, targets). |
| `@actdim/msgmesh-store/bridge` | `attachStoreBridge`, bridge types, deprecated `EchoTracker`. |
| `@actdim/msgmesh-store/cdc` | CDC types and stream helpers. |
| `@actdim/msgmesh-store/worker` | Worker client, host, wire types and in-memory channel. |

---

## Related Libraries

- **[@actdim/msgmesh](https://github.com/actdim/msgmesh)** - the typed message bus (`createMsgBus` from `@actdim/msgmesh/core`).
- **[@actdim/livestruct](https://actdim.github.io/livestruct/)** - local-first document store (`createLiveStruct`, `createLiveEngine`) whose engines expose the `cdc$` stream consumed here.

---

[<- Back to README](../README.md) | [Next: 02. Core Concepts ->](./topic--02-core-concepts.md)
