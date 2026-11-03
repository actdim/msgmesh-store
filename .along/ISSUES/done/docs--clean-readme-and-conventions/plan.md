# Plan: Clean up MobX leaks and bus conventions in README

## Problem Statement
In `src/packages/msgmesh-store/README.md`:
1. Mention of MobX ("cannot hold direct MobX proxies", "Direct MobX / LiveDocument", "Direct MobX Access") was copied from LiveStruct scaffold, despite `msgmesh-store` having 0 MobX dependencies and direct MobX being banned in UI components.
2. In section 3 (Quick Code Example), `bridge.cdc$.subscribe(...)` was shown as the primary way for decoupled services to listen, leaking internal in-process stream mechanics instead of showing bus-level messaging (`bus.on` or `subscribeCdc(bus)`).
3. The example used `channelPrefix: 'PARTS'` and `PARTS.COMMAND`, conflating the collection name with the channel prefix instead of standard `STORE.COMMAND` and `STORE.ENTITY_CHANGED` with `topic: 'parts'`.

## Proposed Changes

### 1. `src/packages/msgmesh-store/README.md`
- **Section 1 (Why is this Integration Needed?)**:
  - Replace: `Running SQLite WASM and heavy computational solvers in a Web Worker means the main UI thread cannot hold direct MobX proxies.`
  - With: `Running SQLite WASM and heavy computational solvers in a Web Worker means the main UI thread cannot hold direct in-memory reactive object proxies.`
- **Section 2 (When to Use Table)**:
  - Replace: `| Local UI Form in the same thread | **Direct MobX / LiveDocument** | Direct property access (m.color = 'red') is 1000x faster, fully type-safe, and avoids magic string paths. |`
  - With: `| Local UI Form in the same thread | **Direct In-Memory Mutation (LiveDocument / Model)** | Direct property access is faster, fully type-safe, and avoids serialized bus hops. |`
- **Section 3 (Quick Code Example)**:
  - Update initialization:
    ```typescript
    // 2. Attach store bridge to bus (defaults to STORE prefix)
    const bridge = attachStoreBridge(bus, parts, {
        enableCdcStream: true,
        enableCommandHandling: true,
    });
    ```
  - Show proper decoupled bus subscription in step 3:
    ```typescript
    // 3. Decoupled services listen to change events via the message bus
    bus.on({
        channel: 'STORE.ENTITY_CHANGED',
        group: 'out',
        topic: 'parts',
        callback: (msg) => {
            const event = msg.payload as StoreCdcEvent;
            console.log('Entity changed:', event.type, event.id, event.delta);
        },
    });
    ```
  - Update bus command dispatch in step 4:
    ```typescript
    // 4. Remote module or worker dispatches command over the bus
    await bus.send({
        channel: 'STORE.COMMAND',
        group: 'in',
        topic: 'parts',
        payload: { type: 'PATCH', id: 'part-101', delta: { color: 'green' } },
    });
    ```
  - Add a concise note:
    `Local in-process code can also subscribe to raw changes via bridge.cdc$ or the subscribeCdc(bus) helper without manual bus.on unpacking.`
- **Section 4 (Architecture Overview Diagram)**:
  - Replace `Direct MobX Access` with `Direct Model Mutation`.

### 2. Synchronization & Verification
- Run tests in `src/packages/msgmesh-store` (`pnpm test`).
- Run build in `src/packages/msgmesh-store` (`pnpm run build`).
- Synchronize Knowledge Base/llms exports if applicable (`along kb-sync` or update `llms-full.txt`).
- Strict typography verification (all ASCII, no non-ASCII dashes, quotes, or bullets).

## Verification Plan
1. `git -C src/packages/msgmesh-store grep -i "mobx"` should return 0 hits in README.md.
2. `pnpm test` in `src/packages/msgmesh-store` passes with 0 failures.
3. Commit via Along protocol.
