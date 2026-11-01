---
protocol: along
protocol_version: "4.5.4"
slug: architecture
title: System Architecture & Flow
type: architecture
created: 2026-10-30
updated: 2026-11-01
tags: [architecture, bridge, cdc, worker, echo-suppression]
---

# @actdim/msgmesh-store Architecture

## 1. System Overview

`@actdim/msgmesh-store` connects a typed message bus (`@actdim/msgmesh`) with a document store (`@actdim/livestruct` or any structurally compatible target). It moves mutation commands from the bus into the store, moves store changes (CDC) back onto the bus without echo loops, and carries the same protocol across a Web Worker boundary.

```text
+-------------------------------------------------------------------------------------+
|                               @actdim/msgmesh-store                                 |
+-------------------------------------------------------------------------------------+
|  bridge/   attachStoreBridge(bus, store, options) -> StoreBridgeController          |
|            - command listeners on <prefix>.COMMAND and <prefix>.<collection>.COMMAND |
|            - CDC publish on <prefix>.ENTITY_CHANGED (+ <prefix>.<collection>.CHANGED)|
|            - origin filtering (publishOrigins), sourceId self-filter, errors$        |
+-------------------------------------------------------------------------------------+
|  cdc/      toStoreCdcObservable, filterCdc, publishCdcToBus, subscribeCdc,          |
|            createCdcBridge, deepFreeze, safeClone, safeSend                          |
+-------------------------------------------------------------------------------------+
|  worker/   createWorkerStoreClient  <-- postMessage -->  attachWorkerStoreHost       |
|            INIT / COMMAND / QUERY / BATCH / CDC / CDC_BATCH / ERROR / CLOSE          |
|            createMessageChannelPair, InMemoryMessagePort, safelyClone               |
+-------------------------------------------------------------------------------------+
|  core/     normalizeCommand, resolveMutationTarget, applyStoreCommand,              |
|            MutationLedger (echo suppression), KeyedSerialQueue (per-doc ordering)   |
+-------------------------------------------------------------------------------------+
|  Runtime dependency: rxjs only. Bus, store and port are structural interfaces.      |
+-------------------------------------------------------------------------------------+
```

## 2. Core Architectural Principles

### 2.1. Structural boundaries
The library never imports `@actdim/msgmesh` or `@actdim/livestruct` at runtime. It accepts `MsgMeshBusLike`, `StoreTarget` and `WorkerMessagePortLike`, so real buses, real stores and plain test doubles are interchangeable.

### 2.2. One mutation pipeline
The store bridge and the worker host both run commands through `normalizeCommand` (bridge) or the host's command mapper, then `KeyedSerialQueue` keyed by `collection:id`, then `applyStoreCommand`. `CREATE` and `PATCH` are upserts, `PATCH_PATH` writes a nested path, `DELETE` of a missing document is a no-op.

### 2.3. Deterministic echo suppression
`MutationLedger` records every bus-applied `mutationId` (in flight and applied, count-bounded). CDC events carrying such an id are emitted locally but never republished, and duplicate commands are skipped. The time-window `EchoTracker` is deprecated.

### 2.4. Immutable, fault-tolerant streams
CDC events are cloned and deep-frozen by default, malformed items are dropped through `onInvalid`, bus send failures go to `errors$`, and disposal is idempotent everywhere.

### 2.5. Explicit worker lifecycle
The client is a state machine (`idle`, `initializing`, `ready`, `dead`, `disposed`) with request timeouts, `WorkerDeadError` on close, optional microtask batching and refcounted CDC subscription. The host resolves lazy store factories once, rejects non in-memory stores and coalesces CDC per microtask.

Data flow diagrams for each path are in [03. Architecture & Wiring](./topic--03-architecture-and-wiring.md).

## 3. Cross-Links

- [Knowledge Base Index](./INDEX.md) - Knowledge Base Root
- [Overview & Advantages](./topic--01-overview-and-advantages.md) - What the library solves
- [Core Concepts](./topic--02-core-concepts.md) - Bridge, CDC, ledger, queue, targets, worker
- [Architecture & Wiring](./topic--03-architecture-and-wiring.md) - Data flow and mermaid diagrams
- [Integration Guide](./topic--04-integration-guide.md) - Installation and wiring recipes
- [API Reference](./topic--05-api-reference.md) - Every public export
- [Domain Model](./topic--domain-model.md) - Key types and entities
- [Setup & Workflow](./topic--setup-and-workflow.md) - Scripts and monorepo development
- [License](./topic--license.md) - License Information
