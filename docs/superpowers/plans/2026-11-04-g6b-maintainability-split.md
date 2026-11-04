# G6b Client and Host File Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reduce the two monolithic implementation files by extracting cohesive modules, without changing any DOM, CSS, route, storage or user-visible behavior.

**Architecture:** This is a behavior-neutral relocation. `components.js` becomes a small barrel/orchestrator while row, header, search and ungrouped-section components move into focused modules. `routes.js` becomes a registration orchestrator while response/parse helpers and control routes move into dedicated host modules. No framework, dependency or protocol changes.

**Tech Stack:** React 19 via `h`, Node 24, Node test runner, Playwright isolated A+ harness.

**Spec:** No dedicated feature spec. Source of truth: current file boundaries in `src/client/components.js`, `src/client/dialog-host.js`, `src/client/session-menu.js`, `src/host/routes.js`, `docs/CONTRACTS.md` and the existing 451-test suite. This plan does not implement a11y or lazy rendering.

## Global Constraints

- Branch: `feature/g6b-file-split`; consume `0.3.0-beta.72` on this branch.
- Start after G6a is merged or separately accepted; do not include a11y behavior in this split.
- No public API, route, storage, locale, CSS, test-id or DOM-order changes.
- Keep `lib/client.js` and all package metadata in sync.
- Do not add dependencies.
- Do not combine this split with a feature or bug fix.
- Existing `tests/**` and `e2e/isolated.spec.mjs` are the equivalence oracle; no assertions may be weakened to make a move pass.
- Target end state (not a test): `components.js` under 1,800 lines and `routes.js` under 550 lines.

## Review Focus

- A moved component must still receive the same `store`, `handlers`, `props`, `virtualRef` and `h` values; a missing prop is a behavior bug even if the import compiles.
- Extracted helpers must not create import cycles between rows, sections, header and `GroupsView`.
- `__internal` exports and any tests importing from `components.js` must keep working through the barrel.
- Control-route extraction must preserve the same fence order, body limits, status codes, planHash/idempotency behavior and publish/log side effects.
- The 451-test suite and A+ must remain green after every extraction, not only at the end.

---

### Task 1: Extract client primitives and shared row controls

**Files:**
- Create: `src/client/components/primitives.js`
- Modify: `src/client/components.js:118-395`
- Test: `tests/client/ui-layout.test.js` (import smoke only)

**Interfaces:**
- Consumes: `h`, `rt`, existing icon/button/status helpers.
- Produces: `IconButton`, `TextButton`, `StatusSpinner`, `StatusDot`, `SessionStatusCell`, `DropPlaceholder`, `EmptyDropBox`, `menuKeyHandler`, `classNames`, `useViewStore`, `usePerfCommit`, `dispatch`, `toast`, and the placeholder heights.

- [ ] **Step 1: Add an import-smoke test**

Add a test that imports the new module and asserts every named export listed above is defined; run it and confirm RED because the module does not exist.

- [ ] **Step 2: Move the leaf helpers**

Cut the corresponding blocks from `components.js` into `primitives.js`; import them back into `components.js` and re-export only what external tests need. Keep the same `data-testid`, classes and props.

- [ ] **Step 3: Run the targeted and full suites**

```bash
node --test tests/client/ui-layout.test.js
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/client/components.js src/client/components/primitives.js tests/client/ui-layout.test.js
git commit -m "refactor(client): [0.3.0-beta.72] extract group primitives"
```

---

### Task 2: Extract session rows, group nodes and group drop slots

**Files:**
- Create: `src/client/components/rows.js`
- Modify: `src/client/components.js:395-795`
- Test: `tests/client/ui-layout.test.js`

**Interfaces:**
- Consumes: primitives from Task 1; `sessionRowPropsEqual`, `sessionTitle`, tree/drag/color helpers, icons, runtime.
- Produces: `SessionRow`, `SessionRowImpl`, `GroupNode`, `GroupDropSlot`, `SESSION_PLACEHOLDER_HEIGHT`, `GROUP_PLACEHOLDER_HEIGHT` if not already in primitives.

- [ ] **Step 1: Add the import smoke for rows**
- [ ] **Step 2: Move the row/group subtree**

Keep the rendered tree exactly as-is. Do not change memoization, drag handlers, `aria-*`, `data-*` or empty-line logic.

- [ ] **Step 3: Run targeted, full and A+ suites**

```bash
node --test tests/client/ui-layout.test.js tests/client/group-drag.test.js tests/client/drag.test.js
npm test
```

Run `npm run test:isolated` against a disposable `.72` instance and confirm drag/collapse/search still pass.

- [ ] **Step 4: Commit**

```bash
git add src/client/components.js src/client/components/rows.js tests/client/ui-layout.test.js
git commit -m "refactor(client): [0.3.0-beta.72] extract tree rows"
```

---

### Task 3: Extract ungrouped section, search box and header surfaces

**Files:**
- Create: `src/client/components/ungrouped.js`
- Create: `src/client/components/search-box.js`
- Create: `src/client/components/header.js`
- Modify: `src/client/components.js:806-1855`
- Test: `tests/client/ui-layout.test.js`

**Interfaces:**
- Consumes: primitives/rows from Tasks 1–2; virtual-list, search, sidebar-width, filter, diagnostics and runtime helpers.
- Produces: `UngroupedSection`, `VirtualSpacer`, `SearchBox`, `SEARCH_LISTBOX_ID`, `Header`, `ArchiveFilterPopover`, `OnboardingCard`, `StatusSessionsButton`, `Banner`, `Rail`, `FlatFallback`.

- [ ] **Step 1: Add the import smoke for all three modules**
- [ ] **Step 2: Move each section without changing JSX/order**

`Header` may remain the composition point; do not change header DOM order. Keep `ArchiveFilterPopover` with the header because it is header-local.

- [ ] **Step 3: Run targeted, full and A+ suites**

```bash
node --test tests/client/ui-layout.test.js tests/client/search.test.js tests/client/virtual-list.test.js
npm test
npm run test:isolated
```

- [ ] **Step 4: Commit**

```bash
git add src/client/components.js src/client/components/ungrouped.js src/client/components/search-box.js src/client/components/header.js tests/client/ui-layout.test.js
git commit -m "refactor(client): [0.3.0-beta.72] extract header and search surfaces"
```

---

### Task 4: Extract host response/parse contract

**Files:**
- Create: `src/host/route-contract.js`
- Modify: `src/host/routes.js:49-230`
- Test: `tests/host/routes.test.js` or the existing route test that imports these exports

**Interfaces:**
- Consumes: `DOC_VERSION`, `normalizeColor`, `normalizeColorHex`, `validateDoc`, constants.
- Produces: `sendJson`, `sendEmpty`, `sendMethodNotAllowed`, `contentTypeOf`, `isObject`, `readBoundedBody`, `controlPlanHash`, `unexpectedControlField`, `loadResponse`, `commitResponse`, `parseCommitBody`, `parseDiagnosticsBody`.

- [ ] **Step 1: Add a module import smoke test**
- [ ] **Step 2: Move pure helpers**

Keep `routes.js` re-exporting the public functions used by tests and external callers. Do not change status codes, messages, body limits or JSON headers.

- [ ] **Step 3: Run host and contract tests**

```bash
node --test tests/host/*.test.js tests/integration/*.test.js
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/host/routes.js src/host/route-contract.js tests/host tests/integration
git commit -m "refactor(host): [0.3.0-beta.72] extract route contract helpers"
```

---

### Task 5: Extract control routes

**Files:**
- Create: `src/host/control-routes.js`
- Modify: `src/host/routes.js:579-968`
- Test: `tests/host/control.test.js`, `tests/host/routes.test.js`, `tests/integration/host-routes.test.js`

**Interfaces:**
- Consumes: a context object from `registerRoutes`:

```js
{
  register, store, ctx,
  sendJson, sendMethodNotAllowed, readControlJson,
  controlApiEnabled, controlSessionsEnabled, controlDestructiveEnabled,
  controlUnavailable, controlDenied, fenceDenied,
  controlPlanHash, unexpectedControlField,
  publishChange, getService, logInfo,
}
```

- Produces: `{ eventsPath, controlDoctorPath, controlStatePath, controlResolvePath, controlPlanPath, controlApplyPath }`.
- Preserve absolute route paths, labels, fence-first ordering, body limits, protocol envelope, planHash, idempotency and logs.

- [ ] **Step 1: Add an import-smoke test for `registerControlRoutes`**
- [ ] **Step 2: Move the control block**

Move only the control/event/doctor route registrations; leave load/commit/diagnostics/debug/skill routes in `routes.js` until a later split. Route labels must not change.

- [ ] **Step 3: Run the full control matrix**

```bash
node --test tests/host/control.test.js tests/host/routes.test.js tests/integration/host-routes.test.js
npm test
```

- [ ] **Step 4: Run A+ control/SSE slices**

Start a `.72` disposable instance, run `npm run test:isolated`, and confirm external SSE refresh, rapid revision convergence, multi-window SSE and concurrent CAS still pass.

- [ ] **Step 5: Commit**

```bash
git add src/host/routes.js src/host/control-routes.js tests/host tests/integration
git commit -m "refactor(host): [0.3.0-beta.72] extract control routes"
```

---

### Task 6: Final size check, documentation and local trial

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/TEST-RESULTS.md`, `README.md`, `README.zh.md`, `CHANGELOG.md`
- Test: all existing suites

**Interfaces:**
- Consumes: all extraction commits.
- Produces: documented module boundaries, updated test evidence and a `.72` trial tarball.

- [ ] **Step 1: Measure and record line counts**

```text
components.js: expected < 1,800 lines
routes.js: expected < 550 lines
```

Record the before/after counts in `docs/ARCHITECTURE.md`; do not add a brittle line-count test.

- [ ] **Step 2: Run the release-grade checks**

```bash
npm ci
npm test
npm run build
node --check lib/client.js
npm run check:coverage
npm pack --dry-run
```

- [ ] **Step 3: Install `.72` locally for trial**

Use `ELECTRON_RUN_AS_NODE=1` and the desktop profile. Verify the installed version, then ask the user to restart and smoke-test group drag, search, menu, settings and lock behavior.

- [ ] **Step 4: Commit docs and evidence**

Do not tag or release. After user acceptance only, merge `--no-ff`, archive the branch and push dev.

## Self-Review

- **Spec coverage:** primitive/row/header/search extraction, route-contract extraction, control-route extraction, module-size recording and local trial are covered.
- **Step scan:** each move has a file boundary, a targeted test command and a full-suite/A+ gate.
- **Type consistency:** all exports named in Interfaces are the ones imported by later tasks; no task invents a second name for the same helper.
- **Review focus:** prop forwarding, import cycles, `__internal` compatibility, fence order and post-move A+ are explicitly checked.
- **Proportion:** this is a relocation plan; it does not rewrite behavior or a11y code.

## Out of Scope

- Lazy rendering and virtualization.
- a11y behavior (G6a owns it).
- Splitting `GroupsView` handlers or `DialogHost` further in this pass; reassess after the measured split.
- New dependencies or a lint-only large-file gate.
- Release tags, market submission or screenshots.
