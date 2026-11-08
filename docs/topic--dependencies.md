---
protocol: along
protocol_version: "4.6.1"
slug: dependencies
title: Dependencies & AI Documentation for @actdim/msgmesh-store
type: topic
created: 2026-11-06
updated: 2026-11-06
tags: [dependencies, subproject, ai-context, rules]
---

# Dependencies & AI Documentation for `@actdim/msgmesh-store`

> [!NOTE]
> This document maintains a localized registry of internal workspace dependencies and third-party libraries for `@actdim/msgmesh-store`.
> Consult linked guidelines when developing, refactoring, or integrating components.

## Internal Workspace Dependencies

| Internal Package | Relative Path | AI Documentation & Context |
| :--- | :--- | :--- |
| **`@actdim/livestruct`** | [`../../../../scratch/07-ci/ci-clone/src/packages/livestruct`](../../../../scratch/07-ci/ci-clone/src/packages/livestruct) | [AGENTS.md](../../../../scratch/07-ci/ci-clone/src/packages/livestruct/AGENTS.md) <br> [CLAUDE.md](../../../../scratch/07-ci/ci-clone/src/packages/livestruct/CLAUDE.md) <br> [llms-full.txt](../../../../scratch/07-ci/ci-clone/src/packages/livestruct/llms-full.txt) <br> [llms.txt](../../../../scratch/07-ci/ci-clone/src/packages/livestruct/llms.txt) <br> [.along/](../../../../scratch/07-ci/ci-clone/src/packages/livestruct/.along) <br> [docs/](../../../../scratch/07-ci/ci-clone/src/packages/livestruct/docs) |
| **`@actdim/msgmesh`** | [`../../../../scratch/07-ci/ci-clone/src/packages/msgmesh`](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh) | [AGENTS.md](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/AGENTS.md) <br> [CLAUDE.md](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/CLAUDE.md) <br> [llms-full.txt](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/llms-full.txt) <br> [llms.txt](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/llms.txt) <br> [.along/](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/.along) <br> [docs/](../../../../scratch/07-ci/ci-clone/src/packages/msgmesh/docs) |
| **`@actdim/utico`** | [`../../../../scratch/07-ci/ci-clone/src/packages/utico`](../../../../scratch/07-ci/ci-clone/src/packages/utico) | [AGENTS.md](../../../../scratch/07-ci/ci-clone/src/packages/utico/AGENTS.md) <br> [CLAUDE.md](../../../../scratch/07-ci/ci-clone/src/packages/utico/CLAUDE.md) <br> [llms-full.txt](../../../../scratch/07-ci/ci-clone/src/packages/utico/llms-full.txt) <br> [llms.txt](../../../../scratch/07-ci/ci-clone/src/packages/utico/llms.txt) <br> [.along/](../../../../scratch/07-ci/ci-clone/src/packages/utico/.along) <br> [docs/](../../../../scratch/07-ci/ci-clone/src/packages/utico/docs) |

## Declared External Dependencies with AI Guidelines

No active external dependencies with AI instructions were detected.

## Transitive Dependency Guidelines & Invariants

No exported invariants detected across current dependencies.

## Usage in Agent Sessions
When working on features involving any of the modules or external libraries above:
1. **Internal Submodules**: Follow conventions in the linked package `AGENTS.md` or package `docs/`.
2. **Third-Party Libraries**: Read the linked instruction files directly for framework-specific patterns and best practices.
