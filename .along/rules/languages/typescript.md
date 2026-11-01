<!-- managed by along: do not edit. Project guidelines belong in docs/ and AGENTS.md -->
<!-- template: languages/typescript.md sha256:1ee034239cddda035a603f2f0cd17615b61a96ddfdb54047bc1ff42b8826f44d -->

# TypeScript Coding Standards & Best Practices

Strict TypeScript conventions for production-grade, maintainable codebases and monorepos.

---

## 1. Monorepos & Workspace Dependency Management

- **PNPM Workspaces Standard**:
  - In multi-package or multi-platform repositories, use PNPM workspaces (`pnpm-workspace.yaml`) to manage dependencies across packages.
  - Link internal repository packages using the `workspace:*` protocol (e.g. `"@myorg/core": "workspace:*"`). `pnpm publish` automatically resolves and replaces `workspace:*` with exact semver versions when publishing to a registry.
  - Use PNPM Catalogs (`pnpm:catalog:`) in the root `pnpm-workspace.yaml` to enforce uniform external dependency versions (React, TypeScript, Vitest, MSW) across all workspace members without version drift.

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
  - "apps/*"

catalog:
  typescript: ^5.5.0
  vitest: ^2.0.0
  msw: ^2.4.0
```

---

## 2. Strict Typing & Zero `any`

- **Compiler Configuration**: Enforce `"strict": true`, `"noImplicitAny": true`, `"strictNullChecks": true`, `"noUncheckedIndexedAccess": true`.
- **Ban `any`**: Never use `any`. Use `unknown` when the type is truly dynamic, and narrow it using type guards (`typeof`, `instanceof`, custom type predicates).
- **Explicit Return Types**: All exported functions and API boundaries must declare explicit return types.

```typescript
// Recommended: Type guard with unknown
function isApiResponse(data: unknown): data is { success: boolean; data: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "success" in data &&
    typeof (data as Record<string, unknown>).success === "boolean"
  );
}
```

---

## 3. Types vs Interfaces & Data Modeling

- **Interfaces for Object Shapes & Extension**: Use `interface` for object contracts, classes, and public APIs that may be augmented.
- **Type Aliases for Unions & Utilities**: Use `type` for unions, intersections, primitives, tuples, and mapped types.
- **Discriminated Unions**: Model domain states using discriminated unions with a common literal discriminator field (e.g. `type` or `status`).

```typescript
// Recommended: Discriminated union
type AsyncResult<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };
```

---

## 4. Immutability & Modern Conventions

- **Readonly Collections**: Prefer `ReadonlyArray<T>` or `readonly T[]` and `as const` assertions for immutable configuration and lookup tables.
- **Optional Chaining & Nullish Coalescing**: Prefer `?.` and `??` over verbose logical checks (`&&` or `||`).
- **Exact Optional Properties**: Explicitly distinguish between `undefined` and missing properties.

---

## 5. Naming & File Organization

- **PascalCase**: Classes, Interfaces, Types, Enums, React Components.
- **camelCase**: Variables, functions, methods, properties.
- **UPPER_SNAKE_CASE**: Global constants.
- **kebab-case**: Source filenames (e.g. `user-service.ts`, `auth-guard.ts`).

---

## 6. Package Distribution & AI Metadata (LLM-Wiki)

- **Explicit `package.json` `"files"` Whitelist (Standard / Vanilla)**:
  - Avoid relying on `.npmignore` alone. Always explicitly declare the `"files"` array in `package.json` to guarantee that compiled output (`dist`), AI rules (`AGENTS.md`, `llms.txt`), and the `docs/` Wiki are published in npm packages.

```json
{
  "name": "@myorg/core",
  "version": "1.0.0",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "AGENTS.md",
    "llms.txt",
    "docs",
    "README.md"
  ],
  "keywords": ["along", "ai-agent", "llms", "rules"],
  "ai": {
    "agents": "AGENTS.md",
    "llms": "llms.txt",
    "wiki": "docs"
  }
}
```

- **PNPM Workspaces & Monorepo Publishing (Recommended)**:
  - Use `pnpm publish --filter <package>` to publish individual workspace packages.
  - The `workspace:*` protocol automatically translates to exact semantic versions during `pnpm publish`.
  - Place shared root documentation in `docs/` and package-specific architectural articles in `packages/<pkg>/docs/`.

- **Consumer & Upward Discovery Protocol**:
  - When consumers install the package (`pnpm add @myorg/core`, `npm i @myorg/core`), package files reside in `node_modules/@myorg/core/`.
  - Along dependency scanner (`along-dep-scan`) inspects `package.json` dependencies, resolves the package in `node_modules/`, identifies `AGENTS.md` and `docs/` (or manifest `"ai"` metadata), and records links in `docs/topic--dependencies.md`.


