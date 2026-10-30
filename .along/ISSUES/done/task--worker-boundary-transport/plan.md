# Plan: Web Worker Boundary Transport for Storage and Compute (task--worker-boundary-transport)

Execution Mode: Direct

## 1. Goal & Objectives
Implement specialized worker transport adapters allowing the store engine to run in a background Web Worker while UI components communicate via lightweight delta packets.

Requirements:
- REQ-1: The transport MUST serialize commands from the main thread to worker via postMessage.
- REQ-2: The transport MUST transfer typed CDC deltas back from worker to main thread.
- REQ-3: The transport MUST handle worker lifecycle, initialization, and error boundaries.

Acceptance Criteria:
- Store engine initializes inside a Web Worker (or Worker-compatible host adapter).
- UI thread dispatches mutations without holding direct SQLite handles.
- Benchmark verifies main thread remains at 60fps during heavy background writes (non-blocking dispatch).

## 2. Architecture & Design
- Subsystem in `src/packages/msgmesh-store/src/worker/`:
  - `types.ts`:
    - Protocol wire messages:
      * `WorkerInitRequest` / `WorkerInitResponse`
      * `WorkerCommandRequest` / `WorkerCommandResponse`
      * `WorkerQueryRequest` / `WorkerQueryResponse`
      * `WorkerCdcResponse` (unsolicited CDC stream delta packet)
      * `WorkerErrorResponse`
    - `WorkerMessagePortLike` interface:
      * `postMessage(data: unknown, transfer?: unknown[]): void`
      * `addEventListener(type: string, listener: (event: any) => void): void`
      * `removeEventListener(type: string, listener: (event: any) => void): void`
      * `terminate?(): void`
    - `WorkerStoreClient`:
      * `isReady: boolean`
      * `cdc$: Observable<StoreCdcEvent>`
      * `create(collection: string, id: string, data: Record<string, unknown>): Promise<void>`
      * `patch(collection: string, id: string, delta: Record<string, unknown>): Promise<void>`
      * `patchPath(collection: string, id: string, path: string, value: unknown): Promise<void>`
      * `delete(collection: string, id: string): Promise<void>`
      * `query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>`
      * `dispose(): void`
    - `WorkerHostController`:
      * `isDisposed: boolean`
      * `dispose(): void`
  - `channel.ts`:
    - In-memory message channel pair (`createMessageChannelPair`) implementing `WorkerMessagePortLike` with asynchronous microtask/queue dispatch for hermetic unit testing without DOM/browser Worker.
  - `workerClient.ts`:
    - `createWorkerStoreClient(portOrWorker, options)`:
      * Sends `INIT` handshake request, waits for `INIT_OK` with configurable timeout.
      * Handles correlation IDs for request-response multiplexing.
      * Forwards incoming `CDC` packets into `cdc$` Observable.
      * Error boundary: captures error events, rejects pending requests on timeout or worker error.
      * Supports graceful cleanup and termination.
  - `workerHost.ts`:
    - `attachWorkerStoreHost(storeOrFactory, portOrSelf, options)`:
      * Responds to `INIT` handshake by resolving or initializing the store.
      * Listens for `COMMAND` messages and executes mutations (`CREATE`, `PATCH`, `PATCH_PATH`, `DELETE`) on the store.
      * Listens for `QUERY` messages and executes raw SQL queries against `store.engine.queryRaw()` or equivalent.
      * Subscribes to store CDC stream via `toStoreCdcObservable` and emits `CDC` response messages over postMessage.
      * Sends error responses if command or query fails, catching exceptions so the worker does not crash.
  - `src/worker/index.ts` & `src/worker.ts`:
    - Re-export types, channel utilities, client, and host functions.
  - `src/index.ts`:
    - Re-export worker module.

## 3. Test Strategy (`tests/worker.test.ts`)
1. Handshake & initialization: client handshakes with host, ready status set.
2. REQ-1 & REQ-2: Client dispatches CREATE, PATCH, PATCH_PATH, DELETE mutations across postMessage; CDC stream emits typed deltas to client.
3. REQ-1: Raw SQL query execution across worker boundary with parameter binding.
4. REQ-3: Error boundary handling:
   - Host catches mutation/query error and returns error response; client promise rejects gracefully.
   - Client timeout handling when worker does not respond in time.
   - Worker termination / error event handling rejects outstanding calls.
5. High-throughput non-blocking write benchmark: simulate 100+ rapid mutations dispatched from main thread without blocking event loop.
6. Disposal & lifecycle cleanup: client and host dispose without leaking subscriptions or event listeners.

## 4. Verification & Wrap-up
- Run test suite: `pnpm --filter @actdim/msgmesh-store test`
- Run typecheck: `pnpm --filter @actdim/msgmesh-store typecheck`
- Run build: `pnpm --filter @actdim/msgmesh-store build`
- Verify ASCII typography.
- Run along wrap and git commit/push across submodule and root repository.
