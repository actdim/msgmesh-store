---
protocol: along
protocol_version: "4.6.1"
slug: add-eslint
type: debt
status: open
priority: low
created: 2026-11-08
updated: 2026-11-08
agent: claude-code
tags: [tooling, lint, dev-config]
blocked_by: []
related: [task--adopt-dev-config]
---

# Add ESLint on @actdim/dev-config base preset

The package has no ESLint at all (no `eslint.config.mjs`, no `lint` script). `task--adopt-dev-config`
moved tsconfig and Prettier to `@actdim/dev-config` (already a devDependency) and left ESLint out of scope,
because adding it introduces a new finding set that has to be triaged.

## Requirements
- REQ-1: The package MUST have an `eslint.config.mjs` built on `base()` from `@actdim/dev-config/eslint` with `tsconfigRootDir: import.meta.dirname`.
- REQ-2: `package.json` MUST have `"lint": "eslint \"./**/*.{ts,tsx}\" -f visualstudio --report-unused-disable-directives"` and devDependencies `eslint`, `eslint-formatter-visualstudio`.
- REQ-3: `noExplicitAny` MUST be `'error'` if the current `any` count can be fixed in this issue, otherwise `'warn'` with the count recorded here.

## Acceptance Criteria
- [ ] `pnpm run lint` exits 0 inside Mempart and in a standalone clone.
- [ ] Every error-level finding is fixed or documented with a reason.
- [ ] `pnpm run typecheck` and `pnpm run test` pass as before.
