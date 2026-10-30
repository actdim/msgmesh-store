---
protocol: along
protocol_version: "4.5.4"
slug: cdc-stream-integration
type: task
status: done
completed: 2026-10-30
priority: high
created: 2026-10-30
updated: 2026-10-30
agent: antigravity
tags: [cdc, sqlite, events, streams]
milestone: v2.0.0-along-transition
blocked_by: []
related: []
---

# Change Data Capture (CDC) Stream Integration

## Objective
Implement automatic Change Data Capture streaming from underlying SQLite mutations onto typed MsgMesh channels.

## Requirements
- REQ-1: The module MUST listen to low-level engine change events.
- REQ-2: The module MUST publish typed `STORE.ENTITY_CHANGED` events onto the bus.
- REQ-3: The stream MUST support filtering by collection and entity ID.

## Acceptance Criteria
- [x] Direct database updates emit verified CDC events on the bus.
- [x] Subscribers can filter events by collection name without memory leaks.
- [x] Tests verify payload structure and timestamps.
