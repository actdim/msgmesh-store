<!-- managed by along: do not edit. Project guidelines belong in docs/ and AGENTS.md -->
<!-- template: platforms/web.md sha256:71bfed6b4ef6fdba63dc3faf510edd4c380f7ed5f51f48ad51b3ab072cad9985 -->

# Web Application Engineering Guidelines & Best Practices

Strict architectural and engineering standards for browser-based and SSR web applications.

---

## 1. Network & API Layer Architecture

1. **Mock Service Worker (MSW) Standard for REST API Simulation**:
   - Use MSW (`msw`) as the standard for REST API mocking and network interception.
   - **Offline / Serverless Development**: MSW is strongly recommended to allow frontend and UI teams to build, iterate, and test client application logic completely decoupled from a running backend server.
   - **Zero Monkey-Patching**: Do not monkey-patch `window.fetch` or `axios` manually; intercept network traffic at the Service Worker layer in the browser (`setupWorker`) or the native request interceptor layer in Node / Vitest (`setupServer`).
   - **Handler Colocation**: Colocate request handlers by domain or entity in `src/mocks/handlers/` (e.g. `handlers/auth.ts`, `handlers/orders.ts`).
   - **Schema Parity**: Maintain strict schema parity between production OpenAPI/TypeScript API contracts and MSW mock response payloads.

2. **Client-Server State Separation**:
   - Separate Server State (cached API data, query status) from Client State (UI toggles, transient form inputs, modal visibility).
   - Use dedicated cache management (e.g. TanStack Query, SWR, or RTK Query) rather than storing remote API responses in global UI stores (such as Zustand, Redux, or Pinia).

3. **Defensive Network Boundaries**:
   - Validate incoming API payloads at the boundary using schema parsers (e.g. Zod, ArkType, Valibot) before data enters application state.
   - Explicitly handle all 4xx/5xx HTTP statuses and network timeout failures with typed error states.

---

## 2. Rendering, Hydration & Lifecycle

1. **SSR / Client Hydration Safety**:
   - Never access browser globals (`window`, `document`, `localStorage`, `sessionStorage`) during initial render or module evaluation in SSR contexts.
   - Guard client-only logic inside lifecycle hooks (`useEffect`, `onMounted`) or explicit environment checks (`typeof window !== "undefined"`).

2. **Bundle Boundaries & Code Splitting**:
   - Lazy-load heavy non-critical views (routes, administration dashboards, rich text editors, charts) via dynamic imports.
   - Keep common dependency vendors tree-shakeable. Avoid importing monolithic libraries when modular subpath imports are available.

---

## 3. UI Accessibility (A11y) & UX Invariants

1. **Semantic HTML**:
   - Prefer native HTML interactive elements (`<button>`, `<a>`, `<input>`, `<dialog>`) over `div` or `span` with custom click handlers.
   - For custom interactive controls, supply standard ARIA attributes (`role`, `aria-expanded`, `aria-controls`, `aria-label`).

2. **Keyboard Navigation & Focus Management**:
   - Ensure all interactive elements have visible focus states (`:focus-visible`) and are keyboard-reachable (`Tab`, `Enter`, `Escape` for modals).
   - Trap focus inside active modal dialogs and restore focus to trigger elements upon dismissal.

---

## 4. Local Storage & Offline Resilience

1. **Storage Sandboxing**:
   - Wrap `localStorage` / `sessionStorage` in type-safe adapters with fallback mechanisms (e.g. in-memory storage if storage quota is exceeded or in private mode).
2. **Optimistic Updates**:
   - Roll back optimistic UI changes cleanly if the underlying API mutation fails. Always display actionable retry prompts.

