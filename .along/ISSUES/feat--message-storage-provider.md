---
protocol: along
protocol_version: "4.6.1"
slug: message-storage-provider
type: feat
status: open
priority: high
created: 2026-11-08
updated: 2026-11-08
agent: antigravity
tags: [persistence, msgmesh, livestore, storage-provider, replay]
blocked_by: []
related: []
---

# Implement MsgStorageProvider for durable channel persistence and replay in LiveStore

- Source: `src/bridge/storeBridge.ts`, `src/core/targets.ts`
- Related: `msgmesh/.along/ISSUES/feat--async-publish-and-backpressure.md`, `msgmesh/.along/ISSUES/feat--message-persistence.md`

## Purpose and Context

`@actdim/msgmesh-store` currently bridges document entities between `@actdim/msgmesh` and `@actdim/livestruct` via CQRS command translation (`STORE.COMMAND`) and Change Data Capture (`STORE.ENTITY_CHANGED`). However, it does not provide an engine for persisting actual bus message records (`Msg<TStruct>`).

When `@actdim/msgmesh` activates the `MsgStorageProvider` contract (under `feat--async-publish-and-backpressure`), `@actdim/msgmesh-store` is the designated package in the Actdim ecosystem to supply a production-grade, local-first storage adapter backed by LiveStore (SQLite in WASM/OPFS).

This package will deliver:
1. **Durable Channel Persistence**: Outgoing messages on persistent channels are committed into a local SQLite table before resolution.
2. **Channel Replay and Hydration**: When components mount, workers connect, or tabs start up, recent channel messages can be queried and replayed into local bus subjects.
3. **Cross-Tab Synchronization**: Because all browser tabs connect to the same shared LiveStore SQLite database, writing a message to the persistent store on Tab A makes it discoverable and observable on Tab B without complex peer-to-peer protocols.
4. **Log Pruning and Retention**: Automated cleanup prevents unbounded SQLite database growth using TTL and maximum entry limits per channel.

---

## Architecture & Storage Schema

The persistence engine will be exposed via a dedicated entry point: `@actdim/msgmesh-store/persistence`.

### 1. SQLite Storage Table

```sql
CREATE TABLE IF NOT EXISTS msgmesh_channel_log (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    group_name TEXT NOT NULL,
    topic TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    headers_json TEXT,
    created_at INTEGER NOT NULL,
    status TEXT DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_msgmesh_channel_topic_time 
    ON msgmesh_channel_log(channel, topic, created_at);

CREATE INDEX IF NOT EXISTS idx_msgmesh_channel_time 
    ON msgmesh_channel_log(channel, created_at);
```

### 2. Provider API

```typescript
export interface LiveStoreMessageStorageOptions {
    tableName?: string; // defaults to 'msgmesh_channel_log'
    retention?: {
        maxEntriesPerChannel?: number; // defaults to 1000
        defaultTtlMs?: number; // optional global message TTL
    };
    serializer?: {
        serialize?: (value: unknown) => string;
        deserialize?: (json: string) => unknown;
    };
}

export function createLiveStoreMessageStorage(
    storeOrEngine: StoreTarget,
    options?: LiveStoreMessageStorageOptions
): MsgStorageProvider & {
    prune(channel?: string): Promise<number>;
};
```

---

## Requirements

### 1. Public Export & Target Compatibility
- REQ-1: `@actdim/msgmesh-store` MUST export `createLiveStoreMessageStorage` from `./persistence` and package root.
- REQ-2: The storage engine MUST accept any valid `StoreTarget` (a `LiveStoreTarget`, `LiveEngineTarget`, or custom engine exposing raw SQL or document APIs).

### 2. MsgStorageProvider Contract Implementation
- REQ-3: `LiveStoreMessageStorage` MUST implement the `MsgStorageProvider` contract from `@actdim/msgmesh/contracts`:
  - `saveMessage(msg: Msg<any>): Promise<void>`: Serializes headers and payload to JSON, executing an idempotent `INSERT OR REPLACE` into `msgmesh_channel_log`.
  - `loadMessages(query: MsgStorageQuery): Promise<Msg<any>[]>`: Queries records with parameterized filters for `channel`, optional `topic`, `sinceTimestamp`, and `limit`, returning deserialized `Msg` records ordered by `created_at ASC`.
  - `deleteMessage(messageId: string): Promise<void>`: Deletes the record by primary key `id`.
  - `clearChannel(channel: string): Promise<void>`: Deletes all records matching the specified channel name.

### 3. Serialization and Validation
- REQ-4: `saveMessage` MUST safely serialize headers and payload. If non-serializable elements (circular references, functions, Symbols) are present, it MUST throw an informative serialization error rather than corrupting the database.
- REQ-5: Deserialized `Msg` objects MUST restore original message address (`channel`, `group`, `topic`), reconstructed `headers`, and parsed `payload`.

### 4. Retention and Pruning Policies
- REQ-6: The storage provider MUST provide an automated or scheduled `prune()` mechanism:
  - Deletes messages where `created_at + ttl < Date.now()` (honoring individual message `headers.ttl` or channel default TTL).
  - Enforces `maxEntriesPerChannel` by pruning the oldest records when channel count exceeds the threshold.

### 5. Multi-Tab Idempotency
- REQ-7: Message writes across multiple tabs sharing the same LiveStore worker MUST be safe against race conditions. Insertion MUST use primary key conflict resolution to guarantee that duplicate deliveries do not generate duplicated log rows.

---

## Acceptance Criteria

- [ ] New module `src/persistence/` added with `createLiveStoreMessageStorage`.
- [ ] Export configured in `package.json` (`./persistence` subpath and root index).
- [ ] `saveMessage` writes records to SQLite table with full fidelity for headers and payload.
- [ ] `loadMessages` retrieves messages matching channel, wildcard topics, timestamps, and limit.
- [ ] `deleteMessage` and `clearChannel` properly purge matching rows.
- [ ] Retention policy successfully drops expired messages (TTL) and trims queues exceeding `maxEntriesPerChannel`.
- [ ] Serialization error handling throws descriptive errors on non-serializable payloads.
- [ ] Unit test suite in `tests/persistence.test.ts` covering SQLite CRUD, query filtering, retention pruning, and serialization edge cases.
- [ ] Documentation added in `docs/topic--02-core-concepts.md` and `docs/topic--05-api-reference.md`.
