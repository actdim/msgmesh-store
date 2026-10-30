# Plan: Store Bridge and Echo Suppression Engine (task--store-bridge-and-echo-suppression)

Execution Mode: Direct

## 1. Goal & Objectives
Implement bidirectional message bus bridge between @actdim/msgmesh and @actdim/livestruct with origin tracking and feedback loop suppression.

Requirements:
- REQ-1: Bridge MUST translate bus commands into store document mutations.
- REQ-2: Bridge MUST attach origin markers ('local', 'remote', 'bus') to every event.
- REQ-3: Bridge MUST suppress feedback loops when store commits trigger bus notifications.

Acceptance Criteria:
- Command sent on bus updates corresponding document in store.
- Origin tags verify that echoed mutations are dropped.
- Tests verify bidirectional flow without infinite recursions.

## 2. Architecture & Design
- Subsystem in `src/packages/msgmesh-store/src/bridge/`:
  - `types.ts`:
    - `StoreBridgeOptions`: channelPrefix (default 'STORE'), enableCdcStream (default true), enableCommandHandling (default true), echoSuppressionMs (default 1000), defaultOrigin ('local' | 'remote' | 'bus'), collection.
    - `StoreCommandType`: 'CREATE' | 'PATCH' | 'DELETE' | 'PATCH_PATH'.
    - `StoreCommandPayload`: type, action, collection, id, delta, data, path, value, origin, correlationId, mutationId.
    - `StoreBridgeController`: isConnected, isDisposed, cdc$, disconnect(), dispose().
  - `echoSuppression.ts`:
    - `EchoTracker`: in-memory sliding-window TTL cache tracking seen mutation IDs and origin markers to break feedback loops and detect reflected events.
    - Methods: `record(mutationId, origin, extra?)`, `isEcho(mutationId, expectedOrigin?)`, `has(mutationId)`, `getOrigin(mutationId)`, `prune()`, `clear()`, `size`, `dispose()`.
  - `storeBridge.ts`:
    - `attachStoreBridge(bus, storeOrCollection, options)`:
      - Command translation: listens on `{ channel: `${channelPrefix}.COMMAND`, group: 'in' }` and collection-specific command channels. Translates commands into store/collection operations (`collection.get(id)`, `doc.patch(delta)`, `collection.create(id, delta)`, `collection.delete(id)`).
      - Attaches origin: incoming bus commands are tagged with `origin: 'bus'` (or remote).
      - Echo suppression: When store mutation commits and triggers CDC event:
        * If CDC event mutationId matches an in-flight command dispatched by the bridge, echo is suppressed from re-broadcasting to bus.
        * If CDC event originates from local store mutation (`origin: 'local'`), it publishes to bus so external subscribers receive it.
        * If CDC event originates from bus command, it does not re-enter the command handler or produce infinite feedback loops.
  - `src/bridge/index.ts` & `src/bridge.ts`: export bridge functionality.
  - `src/index.ts`: update to export bridge and echo suppression types/methods.

## 3. Test Strategy (`tests/bridge.test.ts`)
1. REQ-1: Command sent on bus updates corresponding document in LiveStruct store (CREATE, PATCH, DELETE, PATCH_PATH).
2. REQ-2: Local document patch in LiveStruct emits CDC event on bus with origin 'local'.
3. REQ-2 & REQ-3: Bus-driven mutation emits with origin 'bus' on local cdc$ stream but is suppressed from re-broadcasting to bus.
4. REQ-3: Origin tags and echo suppression window properly drop duplicate / reflected commands and events.
5. Disconnection cleanly unbinds bus subscriptions and tears down CDC listeners without memory leaks.

## 4. Verification & Wrap-up
- Run test suite: `pnpm --filter @actdim/msgmesh-store test`
- Run typecheck: `pnpm --filter @actdim/msgmesh-store typecheck`
- Run build: `pnpm --filter @actdim/msgmesh-store build`
- Verify ASCII typography.
- Run along wrap and git commit/push across submodule and root repository.
