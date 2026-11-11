---
protocol: along
protocol_version: "4.8.1"
slug: dependencies
title: Dependencies & AI Documentation for @actdim/msgmesh-store
type: topic
created: 2026-11-11
updated: 2026-11-11
tags: [dependencies, subproject, ai-context, rules]
---

# Dependencies & AI Documentation for `@actdim/msgmesh-store`

> [!NOTE]
> This document maintains a localized registry of internal workspace dependencies and third-party libraries for `@actdim/msgmesh-store`.
> Consult linked guidelines when developing, refactoring, or integrating components.

## Internal Workspace Dependencies

| Internal Package | Relative Path | AI Documentation & Context |
| :--- | :--- | :--- |
| **`@actdim/livestruct`** | [`../../livestruct`](../../livestruct) | [AGENTS.md](../../livestruct/AGENTS.md) <br> [CLAUDE.md](../../livestruct/CLAUDE.md) <br> [llms-full.txt](../../livestruct/llms-full.txt) <br> [llms.txt](../../livestruct/llms.txt) <br> [.along/](../../livestruct/.along) <br> [docs/](../../livestruct/docs) |
| **`@actdim/msgmesh`** | [`../../msgmesh`](../../msgmesh) | [AGENTS.md](../../msgmesh/AGENTS.md) <br> [CLAUDE.md](../../msgmesh/CLAUDE.md) <br> [llms-full.txt](../../msgmesh/llms-full.txt) <br> [llms.txt](../../msgmesh/llms.txt) <br> [.along/](../../msgmesh/.along) <br> [docs/](../../msgmesh/docs) |
| **`@actdim/utico`** | [`../../utico`](../../utico) | [AGENTS.md](../../utico/AGENTS.md) <br> [CLAUDE.md](../../utico/CLAUDE.md) <br> [llms-full.txt](../../utico/llms-full.txt) <br> [llms.txt](../../utico/llms.txt) <br> [.along/](../../utico/.along) <br> [docs/](../../utico/docs) |

## Declared External Dependencies with AI Guidelines

| Package | Ecosystem | Version | AI Guidelines / Instructions |
| :--- | :--- | :--- | :--- |
| **`@actdim/dev-config`** | `npm` | `1.14.0` | [AGENTS.md](../../../app-core/packages/dev-config/AGENTS.md) <br> manifest metadata (`ai`) |

## Transitive Dependency Guidelines & Invariants

No exported invariants detected across current dependencies.

## Usage in Agent Sessions
When working on features involving any of the modules or external libraries above:
1. **Internal Submodules**: Follow conventions in the linked package `AGENTS.md` or package `docs/`.
2. **Third-Party Libraries**: Read the linked instruction files directly for framework-specific patterns and best practices.
