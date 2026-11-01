---
protocol: along
protocol_version: "4.6.0"
slug: custom-collection-target-unresolved
type: bug
status: open
priority: medium
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [bridge, targets]
blocked_by: []
related: []
---

# CustomStoreTarget { collection(name) } type-checks but attachStoreBridge throws

The `{ collection(name) }` form of `CustomStoreTarget` is accepted by the `StoreTarget` type, but `resolveMutationTarget` (`src/core/targets.ts`) cannot resolve it, so `attachStoreBridge` throws `UnsupportedStoreError`. Only the worker host's internal fallback handles this form. `LiveStoreTarget.collection?()` is likewise never used by target resolution.

## Requirements
- REQ-1: Every shape accepted by the `StoreTarget` type MUST be resolvable by `resolveMutationTarget`, or the type MUST reject the unsupported shapes.

## Acceptance Criteria
- [ ] Test: `attachStoreBridge` with a `{ collection(name) }` target applies CREATE/PATCH/DELETE.
- [ ] `docs/topic--05-api-reference.md` target table updated.
