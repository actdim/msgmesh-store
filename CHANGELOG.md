# Changelog

All notable changes to this project will be documented in this file.

## [1.11.1] - 2026-11-01

### Fixed
- Worker transport lifecycle: explicit client states ('idle' | 'initializing' | 'ready' | 'dead' | 'disposed') with immediate WorkerDeadError on dead or disposed state.
- Close signalling: bidirectional CLOSE message handling and port close event propagation marking client dead and rejecting pending calls.
- Strict cloning: safelyClone uses structuredClone exclusively (zero JSON fallback) and validates cloneability synchronously per message.
- Lazy store factory memoization: concurrent worker store initialization calls share a single factory promise, with retry handling up to factoryRetries before permanent failure.
- Synchronous command serialization: KeyedSerialQueue partitions commands per collection:docId synchronously on receipt in the worker host.
- Worker storage fast-fail: attachWorkerStoreHost validates that LiveStruct stores hosted in worker context use forceMemory / in-memory storage, throwing WorkerHostStorageError otherwise.
- Bridge sync correctness: replaced sliding window EchoTracker with deterministic count-based MutationLedger.
- Re-broadcast suppression: changes applied from a bus command are marked viaBus and never re-broadcast to the bus.
- Mutation target resolution: resolved LiveDocEngine, LiveStoreInstance, and LiveCollection using public APIs without touching private rawEngine.
- Serial execution queue: implemented KeyedSerialQueue to serialize operations strictly per collection:id in arrival order while allowing different documents to execute concurrently.
- No unhandled rejections: guarded bus.send with safeSend and routed failures to errors$ stream.
- Event freezing: deep-freeze delta payloads on StoreCdcEvent to protect storage immutability against subscriber mutations.
