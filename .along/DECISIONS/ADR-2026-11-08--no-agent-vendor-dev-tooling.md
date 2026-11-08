---
protocol: along
slug: no-agent-vendor-dev-tooling
type: decision
title: "Dev servers, Storybook and browser checks run through project scripts, not agent-vendor config"
date: 2026-11-08
status: accepted
tags: [adr, architecture, decision]
---

# ADR-2026-11-08--no-agent-vendor-dev-tooling - Dev servers, Storybook and browser checks run through project scripts, not agent-vendor config

- Date: 2026-11-08
- Status: accepted
- Context: Agent sessions added Claude-specific runtime config (.claude/launch.json) and plans that start servers through it. The owner does not want the project's tooling or instructions to depend on one AI vendor's infrastructure: the repo is worked on by different agents (Claude, Gemini, others) and by people.
- Decision: Dev servers, Storybook and any browser verification are started with the package's own scripts (pnpm run dev, pnpm run storybook, pnpm --dir <pkg> run <script>) and opened by URL in any browser. Plans, issues, AGENTS.md and docs name those commands and URLs, never agent-vendor config (.claude/launch.json, .claude/*, .cursor/*, .gemini/* and similar). Agent-vendor files are not a source of truth for project tooling and are not added or extended by agents.
- Consequences: Instructions stay portable across agents and humans. An agent that has a vendor preview tool may still use it by passing a URL, but must not require a config file for it. Existing references to .claude/launch.json in docs, AGENTS.md and open plans are migrated to script commands; historical records stay as they are.
