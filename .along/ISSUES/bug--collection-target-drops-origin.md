---
protocol: along
protocol_version: "4.6.0"
slug: collection-target-drops-origin
type: bug
status: open
priority: medium
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [bridge, cdc, origin]
blocked_by: []
related: []
---

# Collection targets do not forward origin to commitRaw

When a LiveCollection is the mutation target, insert, patch and remove forward `mutationId` but not `origin` to `engineAccess.commitRaw`; the engine and store-instance paths do forward it. CDC consumers therefore see a different origin depending on the target shape.

## Requirements
- REQ-1: All mutation target shapes MUST forward both `mutationId` and `origin`.

## Acceptance Criteria
- [ ] Test: a command applied through a collection target produces a CDC event with the command origin.
