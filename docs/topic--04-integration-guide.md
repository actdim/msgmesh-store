---
protocol: along
slug: 04-integration-guide
title: Integration Guide
type: topic
created: 2026-11-01
updated: 2026-11-01
tags: [04-integration-guide, install, livestruct, msgmesh, worker, batching]
---

# Integration Guide

[<- Back to 03. Architecture & Wiring](./topic--03-architecture-and-wiring.md) | [Next: 05. API Reference ->](./topic--05-api-reference.md)

---

## 1. Installation

```bash
pnpm add @actdim/msgmesh-store @actdim/msgmesh @actdim/utico rxjs
# optional, when the target store is LiveStruct:
pnpm add @actdim/livestruct
```

### Peer dependencies

| Package | Range | Required | Used for |
|---|---|---|---|
| `rxjs` | `>=7.8.0` | yes | All streams (`cdc$`, `errors$`, operators). The only runtime import of this library. |
| `@actdim/msgmesh` | `>=1.12.0` | yes | The bus passed to `attachStoreBridge`, `createCdcBridge`, `publishCdcToBus`, `subscribeCdc`. |
| `@actdim/utico` | `>=1.12.0` | yes | Peer of `@actdim/msgmesh`. |
| `@actdim/livestruct` | `>=1.12.0` | optional | The typical store target. Any object matching `StoreTarget` works too. |

The library is ESM only (`"type": "module"`) and `sideEffects: false`. It uses `crypto.randomUUID()`, `structuredClone` and `queueMicrotask`, which are available in modern browsers, Web Workers and current Node LTS releases (global `crypto` requires Node 19 or later).

## 2. Bus + Store Bridge on One Thread

```typescript
import { createMsgBus } from '@actdim/msgmesh/core';
import { createLiveStruct } from '@actdim/livestruct';
import { attachStoreBridge, type StoreCdcEvent } from '@actdim/msgmesh-store';

const bus = createMsgBus();
const store = await createLiveStruct({ name: 'workspace_db' });

const bridge = attachStoreBridge(bus, store, {
    channelPrefix: 'STORE',
    publishOrigins: ['local', 'remote'], // default
});

// A decoupled service listens to published changes.
bus.on({
    channel: 'STORE.ENTITY_CHANGED',
    group: 'out',
    topic: '/.*/',
    callback: (msg) => {
        const event = msg.payload as StoreCdcEvent;
        console.log('changed', event.collection, event.id, event.origin);
    },
});

// Any module can write through the bus.
await bus.send({
    channel: 'STORE.COMMAND',
    group: 'in',
    topic: 'users',
    payload: { type: 'PATCH', id: 'u-1', delta: { role: 'admin' }, durable: true },
});

await bridge.whenIdle();
```

Direct writes (`(await store.collection('users')).create(...)`) are published with origin `local`; the `PATCH` sent above is applied but not republished, because it came from the bus.

### Binding a bridge to one collection

Pass a collection as the target, or set `collection`:

```typescript
const parts = await store.collection('parts');
const partsBridge = attachStoreBridge(bus, parts, { channelPrefix: 'PARTS' });

// Listens on PARTS.COMMAND and PARTS.parts.COMMAND
await bus.send({
    channel: 'PARTS.parts.COMMAND',
    group: 'in',
    topic: 'PATCH',
    payload: { id: 'part-101', delta: { color: 'green' } },
});
```

Commands that resolve to a different collection are rejected with an `errors$` event of kind `command`.

### Consuming CDC with filters

```typescript
import { subscribeCdc } from '@actdim/msgmesh-store/cdc';

const sub = subscribeCdc(bus, {
    channelPrefix: 'STORE',
    collection: 'orders',
    originFilter: ['local'],
    typeFilter: ['insert', 'update'],
}).subscribe((e) => audit(e));

// later
sub.unsubscribe(); // aborts the bus listener
```

### Publish-only setups

When you never accept bus commands, use `createCdcBridge` (or `attachStoreBridge` with `enableCommandHandling: false`):

```typescript
import { createCdcBridge } from '@actdim/msgmesh-store/cdc';

const cdcBridge = createCdcBridge(store, bus, {
    channelPrefix: 'STORE',
    secondaryChannelPerCollection: true,
    onError: (err) => console.error('CDC publish failed', err),
});
```

## 3. Store in a Web Worker

### Worker side

```typescript
// store.worker.ts
import { createLiveStruct } from '@actdim/livestruct';
import { attachWorkerStoreHost, type WorkerMessagePortLike } from '@actdim/msgmesh-store/worker';

attachWorkerStoreHost(
    () => createLiveStruct({ name: 'workspace_db', forceMemory: true }),
    self as unknown as WorkerMessagePortLike,
    { factoryRetries: 1 }
);
```

- The factory runs on the first `INIT`; concurrent `INIT`s share one promise. After `factoryRetries + 1` failed attempts the host fails permanently.
- A store whose engine `config.forceMemory` is not `true` throws `WorkerHostStorageError` - a persistent engine must not be hosted by this transport.
- Raw `query()` calls are forwarded to `engine.queryRaw(sql, params, options.collection)` (or `store.query(sql, params)`).

### Main-thread side

```typescript
import { createWorkerStoreClient, type WorkerMessagePortLike } from '@actdim/msgmesh-store/worker';

const worker = new Worker(new URL('./store.worker.ts', import.meta.url), { type: 'module' });
const client = createWorkerStoreClient(worker as unknown as WorkerMessagePortLike, {
    initTimeoutMs: 5000,
    requestTimeoutMs: 10000,
    errorPolicy: 'fatal',
});

client.errors$.subscribe((err) => console.error('worker store', err));
client.cdc$.subscribe((e) => console.log('CDC', e.type, e.collection, e.id));

await client.ready();
await client.create('users', 'u-1', { name: 'Alice' });
await client.patchPath('users', 'u-1', 'settings.theme', 'dark');
```

The casts are needed only because DOM typings declare `onmessage` with `MessageEvent`; the runtime objects satisfy `WorkerMessagePortLike`.

### Lifecycle and recovery

```typescript
import { WorkerDeadError } from '@actdim/msgmesh-store/worker';

try {
    await client.patch('users', 'u-1', { score: 1 });
} catch (err) {
    if (err instanceof WorkerDeadError) {
        const next = new Worker(new URL('./store.worker.ts', import.meta.url), { type: 'module' });
        await client.reconnect(next as unknown as WorkerMessagePortLike);
    }
}

// On shutdown: sends CLOSE, rejects pending calls, terminates the worker
// (set terminateOnDispose: false to keep the port open).
client.dispose();
```

### Forwarding worker CDC to a main-thread bus

```typescript
import { publishCdcToBus } from '@actdim/msgmesh-store/cdc';

const forward = publishCdcToBus(mainBus, client.cdc$, { channelPrefix: 'STORE' });
// forward.unsubscribe() stops forwarding and releases the CDC subscription
```

## 4. Batching Option

Bursts of small requests can be sent as one `postMessage`:

```typescript
const client = createWorkerStoreClient(port, { batch: 'microtask' });

await Promise.all([
    client.create('users', 'u-1', { name: 'A' }),
    client.create('users', 'u-2', { name: 'B' }),
    client.query('SELECT * FROM docs WHERE collection = ?', ['users']),
]); // one BATCH message, one BATCH_OK reply
```

| `batch` value | Behavior |
|---|---|
| `'none'` or omitted | Each request is posted immediately. |
| `'microtask'` | Requests made in the same tick are flushed together in a microtask. |
| `(flush) => void` | Custom scheduler; call `flush()` when the batch should be sent, for example `(flush) => requestAnimationFrame(flush)`. |

Each item in a batch succeeds or fails independently. If the whole `BATCH` fails with an `ERROR`, every item in it is rejected.

## 5. Testing Without a Browser

```typescript
import { createLiveStruct } from '@actdim/livestruct';
import { createMessageChannelPair, attachWorkerStoreHost, createWorkerStoreClient } from '@actdim/msgmesh-store/worker';

const store = await createLiveStruct({ name: 'test', forceMemory: true });
const { port1, port2 } = createMessageChannelPair();
const host = attachWorkerStoreHost(store, port1);
const client = createWorkerStoreClient(port2);

await client.ready();
// ... assertions ...
client.dispose();
host.dispose();
await store.close();
```

For bridge tests, `await bridge.whenIdle()` after sending commands instead of waiting on timers. A mock bus only needs `send` (returning a promise) and `on`.

## 6. Checklist

- Choose one `channelPrefix` per bridge and keep it consistent between producers and consumers.
- Supply a stable `mutationId` when a command may be redelivered; the bridge then applies it once.
- Subscribe to `errors$` on both bridges and worker clients - failures are reported there, not thrown.
- Always `dispose()` bridges, CDC bridges, worker clients and hosts; disposal aborts bus listeners and completes streams.

---

[<- Back to 03. Architecture & Wiring](./topic--03-architecture-and-wiring.md) | [Next: 05. API Reference ->](./topic--05-api-reference.md)
