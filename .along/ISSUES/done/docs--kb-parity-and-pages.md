---
protocol: along
protocol_version: "4.5.4"
slug: kb-parity-and-pages
type: docs
status: done
completed: 2026-11-01
priority: medium
created: 2026-11-01
updated: 2026-11-01
agent: claude-code
tags: [docs, pages]
parent: docs--lib-docs-demo-pages
blocked_by: []
related: []
---

# Knowledge base, AGENTS.md, llms.txt and VitePress Pages site at dynstruct parity

msgmesh-store has `.along/` but no `AGENTS.md` / `CLAUDE.md`, and its three KB topics are scaffold
stubs ("Document system components ... here"). `llms-full.txt` is therefore near empty.

## Requirements
- REQ-1: The repo MUST carry the Along `AGENTS.md` + `CLAUDE.md` pair produced by the Along init tooling.
- REQ-2: The KB MUST replace the stub topics and add overview, core concepts (bridge, CDC, worker transport, mutation ledger), integration and API reference topics grounded in `src/` exports.
- REQ-3: `llms.txt` and `llms-full.txt` MUST be regenerated from the KB via the Along KB pipeline.
- REQ-4: The repo MUST contain a VitePress config, a `docs:build` script, and a `pages.yml` workflow deploying to GitHub Pages.

## Acceptance Criteria
- [x] No scaffold placeholder text remains in `docs/`.
- [x] Every API name cited in the KB exists in `src/`.
- [x] `along kb-sync --check` reports no broken links.
- [x] `pnpm run docs:build` succeeds locally.
