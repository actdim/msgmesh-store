---
protocol: along
protocol_version: "4.6.0"
slug: clean-readme-and-conventions
type: docs
status: done
completed: 2026-11-03
priority: high
created: 2026-11-03
updated: 2026-11-03
agent: antigravity
tags: [docs, readme, msgmesh-store, cdc]
blocked_by: []
related: []
plan_status: approved
---

# Clean up MobX leaks and bus conventions in README

## Problem
In `README.md` of `@actdim/msgmesh-store`:
1. Phantom MobX references remain from an early scaffold (mentioning MobX proxies, Direct MobX / LiveDocument, Direct MobX Access), while `msgmesh-store` has zero MobX dependencies and direct MobX is banned in UI code.
2. The Quick Code Example in section 3 uses `bridge.cdc$.subscribe(...)` directly under the comment "Decoupled services listen to CDC stream". This leaks internal in-process controller streams into the primary getting-started example instead of demonstrating idiomatic bus subscriptions (`bus.on` or `subscribeCdc(bus)`).
3. The Quick Code Example uses `channelPrefix: 'PARTS'` which creates hardcoded `PARTS.COMMAND` and `PARTS.ENTITY_CHANGED`, confusing the collection name with the channel prefix instead of standard `STORE` channels and `topic` routing.

## Requirements
- REQ-1: The documentation MUST remove all phantom MobX references from `README.md` and replace them with neutral in-memory reactive model terminology.
- REQ-2: The Quick Code Example in `README.md` MUST demonstrate consuming change events via the message bus (`bus.on` or `subscribeCdc(bus)`), with `bridge.cdc$` noted clearly as a local in-process escape hatch.
- REQ-3: The Quick Code Example in `README.md` MUST use standard `STORE.COMMAND` and `STORE.ENTITY_CHANGED` with `topic: 'parts'` rather than hardcoding collection names into `channelPrefix`.
- REQ-4: All documentation updates MUST adhere to strict ASCII typography (no non-ASCII quotes, dashes, ellipses, or bullet characters) and pass `pnpm run build` and tests.

## Acceptance Criteria
- [x] No occurrences of `MobX` remain in `src/packages/msgmesh-store/README.md`.
- [x] Section 3 Quick Code Example shows bus-level listening via `bus.on` or `subscribeCdc(bus)`.
- [x] Section 3 Quick Code Example uses `STORE` channel conventions with `topic: 'parts'`.
- [x] `llms-full.txt` and docs are synchronized.
- [x] All tests in `src/packages/msgmesh-store` pass.
