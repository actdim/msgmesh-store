# Vision

_North star: scope, boundaries, non-goals, roadmap. Evolves slowly; slims as features ship._

## Scope

- Connect the `@actdim/msgmesh` bus to persistent document stores: bus commands mutate the store, store changes (CDC) are published back on the bus.
- Store-agnostic targets resolved structurally (LiveStruct engine, store instance, collection, custom target) without hard runtime imports of the store libraries.
- Loop-free bidirectional sync through ledger-based echo suppression and per-entity serial ordering.
- A worker boundary transport so the store can live in a dedicated worker while the UI talks to it over the bus.

## Non-goals

- Owning persistence, schemas or conflict resolution: those belong to `@actdim/livestruct` / LiveStore.
- Network transport between processes or hosts: that is `@actdim/msgmesh-remote`.
- UI bindings; consumers use dynstruct / msgmesh on the UI side.

## Roadmap

- Close the gaps the 2026-11-01 KB review found: honour or remove the ignored `echoSuppressionMs` option, forward `origin` on collection targets, let the host dispose on the client `CLOSE` message, carry a per-command `origin` across the worker boundary, and resolve the `{ collection(name) }` custom target form in `attachStoreBridge`.
