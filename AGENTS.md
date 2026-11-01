<!-- BEGIN ALONG-PROTOCOL root (managed by along-init - do not edit by hand) -->
# ALONG-PROTOCOL v4.5.4

This repo carries its own agent context, provider-agnostically. Follow it every session, whatever tool you are. This is the core; procedures (completion checklist, doc routing, merges, along-team, tool-use rules) live in `docs/topic--along-protocol.md` - pull the section you need via `/along-kb-search`. A gate's error message carries its detail.

## Where state lives
- **Nearest wins**: any folder may carry its own `AGENTS.md` + `.along/`; use the NEAREST for the area you work in. Nearest `.along/` > higher-level `.along/` > global config. Only a nested `.git` or a user-run `along init` makes a subproject.
- **Read at session start** (not auto-loaded): `.along/ISSUES.md`, `.along/CONSTRAINTS.md`, your issue `.along/ISSUES/<type>--<slug>.md`; when relevant `.along/VISION.md`, `.along/GLOSSARY.md`. They reflect the state WHEN WRITTEN - verify named files/APIs/flags against the code.
- **Entities**: issues (`feat|bug|debt|task|docs|spike`), ADRs (`.along/DECISIONS/`, never edited - superseded), milestones, sessions. Keys `<type>--<slug>`, referenced by key, never by path; schemas in `docs/topic--domain-model.md`. Create them from intent unprompted (build/fix -> issue, blocked -> issue tagged `risk`, compare -> `spike` issue, release -> milestone).
- **Projections** (`ISSUES.md`, `DECISIONS.md`, `CONSTRAINTS.md`, `docs/INDEX.md`) are compiled: on conflict take either side and re-run the sync.

## Anchor work to an issue
1. Find or create the issue with `status: in-progress`; `along start <slug>` binds this session.
2. Source edits unlock after the user approves the plan (`EnterPlanMode` -> `ExitPlanMode`, or `along plan approve --plan-file <path>` after their explicit yes). Questions get read-only answers; 1-line typo/comment edits are exempt.
3. Commit via `/along-commit`: bound to the slug, no AI `Co-Authored-By:` trailers.
4. Finish with the completion checklist, ending in `along wrap <slug> --summary "..." (--decisions <ADR...> | --no-decisions)`.

## Gates
Runtime hooks enforce these where installed; elsewhere (`along doctor` shows the level) self-apply every one and use the `along` CLI instead of raw tools.
- [gate: require-active-issue] [gate: require-plan-approval] - no source edit without an in-progress issue and an approved plan.
- [gate: subproject-boundary] - a subproject's entities go in ITS `.along/`; cross-subproject work needs an issue in each, or a root umbrella with `parent:` children.
- [gate: workspace-containment] - read/write inside the workspace (plus temp); other roots need `allowed_roots`; never credential stores.
- [gate: projection-protection] - never hand-edit or hand-merge projections.
- [gate: commit-issue-binding] - every commit names the active issue.
- [gate: issue-lifecycle] [gate: entity-reference-integrity] [gate: entity-deletion-protection] - close via `along wrap` / `along issue done`; rename or supersede, never delete a referenced entity.
- [gate: doc-manual-lock] - `write_policy: manual` docs change only under a `docs--<slug>` issue.
- [gate: rule-pack-protection] - never edit `.along/rules/**/*.md` (`along rules attach` owns them).
- [gate: doc-routing-compliance] - ADR vs `README.md` vs `docs/topic--*.md` routing tree.
- [gate: untracked-exports] - dashboards and `.along/diagnostics/` stay out of Git.
- [gate: cli_safety] - file content via file tools, never heredocs or `python -c`; no global installs.
- [gate: team-step-active] [gate: team-reviews-before-stop] - an `along-team` blackboard holds you to its step loop.
- [gate: test_before_stop] [gate: wrap_before_stop] [gate: projection_sync_before_stop] - before stopping: tests green, session wrapped, projections synced.
- [gate: unresolved_gate_denial] - a denied tool call is redone within the gate's rules or told to the user (`along gates ack`), never dropped silently; closing waits for their reply.
- Commit-time (`along lint`, pre-commit + CI): ASCII typography, fence languages, relative links, no `docs/` -> `.along/` links, Windows-safe names, no secrets, no stubs.
- Bypass is the user's call: `-n`, `--force-reason`, `scratch fallback` need `--reason` after their reply; recorded in `along gates stats`.

## Judgment rules
- Ground facts in code, `README.md` and `docs/`; no generic placeholders. Query `/along-kb-search` before reading whole docs; update affected `docs/topic--*.md` after non-trivial changes.
- Use `/along-test`, `/along-build`, `/along-dev` before raw commands, with quiet flags. Review your diff and blast radius (`along graph-impact`).
- Never delete or truncate docs, comments or code unless told; no stubs; check `git diff --stat` after batch edits. Verify written files parse. Tests stay hermetic.
- Scope > 3 files, crossing subsystems or refactoring core engines: route to `along-team`; plans MUST declare `Execution Mode: Direct` or `Role-Based`.
- Treat the `along` CLI as a black box (`along <cmd> --help`, no engine source outside the Along repo); report its errors verbatim.
<!-- END ALONG-PROTOCOL -->

## Project specifics

<!-- BEGIN ALONG-RULES -->
See the following engineering guidelines:
- `[languages/typescript.md](.along/rules/languages/typescript.md)`
- `[platforms/web.md](.along/rules/platforms/web.md)`
<!-- END ALONG-RULES -->

- **Package**: `@actdim/msgmesh-store` - bridge between the `@actdim/msgmesh` bus and persistent stores (LiveStruct / LiveStore): store bridge for command channels (`<prefix>.COMMAND`), CDC publishing (`<prefix>.ENTITY_CHANGED`), ledger-based echo suppression (`MutationLedger`), per-entity ordering (`KeyedSerialQueue`), and a worker transport (`attachWorkerStoreHost` / worker client).
- **Entry points**: `.` (`src/index.ts`), `./cdc`, `./bridge`, `./worker`. ESM only. Peers: `@actdim/msgmesh`, `@actdim/utico`, `rxjs`, optional `@actdim/livestruct`; runtime imports only `rxjs`, the rest is structural typing.
- **Commands** (package folder): `pnpm run build`, `pnpm run typecheck`, `pnpm run test` (Vitest node), `pnpm run docs:build` (VitePress, published to https://actdim.github.io/msgmesh-store/ by `.github/workflows/pages.yml`).
- **Knowledge Base**: `docs/INDEX.md`; regenerate `docs/INDEX.md`, `llms.txt` and `llms-full.txt` with `along kb-sync <absolute package path>` after doc changes.
- **Versioning**: submodule of the mempart pnpm monorepo under one unified version; never bump `package.json` here in isolation (mempart `pnpm run version:sync <version>` only).
