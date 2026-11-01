# Plan: bridge-sync-correctness

## Implementation Summary
- Refactored `src/bridge/storeBridge.ts`:
  - Replaced legacy executeStoreMutation and EchoTracker with KeyedSerialQueue and MutationLedger.
  - Resolved MutationTarget without accessing private rawEngine.
  - Per-document serialization via KeyedSerialQueue (collection:id).
  - Deterministic mutation echo suppression using MutationLedger.
  - Re-broadcast suppression: changes applied from bus command marked viaBus and never re-broadcast to the bus.
  - Guarded all bus.send calls using safeSend with routing to errors$.
  - Enforced collection boundaries on LiveCollection targets.
  - Handled onInvalid and stream lifecycle (isConnected false on source completion or failure).
- Added comprehensive unit tests in tests/keyedQueue.test.ts, tests/applyMutation.test.ts, tests/bridge.test.ts, and tests/cdc.test.ts.
- Passed 100% of tests (58/58 passing) and tsc -b with 0 errors.
