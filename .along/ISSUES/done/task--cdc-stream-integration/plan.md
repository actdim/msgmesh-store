# Plan: CDC Stream Integration (task--cdc-stream-integration)

Execution Mode: Direct

## 1. Goal & Objectives
Integrate Change Data Capture (CDC) streaming from low-level SQLite storage engine mutations onto typed MsgMesh channels.

Requirements:
- REQ-1: Listen to low-level engine change events (LiveEngineAccess, LiveCollection, LiveStoreInstance, LiveSqliteEngine).
- REQ-2: Publish typed STORE.ENTITY_CHANGED events onto the MsgMesh bus with address { channel, group: 'out', topic }.
- REQ-3: Support filtering by collection, entity ID, and mutation type without memory leaks.

## 2. Architecture & Design
- Types:
  - `StoreCdcEvent<T>`: typed change payload with type ('insert' | 'update' | 'delete'), collection, id, delta, origin ('local' | 'remote' | 'bus'), timestamp, mutationId.
  - `CdcSubscriptionOptions`: channelPrefix, collection, id, originFilter, typeFilter.
  - `CdcBridgeOptions`: channelPrefix, defaultOrigin, collection.
  - `CdcBridge`: disposable controller exposing isDisposed, cdc$ stream, and dispose().
- Implementation:
  - `toStoreCdcObservable`: polymorphic adapter extracting and normalizing CDC stream from LiveStoreInstance, LiveSqliteEngine, LiveCollection, LiveEngineAccess, or Observable.
  - `filterCdc`, `filterCollection`, `filterEntity`: RxJS filtering operators.
  - `publishCdcToBus`: connects CDC observable stream to MsgMesh bus send().
  - `createCdcBridge`: creates managed, disposable bridge connecting source store and message bus.
  - `subscribeCdc`: convenience helper to consume filtered CDC events from MsgMesh bus using typed addresses.
  - Integration with `attachStoreBridge` in index.ts.
- Module Exports:
  - `src/cdc/types.ts`
  - `src/cdc/cdcStream.ts`
  - `src/cdc/index.ts`
  - `src/cdc.ts`
  - `src/index.ts`

## 3. Test Strategy
Comprehensive test suite in `tests/cdc.test.ts`:
1. Engine mutation triggers CDC event published to MsgMesh bus.
2. Event payload structure verification (type, id, collection, delta, origin, timestamp).
3. Collection and ID filtering (ensuring only matching events pass through).
4. Subscription disposal and unsubscription (ensuring no memory leaks or dangling listeners).
5. Multiple collections concurrently emitting events.
6. Integration with attachStoreBridge controller and cdc$ getter.

## 4. Verification & Wrap-up
- Run test suite: `pnpm --filter @actdim/msgmesh-store test`
- Run typecheck: `pnpm --filter @actdim/msgmesh-store typecheck`
- Run build: `pnpm --filter @actdim/msgmesh-store build`
- Verify ASCII typography.
- Run along wrap and git commit/push across submodule and root repository.
