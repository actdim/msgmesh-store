# Execution Plan: debt--perf-tests-and-types

Active Issue: debt--perf-tests-and-types
Execution Mode: Direct

## Steps

1. REQ-1 (Mutation logic deduplication):
   - Verify buildNestedPathPatch exported in src/core/applyMutation.ts.
   - Import buildNestedPathPatch in src/worker/workerHost.ts and src/bridge/storeBridge.ts.
   - Verify git grep "function buildNestedPathPatch" src/ returns exactly 1 line.
   - Confirm executeStoreMutation and executeWorkerMutation deleted.

2. REQ-2 (EchoTracker optimization & deprecation):
   - In src/bridge/echoSuppression.ts:
     - Mark EchoTracker with @deprecated.
     - In record(key, origin): delete key before set to preserve chronological order.
     - In prune(now): iterate Map insertion order and break at the first unexpired entry.
   - Keep exported in src/index.ts and src/bridge/index.ts with @deprecated.

3. REQ-4 & REQ-5 (Typed Public API, Deprecations & Targets):
   - Create src/core/targets.ts defining LiveStoreTarget, LiveEngineTarget, LiveCollectionTarget, CustomStoreTarget, and StoreTarget union.
   - Export targets in src/core/index.ts and src/index.ts.
   - In src/cdc/types.ts: type MsgMeshBusLike with typed send and on.
   - In src/bridge/types.ts: deprecate action, data, disconnect.
   - In src/bridge/storeBridge.ts: type bus as MsgMeshBusLike, store as StoreTarget | null.
   - In src/worker/types.ts: remove unused channelPrefix from WorkerHostOptions; deprecate action, data, disconnect.
   - Remove any in src/ across all files.

4. REQ-3 (Opt-in Worker Batching):
   - In src/worker/types.ts:
     - Add WorkerBatchRequest, WorkerBatchResponse, WorkerCdcBatchMessage, WorkerCdcSubscribeMessage, WorkerCdcUnsubscribeMessage.
     - Add batch option to WorkerStoreClientOptions.
   - In src/worker/workerClient.ts:
     - Support batch scheduling ('none' | 'microtask' | custom function).
     - On flush: if multiple requests queued, send BATCH.
     - On BATCH_OK: resolve/reject individual requests.
     - On CDC_BATCH: emit each event on cdcSubject.
     - On cdc$ refcount 0 -> 1 send CDC_SUBSCRIBE; 1 -> 0 send CDC_UNSUBSCRIBE.
   - In src/worker/workerHost.ts:
     - Handle CDC_SUBSCRIBE and CDC_UNSUBSCRIBE. Suppress CDC when no subscribers.
     - Buffer CDC events in microtask queue and flush as CDC_BATCH.
     - Handle BATCH requests using KeyedSerialQueue and reply with BATCH_OK.
     - Maintain backward compatibility for single unbatched requests.

5. Test Suite Determinism (Zero Fixed Sleeps):
   - Replace all setTimeout(resolve, ...) in tests/keyedQueue.test.ts with deferred promises.
   - Replace all setTimeout(resolve, ...) in tests/bridge.test.ts with whenIdle() and firstValueFrom().
   - Replace all setTimeout(resolve, ...) in tests/cdc.test.ts with firstValueFrom() and callbacks.
   - Replace all setTimeout(resolve, ...) in tests/worker.test.ts with firstValueFrom() and microtask ticks.
   - Verify: git grep "setTimeout(resolve" tests/ returns 0 lines.
   - Verify entire test suite runs in < 3 s.

6. Add New Unit & Type Tests:
   - Type test: attachStoreBridge(123, ...) fails compilation.
   - Worker batching tests: batch: 'microtask', mixed success/failure, CDC subscriber gating.
   - MutationLedger eviction and lifecycle unit tests.

7. Verification & Quality Gates:
   - pnpm test -> 100% pass in < 3s.
   - pnpm typecheck -> 0 errors.
   - pnpm build -> clean build.

8. Completion & Along Wrap:
   - Check off all criteria in .along/ISSUES/debt--perf-tests-and-types.md.
   - Update CHANGELOG.md.
   - along commit & along wrap.
   - git push.
