---
protocol: along
slug: 05-api-reference
title: API Reference
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [05-api-reference, api, contracts, exports]
---

# API Reference

[<- Back to 04. Integration Guide](./topic--04-integration-guide.md) | [Back to Main README](../README.md)

---

All exports are available from the root entry `@actdim/msgmesh-store`. The subpath entries `./bridge`, `./cdc` and `./worker` expose the subsets listed below. The `core` module (section 4) is exported only from the root entry, except `buildNestedPathPatch`, which `./worker` re-exports.

## 1. `@actdim/msgmesh-store/bridge`

### `attachStoreBridge(bus, storeOrCollection, options?)`

```typescript
function attachStoreBridge(
    bus: MsgMeshBusLike,
    storeOrCollection: StoreTarget | null,
    options?: StoreBridgeOptions
): StoreBridgeController;
```

Attaches a store to a bus: listens for commands on `<prefix>.COMMAND` (and `<prefix>.<collection>.COMMAND` when bound), applies them per document in order, emits store CDC on `cdc$` and publishes non-bus changes on `<prefix>.ENTITY_CHANGED`. Throws `UnsupportedStoreError` when the store cannot be resolved. With `null` the bridge has no CDC and reports every command as an error.

### `StoreBridgeOptions`

| Option | Type | Default | Purpose |
|---|---|---|---|
| `channelPrefix` | `string` | `'STORE'` | Prefix of all channels. |
| `enableCdcStream` | `boolean` | `true` | Subscribe to the store CDC stream. Disable for targets without CDC. |
| `enableCommandHandling` | `boolean` | `true` | Register bus command listeners. |
| `defaultOrigin` | `StoreCdcOrigin` | `'local'` for CDC | Origin for CDC events without one; also the command origin fallback (else `'bus'`). |
| `collection` | `string` | target's collection | Bind the bridge to one collection. |
| `secondaryChannelPerCollection` | `boolean` | `false` | Also publish on `<prefix>.<collection>.CHANGED`. |
| `publishOrigins` | `StoreCdcOrigin[]` | `['local', 'remote']` | Origins that are published to the bus. |
| `freezeEvents` | `boolean` | `true` | Clone and deep-freeze CDC events. |
| `ledgerCapacity` | `number` | `4096` | Capacity of the internal `MutationLedger`. |
| `onInvalid` | `(error, rawItem) => void` | - | Called for malformed CDC items (also reported on `errors$`). |
| `echoSuppressionMs` | `number` | - | Deprecated, ignored. |

### `StoreBridgeController`

| Member | Description |
|---|---|
| `isConnected: boolean` | `true` until disposed or the CDC source completes or errors. |
| `isDisposed: boolean` | `true` after `dispose()`. |
| `cdc$: Observable<StoreCdcEvent>` | All store changes, labeled with origin. Throws when the bridge has no store. |
| `errors$: Observable<BridgeErrorEvent>` | Command, bus send and validation errors. |
| `whenIdle(): Promise<void>` | Resolves when all queued commands have settled. |
| `dispose(): void` | Aborts listeners, unsubscribes CDC, completes streams. Idempotent. |
| `disconnect(): void` | Deprecated alias of `dispose()`. |

### Types

- **`StoreCommandType`** - `'CREATE' | 'PATCH' | 'DELETE' | 'PATCH_PATH'`.
- **`StoreCommandPayload<T>`** - `{ type?, action? (deprecated), collection?, id, delta?, data? (deprecated), path?, value?, origin?, correlationId?, mutationId?, durable?, sourceId? }`.
- **`BridgeErrorEvent`** - union of:
  - `BridgeCommandErrorEvent` - `{ kind: 'command', collection?, id?, mutationId?, correlationId?, error }`
  - `BridgeBusSendErrorEvent` - `{ kind: 'bus_send', channel?, topic?, error }`
  - `BridgeValidationErrorEvent` - `{ kind: 'validation', error }`

### `EchoTracker` (deprecated)

```typescript
class EchoTracker {
    constructor(ttlMs?: number); // default 1000
    record(mutationId: string, origin?: StoreCdcOrigin, extra?: { collection?: string; id?: string }): void;
    isEcho(mutationId: string, expectedOrigin?: StoreCdcOrigin): boolean;
    has(mutationId: string): boolean;
    getOrigin(mutationId: string): StoreCdcOrigin | undefined;
    prune(now?: number): void;
    clear(): void;
    readonly size: number;
    dispose(): void;
}
```

Sliding time-window tracker kept for backwards compatibility; `EchoRecord` is its record type. Use `MutationLedger` instead.

## 2. `@actdim/msgmesh-store/cdc`

### Types

- **`StoreCdcType`** - `'insert' | 'update' | 'delete'`.
- **`StoreCdcOrigin`** - `'local' | 'remote' | 'bus'`.
- **`StoreCdcEvent<T>`** - `{ type, collection, id, delta, origin, timestamp, mutationId?, sourceId? }` (all readonly).
- **`CdcSubscriptionOptions`** - `{ channelPrefix?, collection?, id?, originFilter?, typeFilter? }`.
- **`CdcBridgeOptions`** - `{ channelPrefix?, defaultOrigin?, collection?, secondaryChannelPerCollection?, onError?, onInvalid?, freezeEvents? }`.
- **`CdcBridge`** - `{ isDisposed, isConnected, cdc$, dispose(), disconnect() (deprecated) }`.
- **`MsgMeshBusLike`** - `{ send(params): Promise<unknown>; on?(params: MsgMeshBusOnParams): (() => void) | void }`; a real `createMsgBus()` instance satisfies it.
- **`MsgMeshBusOnParams`** - `{ channel, group?, topic?, callback?, handler?, ... }`.
- **`ToStoreCdcObservableOptions`** - `{ defaultCollection?, defaultOrigin?, onInvalid?, freezeEvents? }`.

### Functions

| Function | Signature | Purpose |
|---|---|---|
| `toStoreCdcObservable` | `(source: unknown, options?: ToStoreCdcObservableOptions) => Observable<StoreCdcEvent>` | Normalize an observable, store, engine, engine access or collection into CDC events. Throws when no stream can be found. |
| `filterCdc` | `(options?: CdcSubscriptionOptions) => MonoTypeOperatorFunction<StoreCdcEvent>` | Filter by collection, id, origins and types. |
| `filterCollection` | `(collection: string) => MonoTypeOperatorFunction<StoreCdcEvent>` | Shorthand for `filterCdc({ collection })`. |
| `filterEntity` | `(collection: string, id: string) => MonoTypeOperatorFunction<StoreCdcEvent>` | Shorthand for `filterCdc({ collection, id })`. |
| `publishCdcToBus` | `(bus: MsgMeshBusLike, cdc$: Observable<StoreCdcEvent>, options?: CdcBridgeOptions) => Subscription` | Publish each event on `<prefix>.ENTITY_CHANGED` (and optionally the per-collection channel). |
| `subscribeCdc` | `(bus: MsgMeshBusLike, options?: CdcSubscriptionOptions) => Observable<StoreCdcEvent>` | Cold observable of bus CDC events with filtering; unsubscribing aborts the listener. |
| `createCdcBridge` | `(source: unknown, bus?: MsgMeshBusLike \| null, options?: CdcBridgeOptions) => CdcBridge` | Disposable source-to-bus publisher. |
| `deepFreeze` | `<T>(obj: T, visited?: Set<unknown>) => T` | Recursively freeze an object in place (cycle safe). |
| `safeClone` | `<T>(val: T) => T` | `structuredClone`, falling back to JSON, then a shallow copy. |
| `safeSend` | `(bus, params, onError?) => Promise<unknown>` | Call `bus.send` and route any sync or async failure to `onError`; never rejects. |

## 3. `@actdim/msgmesh-store/worker`

### Client

```typescript
function createWorkerStoreClient(
    portOrWorker: WorkerMessagePortLike,
    options?: WorkerStoreClientOptions
): WorkerStoreClient;
```

**`WorkerStoreClientOptions`** (alias `WorkerClientOptions`):

| Option | Type | Default | Purpose |
|---|---|---|---|
| `initTimeoutMs` | `number` | `5000` | Timeout of the `INIT` handshake. |
| `requestTimeoutMs` | `number` | `10000` | Timeout of every other request. |
| `autoInit` | `boolean` | `true` | Start the handshake immediately. |
| `initPayload` | `Record<string, unknown>` | - | Sent as `INIT.payload`. |
| `terminateOnDispose` | `boolean` | `true` | Call `terminate()` (or `close()`) on the port in `dispose()`. |
| `errorPolicy` | `'fatal' \| 'log'` | `'fatal'` | Whether a port `error` event kills the client. |
| `batch` | `'none' \| 'microtask' \| ((flush) => void)` | none | Request batching. |

**`WorkerStoreClient`**:

| Member | Description |
|---|---|
| `state: WorkerClientState` | `'idle' \| 'initializing' \| 'ready' \| 'dead' \| 'disposed'`. |
| `isReady`, `isDisposed` | State shortcuts. |
| `cdc$: Observable<StoreCdcEvent>` | Refcounted CDC stream from the host. |
| `errors$: Observable<unknown>` | `WorkerDeadError`, unsolicited host errors, `messageerror`. |
| `ready(): Promise<void>` | Run or await the handshake. |
| `reconnect(port?): Promise<void>` | Reset to `idle`, optionally swap the port, resubscribe CDC and handshake again. |
| `create(collection, id, data, options?)` | `CREATE` command; `options.mutationId` optional. |
| `patch(collection, id, delta, options?)` | `PATCH` command. |
| `patchPath(collection, id, path, value, options?)` | `PATCH_PATH` command. |
| `delete(collection, id, options?)` | `DELETE` command. |
| `query<T>(sql, params?): Promise<T[]>` | Raw SQL query in the worker. |
| `dispose()` | Reject pending calls, send `CLOSE`, detach listeners, complete streams, terminate the port. |
| `disconnect?()` | Deprecated alias of `dispose()`. |

### Host

```typescript
function attachWorkerStoreHost(
    storeOrFactory: StoreOrFactory,
    portOrSelf: WorkerMessagePortLike,
    options?: WorkerHostOptions
): WorkerHostController;

function validateStoreForWorker(store: unknown): void;
```

- **`StoreOrFactory`** - a store, or `() => store | Promise<store>`.
- **`WorkerHostOptions`** - `{ defaultOrigin? (default 'local'), collection?, factoryRetries? (default 1) }`.
- **`WorkerHostController`** - `{ isDisposed, store (resolved store or null), dispose() }`. `dispose()` sends `CLOSE`, stops CDC and calls the store's `close()` or `dispose()`.
- **`validateStoreForWorker`** - throws `WorkerHostStorageError` when the store or its engine has a `config` without `forceMemory: true`.

### Channel utilities

| Export | Purpose |
|---|---|
| `safelyClone<T>(data: T): T` | `structuredClone` without fallback; throws `DataCloneError` for non-cloneable data. |
| `addPortListener(port, type, listener)` | Register via `addEventListener`, `on`, `addListener` or `on<type>` property. |
| `removePortListener(port, type, listener)` | Counterpart of `addPortListener`. |
| `InMemoryMessagePort` | In-memory port with microtask delivery; extra members `isClosed`, `triggerError(error)`, `close()`, `terminate()`. |
| `createMessageChannelPair(): { port1, port2 }` | Two connected `InMemoryMessagePort` instances. |
| `buildNestedPathPatch` | Re-export of the core helper. |

### Errors

- **`WorkerDeadError`** - operation on a dead or disposed client; also used to reject pending requests.
- **`WorkerHostStorageError`** - non in-memory store hosted in the worker.

### Wire protocol types

| Type | Shape |
|---|---|
| `WorkerRequestAction` | `'CREATE' \| 'PATCH' \| 'PATCH_PATH' \| 'DELETE'` |
| `WorkerRequestType` | `'INIT' \| 'COMMAND' \| 'QUERY' \| 'BATCH' \| 'CDC_SUBSCRIBE' \| 'CDC_UNSUBSCRIBE' \| 'CLOSE'` |
| `WorkerInitRequest` | `{ id, type: 'INIT', payload?: { storeName?, options?, ... } }` |
| `WorkerCommandRequest` | `{ id, type: 'COMMAND', payload: { type?, action?, collection, docId, delta?, data?, path?, value?, mutationId? } }` |
| `WorkerQueryRequest` | `{ id, type: 'QUERY', payload: { sql, params? } }` |
| `WorkerBatchRequest` | `{ id, type: 'BATCH', payload: WorkerClientRequest[] }` |
| `WorkerCdcSubscribeMessage` / `WorkerCdcUnsubscribeMessage` | `{ type: 'CDC_SUBSCRIBE' }` / `{ type: 'CDC_UNSUBSCRIBE' }` |
| `WorkerCloseMessage` | `{ type: 'CLOSE', reason? }` (both directions) |
| `WorkerClientRequest` | Union of all client-to-host messages. |
| `WorkerInitResponse` | `{ id, type: 'INIT_OK', payload? }` |
| `WorkerCommandResponse` | `{ id, type: 'COMMAND_OK', payload?: { mutationId?, ... } }` |
| `WorkerQueryResponse` | `{ id, type: 'QUERY_OK', payload: { rows } }` |
| `WorkerBatchResultItem` | `{ id, success, result?, error? }` |
| `WorkerBatchResponse` | `{ id, type: 'BATCH_OK', payload: { results } }` |
| `WorkerCdcResponse` | `{ type: 'CDC', payload: StoreCdcEvent }` |
| `WorkerCdcBatchMessage` | `{ type: 'CDC_BATCH', payload: StoreCdcEvent[] }` |
| `WorkerErrorResponse` | `{ id?, type: 'ERROR', error: { message, name?, stack?, code? } }` |
| `WorkerHostMessage` | Union of all host-to-client messages. |
| `WorkerMessageEventLike<T>` | `{ data: T }` |
| `WorkerMessagePortLike` | `postMessage` plus optional listener methods, `onmessage`/`onerror`/`onclose`, `terminate`, `close`, `start`. |

## 4. Core (root entry only)

### `MutationLedger`

```typescript
class MutationLedger {
    constructor(capacity?: number); // default 4096
    readonly capacity: number;
    readonly inFlight: Map<string, string>;
    readonly applied: Map<string, number>;
    begin(mutationId: string, origin: string): void;
    end(mutationId: string): void;
    isInFlight(mutationId: string): boolean;
    getInFlightOrigin(mutationId: string): string | undefined;
    markApplied(mutationId: string, origin?: string): void;
    wasApplied(mutationId: string): boolean;
    clear(): void;
}
```

### `KeyedSerialQueue`

```typescript
class KeyedSerialQueue {
    readonly size: number;
    run<T>(key: string, task: () => Promise<T>): Promise<T>;
    drain(): Promise<void>;
}
```

### Command and target functions

| Export | Signature | Purpose |
|---|---|---|
| `normalizeCommand` | `(msg: unknown, defaults?: NormalizeCommandDefaults) => NormalizedStoreCommand` | Parse a bus message or raw payload; throws on missing `id` or non-object input. |
| `resolveMutationTarget` | `(store: unknown, options?: { boundCollection?: string }) => MutationTarget` | Adapt a collection, store instance, engine or custom target. |
| `applyStoreCommand` | `(target: MutationTarget, cmd: NormalizedStoreCommand) => Promise<unknown>` | Execute upsert / path patch / delete semantics; flush when `durable`. |
| `buildNestedPathPatch` | `(path: string, value: unknown) => Record<string, unknown>` | `'a.b.c', 1` -> `{ a: { b: { c: 1 } } }`. |
| `UnsupportedStoreError` | `class extends Error` | Thrown by `resolveMutationTarget`. |

### Types

- **`NormalizedStoreCommand`** - `{ type, collection, id, delta?, path?, value?, mutationId, correlationId?, origin, durable?, sourceId?, rawPayload? }`.
- **`NormalizeCommandDefaults`** - `{ defaultCollection?, defaultOrigin?, boundCollection? }`.
- **`MutationTarget`** - `{ boundCollection?, get, insert, patch, remove, flush? }` with `(collection, id, ..., mutationId?, origin?)` parameters.
- **`StoreTarget`** - `LiveStoreTarget | LiveEngineTarget | LiveCollectionTarget | CustomStoreTarget`.
- **`LiveEngineTarget`** - `getDoc`, `insertDoc`, `patchDoc`, `deleteDoc`, optional `flush` (LiveStruct engine shape).
- **`LiveCollectionTarget`** - `name`, `get`, `create`, `delete`, optional `flush` (LiveStruct collection shape).
- **`LiveStoreTarget`** - `engine: LiveEngineTarget`, optional `collection(name)`, optional `flush`.
- **`CustomStoreTarget`** - either `{ get, insert?, patch?, remove?, flush? }` with `(collection, id, ...)` methods, or `{ collection(name), flush? }`. Note: `resolveMutationTarget` (and therefore `attachStoreBridge`) only accepts the first form with all four methods present; the `collection(name)` form is resolved only inside `attachWorkerStoreHost`.

---

[<- Back to 04. Integration Guide](./topic--04-integration-guide.md) | [Back to Main README](../README.md)
