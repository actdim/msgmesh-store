---
protocol: along
slug: 03-architecture-and-wiring
title: Architecture & Wiring
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [03-architecture-and-wiring, data-flow, echo-suppression, worker, mermaid]
---

# Architecture & Wiring

[<- Back to 02. Core Concepts](./topic--02-core-concepts.md) | [Next: 04. Integration Guide ->](./topic--04-integration-guide.md)

---

## 1. Layers

```mermaid
flowchart TB
    subgraph Consumers
        UI["UI / toolbars<br/>(send commands)"]
        SVC["Decoupled services<br/>(audit, analytics, sync)"]
    end
    BUS["@actdim/msgmesh bus"]
    subgraph MS["@actdim/msgmesh-store"]
        BR["bridge: attachStoreBridge"]
        CDC["cdc: toStoreCdcObservable / createCdcBridge"]
        CORE["core: normalizeCommand, applyStoreCommand,<br/>MutationLedger, KeyedSerialQueue"]
        WK["worker: client / host / channel"]
    end
    STORE["@actdim/livestruct store / engine<br/>(or custom StoreTarget)"]

    UI -->|STORE.COMMAND| BUS
    BUS -->|STORE.ENTITY_CHANGED| SVC
    BUS <--> BR
    BR --> CORE
    BR --> CDC
    WK --> CORE
    WK --> CDC
    CORE -->|insert / patch / remove| STORE
    STORE -->|cdc$| CDC
```

- `core` has no knowledge of the bus or of workers. It normalizes commands, resolves store targets and applies mutations.
- `cdc` turns store streams into `StoreCdcEvent` and moves them to and from the bus.
- `bridge` composes `core` and `cdc` into a bidirectional bus attachment with echo suppression.
- `worker` composes `core` and `cdc` behind a `postMessage` protocol.

## 2. Command Path (bus -> store)

```mermaid
sequenceDiagram
    participant P as Producer
    participant B as MsgMesh bus
    participant SB as Store bridge
    participant L as MutationLedger
    participant Q as KeyedSerialQueue
    participant S as Store

    P->>B: send STORE.COMMAND {type, id, delta, mutationId?}
    B->>SB: handleCommand(msg)
    SB->>SB: normalizeCommand (collection, type, mutationId)
    alt bound collection mismatch / no target / invalid
        SB-->>SB: errors$ (command | validation)
    else own sourceId or mutationId already seen
        SB-->>SB: ignore (duplicate / own echo)
    else accepted
        SB->>Q: run("collection:id")
        Q->>L: begin(mutationId, origin)
        Q->>S: applyStoreCommand (upsert / path patch / remove)
        Q->>L: markApplied + end
    end
```

Key properties:
- Commands for the same `collection:id` are applied in arrival order; other documents proceed in parallel.
- A command with a `mutationId` that is in flight or already applied is dropped, which makes redelivery idempotent.
- `durable: true` additionally awaits `flush()` on the target.

## 3. Change Path (store -> bus)

```mermaid
sequenceDiagram
    participant S as Store cdc$
    participant SB as Store bridge
    participant L as MutationLedger
    participant C as bridge.cdc$
    participant B as MsgMesh bus

    S->>SB: raw change {type, collection, id, delta, mutationId}
    SB->>SB: normalize, clone, deep-freeze
    SB->>L: isInFlight / wasApplied(mutationId)?
    alt applied from a bus command (viaBus)
        SB->>C: emit with origin = command origin (default bus)
        Note over SB,B: not republished - echo suppressed
    else local or remote write
        SB->>C: emit with origin from event (default defaultOrigin)
        opt origin in publishOrigins
            SB->>B: STORE.ENTITY_CHANGED (group out, topic collection, + sourceId)
            opt secondaryChannelPerCollection
                SB->>B: STORE.{collection}.CHANGED (topic id)
            end
        end
    end
```

### Why the loop cannot form

1. A bus command is recorded in the ledger before the store write.
2. The store emits a CDC event with the same `mutationId`.
3. The bridge sees the id in the ledger and does not publish to the bus.
4. If another bridge forwards a published event back as a command with the original `sourceId`, the originating bridge ignores it.

Because the ledger is count-bounded (not time-bounded), suppression does not depend on timing; only ids older than the last `ledgerCapacity` applied mutations are forgotten.

## 4. Bus Topology

| Channel | Group | Topic | Direction | Producer |
|---|---|---|---|---|
| `<prefix>.COMMAND` | `in` or `out` | any (often the collection, or a command verb) | -> store | application |
| `<prefix>.<collection>.COMMAND` | `in` or `out` | any | -> store | application (bound bridges only) |
| `<prefix>.ENTITY_CHANGED` | `out` | collection | <- store | `attachStoreBridge`, `createCdcBridge`, `publishCdcToBus` |
| `<prefix>.<collection>.CHANGED` | `out` | entity id | <- store | same, with `secondaryChannelPerCollection` |

The default prefix is `STORE`. Several bridges with different prefixes can share one bus, for example one per bounded context.

## 5. Worker Topology

```mermaid
flowchart LR
    subgraph Main["Main thread"]
        APP["App code"]
        WC["createWorkerStoreClient"]
    end
    subgraph W["Web Worker"]
        WH["attachWorkerStoreHost"]
        Q2["KeyedSerialQueue"]
        ST["LiveStruct store<br/>(forceMemory: true)"]
    end
    APP -->|create / patch / patchPath / delete / query| WC
    WC -->|INIT, COMMAND, QUERY, BATCH,<br/>CDC_SUBSCRIBE, CDC_UNSUBSCRIBE, CLOSE| WH
    WH -->|INIT_OK, COMMAND_OK, QUERY_OK, BATCH_OK,<br/>CDC, CDC_BATCH, ERROR, CLOSE| WC
    WH --> Q2 --> ST
    ST -->|cdc$| WH
    WC -->|cdc$| APP
```

### Handshake and requests

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Host
    participant S as Store

    C->>H: INIT {id, payload: initPayload}
    H->>S: resolve store (call factory once, retry up to factoryRetries)
    H-->>C: INIT_OK {ready: true}  (or ERROR)
    C->>H: CDC_SUBSCRIBE (first cdc$ subscriber)
    C->>H: COMMAND {type, collection, docId, delta | path+value, mutationId?}
    H->>S: applyStoreCommand (serialized per collection:docId)
    H-->>C: COMMAND_OK {mutationId}
    S-->>H: CDC events
    H-->>C: CDC (one event) or CDC_BATCH (same microtask)
    C->>H: CLOSE (client dispose)
```

Lifecycle rules enforced by the client:
- Every request has a timeout (`requestTimeoutMs`, default 10000; `initTimeoutMs`, default 5000).
- A `CLOSE` message or port `close` event marks the client `dead` and rejects all pending requests with `WorkerDeadError`.
- A port `error` event is fatal under `errorPolicy: 'fatal'` (default) and only reported on `errors$` under `'log'`.
- Requests are checked for cloneability before sending, so a non-cloneable payload rejects immediately instead of breaking the port.

### Batching

With `batch: 'microtask'`, requests issued in the same tick are queued and flushed once:

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Host
    C->>C: create(), patch(), query() in one tick
    C->>H: BATCH {payload: [COMMAND, COMMAND, QUERY]}
    H->>H: execute items (each isolated)
    H-->>C: BATCH_OK {results: [{id, success, result | error}]}
    C->>C: resolve / reject each original promise
```

A single queued request is sent unwrapped. `INIT` is never batched.

## 6. Combining Bridge and Worker

The two halves are independent. A common layout keeps the store in a worker and puts a bus on each side:

- Inside the worker, `attachStoreBridge(workerBus, store)` lets worker-side services exchange commands and CDC on a local bus.
- On the main thread, `createWorkerStoreClient(worker)` provides typed calls and `client.cdc$`; that stream can be forwarded to the main-thread bus with `publishCdcToBus(mainBus, client.cdc$)`.

See [04. Integration Guide](./topic--04-integration-guide.md) for runnable setups.

---

[<- Back to 02. Core Concepts](./topic--02-core-concepts.md) | [Next: 04. Integration Guide ->](./topic--04-integration-guide.md)
