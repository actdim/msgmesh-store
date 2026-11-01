---
protocol: along
slug: 02-core-concepts
title: Core Concepts
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [02-core-concepts, bridge, cdc, ledger, queue, worker]
---

# Core Concepts

[<- Back to 01. Overview & Advantages](./topic--01-overview-and-advantages.md) | [Next: 03. Architecture & Wiring ->](./topic--03-architecture-and-wiring.md)

---

This page explains each building block on its own. How they are combined is covered in [03. Architecture & Wiring](./topic--03-architecture-and-wiring.md); exact signatures are in [05. API Reference](./topic--05-api-reference.md).

## 1. CDC Events (`StoreCdcEvent`)

Every store change is normalized into one immutable record:

```typescript
interface StoreCdcEvent<T = Record<string, unknown>> {
    readonly type: 'insert' | 'update' | 'delete'; // StoreCdcType
    readonly collection: string;
    readonly id: string;
    readonly delta: Partial<T>;
    readonly origin: 'local' | 'remote' | 'bus'; // StoreCdcOrigin
    readonly timestamp: number;
    readonly mutationId?: string;
    readonly sourceId?: string;
}
```

- **`origin`** says where the change came from: `local` (direct store or engine write), `remote` (replication / sync), `bus` (applied from a bus command).
- **`mutationId`** identifies the write. The bridge uses it for echo suppression and deduplication.
- **`sourceId`** is stamped by a store bridge on the events it publishes to the bus (see section 3).

### Normalizing a source: `toStoreCdcObservable`

`toStoreCdcObservable(source, options)` accepts many shapes and returns an `Observable<StoreCdcEvent>`:

| Source shape | How the stream is found |
|---|---|
| An RxJS `Observable` | Used directly. |
| Object with `engine` (LiveStruct store instance) | Recurses into `source.engine`. |
| Object with `tableName` and `cdc$` (engine access) | Uses `cdc$`; collection defaults to `tableName`. |
| Object with `name` (collection) | Uses `cdc$`, `engineAccess.cdc$` or `engine.cdc$`; collection defaults to `name`. |
| Object with an observable `cdc$` | Uses `cdc$`. |
| Object with `cdcSubject.asObservable()` | Uses that observable. |

For each raw item it maps `type` (unknown values become `update`), resolves `collection` (item, inferred, `defaultCollection`, then `'default'`), reads `delta` or `data`, falls back to `defaultOrigin` (default `local`) and `Date.now()`. Non-object items are passed to `onInvalid` and dropped - the stream keeps running. When `freezeEvents` is not `false`, the delta is cloned (`safeClone`) and the event is deep-frozen (`deepFreeze`).

```typescript
import { Subject } from 'rxjs';
import { toStoreCdcObservable } from '@actdim/msgmesh-store/cdc';

const raw$ = new Subject<unknown>();
const cdc$ = toStoreCdcObservable(raw$, {
    defaultCollection: 'users',
    onInvalid: (err, item) => console.warn('dropped CDC item', item, err),
});

cdc$.subscribe((e) => console.log(e.type, e.collection, e.id, e.delta));
raw$.next({ type: 'insert', id: 'u-1', delta: { name: 'Alice' } });
```

### Filtering: `filterCdc`, `filterCollection`, `filterEntity`

RxJS operators over `StoreCdcEvent` streams:

```typescript
import { filterCdc, filterCollection, filterEntity } from '@actdim/msgmesh-store/cdc';

cdc$.pipe(filterCollection('orders'));
cdc$.pipe(filterEntity('orders', 'ord-42'));
cdc$.pipe(filterCdc({ collection: 'orders', originFilter: ['remote'], typeFilter: ['delete'] }));
```

Empty `originFilter` / `typeFilter` arrays mean "no filter".

## 2. CDC Bridge (`createCdcBridge`)

A CDC bridge is a one-way, disposable connection from a store source to an optional bus. It is the right tool when you only need to *publish* store changes and do not accept bus commands.

```typescript
import { createMsgBus } from '@actdim/msgmesh/core';
import { createLiveEngine } from '@actdim/livestruct';
import { createCdcBridge, subscribeCdc } from '@actdim/msgmesh-store/cdc';

const bus = createMsgBus();
const engine = await createLiveEngine({ name: 'app_db', forceMemory: true });

const cdc = createCdcBridge(engine, bus, { channelPrefix: 'STORE' });

subscribeCdc(bus, { channelPrefix: 'STORE', collection: 'accounts' })
    .subscribe((e) => console.log('account changed', e.id, e.delta));

await engine.insertDoc('accounts', 'acc-1', { balance: 10 });
cdc.dispose();
```

- Events are published on `<prefix>.ENTITY_CHANGED` (group `out`, topic = collection). With `secondaryChannelPerCollection: true` they are also published on `<prefix>.<collection>.CHANGED` (topic = entity id).
- With `collection` set, only that collection's events pass.
- `bus` may be `null` - then the bridge just exposes `cdc$`.
- `isConnected` turns `false` when the source completes or errors, or after `dispose()`.

`publishCdcToBus(bus, cdc$, options)` is the lower-level function that `createCdcBridge` uses; it returns a plain RxJS `Subscription`. `subscribeCdc(bus, options)` is its consumer-side counterpart: a cold `Observable` that registers a bus listener on subscribe and aborts it on unsubscribe.

## 3. Store Bridge (`attachStoreBridge`)

The store bridge is bidirectional: it does everything a CDC bridge does and additionally accepts mutation commands from the bus.

```typescript
import { createMsgBus } from '@actdim/msgmesh/core';
import { createLiveStruct } from '@actdim/livestruct';
import { attachStoreBridge } from '@actdim/msgmesh-store/bridge';

const bus = createMsgBus();
const store = await createLiveStruct({ name: 'workspace_db' });

const bridge = attachStoreBridge(bus, store, { channelPrefix: 'STORE' });

bridge.cdc$.subscribe((e) => console.log(e.origin, e.type, e.collection, e.id));
bridge.errors$.subscribe((err) => console.error(err.kind, err.error));

await bus.send({
    channel: 'STORE.COMMAND',
    group: 'in',
    topic: 'users',
    payload: { type: 'CREATE', id: 'u-100', delta: { name: 'Alice' } },
});

await bridge.whenIdle();
bridge.dispose();
```

### Command channels

The bridge listens (groups `in` and `out`, any topic) on:
- `<prefix>.COMMAND`
- `<prefix>.<boundCollection>.COMMAND` - only when the bridge is bound to a collection (through the `collection` option or because the target is a single collection).

### Command payload (`StoreCommandPayload`)

| Field | Meaning |
|---|---|
| `type` | `CREATE`, `PATCH`, `DELETE` or `PATCH_PATH`. `INSERT` / `UPDATE` are accepted as aliases. Deprecated alias field: `action`. |
| `id` | Document id (`docId` and `entityId` are also accepted). Required. |
| `collection` | Target collection. Optional, see resolution below. |
| `delta` | Fields to write. Deprecated alias: `data`. |
| `path`, `value` | For `PATCH_PATH`: dot path such as `settings.theme` and its new value. |
| `origin` | Origin recorded for the write (default `options.defaultOrigin`, then `bus`). |
| `mutationId` | Deduplication key. A fresh `crypto.randomUUID()` is generated when absent. |
| `correlationId` | Carried through to error events. |
| `durable` | When `true`, the target's `flush()` is awaited after the write. |
| `sourceId` | Commands carrying this bridge's own `sourceId` are ignored. |

`normalizeCommand` resolves the collection in this order: `payload.collection`; the segment before `COMMAND` in a channel like `STORE.users.COMMAND`; the message topic (unless it is a command verb or starts with `/`); the bound collection; `'default'`. The command type falls back to the message topic (for example topic `DELETE`) and finally to `PATCH`.

### Command semantics (`applyStoreCommand`)

| Type | Behavior |
|---|---|
| `CREATE` | Insert; if the document already exists, patch it instead (upsert). |
| `PATCH` | Patch if the document exists; otherwise insert the delta. |
| `PATCH_PATH` | Build a nested patch with `buildNestedPathPatch(path, value)` (for example `{ settings: { theme: 'dark' } }`), then patch-or-insert. |
| `DELETE` | Remove; a missing document or a failing remove is a silent no-op (`false`). |

### Origin filtering and republishing

Store CDC events are always emitted on `bridge.cdc$`. They are published to `<prefix>.ENTITY_CHANGED` only when:
1. the event was **not** produced by a bus command (its `mutationId` is not in the ledger), and
2. its origin is in `publishOrigins` (default `['local', 'remote']`).

Published events carry the bridge `sourceId`. Events produced by a bus command are re-labeled with the command origin (by default `bus`).

### Errors (`errors$`)

| `kind` | Raised when |
|---|---|
| `command` | The command targets a collection other than the bound one, there is no store target, or the store write throws. |
| `bus_send` | Publishing a CDC event to the bus fails. |
| `validation` | A command cannot be normalized (for example missing `id`), a CDC item is malformed, or the CDC source errors. |

## 4. Mutation Ledger (`MutationLedger`)

The ledger is the bridge's deterministic echo-suppression memory. It holds:
- `inFlight` - mutation ids currently being applied, with their origin;
- `applied` - completed mutation ids, bounded by `capacity` (default 4096) with oldest-first eviction.

```typescript
import { MutationLedger } from '@actdim/msgmesh-store';

const ledger = new MutationLedger(1024);
ledger.begin('m-1', 'bus');
ledger.isInFlight('m-1'); // true
ledger.markApplied('m-1');
ledger.end('m-1');
ledger.wasApplied('m-1'); // true
ledger.getInFlightOrigin('m-1'); // 'bus' (falls back to the applied origin)
```

The bridge skips a command whose `mutationId` is in flight or already applied (duplicate delivery), and treats a CDC event with such a `mutationId` as "via bus" (not republished).

> `EchoTracker` (time-window based) and the `echoSuppressionMs` option are deprecated. `attachStoreBridge` does not use them.

## 5. Keyed Serial Queue (`KeyedSerialQueue`)

```typescript
import { KeyedSerialQueue } from '@actdim/msgmesh-store';

const queue = new KeyedSerialQueue();
void queue.run('users:u-1', async () => save(1));
void queue.run('users:u-1', async () => save(2)); // runs after save(1)
void queue.run('users:u-2', async () => save(3)); // runs concurrently
await queue.drain();
```

- Tasks with the same key run one after another in FIFO order; different keys run concurrently.
- A rejected task does not reject later tasks for the same key.
- `size` is the number of keys with pending work; `drain()` waits until all of them settle.

Both the store bridge and the worker host use the key `<collection>:<id>`.

## 6. Mutation Targets

`resolveMutationTarget(store, { boundCollection })` turns a store into a `MutationTarget` (`get`, `insert`, `patch`, `remove`, optional `flush`). Recognized inputs, checked in order:

1. **Collection** - has `name`, `get`, `create`, `delete` (for example a LiveStruct `LiveCollection`). Bound to its `name`; writes use `engineAccess.commitRaw` when present so the `mutationId` is preserved.
2. **Store instance** - has `engine` with `insertDoc`, `patchDoc`, `deleteDoc`, `getDoc`.
3. **Low-level engine** - has `insertDoc`, `patchDoc`, `deleteDoc`, `getDoc` directly.
4. **Custom target** - already implements `get`, `insert`, `patch`, `remove`.

Anything else throws `UnsupportedStoreError`. With a bound collection, operations on another collection throw.

```typescript
import { attachStoreBridge, type StoreTarget } from '@actdim/msgmesh-store';

const memory = new Map<string, Record<string, unknown>>();
const target: StoreTarget = {
    get: async (c, id) => memory.get(`${c}:${id}`) ?? null,
    insert: async (c, id, data) => memory.set(`${c}:${id}`, data),
    patch: async (c, id, p) => memory.set(`${c}:${id}`, { ...memory.get(`${c}:${id}`), ...p }),
    remove: async (c, id) => memory.delete(`${c}:${id}`),
};

// A custom target has no CDC stream, so disable CDC.
const bridge = attachStoreBridge(bus, target, { enableCdcStream: false });
```

## 7. Worker Transport

### Ports (`WorkerMessagePortLike`)

Any object with `postMessage` plus one listener style (`addEventListener`, `on`, `addListener` or `onmessage`/`onerror`/`onclose` properties). `Worker`, `MessagePort`, a worker's `self` and Node `worker_threads` ports all fit; `addPortListener` / `removePortListener` pick the available style.

For tests, `createMessageChannelPair()` returns two connected `InMemoryMessagePort` instances. They clone every message with `structuredClone` (`safelyClone`) and deliver it in a microtask, just like a real port.

### Worker host (`attachWorkerStoreHost`)

Runs next to the store (inside the worker). It answers `INIT`, `COMMAND`, `QUERY` and `BATCH` requests, applies commands through the same `applyStoreCommand` used by the bridge, serializes them per `collection:docId`, and streams CDC back only while the client is subscribed - events produced in the same microtask are coalesced into one `CDC_BATCH` message.

The store may be passed directly or as a (possibly async) factory that is resolved on the first `INIT`. Stores whose engine `config` exists must have `forceMemory: true`; otherwise `WorkerHostStorageError` is thrown.

### Worker client (`createWorkerStoreClient`)

The main-thread facade:

```typescript
import { createMessageChannelPair, attachWorkerStoreHost, createWorkerStoreClient } from '@actdim/msgmesh-store/worker';

const { port1, port2 } = createMessageChannelPair();
const host = attachWorkerStoreHost(store, port1);
const client = createWorkerStoreClient(port2);

await client.ready();
const sub = client.cdc$.subscribe((e) => console.log('worker CDC', e.type, e.id));

await client.create('users', 'usr-1', { name: 'Alice' });
await client.patch('users', 'usr-1', { score: 10 });
await client.patchPath('users', 'usr-1', 'profile.bio', 'Hello');
const rows = await client.query('SELECT * FROM docs WHERE collection = ?', ['users']);
await client.delete('users', 'usr-1');

sub.unsubscribe();
client.dispose();
host.dispose();
```

- **States**: `idle` -> `initializing` -> `ready`; `dead` after a close or fatal error; `disposed` after `dispose()`.
- **`cdc$`** is refcounted: the first subscriber sends `CDC_SUBSCRIBE`, the last unsubscribe sends `CDC_UNSUBSCRIBE`.
- **`errors$`** receives `WorkerDeadError` on close or fatal errors, unsolicited host `ERROR` messages and `messageerror` events.
- **Batching**: `batch: 'microtask'` (or a custom scheduler function) groups requests issued in the same tick into a single `BATCH` message; each request still resolves or rejects individually.

---

[<- Back to 01. Overview & Advantages](./topic--01-overview-and-advantages.md) | [Next: 03. Architecture & Wiring ->](./topic--03-architecture-and-wiring.md)
