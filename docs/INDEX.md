---
protocol: along
slug: INDEX
title: '@actdim/msgmesh-store - Knowledge Base Topic Index'
type: index
created: 2026-10-30
updated: 2026-11-03
tags: [index, kb, topics, map]
---

# @actdim/msgmesh-store - Knowledge Base Topic Index

Central entry point and cross-linked topic catalog for project documentation:

## Knowledge Graph & Topic Map

```mermaid
flowchart TD
    INDEX["Knowledge Base (INDEX)"]
    T_01_OVERVIEW_AND_ADVANTAGES["Overview & Key Advantages"]
    INDEX --> T_01_OVERVIEW_AND_ADVANTAGES
    T_02_CORE_CONCEPTS["Core Concepts"]
    INDEX --> T_02_CORE_CONCEPTS
    T_03_ARCHITECTURE_AND_WIRING["Architecture & Wiring"]
    INDEX --> T_03_ARCHITECTURE_AND_WIRING
    T_04_INTEGRATION_GUIDE["Integration Guide"]
    INDEX --> T_04_INTEGRATION_GUIDE
    T_05_API_REFERENCE["API Reference"]
    INDEX --> T_05_API_REFERENCE
    T_ALONG_PROTOCOL["Along Protocol Reference"]
    INDEX --> T_ALONG_PROTOCOL
    T_ARCHITECTURE["System Architecture & Flow"]
    INDEX --> T_ARCHITECTURE
    T_DOMAIN_MODEL["Domain Model & Type Contracts"]
    INDEX --> T_DOMAIN_MODEL
    T_LICENSE["License"]
    INDEX --> T_LICENSE
    T_SETUP_AND_WORKFLOW["Setup, Build & Workflow"]
    INDEX --> T_SETUP_AND_WORKFLOW
    T_01_OVERVIEW_AND_ADVANTAGES -.->|references| T_02_CORE_CONCEPTS
    T_02_CORE_CONCEPTS -.->|references| T_01_OVERVIEW_AND_ADVANTAGES
    T_02_CORE_CONCEPTS -.->|references| T_03_ARCHITECTURE_AND_WIRING
    T_02_CORE_CONCEPTS -.->|references| T_05_API_REFERENCE
    T_03_ARCHITECTURE_AND_WIRING -.->|references| T_02_CORE_CONCEPTS
    T_03_ARCHITECTURE_AND_WIRING -.->|references| T_04_INTEGRATION_GUIDE
    T_04_INTEGRATION_GUIDE -.->|references| T_03_ARCHITECTURE_AND_WIRING
    T_04_INTEGRATION_GUIDE -.->|references| T_05_API_REFERENCE
    T_05_API_REFERENCE -.->|references| T_04_INTEGRATION_GUIDE
    T_ARCHITECTURE -.->|references| T_03_ARCHITECTURE_AND_WIRING
    T_ARCHITECTURE -.->|references| T_01_OVERVIEW_AND_ADVANTAGES
    T_ARCHITECTURE -.->|references| T_02_CORE_CONCEPTS
    T_ARCHITECTURE -.->|references| T_04_INTEGRATION_GUIDE
    T_ARCHITECTURE -.->|references| T_05_API_REFERENCE
    T_ARCHITECTURE -.->|references| T_DOMAIN_MODEL
    T_ARCHITECTURE -.->|references| T_SETUP_AND_WORKFLOW
    T_ARCHITECTURE -.->|references| T_LICENSE
    T_DOMAIN_MODEL -.->|references| T_05_API_REFERENCE
    T_DOMAIN_MODEL -.->|references| T_ARCHITECTURE
    T_DOMAIN_MODEL -.->|references| T_02_CORE_CONCEPTS
    T_SETUP_AND_WORKFLOW -.->|references| T_ARCHITECTURE
    T_SETUP_AND_WORKFLOW -.->|references| T_DOMAIN_MODEL
    T_SETUP_AND_WORKFLOW -.->|references| T_04_INTEGRATION_GUIDE
    T_SETUP_AND_WORKFLOW -.->|references| T_05_API_REFERENCE
    T_SETUP_AND_WORKFLOW -.->|references| T_LICENSE
```

---

## Articles

- **[Overview & Key Advantages](./topic--01-overview-and-advantages.md)** (topic) `01-overview-and-advantages`, `overview`, `msgmesh`, `livestruct`, `cdc`
- **[Core Concepts](./topic--02-core-concepts.md)** (topic) `02-core-concepts`, `bridge`, `cdc`, `ledger`, `queue`, `worker`
- **[Architecture & Wiring](./topic--03-architecture-and-wiring.md)** (topic) `03-architecture-and-wiring`, `data-flow`, `echo-suppression`, `worker`, `mermaid`
- **[Integration Guide](./topic--04-integration-guide.md)** (topic) `04-integration-guide`, `install`, `livestruct`, `msgmesh`, `worker`, `batching`
- **[API Reference](./topic--05-api-reference.md)** (topic) `05-api-reference`, `api`, `contracts`, `exports`
- **[Along Protocol Reference](./topic--along-protocol.md)** (reference) `protocol`, `agents-md`, `checklist`, `routing`, `concurrency`, `along-team`, `conventions`
- **[System Architecture & Flow](./topic--architecture.md)** (architecture) `architecture`, `bridge`, `cdc`, `worker`, `echo-suppression`
- **[Domain Model & Type Contracts](./topic--domain-model.md)** (domain-model) `domain-model`, `types`, `cdc`, `commands`, `worker-protocol`
- **[License](./topic--license.md)** (license) `license`, `mit`
- **[Setup, Build & Workflow](./topic--setup-and-workflow.md)** (setup-workflow) `setup`, `workflow`, `build`, `tests`, `monorepo`

---

## Related Context

- [AGENTS.md](../AGENTS.md): Active protocol conventions and rules.
- [Decisions (ADRs)](./decisions/INDEX.md): Architectural Decision Records.
- [Domain Model & Entity Ecosystem](./topic--domain-model.md): Specifications for active issues and project history.
