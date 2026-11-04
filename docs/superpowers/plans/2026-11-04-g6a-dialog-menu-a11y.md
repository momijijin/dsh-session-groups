# G6a Dialog and Group Menu Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plugin's dialogs and group context menu usable without a pointer, with a clear accessible name, predictable focus, Escape handling and a keyboard equivalent for moving/resizing dialogs.

**Architecture:** Accessibility behavior lives in the client half and is layered onto the existing dialog/menu components. No host protocol, storage schema, group model or release behavior changes. The dialog gains a dedicated focus manager; the menu gains roving focus; both use the already-installed React/Playwright stack.

**Tech Stack:** React 19 via the plugin's `h` helper, DSH client runtime, Node test runner, Playwright isolated A+ harness.

**Spec:** No dedicated feature spec yet. Source of truth: the G6 audit captured in this plan, `src/client/dialog-host.js`, `src/client/session-menu.js`, and the user's request for G6 a11y work. Do not include lazy rendering or file splitting in this plan.

## Global Constraints

- Branch: `feature/g6a-dialog-a11y`; consume `0.3.0-beta.71` on this branch.
- Do not add npm dependencies; use existing React, DOM and Playwright APIs.
- Do not change dialog geometry, storage keys, route contracts or group data.
- Keep pointer drag/resize behavior unchanged.
- Every task must keep `npm test` green and add the smallest test that proves its behavior.
- Run the isolated A+ smoke before merge; no release tag.
- The existing `.70` install remains the user's trial build until `.71` is verified.
- The dialog must remain usable with the mouse, keyboard and screen readers.

## Review Focus

- A dialog opened from a menu must return focus to the originating group/session row, not the detached menu item.
- Tab and Shift+Tab must wrap inside the dialog and never reach the page behind it.
- Escape must close every dialog kind, including selection dialogs without a text input.
- The first focus target must be visible and useful: the text input for name dialogs, otherwise the first enabled action/choice.
- A keyboard resize/move must respect the same viewport clamping and persistence path as pointer gestures.
- Both `en` and `zh` must expose a meaningful dialog/menu name; no raw locale key may appear.

---

### Task 1: Accessible dialog name, initial focus and return focus

**Files:**
- Modify: `src/client/dialog-host.js:270-300`, `:551-584`
- Modify: `locale/en.json`, `locale/zh.json`
- Test: `tests/client/ui-layout.test.js`
- Test: `e2e/isolated.spec.mjs`

**Interfaces:**
- Consumes: `dialog.kind`, `dialog.titleKey`, `inputRef`, `dialogRef`.
- Produces: stable title id `dsg-dialog-title`, `aria-labelledby="dsg-dialog-title"`, and a restored `document.activeElement` after close.
- Locale keys: `dialog.moveDialog` and `dialog.resizeDialog` in `en.json` / `zh.json` (for Task 3).

- [ ] **Step 1: Write the failing source contract**

In `tests/client/ui-layout.test.js`, add a test that requires:

```js
assert.match(dialogHost, /'aria-labelledby': 'dsg-dialog-title'/)
assert.match(dialogHost, /id: 'dsg-dialog-title'/)
assert.match(dialogHost, /restoreFocusRef/)
```

The test must fail because the current dialog has no accessible name and no restore path.

- [ ] **Step 2: Run the source test and confirm RED**

```bash
node --test tests/client/ui-layout.test.js
```

Expected: the new test fails on the missing `aria-labelledby`.

- [ ] **Step 3: Implement the accessible name**

Render the title as:

```js
h('div', { id: 'dsg-dialog-title', class: 'dsg-dialog-title' }, title)
```

Put `'aria-labelledby': 'dsg-dialog-title'` on the dialog element.

- [ ] **Step 4: Implement initial focus and return focus**

Add a `restoreFocusRef` ref. On the transition from no dialog to a dialog, save `document.activeElement` before focusing inside. Focus `inputRef` for name dialogs, otherwise focus the first focusable element that is not `aria-hidden`, disabled or the dialog container. On close, restore the saved element and clear the ref.

- [ ] **Step 5: Add an A+ assertion**

In `e2e/isolated.spec.mjs`, open a dialog from a group row, verify `role="dialog"` has an accessible name containing the localized title, then cancel and verify focus is back on the originating row.

- [ ] **Step 6: Run focused and full checks**

```bash
node --test tests/client/ui-layout.test.js
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/dialog-host.js locale/en.json locale/zh.json tests/client/ui-layout.test.js e2e/isolated.spec.mjs
git commit -m "feat(a11y): [0.3.0-beta.71] name dialogs and restore focus"
```

---

### Task 2: Focus trap and Escape for every dialog kind

**Files:**
- Modify: `src/client/dialog-host.js:270-300`, `:551-635`
- Test: `tests/client/ui-layout.test.js`
- Test: `e2e/isolated.spec.mjs`

**Interfaces:**
- Consumes: `dialogRef`, `close`, `dialog` state.
- Produces: a document-level keydown trap while a dialog is open; Escape dispatches `dialog: null`.

- [ ] **Step 1: Write the failing source contract**

Require that the dialog host registers a keydown trap, queries focusable descendants and handles `Tab`/`Shift+Tab` plus `Escape`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/client/ui-layout.test.js
```

- [ ] **Step 3: Implement focusable collection**

Use this selector inside the dialog:

```text
button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])
```

Filter `aria-hidden="true"`, invisible nodes and the dialog container itself. Treat a missing list as a safe no-op.

- [ ] **Step 4: Implement the trap**

Add one document-level `keydown` listener only while `dialog` exists:

- `Escape` → `preventDefault()`, `close()`.
- `Tab` → if active element is the last focusable and Shift is not pressed, wrap to first; if active element is the first and Shift is pressed, wrap to last; otherwise let the browser advance.
- Remove the listener when the dialog closes/unmounts.

Remove the input-only Escape handler once the root trap owns it; keep Enter-to-confirm for name inputs.

- [ ] **Step 5: Add A+ coverage for every dialog family**

Open at least a selection dialog and a destructive confirmation, press Tab repeatedly, assert focus stays within the dialog; press Escape and assert it closes. Add a name-dialog Escape assertion.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/client/ui-layout.test.js
npm test
npm run test:isolated
git add src/client/dialog-host.js tests/client/ui-layout.test.js e2e/isolated.spec.mjs
git commit -m "feat(a11y): [0.3.0-beta.71] trap dialog focus and honor Escape"
```

---

### Task 3: Keyboard move and resize for dialogs

**Files:**
- Create: `src/client/dialog-keyboard.js`
- Modify: `src/client/dialog-host.js:551-635`
- Test: `tests/client/dialog-keyboard.test.js`
- Test: `e2e/isolated.spec.mjs`

**Interfaces:**
- Consumes: `dragDialogRect(rect, dx, dy, viewportWidth, viewportHeight)`, `resizeDialogRect(rect, dir, dx, dy, viewportWidth, viewportHeight)`, `saveDialogGeometry(kind, rect)`.
- Produces: `dialogKeyboardDelta(key, shiftKey)` returning `{ dx, dy }`; the titlebar moves by arrow keys; the `se` resizer adjusts width/height by arrow keys.

- [ ] **Step 1: Write the failing unit test**

```js
assert.deepEqual(dialogKeyboardDelta('ArrowRight', false), { dx: 10, dy: 0 })
assert.deepEqual(dialogKeyboardDelta('ArrowUp', true), { dx: 0, dy: -1 })
assert.deepEqual(dialogKeyboardDelta('Escape', false), { dx: 0, dy: 0 })
```

Run `node --test tests/client/dialog-keyboard.test.js`; expect a module-not-found failure.

- [ ] **Step 2: Implement the pure helper**

Create `src/client/dialog-keyboard.js` exporting `dialogKeyboardDelta` and `dialogKeyboardStep` (the latter returns the keyboard step size: 10 normally, 1 with Shift). Keep it free of DOM/React imports.

- [ ] **Step 3: Make the titlebar keyboard-movable**

Add `tabIndex=0` and a localized `aria-label` (`dialog.move` / `移动对话框`). On Arrow keys, compute the next rect with `dragDialogRect`, set `dialogRect`, and call `saveDialogGeometry` only on keyup/commit to avoid excessive writes. Home resets to the centered default; Escape is owned by Task 2.

- [ ] **Step 4: Make the `se` resizer keyboard-resizable**

Keep all eight pointer resizers for mouse behavior. Give the `se` resizer `tabIndex=0`, `role="separator"`, `aria-label` and `aria-valuenow`/min/max; mark only the other seven `aria-hidden="true"`. Arrow keys resize with `resizeDialogRect`; Home resets to the natural/centered rect; persist on keyup.

- [ ] **Step 5: Add A+ bounds assertions**

Open a dialog, focus the titlebar and press ArrowRight/ArrowDown; assert the dialog's bounding box moves by the expected clamped amount. Focus the `se` resizer, resize, assert size changes within the viewport, then cancel.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/client/dialog-keyboard.test.js
node --test tests/client/dialog-geometry.test.js
npm test
npm run test:isolated
git add src/client/dialog-keyboard.js src/client/dialog-host.js tests/client/dialog-keyboard.test.js e2e/isolated.spec.mjs
git commit -m "feat(a11y): [0.3.0-beta.71] add keyboard dialog move and resize"
```

---

### Task 4: Roving keyboard focus in the group menu

**Files:**
- Modify: `src/client/session-menu.js:31-113`
- Test: `tests/client/ui-layout.test.js`
- Test: `e2e/isolated.spec.mjs`

**Interfaces:**
- Consumes: `menuRef`, `[role="menuitem"]`, `handlers.closeMenu`.
- Produces: ArrowDown/ArrowUp/Home/End move focus among enabled menu items; Escape closes and restores the originating row.

- [ ] **Step 1: Write the failing source contract**

Require the menu to contain ArrowDown/ArrowUp/Home/End handling and `role="menu"` item focus management.

- [ ] **Step 2: Run RED**

```bash
node --test tests/client/ui-layout.test.js
```

- [ ] **Step 3: Implement roving focus**

Add a keydown handler on the menu:

- ArrowDown/ArrowUp cycle through enabled `[role="menuitem"]` buttons, wrapping.
- Home/End jump to the first/last enabled item.
- Escape closes the menu.
- Do not move focus for unrelated keys; preserve native button activation.

- [ ] **Step 4: Add A+ coverage**

Open the group menu via keyboard (`Shift+F10`), press ArrowDown and assert the second action (New subgroup) is focused; press Escape and assert the group row regains focus.

- [ ] **Step 5: Verify and commit**

```bash
node --test tests/client/ui-layout.test.js
npm test
npm run test:isolated
git add src/client/session-menu.js tests/client/ui-layout.test.js e2e/isolated.spec.mjs
git commit -m "feat(a11y): [0.3.0-beta.71] add roving focus to the group menu"
```

---

### Task 5: Final a11y verification and local trial

**Files:**
- Modify: `docs/TEST-RESULTS.md`
- Modify: `README.md`, `README.zh.md` (a11y scope/limits)

**Interfaces:**
- Consumes: all prior task commits and the built package.
- Produces: a `.71` tarball installed in the desktop profile and a reviewed a11y evidence note.

- [ ] **Step 1: Run the full gate**

```bash
npm ci
npm test
npm run build
node --check lib/client.js
npm run check:coverage
npm pack --dry-run
```

- [ ] **Step 2: Run isolated A+**

Start a disposable instance with the `.71` tarball and run `npm run test:isolated`; stop it afterwards.

- [ ] **Step 3: Install locally for user trial**

Use `ELECTRON_RUN_AS_NODE=1` and `plugin --profile desktop add --force "file:<absolute .71 tarball>"`. Verify the installed `package.json` version before asking the user to restart.

- [ ] **Step 4: Record results and commit**

Add the keyboard/focus evidence to `docs/TEST-RESULTS.md` and the a11y limitation (no full automated axe audit; no pointer-free drag/resize for the sidebar itself) to both READMEs. Commit with the version marker.

- [ ] **Step 5: User review gate**

After the user accepts the trial, merge with `--no-ff`, create `archive/feature/g6a-dialog-a11y`, delete the branch and push dev. Do not tag or release.

## Self-Review

- **Spec coverage:** accessible names, initial/return focus, focus trap, Escape, keyboard move/resize, menu roving focus and A+ verification are covered.
- **Step scan:** every step has a command, selector, helper contract or concrete assertion. No “make it accessible” placeholder remains.
- **Type consistency:** `dialogKeyboardDelta`/`dialogKeyboardStep` are defined once; titlebar and resizer tasks consume the same helpers; the A+ selectors are the existing dialog test ids.
- **Review focus:** each listed input class is tied to a task and its test.
- **Proportion:** the plan is behavior-focused and does not restructure unrelated code; render virtualization remains out of scope.

## Out of Scope

- Lazy rendering or virtualized tree changes.
- Splitting `components.js` or `routes.js`.
- A full automated axe/contrast CI; that needs a dependency decision and a separate plan.
- Drag-and-drop keyboard equivalence for the whole tree.
- Changing dialog geometry, persistence keys or route payloads.
