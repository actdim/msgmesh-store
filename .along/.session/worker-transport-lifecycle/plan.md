# Plan: Worker Transport Lifecycle

## Slug: bug--worker-transport-lifecycle
Active Issue: .along/ISSUES/bug--worker-transport-lifecycle.md
Execution Mode: Direct

## Problem
The worker client never detects a dead worker, close is not signalled, the lazy store factory is not memoized and the in-memory transport hides clone errors.

## Implementation Steps
1. Types (src/worker/types.ts):
   - Export WorkerDeadError (extends Error, name = 'WorkerDeadError').
   - Export WorkerHostStorageError (extends Error, name = 'WorkerHostStorageError').
   - Export WorkerCloseMessage { type: 'CLOSE'; reason?: string } and add to WorkerClientRequest and WorkerHostMessage unions.
   - Update WorkerStoreClient with:
     - state: 'idle' | 'initializing' | 'ready' | 'dead' | 'disposed'
     - errors$: Observable<unknown>
     - reconnect(port?: WorkerMessagePortLike): Promise<void>
     - isReady: boolean (getter returning state === 'ready')
   - Update WorkerStoreClientOptions (and WorkerClientOptions alias) with errorPolicy?: 'fatal' | 'log' (default 'fatal').
   - Update WorkerHostOptions with factoryRetries?: number (default 1).

2. Transport Channel (src/worker/channel.ts):
   - Strict safelyClone using structuredClone ONLY (no JSON fallback, 0 JSON.parse).
   - Synchronous validation on InMemoryMessagePort.postMessage: throw synchronously on uncloneable data.
   - InMemoryMessagePort.close(): deliver 'close' event to peer via queueMicrotask if peer is open.
   - Support 'close' event in addPortListener and removePortListener.

3. Worker Client (src/worker/workerClient.ts):
   - Lifecycle state machine: 'idle' | 'initializing' | 'ready' | 'dead' | 'disposed'.
   - Fast rejection with WorkerDeadError on dead or disposed state.
   - Pre-dispatch clone validation in sendRequest: reject only affected request on DataCloneError, keep state ready.
   - Fatal handleError: reject pending, clear timers, set dead, null initPromise, emit errors$.
   - Non-fatal handleMessageError: log warning, emit errors$, keep pending requests intact.
   - Incoming CLOSE message and port 'close' event: fatal transition to dead with reason, reject pending requests.
   - dispose(): post CLOSE in try/catch before closing port, mark disposed.
   - reconnect(port?): re-bind port listeners, reset to idle, trigger init.

4. Worker Host (src/worker/workerHost.ts):
   - Validate store target for worker: fail fast with WorkerHostStorageError if LiveStruct is not forceMemory / in-memory.
   - Lazy store factory memoization: concurrent requests share pending promise, called once.
   - Failure retry handling: retry at most factoryRetries (default 1), then permanent ERROR.
   - Synchronous command serialization: KeyedSerialQueue per collection:docId.
   - reply() helper: catch clone errors, respond with ERROR for request id.
   - dispose(): post CLOSE before tearing down subscriptions and store.
   - CDC stream error: forward to client as ERROR without request id -> routed to errors$.

5. Tests (tests/worker.test.ts):
   - Acceptance scenario 1: fatal error then call -> state dead, client.patch rejects WorkerDeadError without timers.
   - Acceptance scenario 2: host dispose -> pending request rejects with CLOSE reason, state dead; port1.close() -> client dead.
   - Acceptance scenario 3: messageerror leaves other pending requests resolvable.
   - Acceptance scenario 4: deferred factory + 5 concurrent ready()/query -> factory called once; failing factory retried once then permanent ERROR.
   - Acceptance scenario 5: command with function in payload -> DataCloneError, client stays ready.
   - Acceptance scenario 6: 20 concurrent PATCH to a new id run in order, all fields present.
   - Acceptance scenario 7: hosting persisted livestruct store fails fast with WorkerHostStorageError.

6. Verification and Commit:
   - grep -n "JSON.parse" src/worker/channel.ts returns 0.
   - pnpm test, pnpm typecheck, pnpm build all pass.
   - Update CHANGELOG.md and check off acceptance items in issue file.
   - along commit, along wrap, and git push.
