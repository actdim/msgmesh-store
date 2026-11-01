---
protocol: along
protocol_version: "4.6.0"
slug: worker-host-ignores-close
type: bug
status: open
priority: low
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [worker, lifecycle]
blocked_by: []
related: []
---

# attachWorkerStoreHost does not dispose on client CLOSE

The host ignores the client's `CLOSE` message. The client terminates the port by default, so this only leaks with `terminateOnDispose: false`, where host subscriptions and the store stay alive.

## Requirements
- REQ-1: On `CLOSE`, the host MUST release its CDC subscription and bridge resources for that client.

## Acceptance Criteria
- [ ] Test with `terminateOnDispose: false`: after client dispose, the host stops emitting CDC batches.
