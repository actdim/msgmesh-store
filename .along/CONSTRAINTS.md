<!-- Generated projection from .along/DECISIONS. Do not edit by hand. Run: along decision sync -->
# Active Architectural Constraints

This document compiles active architectural rules and constraints from `.along/DECISIONS/`.
Detailed context, history, and superseded ADRs remain in individual decision records.

- **[Dev servers, Storybook and browser checks run through project scripts, not agent-vendor config](DECISIONS/ADR-2026-11-08--no-agent-vendor-dev-tooling.md)**: Dev servers, Storybook and any browser verification are started with the package's own scripts (pnpm run dev, pnpm run storybook, pnpm --dir <pkg> run...
