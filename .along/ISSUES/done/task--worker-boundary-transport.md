---
protocol: along
protocol_version: "4.5.4"
slug: worker-boundary-transport
type: task
status: done
completed: 2026-10-30
priority: medium
created: 2026-10-30
updated: 2026-10-30
agent: antigravity
tags: [worker, web-worker, transport, postmessage]
milestone: v2.0.0-along-transition
blocked_by: []
related: []
---

# Web Worker Boundary Transport for Storage and Compute

## Objective
Implement specialized worker transport adapters allowing the store engine to run in a background Web Worker while UI components communicate via lightweight delta packets.

## Requirements
- REQ-1: The transport MUST serialize commands from the main thread to worker via `postMessage`.
- REQ-2: The transport MUST transfer typed CDC deltas back from worker to main thread.
- REQ-3: The transport MUST handle worker lifecycle, initialization, and error boundaries.

## Acceptance Criteria
- [x] Store engine initializes inside a Web Worker.
- [x] UI thread dispatches mutations without holding direct SQLite handles.
- [x] Benchmark verifies main thread remains at 60fps during heavy background writes.
