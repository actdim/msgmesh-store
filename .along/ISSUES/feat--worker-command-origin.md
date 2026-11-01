---
protocol: along
protocol_version: "4.6.0"
slug: worker-command-origin
type: feat
status: open
priority: medium
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [worker, origin]
blocked_by: []
related: []
---

# Carry per-command origin across the worker boundary

The worker wire command has no `origin` field, so every command executed by `attachWorkerStoreHost` uses the host's `defaultOrigin`. A per-command origin set on the client side is lost.

## Requirements
- REQ-1: The worker protocol MUST carry an optional per-command `origin`, falling back to `defaultOrigin` when absent.
- REQ-2: The change MUST stay backward compatible with clients that do not send `origin`.

## Acceptance Criteria
- [ ] Test over the in-memory port pair: a client command origin appears on the resulting CDC event.
- [ ] Worker protocol tables in `docs/topic--domain-model.md` updated.
