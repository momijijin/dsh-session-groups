# Session Groups V1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 dsh-session-groups 上交付 V1.1：分组视图左栏可拖宽、分组可拖拽排序/改父级、会话搜索下拉，并通过完整回归与用户验收。

**Architecture:** 继续使用一个 Cordis 插件：Host 数据层不变；Client 新增 `sidebar-width.js`（宽度纯函数 + 宿主 DOM 覆盖）、`group-drag.js`（组拖落点纯函数）、`search.js`（搜索索引 + 会话显现纯函数），组件层只在 `components.js`/`css.js` 接入。分组拖拽复用现有 `moveGroup(doc,id,parentId,index)` 与 `commitDoc` 队列；宽度只改 `<style>`/`data-*`，不写宿主内联样式；搜索只读，不写 doc。

**Tech Stack:** Node 22 ESM、React 18（externals）、esbuild、Node `node --test`、Playwright/CDP E2E（现有 `e2e/groups.spec.mjs`）。

**Spec:** `docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md`

## Global Constraints

- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2；不改宿主安装目录、不改 `workspace.json`/session 日志/`cordis.patch.yml`。
- 宽度只在 `viewMode=groups` 且 `wide=true` 时覆盖；官方视图/rail 必须恢复官方宽度；264–760px，主内容至少 480px；存储键 `dsh-session-groups.width.v1`。
- 分组拖拽只改分组 doc；使用 `moveGroup` 现有 cycle/depth 校验；禁止进自身/后代；落点即最终父级+序号。
- 搜索只读；归档结果列出但 `aria-disabled=true`，不可打开；选中普通会话才 `openSession`。
- 新文案必须同时进 `src/client/locale.js`、`locale/zh.json`、`locale/en.json`，zh/en key 集合一致。
- 新 testid 追加到 `docs/CONTRACTS.md §4.1` 和 `docs/TEST-PLAN.md`；不删除/改名旧 testid。
- 不新增依赖；不新增 DOM/React 测试基建；组件行为用 E2E，纯函数用 `node --test`。
- 每个 commit step 仅在 Lead 已取得用户本地 commit 授权后执行；否则跳过并在结果中说明。不安装 desktop、不 push。
- 代码/构建产物不漂移：提交前 `npm run build` 并 `node --check lib/client.js`。

## Review Focus

1. **官方视图/rail 被宽度覆盖污染**：切回官方或折叠后，侧栏宽度必须回到进入前记录的官方值，把手消失。
2. **组拖子树/环/旧 doc 丢失**：同父/跨父落点、空组/有会话无子组、自身后代、连拖两次都要保持正确父级和序号。
3. **折叠态搜索静默失败**：目标组或 `__ungrouped__` 折叠时，选中结果必须展开所在容器 + 全部祖先，行可见且滚动高亮。
4. **264px 极窄布局溢出**：宽度拉到 264 时搜索框/按钮不产生水平溢出；官方视图宽度不受影响。
5. **locale/testid/契约漂移**：新 key 有 zh/en，新 testid 已登记，旧 12 步 E2E 仍全绿。

---

### Task 1: 宽度纯函数与持久化

**Files:**
- Create: `src/client/sidebar-width.js`
- Create: `tests/client/sidebar-width.test.js`

**Interfaces:**
- Consumes: `safeStorage` from `src/client/state.js`；无宿主依赖。
- Produces:
  - `SIDEBAR_WIDTH_KEY = 'dsh-session-groups.width.v1'`
  - `SIDEBAR_WIDTH_MIN = 264`, `SIDEBAR_WIDTH_MAX = 760`, `SIDEBAR_WIDTH_DEFAULT = 420`
  - `clampSidebarWidth(px, viewportWidth, options?) -> number | null`（`options.mainMin` 默认 480；`max = min(760, viewport-480)`；`max<=min` 时返回 `null`，表示不可覆盖）
  - `readSidebarWidth(storage = safeStorage()) -> number`（非法/缺失回退 420）
  - `writeSidebarWidth(px, storage = safeStorage()) -> void`（best effort）

- [ ] **Step 1: Write the failing tests**

```js
// tests/client/sidebar-width.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { clampSidebarWidth, readSidebarWidth, writeSidebarWidth, SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH_DEFAULT } from '../../src/client/sidebar-width.js'

test('clamp: min-1/min/max/max+1 and viewport cap', () => {
  assert.equal(clampSidebarWidth(263, 1440), 264)
  assert.equal(clampSidebarWidth(264, 1440), 264)
  assert.equal(clampSidebarWidth(760, 1440), 760)
  assert.equal(clampSidebarWidth(761, 1440), 760)
  assert.equal(clampSidebarWidth(800, 1200), 720) // 1200-480
  assert.equal(clampSidebarWidth(600, 700), null) // max<=min -> no override
  assert.equal(clampSidebarWidth(600, 744), null) // max=264 == min -> no wider range
  assert.equal(clampSidebarWidth(Number.NaN, 1440), SIDEBAR_WIDTH_DEFAULT)
})
test('storage: key, default, valid, invalid, throwing storage', () => {
  const map = new Map()
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) }
  assert.equal(readSidebarWidth(storage), 420)
  writeSidebarWidth(620, storage)
  assert.equal(map.get(SIDEBAR_WIDTH_KEY), '620')
  assert.equal(readSidebarWidth(storage), 620)
  map.set(SIDEBAR_WIDTH_KEY, 'nope')
  assert.equal(readSidebarWidth(storage), 420)
  assert.doesNotThrow(() => writeSidebarWidth(500, { setItem: () => { throw new Error('blocked') } }))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/client/sidebar-width.test.js`
Expected: FAIL with module/function not defined.

- [ ] **Step 3: Implement `src/client/sidebar-width.js`**

Implement the constants above and pure clamp/storage functions. `clampSidebarWidth` returns `null` when `viewportWidth - mainMin <= min` (no usable wider range); `readSidebarWidth` must catch storage exceptions; `writeSidebarWidth` must never throw. No DOM code in this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/client/sidebar-width.test.js`
Expected: PASS.

- [ ] **Step 5: Run full tests and commit**

Run: `npm test`；Expected: 全部 PASS（含新增）。
Commit（仅在已获本地授权时）：`feat(v1.1): add sidebar width math and persistence`.

---

### Task 2: 宽度覆盖控制器、把手与 E2E

**Files:**
- Modify: `src/client/sidebar-width.js`
- Modify: `src/client/components.js`（`GroupsView`、`Header`、新增 `ResizeHandle`）
- Modify: `src/client/css.js`
- Modify: `src/client/locale.js`, `locale/zh.json`, `locale/en.json`
- Modify: `docs/CONTRACTS.md`（追加 `session-groups-resize-handle`）
- Test: `e2e/groups.spec.mjs`（新增 step 13）

**Interfaces:**
- Consumes: Task 1 的 `clampSidebarWidth`/read/write；`wide` prop。
- Produces:
  - `findLayoutNodes(rootElement) -> { supported, frame, sidebarRoot, officialHandle }`（`supported=false` when ancestors missing）
  - `applyWidthOverride(nodes, width, viewportWidth) -> { update(width), clear() } | null`（`null` when `clampSidebarWidth(...)===null`；插入/更新 `<style data-dsg-width>`、`data-dsg-sidebar-frame/root`、隐藏官方 `[data-side="sidebar"]`；`clear()` 移除）
  - `ResizeHandle({ width, min, max, onChange, onCommit, onReset })`；testid `session-groups-resize-handle`，`role="separator"`，`aria-valuemin/max/now`。

- [ ] **Step 0: Prepare the isolated E2E server**

Run: `pwsh -NoProfile -File scripts/qa/setup.ps1 -QaHome .spike-homes\qa -RequireClientBuild`；Expected PASS.
Run: `pwsh -NoProfile -File scripts/qa/start-web.ps1 -QaHome .spike-homes\qa -Port 4402`（若脚本保持前台，用后台 job；等待 `scripts/qa/evidence/web.json` 写出）。
Expected: 4402 listening and `web.json` has token URL. E2E has **no step filter**; every invocation runs all steps in order.

- [ ] **Step 1: Add E2E step 13 (failing)**

At `e2e/groups.spec.mjs` top add `const SIDEBAR_WIDTH_KEY = 'dsh-session-groups.width.v1'`; add helpers `ui.sidebarWidth()` (sidebar root rect width), `ui.dragResizeHandle(targetX)` (real CDP `Input.dispatchMouseEvent` with mousePressed/mouseMoved/mouseReleased), and `ui.resetViewport()`/`ui.setViewport(width)` via `Emulation.setDeviceMetricsOverride`.
After step 12 (which leaves the **workspace** view active) add step `resize-sidebar-and-restore-official`:
- `const official = await ui.sidebarWidth();`（当前就是 workspace，不再 toggle）
- `await ui.toggleMode(); await ui.waitGroupsView();`
- drag handle to 620; assert sidebar root width ≈620 (±2); assert `localStorage[SIDEBAR_WIDTH_KEY] === '620'`.
- reload: `await driver.navigate(webState(args.evidenceDir).url)`（token URL；或 `driver.evaluate('location.reload()')` 后 `ui.waitGroupsView()`）；`await ui.dismissOverlay(); await sleep(400);` assert width 620 and handle present.
- set viewport 700 with `ui.setViewport(700)`; `await ui.waitFor('!!document.querySelector([data-testid="session-groups-rail-expand"])', 'rail expand'); await ui.click(RAIL_EXPAND);`; wait groups view; assert handle absent, no `data-dsg-sidebar-frame` override marker, and width is within the host's official narrow range (264–420) — **do not compare to the 1440-time `official` value**. `ui.resetViewport()`; `await ui.waitFor('!!document.querySelector([data-testid="session-groups-resize-handle"])', 'handle returns at 1440')`; if the official sidebar is still rail, click `RAIL_EXPAND` first; assert width 620.
- double-click handle → width 420.
- drag to 264; assert header `scrollWidth <= clientWidth + 1`.
- collapse to rail via the existing official collapse control (same selector as step 9); assert handle absent and no override marker; expand rail; assert width **264** (persisted last width, per spec §3.1) and handle present.
- toggle official; assert handle absent and width equals recorded `official`.

- [ ] **Step 2: Run E2E step 13 to verify it fails**

Run: `node e2e/groups.spec.mjs --port 4402`.
Expected: step 13 FAIL / BLOCKED on missing `session-groups-resize-handle`（其余步骤可先通过）。

- [ ] **Step 3: Implement DOM override + handle**

In `sidebar-width.js` implement `findLayoutNodes` by walking ancestors for inline `gridTemplateColumns`/`width`; capture template, generate full `<style>` with `<rest>` preserving rightbar track; observe `frame.style` + body childList, re-find on `isConnected=false`; `clear()` removes attrs/style and restores official handle.
In `components.js` mount a `ResizeHandle` only when `wide` **and** `clampSidebarWidth(current, innerWidth) !== null`; pointer capture `try/catch` (synthetic pointer may throw); rAF clamp; persist on pointerup; double-click reset 420; keyboard Arrow/Home/End; hide and call `clear()` when unsupported. **When `wide` becomes false (rail), on DOM node loss, or on unmount, call `clear()` before returning/hiding.** Add a `window.resize` listener that re-runs `findLayoutNodes` + clamp + apply/clear. Add two-row header wrapper so search can come later; keep existing controls unchanged.
Add CSS for 6px fixed handle at right edge, z-index above official handle, hover/active, and `dsg-header` min-width/wrap.
Add locale keys for handle label/reset tooltip in `locale.js` + both JSON files.

- [ ] **Step 4: Build and run E2E step 13**

Run: `npm run build && node --check lib/client.js && Copy-Item -LiteralPath lib\client.js -Destination .spike-homes\qa\staging\dsh-session-groups\lib\client.js -Force && node e2e/groups.spec.mjs --port 4402`.
Expected: step 13 PASS；其余步骤保持 PASS；无 console errors。

- [ ] **Step 5: Full regression and commit**

Run: `npm test`；E2E 12 步 + step 13 全 PASS。
Commit（授权后）：`feat(v1.1): resizable sidebar width in groups view`.

---

### Task 3: 组拖落点纯函数

**Files:**
- Create: `src/client/group-drag.js`
- Create: `tests/client/group-drag.test.js`

**Interfaces:**
- Consumes: `childrenOf`, `findGroup`, `isDescendant`, `moveGroup` from `src/shared/model.js`。
- Produces:
  - `GROUP_DRAG_MIME = 'application/x-dsh-group-id'`
  - `resolveGroupDrop({ doc, draggedId, target }) -> { parentId, index } | { invalid: true, reason }`
  - `target` 形状：
    - `{ kind: 'before'|'after', targetId }`
    - `{ kind: 'child', parentId, beforeGroupId: string|null }`（`null`=末尾；空组=0；索引在 resolve 时按最新 children 计算）
    - `{ kind: 'root-end' }`

- [ ] **Step 1: Write failing tests**

Cover:
- root `[A,B,C]`；A after B → `{parentId:null,index:1}`；C before B → `{parentId:null,index:1}`。
- A into B child `beforeGroupId: null` → `{parentId:B,index:0}`（B 有会话/无子组同样）。
- **空组**（无会话/无子组）`beforeGroupId: null` → `{parentId:empty,index:0}`。
- child slots when parent has 2 children: `beforeGroupId=B` / `beforeGroupId=C` / `null` → index 0/1/2，按移除后数组修正（A 在 B/C 之间）。
- **快速双拖 child 槽**：先在 latest doc 上解析并 `moveGroup` 第一次，再用**同一 `beforeGroupId` 锚点**在第一次结果上解析第二次，断言第二次 index 按新 children 重算而不是旧数字。
- `targetId===draggedId`（before/after）→ invalid。
- dragged into itself/descendant → invalid。
- root-end → `{parentId:null,index:根组数}`。
- 有效结果交给 `moveGroup` 后，父级/顺序/子树符合预期。

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/client/group-drag.test.js`
Expected: FAIL module not found.

- [ ] **Step 3: Implement `resolveGroupDrop`**

Compute sibling arrays with `childrenOf`; for before/after use target index; for child resolve `index` from the **latest** children list: `beforeGroupId===null ? children.length : children.findIndex(id===beforeGroupId)` (missing anchor → invalid); for root-end use root count. Apply same-parent `-1` when original index < insert index. Validate `targetId===draggedId`, `parentId===draggedId`, `isDescendant`, missing group; return invalid. Do not mutate doc.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/client/group-drag.test.js`
Expected: PASS.

- [ ] **Step 5: Full tests and commit**

Run: `npm test`；Expected PASS.
Commit（授权后）：`feat(v1.1): add group drag drop resolver`.

---

### Task 4: 组拖 UI、组体槽与菜单上移/下移

**Files:**
- Modify: `src/client/components.js`（`GroupNode`、`GroupDropSlot`、handlers、`MenuPopover`）
- Modify: `src/client/css.js`
- Modify: `src/client/locale.js`, `locale/zh.json`, `locale/en.json`
- Modify: `docs/CONTRACTS.md`（追加 `session-groups-group-drop` `data-before-group-id`、`session-groups-group-move-up/down`；补登记 `session-groups-menu`）
- Test: `e2e/groups.spec.mjs`（新增 step 14）

**Interfaces:**
- Consumes: Task 3 `resolveGroupDrop`/`GROUP_DRAG_MIME`；现有 `moveGroup`、`commitDoc`、`groupOwnedIds`。
- Produces: group header draggable; `GroupDropSlot({parentId,beforeGroupId,testId...})`; group menu items `group.moveUp`/`group.moveDown`; group drag handlers.

- [ ] **Step 1: Add E2E step 14 (failing)**

Step 13 ends in **workspace** view. At step 14 start `await ui.toggleMode(); await ui.waitGroupsView();`. Add `drag-groups-reorder-and-reparent`:
- Ensure group `b` has sessions and 0 child groups (existing step 4 state); create an empty group `e` via `ui.createGroup('空组E')`; create another root group `f` via `ui.createGroup('空组F')` for the rapid child-slot double drag.
- Drag `c` to `b` body slot index 0 → `c.parentId === b` (assert via group rows/`data-depth` or doc read from DOM); then drag `c` out before reusing.
- Drag a root group into empty group `e` body slot 0 → becomes `e` 子组（空组 index 0，覆盖 B6）。
- Drag `c` to root-end via ungrouped header → `c.parentId === null`.
- Rapid double drag before/after: drag `a` after `b`, then immediately drag `c` before `b` without waiting; assert final root order reflects both (B5; target descriptor resolved inside commit updater).
- Rapid double drag child slot: with another root group `f`, first drag `f` into `b` body `beforeGroupId` anchor, then immediately drag another root group into the **same child slot anchor**; assert both resolve against latest children (B5 child-slot path, not just before/after).
- Drag `a` to `b` top edge → root order changes; assert order.
- Drag `b` onto its own header top edge → no change, no console error.
- Group menu: choose the **first** root group, open `...`, assert move-up `data-disabled=true`; close/ reopen, click move-down, assert order changed; choose the **last** root group, open `...`, assert move-down `data-disabled=true`; after each menu action the menu closes, so reopen before the next click.
- Use synthetic DragEvent helper for group MIME; no real mouse needed. End step in groups view for step 15.

- [ ] **Step 2: Run E2E step 14 to verify failure**

If 4402 is not listening, repeat Task 2 Step 0 (setup/start-web). Run: `node e2e/groups.spec.mjs --port 4402`。
Expected: step 14 FAIL（group rows not draggable / no slots）；前 13 步可先通过。

- [ ] **Step 3: Implement group drag UI**

- Group row `draggable=true`; `onDragStart` guard buttons; set MIME + `dragRef={kind:'group',id}`; `suppressNextClick` on dragstart.
- Header edges set before/after; middle 50% invalid; body slots always `n+1` (n=child groups), n=0 one slot at body top; slots only before child groups/after last, never between sessions. Each slot carries `beforeGroupId` = next child group id, or `null` for the last slot/empty group.
- Drop stores the **target descriptor** (not precomputed parent/index) and calls `rt().commitDoc(latest => { const resolved = resolveGroupDrop({ doc: latest, draggedId, target }); if (resolved.invalid) throw new Error(resolved.reason); return moveGroup(latest, draggedId, resolved.parentId, resolved.index) })`; same-parent/current-position no-op skip; toast on cycle/depth; clear indicator. Child slots re-resolve `beforeGroupId` against latest `childrenOf`, so rapid consecutive drops cannot use a stale numeric index (B5).
- Branch existing session handlers by `dragRef.kind`; group drag never calls session `applyDrop`.
- Add menu up/down items; disabled at first/last sibling; use `moveGroup` with index ±1; testid `session-groups-group-move-up/down`; disabled button has `data-disabled=true` and no commit.
- CSS insertion line/child slot/forbidden; locale keys.

- [ ] **Step 4: Build and E2E step 14**

Run: `npm run build && node --check lib/client.js && Copy-Item -LiteralPath lib\client.js -Destination .spike-homes\qa\staging\dsh-session-groups\lib\client.js -Force && node e2e/groups.spec.mjs --port 4402`.
Expected: step 14 PASS；12/13 保持 PASS。

- [ ] **Step 5: Full regression and commit**

Run: `npm test`; E2E 12 + 13 + 14 PASS.
Commit（授权后）：`feat(v1.1): drag groups to reorder and reparent`.

---

### Task 5: 搜索索引与 revealSession

**Files:**
- Create: `src/client/search.js`
- Create: `tests/client/search.test.js`

**Interfaces:**
- Consumes: `findGroup`, `groupAncestors`, `groupPath`, `sessionTitle`, `workspaceLabel`, `workspaceOfSession`（沿用 actions/filter 现有导出，缺失则在 `search.js` 内做等价容错）。
- Produces:
  - `UNGROUPED_ID = '__ungrouped__'`
  - `buildSearchIndex({ doc, sessionsById, workspaces, archivedSessionIds }) -> Entry[]`
  - `matchSessions(index, query, limit = 20) -> Entry[]`
  - `revealSession(doc, collapsed, sessionId) -> object`（新 collapsed；不变时返回原引用）
  - `Entry = { sessionId, title, workspace, groupPath, groupIds, archived }`

- [ ] **Step 1: Write failing tests**

- index 排除 `origin==='subagent'`；空白/缺 title 用 `sessionTitle`；workspace/组路径正确；归档标记数组。
- match：标题前缀优先、标题包含、工作区/组路径；大小写；空查询 `[]`；limit 20；稳定排序。
- reveal：目标组折叠→展开所在组+祖先；嵌套全部祖先；未归组折叠 `__ungrouped__`→展开；doc 找不到（派生未归组）→展开 `__ungrouped__`；已展开返回同一引用。

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/client/search.test.js`
Expected: FAIL module not found.

- [ ] **Step 3: Implement pure functions**

Index all sessions in `sessionsById`, not only tree-visible; locate group by scanning `doc.groups`; group path via `groupPath`; `revealSession` remove target group/`UNGROUPED_ID` and ancestors. No DOM.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/client/search.test.js`
Expected: PASS.

- [ ] **Step 5: Full tests and commit**

Run: `npm test`.
Commit（授权后）：`feat(v1.1): add session search index and reveal logic`.

---

### Task 6: 搜索下拉 UI、打开/展开/滚动

**Files:**
- Modify: `src/client/components.js`（`Header`/`SearchBox`/handlers）
- Modify: `src/client/css.js`
- Modify: `src/client/locale.js`, `locale/zh.json`, `locale/en.json`
- Modify: `docs/CONTRACTS.md`（追加 search testids）
- Test: `e2e/groups.spec.mjs`（新增 step 15）

**Interfaces:**
- Consumes: Task 5 `buildSearchIndex`/`matchSessions`/`revealSession`；`openSession`、`expand-group`/store collapsed、`archiveFilter`。
- Produces: `SearchBox` component; testids `session-groups-search`, `-search-results`, `-search-result`, `-search-empty`；selection handler.

- [ ] **Step 1: Add E2E step 15 (failing)**

Step 14 ends in groups view. After step 14 add `search-session-reveal`：
- **Before collapsing** group `a`, pick a non-blank row whose `groupId===state.groups.a`; read its title via a new `ui.sessionTitle(sid)` helper (`.dsg-session-title` text / `aria-label`, not full row text with workspace badge); store `state.searchTitle`.
- Collapse group `a` (click header); type `state.searchTitle` into search; assert result; ArrowDown/Enter; assert group `a` `data-expanded=true`, row visible, `dsg-search-hit` present, `.dsg-tree.scrollTop` changed.
- Archive another visible non-blank session via its `...` menu; capture its old title as `state.archivedTitle`; search that title; assert result `data-archived=true`/`aria-disabled=true`; Enter leaves main session unchanged.
- Type nonsense; assert empty state.
- Before/after the search calls, read `dsh-session-groups.json` from `QA_HOME/storages` **twice 300ms apart** (wait for in-flight commits to settle), compare `groups` + `ungrouped` (ignore `expanded`/visible rows and `revision`); assert unchanged.

- [ ] **Step 2: Run E2E step 15 to verify failure**

If 4402 is not listening, repeat Task 2 Step 0. Run: `node e2e/groups.spec.mjs --port 4402`。
Expected: step 15 FAIL（no search input）；前 14 步可先通过。

- [ ] **Step 3: Implement search UI**

Header two rows; `SearchBox` combobox/listbox, keyboard, click-outside, archived disabled; selection:
- archived → toast/info, no open;
- only→all if needed;
- `openSession(id)`;
- `revealSession` and `store.update({collapsed})`;
- wait for row (2 rAF), rect-diff scroll to 30%, add `dsg-search-hit` 1.5s.
CSS dropdown/highlight.
New locale keys.

- [ ] **Step 4: Build and E2E step 15**

Run: `npm run build && node --check lib/client.js && Copy-Item -LiteralPath lib\client.js -Destination .spike-homes\qa\staging\dsh-session-groups\lib\client.js -Force && node e2e/groups.spec.mjs --port 4402`.
Expected: step 15 PASS；12/13/14 保持 PASS。E2E 结束时若 step 15 归档了会话，记录该副作用供 QA 审计。

- [ ] **Step 5: Full regression and commit**

Run: `npm test`; E2E 12+13+14+15 PASS.
Commit（授权后）：`feat(v1.1): session search dropdown with reveal and scroll`.

---

### Task 7: 契约/文案同步、完整验证与打包

**Files:**
- Modify: `docs/CONTRACTS.md`（§1 invariant 8 派生未归组说明、§4.1 新 testids、`session-groups-menu`）
- Modify: `docs/TEST-PLAN.md`（C11-C13，E2E 13-15，15 步）
- Modify: `docs/V1-PLAN.md`（宽度 264–760 取代 264–420；搜索/组拖状态）
- Modify: `docs/RELEASE.md`、`README.md`（V1.1 范围/安装/已知限制）
- Modify: `package.json`（version `0.2.0`）
- Modify: `lib/client.js`（build）
- Modify: `docs/TEST-RESULTS.md`（QA 最终结果，若 QA 执行）

**Interfaces:**
- Consumes: Tasks 1-6 全部；QA 隔离 harness。
- Produces: 0.2.0 tarball、15 步 E2E 证据、审计/打包结果。

- [ ] **Step 1: Update contract/test docs and version**

Add new testids, 15-step plan, width 760, V1.1 locale keys; `package.json` 0.2.0; RELEASE/README status.

- [ ] **Step 2: Build and run all tests**

Run: `npm test`；Expected 全 PASS。
Run: `npm run build && node --check lib/client.js`；Expected build OK.

- [ ] **Step 3: Run 15-step E2E + regression audit in isolated home**

Run: `pwsh -NoProfile -File scripts/qa/run-v1.ps1`（or setup/start/E2E/audit/teardown as QA runbook）。
Expected: 15/15 E2E PASS；audit load/commit PASS；teardown PASS；真实 home 指纹不变。

- [ ] **Step 4: Package and inspect**

Run: `npm pack`；Expected `dsh-session-groups-0.2.0.tgz`，files 不含 tests/e2e/scripts/spike。
Record sha256.

- [ ] **Step 5: Commit（授权后）and hand off**

Commit docs/build/version; do **not** install desktop or push. Report tarball, E2E evidence, known limitations (running-archive BLOCKED-ENV; P1/P2 remaining) and ask user for manual verification.
