# @actdim/msgmesh-store

> **Decoupled Message Bus Bridge & Change Data Capture (CDC) Engine Connecting @actdim/msgmesh with Persistent Stores (LiveStruct & LiveStore)**

[![npm version](https://img.shields.io/npm/v/@actdim/msgmesh-store.svg)](https://www.npmjs.com/package/@actdim/msgmesh-store)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 1. What is MsgMesh-Store?

**`@actdim/msgmesh-store`** is the architectural bridge between in-memory message buses (`@actdim/msgmesh`) and local-first persistent stores (`@actdim/livestruct` and `@livestore/livestore`).

### Why is this Integration Needed?

If LiveStore already synchronizes state across browser tabs via SQLite and `BroadcastChannel`, why introduce a message bus?

**LiveStore solves storage, not communication.** A message bus is required whenever interactions cross execution boundaries or involve non-persistent orchestration:

1. **Web Worker Boundary Crossing:**
   Running SQLite WASM and heavy computational solvers in a Web Worker means the main UI thread cannot hold direct MobX proxies. `@actdim/msgmesh-store` bridges commands and change deltas across the `postMessage` boundary with zero proxy serialization overhead.
2. **Change Data Capture (CDC) for Decoupled Services:**
   Decoupled modules (audit logs, analytics, minimaps, cloud sync watermarks) need to react when database records change, without holding direct class instances or query subscriptions to the underlying documents.
3. **Command Bus (CQRS Pipeline):**
   UI toolbars emit domain intents (`cad.command.extrude_face`) rather than mutating database tables directly. The command bus validates topological constraints before committing to storage.
4. **Echo Suppression (Feedback Loop Protection):**
   When a document change emits a bus event and a bus listener triggers a patch, an infinite loop can easily form. The bridge includes built-in origin tracking (`local`, `remote`, `bus`) and debounce guards.

---

## 2. When to Use (and When NOT to Use)

| Scenario | Recommended Approach | Reason |
|---|---|---|
| Local UI Form in the same thread | **Direct MobX / LiveDocument** | Direct property access (`m.color = 'red'`) is 1000x faster, fully type-safe, and avoids magic string paths. |
| UI thread to Web Worker storage | **@actdim/msgmesh-store Bridge** | Serialized delta packets carry data across threads cleanly. |
| Decoupled services (audit, sync) | **Store CDC Events via Bus** | Modules listen to `STORE.ENTITY_CHANGED` without tight coupling to models. |
| High-frequency interactions (60fps drag) | **Pure In-Memory MsgMesh** | Transient events bypass the disk log entirely. |

---

## 3. Quick Code Example

```typescript
import { createMsgBus } from '@actdim/msgmesh';
import { attachStoreBridge } from '@actdim/msgmesh-store';
import { createLiveStruct } from '@actdim/livestruct';

// 1. Instantiate bus and store
const bus = createMsgBus();
const store = await createLiveStruct({ name: 'workspace_db' });
const parts = await store.collection('parts');

// 2. Attach store bridge to bus
const bridge = attachStoreBridge(bus, parts, {
    channelPrefix: 'PARTS',
    enableCdcStream: true,
    enableCommandHandling: true,
});

// 3. Decoupled services listen to CDC stream
bridge.cdc$.subscribe((event) => {
    console.log('CDC event:', event.type, event.id, event.delta);
});

// 4. Remote or worker dispatches command over bus
bus.send({
    channel: 'PARTS.PATCH',
    payload: { id: 'part-101', delta: { color: 'green' } },
});
```

---

## 4. Architecture Overview

```
  [ Local Forms / Dynstruct UI ]         [ Decoupled Services / Minimap / Cloud ]
                |                                          |
        Direct MobX Access                         Listen to Bus Channels
                v                                          v
   +-------------------------+                     +---------------+
   |       LiveStruct        |                     |    MsgMesh    |
   | (High-Level Documents)  |                     |  (Message Bus)|
   +-------------------------+                     +---------------+
                |                                          ^
                | 1. Commit Mutation                       | 2. Stream CDC Deltas
                v                                          |
   +---------------------------------------------------------------+
   |                      @actdim/msgmesh-store                    |
   | (Bridge: Command Handling, Worker Boundary & Echo Suppression)|
   +---------------------------------------------------------------+
                                   |
                                   v
                         [ LiveStore / SQLite ]
```

---

## 5. Installation

```bash
pnpm add @actdim/msgmesh-store @actdim/msgmesh @actdim/livestruct @actdim/utico rxjs
```
