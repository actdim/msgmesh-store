---
protocol: along
protocol_version: "4.6.0"
slug: store-bridge-dead-options
type: debt
status: open
priority: low
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [bridge, cleanup]
blocked_by: []
related: []
---

# Remove or implement echoSuppressionMs; drop unused import

`StoreBridgeOptions.echoSuppressionMs` is declared but never read by `src/bridge/storeBridge.ts` (echo suppression is ledger-based). `storeBridge.ts` also imports `buildNestedPathPatch` without using it.

## Requirements
- REQ-1: `echoSuppressionMs` MUST either be removed from the public options (with a deprecation note) or affect behaviour.
- REQ-2: Unused imports MUST be removed.

## Acceptance Criteria
- [ ] `pnpm run typecheck` and `pnpm run test` pass.
- [ ] API reference and README reflect the final option set.
