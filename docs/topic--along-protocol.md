---
protocol: along
slug: along-protocol
title: Along Protocol Reference
type: reference
write_policy: manual
tags: [protocol, agents-md, checklist, routing, concurrency, along-team, conventions]
created: 2026-10-18
---
<!-- ALONG-PROTOCOL-REFERENCE (managed by along-init - do not edit by hand) -->

# Along Protocol Reference

The managed block in `AGENTS.md` is the always-loaded core of the ALONG-PROTOCOL: where state lives, how work is anchored to an issue, and the list of gates. This article carries the situational procedure the core points to. Pull the section you need with `/along-kb-search` instead of reading the whole file. `along init` and `along update` regenerate this file from the installed protocol; repository-specific guidance belongs in its own `docs/topic--<slug>.md` article or in `AGENTS.md` "Project specifics".

## Scope, Precedence & Subproject Placement

- **Nearest Context Boundary**: Any folder may carry its own `AGENTS.md` + `.along/`; use the NEAREST ones for the area you're working in. On conflict, the more specific wins.
- **Subproject Localization** [gate: subproject-boundary]: In submodules, nested repos or symlinked folders: all entities (issues, sessions, ADRs, history) MUST be created in the NEAREST `.along/`. Agents are STRICTLY FORBIDDEN from dumping subproject changes into the workspace root `.along/`.
- **Multi-Subproject Work** [gate: subproject-boundary]: A change spanning subprojects needs an issue in each touched `.along/`, or a root umbrella issue whose child issues there carry `parent: <umbrella key>`. Edits under a subproject `.along/` are checked by path.
- **Subproject Boundary**: only a nested `.git` or a user-run `along init` makes a subproject; never init a manifest folder.
- **Precedence**: Nearest `.along/` > higher-level `.along/` > global config (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/config/GEMINI.md`).

## Session Start

Use the NEAREST `.along/` for the area you're working in (fall back to a higher-level one if the folder has none). These files are NOT auto-loaded; read them yourself:

1. `AGENTS.md` (nearest) - conventions to follow.
2. `.along/ISSUES.md` - active issue board (or query `/along-kb-search`).
3. `.along/CONSTRAINTS.md` - active architectural constraints (or full log in `.along/DECISIONS.md` / `.along/DECISIONS/`).
4. Active Issue file `.along/ISSUES/<type>--<slug>.md` for your task.

Also, when relevant: `.along/VISION.md`, `.along/GLOSSARY.md`. These reflect the state WHEN WRITTEN - verify any named file/API/flag against the real code first.

## Multi-Agent & Multi-Branch Concurrency

- **Zero-Manual-Merge Rule** [gate: projection-protection]: On merge conflicts in derived projections (`ISSUES.md`, `INDEX.md`, `DECISIONS.md`), accept either side and run `/along-issue-sync`, `/along-kb-sync`, or `/along-decision-sync` to recompile. `along git setup` registers merge drivers that do this automatically; afterwards run `along git sync`.
- **Append-Only Merge Driver**: `.along/HISTORY.md` and legacy monolithic `.along/DECISIONS.md` are append-only. Configure `.gitattributes` with `merge=union`. Modular ADR files in `.along/DECISIONS/` are isolated per-file to eliminate merge collisions.
- **Untracked Exports** [gate: untracked-exports]: `.along/dashboard.html`, `.along/DASHBOARD.md` and per-machine `.along/diagnostics/` stay out of Git.
- **Context Isolation**: Context is localized to the target issue file, session-scoped blackboard (`.along/.session/<slug>/`), and completed session logs.
- **Parallel Closeout**: `along session list`; on the user's yes `along plan approve --closeout --ready`, then `along session close --ready`.

## Issue Anchoring & Commits

- **No Code Without Issue** [gate: require-active-issue]: Before modifying source code, agents MUST identify or create an issue in `.along/ISSUES/<type>--<slug>.md` and set `status: in-progress`.
- **Session Binding & Plan Approval** [gate: require-plan-approval]: `along start <slug>` binds THIS agent session to the issue; parallel sessions keep their own bindings. Source edits unlock after the user approves the plan (`EnterPlanMode` -> `ExitPlanMode`; outside plan mode, write the plan to a file and run `along plan approve --plan-file <path>` after the user's explicit yes). `along plan status` shows the binding.
- **Exemptions**: Read-only Q&A and 1-line micro-edits (typo fixes, comments) do not require issues.
- **Inquiry Read-Only Invariance (Zero-Mutation Rule on Questions)** [gate: require-plan-approval]: On interrogative prompts ("is X done?", "why did Y fail?"), write/modify tools are STRICTLY PROHIBITED. Return a read-only audit report and ask for confirmation before modifying anything.
- **Commit Binding** [gate: commit-issue-binding]: Every commit via `/along-commit` MUST bind to the active issue slug.
- **No AI Co-Authors**: Commit messages MUST NOT carry `Co-Authored-By:` trailers naming an AI agent (GitHub lists the vendor as a contributor). `along hook install` turns runtime attribution off; opt out via `.along/config.json` `commits.allow_ai_coauthor: true`.

## Issue Plans & Approving Ahead

- **Plan location**: An issue's plan lives next to its ticket in `.along/ISSUES/<key>/plan.md` (committed; moves with the ticket to `done/` and on rename). It is one living file: the approved baseline, then each correction appended as `## Revision N (date, source)` with a `Reason:` line. `along-team` writes its Living Plan there too; blackboards without an issue keep `.along/.session/<slug>/plan.md`.
- **Plan status** (ticket front-matter `plan_status`, shown on the board): `needs-approval` (written, waiting for the user), `approved` (ready to run), `needs-rework` (cannot be followed within the ticket). Agents may set `needs-approval` / `needs-rework`; only `along plan approve`, after the user's explicit yes, sets `approved` [gate: require-plan-approval]: a file-tool edit that sets it is denied, a shell write is reported at Stop.
- **Approve ahead**: Write the plan (plan mode, or a file), show it, and after the user's yes run `along plan approve <slug>` (`--plan-file <path>` outside plan mode) before `along start`. The issue is not started; the ticket says `plan_status: approved` and the CLI logs the approval in `.along/.session/plan-approvals.jsonl` (machine-local, closed to file tools). A later `along start <slug>`, by the user, the agent, or the orchestrator / runner daemon, runs the plan with no second approval and no re-planning (the orchestrator skips its architect).
- **Approved elsewhere**: `approved` in the ticket with no approval logged on this machine (approved on another machine, or written by hand) is not trusted: show the plan and ask once in the current channel (chat, or the daemon's Telegram reply); the orchestrator stops with `needs-input`.
- **Plans change during work; escalate only past the ticket**: Once approved, the plan belongs to the agents. A deviation they can resolve while still meeting the ticket's requirements and acceptance criteria is resolved on the spot and recorded (`along plan revise <slug> --plan-file <path> --reason "..."`); no one is asked and the status stays `approved`. Only a problem the ticket cannot absorb (a requirement cannot be met or must change, a decision only the user can make) goes to the user: `along plan rework <slug> --reason "..."`, stop, ask. In `along-team`, implementer and reviewer report plan problems to the supervisor, the architect revises, and only a ticket-level problem halts the run. Plans are not checked for staleness: a plan stays valid until the work shows otherwise.

## Entity Ecosystem

- **Entity types**: Issues (`feat`, `bug`, `debt`, `task`, `docs`, `spike`), Decisions (ADRs), Milestones, Sessions. A risk or blocker is an issue tagged `risk`; a spike is a `spike--<slug>` issue with an `## Outcome` section. Full YAML schemas: `docs/topic--domain-model.md`.
- **Canonical keys**: `<type>--<slug>` (e.g. `feat--token-refresh`). Reference by key, NEVER by file path.
- **ADRs**: Modular records in `.along/DECISIONS/ADR-YYYY-MM-DD--<slug>.md` (with legacy fallback to monolithic `DECISIONS.md`). Never edit past entries - mark superseded. Recompile projections (`.along/DECISIONS.md` board and `.along/CONSTRAINTS.md`) via `/along-decision-sync` or `along decision sync`. Create new ADRs via `/along-decision-sync` or `along decision create <slug> --title "..."`. Add terms to `.along/GLOSSARY.md`.
- **Issue lifecycle** [gate: issue-lifecycle]: Complete active issues via `along wrap <slug>` (or `along issue done <slug> --status cancelled|superseded`). Closing as done requires `validate_issue_completion` (no scaffold placeholders, mandatory Acceptance Criteria, all `- [x]` closed).
- **Entity references** [gate: entity-reference-integrity] [gate: entity-deletion-protection]: Never delete an entity other entities reference; use `along issue rename` / `along issue supersede`.
- **Auto-entity creation**: Agents MUST automatically detect user intent (build/fix/refactor -> Issue, blocked/rate-limit -> Issue tagged `risk`, compare/benchmark -> `spike` Issue, release/sprint -> Milestone) and create entities without prompting the user.

## Knowledge Base & Documentation

- **Stable Entry Point**: `README.md` and `docs/` never link into `.along/`; route through `docs/INDEX.md` or `docs/topic--<slug>.md`.
- **Portable Links**: Relative Markdown links only.
- **Fact Grounding**: Agents MUST extract facts from actual code, `README.md`, `docs/`, and `package.json`. Generic LLM placeholders are strictly prohibited.
- **Fast Retrieval**: Agents SHOULD query `/along-kb-search` before reading whole documentation files.
- **Doc Blast Radius**: After non-trivial code changes, agents MUST map affected symbols to `docs/topic--*.md` articles and update them before completing the task.
- **Manual Document Lock** [gate: doc-manual-lock]: Documents marked with `write_policy: manual` (or `locked: true`) are protected from automated agent modification during blast radius sweeps. Modifications require an explicit documentation issue (`docs--<slug>`).
- **Managed Rule Packs** [gate: rule-pack-protection]: Never edit `.along/rules/**/*.md`; `along rules attach` owns them. Project guidelines go to `docs/topic--<slug>.md` or "Project specifics"; revert with `along rules restore`. `.along/rules/gates.yaml` and `.along/scripts/` stay repo-owned.

### Documentation Routing Tree

[gate: doc-routing-compliance]

- Architectural choice / trade-off -> `.along/DECISIONS/` (ADR)
- Public overview / pitch / landing page -> `README.md`
- Technical interface contract / CLI spec -> `docs/topic--<slug>.md` (`type: reference`)
- Conceptual explanation / comparison / philosophy -> `docs/topic--<slug>.md` (`type: explanation`, `write_policy: manual`)
- Procedural walkthrough / runbook -> `docs/topic--<slug>.md` (`type: guide`)

## While Working

- **Token hygiene**: Use quiet flags (`pytest -q`, `dotnet test -v q`), filter outputs, inspect targeted line ranges.
- **Lifecycle hooks first**: Agents MUST use `/along-test`, `/along-build`, `/along-dev` (or `.along/scripts/*.py`) before raw shell commands.
- **Post-change review**: Agents MUST inspect diffs and evaluate blast radius via `along graph-impact` (or static search fallback). Silent skips are forbidden.

## Stage & Session Completion Checklist

When a stage or session completes, agents MUST execute in this order:
1. [ ] **Tests** [gate: test_before_stop]: Run via `/along-test` with quiet flags. Zero failures.
2. [ ] **File Integrity**: `git status -u` - all new/modified files non-zero size, no empty placeholders.
3. [ ] **Code Review**: Inspect diff for side effects, verify REQ-N coverage, evaluate blast radius via `along graph-impact` (or static search), verify architectural decision compliance.
4. [ ] **Entity Reconciliation**: Close issues (`done` + move to `done/`), update milestones, record the `## Outcome` of a spike. [gate: unresolved_gate_denial]: every tool call a gate denied is redone within the gate's rules or disclosed (`along gates denials`, `along gates ack <id> --note "..."`); `along wrap` / `along issue done` refuse until the user has replied to a disclosure (`--force-reason` after their reply).
5. [ ] **Doc Blast Radius**: Update affected `docs/topic--*.md`, `README.md` and Project specifics; add new terms to `.along/GLOSSARY.md` (create it on first use); touch `.along/VISION.md` only if scope/roadmap changed; run `/along-kb-sync`.
6. [ ] **Session Log & Wrap** [gate: wrap_before_stop]: `along wrap <slug> --summary "<summary>" (--decisions <ADR...> | --no-decisions)` writes `.along/SESSIONS/<YYYY>/<date>--<slug>.md` (summary, decisions, attributed `files:`, blackboard record), compiles projections, and appends to `.along/HISTORY.md` (provide `--summary` or let it fallback to issue title).
7. [ ] **Projections** [gate: projection_sync_before_stop]: Run `/along-issue-sync` and `/along-decision-sync`.
8. [ ] **HISTORY**: Verify line in `.along/HISTORY.md` (appended automatically by `along wrap`; update via `along history append <slug> "..."` if needed).
9. [ ] **Compaction**: Advise user to run `/compact`.

## Multi-Agent Routing

- **Mandatory Adaptive Complexity Escalation & Execution Mode Routing**: When scope touches > 3 files, crosses subsystems, or refactors core engines: single-agent execution is forbidden - route to `along-team`. Plans MUST declare `Execution Mode: Direct` or `Role-Based`. Role-based blackboards (`along scratch init`) are held to the step loop [gate: team-step-active] [gate: team-reviews-before-stop]; dropping it needs `along scratch fallback <slug> --reason "..."`.

## Tool-Use Rules

- **Contract-First Lifecycle**:
  - Agents MUST execute `.along/scripts/<action>.py` or `/along-test`, `/along-build`, `/along-dev` before raw shell commands.
  - When `.along/scripts/` is missing, `along test`/`along build` auto-detects and synthesizes hooks.
  - In submodules, execute the hook from that subproject's own `.along/scripts/`.
- **Environment Isolation**:
  - Agents MUST NOT install system-wide or global packages when a script fails. Fix the architecture (missing `bootstrap.ensure_deps()`, incorrect `uv` wrapper), not the environment.
- **Workspace Containment** [gate: workspace-containment]: Read and write only inside the workspace. Writes elsewhere are limited to the temp dir and runtime artifact dirs. Other repos need `allowed_roots` (`.along/rules/gates.yaml`, issue frontmatter, `along start --allow-root`). Never touch credential stores (`~/.ssh`, `~/.aws`).
- **Runtimes Without Along Hooks** (Claude Cowork, Cursor, OpenCode, plain shells): gates are advisory there. Agents MUST self-apply every gate-tagged rule and use the `along` CLI for tests, commits, entity changes, and wrap instead of raw tools. `along doctor` reports the enforcement level.
- **File Modification & Anti-Deletion**:
  - Never delete, truncate, or overwrite existing documentation, comments, or code unless explicitly instructed.
  - After batch edits or migrations, agents MUST run `git diff --stat` and inspect unexpected size reductions.
  - No stubs or skeletons in place of populated code.
  - Anchor edits on minimal unique chunks. Restore unintended deletions immediately.
- **Clean ASCII**: ASCII punctuation only (no typographic dashes, quotes, ellipsis, bullets, NBSP/zero-width chars or BOM); `along sanitize --write` fixes them.
- **Markdown**: Every code fence names a language.
- **Commit-time checks**: typography, code fences, links, filenames, secrets, stubs and AI co-authors are checked by `along lint` (pre-commit and CI), not while you work.
- **Bypass Is The User's Call**: `-n`, `--force-reason`, `scratch fallback` need `--reason` and the user's reply after the failure; each bypass is recorded (`along gates stats`).
- **File Content Via Tools Only** [gate: cli_safety]: Create/edit files with the agent's file tools. NEVER carry content in heredocs, `python -c`, or inline shell. Write scripts to a file first.
- **No Ad-Hoc Shell Code Probing**: Agents must never use `python -c` or inline shell commands to probe internal module symbols or inspect functions. Internal engine packages (`alongkit`, `scripts`) are not installed into the global Python environment, and ad-hoc shell probing produces confusing error traces instead of actionable information. Prescribed inspection tools: static file tools (`view_file`, `grep_search`), AST tools (`along graph-*`), official CLI subcommands (`along <command> --help`), or dedicated hermetic tests in `tests/`.
- **CLI Black-Box Invariance**: Agents MUST treat the Along CLI and development tools as strict opaque black-box executables. Reading Along engine source code (`.along/bin/*.py`, `~/.along/bin/`, `alongkit/**`, `along_*.py`) to inspect internals, arguments, or data structures is STRICTLY FORBIDDEN unless working on the Along repository itself. Always use `along <command> --help` or official documentation in `docs/`. If an Along command returns an error or fails validation, report the exact CLI error output to the user immediately. Do not attempt to reverse-engineer or debug the Along engine.
- **Verify Written Files**: After writing/patching, confirm parsing (`python -m compileall -q`, `bash -n`, etc.) before moving on.
- **Hermetic Tests**: Tests MUST target throwaway fixtures (`tempfile.mkdtemp()`), never the live repository. Read-only access to live state is allowed. Keep a meta-test that verifies `git status --porcelain -u` stays clean.
- Windows-safe filenames: dates `YYYY-MM-DD`, date first.
- Keep `ISSUES.md` compact: `along context-budget --check` enforces the limit.
- Never write secrets into tracked files.
