---
protocol: along
protocol_version: "4.5.4"
slug: store-bridge-and-echo-suppression
type: task
status: done
completed: 2026-10-30
priority: high
created: 2026-10-30
updated: 2026-10-30
agent: antigravity
tags: [bridge, echo-suppression, msgmesh, livestruct]
milestone: v2.0.0-along-transition
blocked_by: []
related: []
---

# Store Bridge and Echo Suppression Engine

## Objective
Implement bidirectional message bus bridge between `@actdim/msgmesh` and `@actdim/livestruct` with origin tracking and loop detection.

## Requirements
- REQ-1: Bridge MUST translate bus commands into store document mutations.
- REQ-2: Bridge MUST attach origin markers (`local`, `remote`, `bus`) to every event.
- REQ-3: Bridge MUST suppress feedback loops when store commits trigger bus notifications.

## Acceptance Criteria
- [x] Command sent on bus updates corresponding document in store.
- [x] Origin tags verify that echoed mutations are dropped.
- [x] Tests verify bidirectional flow without infinite recursions.
