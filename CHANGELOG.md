# Changelog

All notable changes to this project will be documented in this file.

## [1.11.1] - 2026-11-01

### Fixed
- Bridge sync correctness: replaced sliding window EchoTracker with deterministic count-based MutationLedger.
- Re-broadcast suppression: changes applied from a bus command are marked viaBus and never re-broadcast to the bus.
- Mutation target resolution: resolved LiveDocEngine, LiveStoreInstance, and LiveCollection using public APIs without touching private rawEngine.
- Serial execution queue: implemented KeyedSerialQueue to serialize operations strictly per collection:id in arrival order while allowing different documents to execute concurrently.
- No unhandled rejections: guarded bus.send with safeSend and routed failures to errors$ stream.
- Event freezing: deep-freeze delta payloads on StoreCdcEvent to protect storage immutability against subscriber mutations.
