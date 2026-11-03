# V1/V1.1 契约（Host / Client / Shared）— Gate 0 修订稿

> **Historical document (V1/V1.1 contract, frozen 2026-10-18).** This contract predates the 0.3 beta additions: the native `doctor` action, automatic `.bak` recovery, session-route extraction, and dshmarket distribution. For current behavior see `README.md`, `docs/ARCHITECTURE.md`, `docs/COMPATIBILITY.md` and `docs/TEST-RESULTS.md`.

- 状态：**Frozen（Gate 0 PASS，2026-10-18）**；后续变更需 Gate 1 评审
- V1.1（0.2.0，2026-10-28）：**additive** 扩展——左栏宽度覆盖、分组拖拽排序/改父级、会话搜索下拉；数据模型、Host 路由、存储路径均不变
- V1.1（0.2.1，2026-10-28）：**typography/spacing-only patch**——分组视图排版/间距/图标对齐官方侧栏，消费宿主继承字体；无契约/数据/路由变化
- V1.1（0.2.2，2026-10-28）：**UI-layout + drag-perf patch**——footer 两段视图切换、header 加号/搜索/视图选项（搜索行可折叠 + 关闭）、归档三态移入 view-options popover、菜单/对话框/输入主题感知、dragover 目标去重 + 移除未消费的 `saving` 重渲染；无数据模型/Host 路由/存储变化。UI testid additive，旧的 `session-groups-toggle`/`session-groups-archive-filter`/`session-groups-search` 保留。
- V1.1（0.2.3，2026-10-29）：**virtualization + UI 回退 patch**——footer 恢复为单个切换按钮（图标/文案随目标视图变化，`data-mode`/`title`/`aria-pressed` 反映当前态）；header 右侧顺序改为官方工作区段头 **search → view-options → plus**；未归组列表按 `.dsg-tree` 视口 + overscan 窗口化（顶部/底部 spacer 精确保高，组树保持完整），搜索选中窗口外未归组行会先强制滚入窗口；纯 helper `computeVirtualWindow` + `virtualScrollOffset`。数据模型/Host 路由/存储不变；0.2.2 的 `session-groups-toggle-groups`/`session-groups-toggle-workspace` 删除，新增 `session-groups-virtual-spacer`。
- V1.1（0.2.4，2026-10-29）：**optimistic drop commits + insertion placeholders + official chrome patch**——会话/分组拖拽（含菜单上移/下移）改为乐观提交：drop 当帧按当前乐观 doc dispatch，`revision` 保持服务端确认值，写入进入单写者合并队列（快速移动合并、成功 reconcile、失败/冲突回滚 + 既有 toast）；非乐观提交（建组/重命名/删除/图标/移动对话框）先 flush 乐观队列再在最新 doc 上执行。拖拽落点改为真实行高占位（32px 会话 / 34px 分组，主题 accent 背景 + 虚线边框 + 目标名/「放到这里」），覆盖 session-before/after、group-before/after、子组缝隙、group-append、ungrouped/root-end；`session-groups-drop-indicator` testid 保留并新增 `data-drop-height`。`.dsg-header-title` 权重 600→400（官方 section label，14/20）；footer 文案精确为「切换到自由分组视图」/「返回默认工作区视图」。数据模型/Host 路由/存储不变。
- V1.1（0.2.5，2026-10-29）：**official header icons + drag diagnostics patch**——header 三按钮改用 DSH 2.0.18 primitives 原始 artwork（`IconSearchOutlineRegular` / `IconSlidersTwoOutlineRegular` / `IconProjectAddOutlineRegular`，16px、1px stroke）；新增**只增不改**的 `POST /dsh-session-groups/diagnostics`（fence 后 append-only NDJSON 到 storages 下的诊断文件）、客户端诊断环/flush/HUD（默认开启，`localStorage['dsh-session-groups.diagnostics']='0'` 关闭）与分析器脚本。数据模型、`load`/`commit`、记录文件路径与官方数据写入不变。
- V1.1（0.2.6，2026-10-29）：**group color + selection-dialog patch**——`Group` 新增**可选** `color`（`blue|green|orange|red|purple|gray`，默认蓝；`DOC_VERSION` 不变，旧文档无 color 仍合法并按蓝显示/归一化）；新增 `setGroupColor` 与分组菜单「颜色」对话框。header 标题与 accent 图标统一 primary accent；行 hover 操作按钮 16→28px 命中区（glyph 仍 16px、gap 4px）；分组左侧引导线移到父级 caret 尖端（x=16、2px 宽、子内容 padding 4，缩进仍 20px/级）。icon / move-session / move-group / new-session / group-color 五类选择对话框统一「点击只高亮、footer Confirm/Cancel 才生效」；输入/删除/运行中归档对话框行为不变。`load`/`commit` 路由与记录文件路径不变；host 在 commit 校验后将缺省 color 归一化为 `blue` 落盘。
- V1.1（0.2.7，2026-10-29）：**row layout + custom color + context-menu patch**——`Group` 新增**可选** `colorHex`（canonical lowercase `#rrggbb`，无 alpha；显示优先级 `colorHex > color`；`DOC_VERSION` 不变）。host commit 归一化合法短/大写 hex 并拒绝 alpha/非法值（422 `group-color-hex:<id>`）；load 时把合法非 canonical hex 归一化，非法值仍 `invalid-file` quarantine。新增 `setGroupColorHex`；`setGroupColor` 清除 `colorHex`。新建组默认 `hash` 图标（旧组保留原图标）。组行 DOM 顺序 caret→icon→name→actions→count；会话行 dot→title→workspace→actions→time；计数/更新时间右对齐（12/16，时间 min-width 40）；隐藏操作区 `opacity:0;pointer-events:none`。组/未归组 guide 统一 16/4、2px、上下内缩 2（组色 60%，未归组 label-tertiary 45%）；caret 组色 85%、icon 100%。组行/会话行支持 `contextmenu` 与 Shift+F10/ContextMenu，菜单按实测 rect 在 8px 视口内 clamp；Escape/外部/滚动/resize 关闭并回焦来源行。颜色对话框改为 3×2 32px 色板 + 固定 16px check 槽 + 自定义 `type=color`/hex 行（`#RGB`/`RGB` 展开，非法 Confirm disabled，11px aria-live 提示）。
- V1.1（0.2.8，2026-10-29）：**official session status + empty drop box + drag-label hardening patch**——会话状态严格对齐官方 `dsh-client-ui-workspace`：6 个互斥标签（idle/running/waitingApproval/planReview/waitingAnswer/completed）+ 1 个可共存的 `subagentsRunning`（来自 host `projectionsBySession.subagentCatalog` 的运行中子会话计数）；优先级 pending > running > subagents-only > completed > idle，未知 `pendingInteraction.kind` 不产生状态。UI：idle/archived/blank 保留 16×20 空槽（不再画透明点）；running 使用官方 14px 双圆环 spinner（r=9.5/stroke 2/track 25%/arc dash 12 150/spin+dash 1.5s/reduced-motion 静态）；pending 与 completed 使用 10px 点（6px core，warn/success）；pending 时 trailing time 换成官方 compact 文案（待审批/计划待审/待回答）；所有显示状态带 visually-hidden 文本；时间字号 12→官方 10/16。空组/未归组空提示改为与 DropPlaceholder 同形的整宽 dashed 32px 盒（plus+12px 文案；drop-active 用 accent surface），组体已有 placeholder 时不再同时渲染。浮动拖拽 label 改为单实例控制器：复用 DOM 中既有 `session-groups-floating-label`、隐藏重复节点、缓存 text/visibility/position、rAF 合并（last-wins）、hide/dispose flush。无数据模型/Host 路由/存储变化。
- V1.1（0.2.9，2026-10-29）：**delete-group destination patch**——分组菜单颜色项与颜色对话框标题改为「修改颜色」/「Change color」（与「更换图标」对齐；色板/自定义色行为不变）。删除分组：空叶分组（无直接会话、无直接子组）直接删除、不弹对话框，仅 toast；非空分组弹出「删除分组」对话框，必须先选择直接会话与直接子组的去向（未归组/根目录或某个分组）再确认。`deleteGroupTo(doc, groupId, destinationId)` 在单次克隆文档中把直接会话前插到目标、直接子组改 parentId（保留子树），校验 `cycle` / `depth-exceeded` / `parent-not-found`；`deleteGroup` 保留为默认父级的兼容包装。目的地列表排除自身与全部递归后代；有子组时还排除 `destinationDepth + 1 + subtreeHeight(child) > MAX_DEPTH` 的目标（根/未归组恒可用）。对话框遵循选择对话框契约（点击只高亮、Confirm 初始 disabled），footer 使用 danger 样式与「移动并删除」/「Move and delete」。无 `DOC_VERSION`/Host 路由/存储变化。
- 关联：`docs/V1-PLAN.md`、`docs/SPIKE.md`、`docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md`
- 本稿已吸收架构评审：数据隔离、API 形状、打包格式、运行中归档、组内新建、存储路径、图标、footer 生命周期

## 0. 已裁决的实现选择

| 选择 | 结论 | 理由 |
|---|---|---|
| 存储后端 | **自带 JSON**（V1）；storageDomain 作为 P1 备选 | Host spike 已实测 temp+rename+.bak/409/坏文件；原样 `GroupDoc` 可读可备份；storageDomain 信封不是原样 doc，且 `.bak` 要另做 |
| 存储路径 | `dshHomePath('storages')` + `dsh-session-groups.json` | 尊重 `$DSH_HOME`；不硬编码 `~/.dsh` |
| 路由围栏 | **`ctx.connection.requestRejection(req)` 必需**；缺失时 **fail-closed 503 `fence-unavailable`**；`connection.fetch.register` 仅 P1 评估，不进 V1 正式路径 | 已实测 401/403；弱 loopback fallback 不作为正式路径 |
| 组内新建 | 自己的预创建工作区菜单 → `uiWorkspace.connectWorkspace(id)` → 落组首 | 宿主 hero 切换可能换 session id/留 blank |
| 运行中归档 | 捕获 `workspace/session-active`，确认后 `archiveSession(id,{stopActivity:true})` | 与官方同形；不静默失败 |
| 图标 | 插件自带 9 个 16px inline SVG（0.2.7 增 `hash`） | 宿主图标集命名/集合不稳定 |
| 客户端 bundle | `window.__ModuleLoader__.load({id, factory})` CJS factory，externals `react`/`react/jsx-runtime` | 平台加载器要求；避免第二份 React |
| 数据隔离 | Gate 0 全部用独立 `DSH_HOME`（`.spike-homes/<agent>`），不共享真实 home | profile 不隔离 sessions/storages |

## 1. 数据模型

```ts
export type GroupIcon =
  | 'folder'
  | 'folder-open'
  | 'star'
  | 'flag'
  | 'bookmark'
  | 'tag'
  | 'bulb'
  | 'rocket'
  | 'hash';       // 0.2.7 default for newly created groups

export interface Group {
  id: string;            // "g-" + 12 hex
  name: string;          // 1..80 chars, trimmed; >80 -> reject
  icon: GroupIcon;
  color?: GroupColor;    // 0.2.6 additive; missing -> blue (legacy docs valid)
  colorHex?: string;     // 0.2.7 additive; canonical #rrggbb, display precedence over color
  parentId: string | null;
  sessionIds: string[];  // display order
}

export type GroupColor = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray';

export interface GroupDoc {
  version: 1;
  revision: number;      // host-owned, starts at 0
  groups: Group[];       // flat; sibling order = array order filtered by parentId
  ungrouped: string[];   // persisted manual order of explicitly ungrouped sessions
}
```

Invariants:

1. `id` unique; `name` trimmed 1..80; invalid icon -> `folder` (new groups default `hash`); optional `color` must be a known palette id (missing/invalid input normalizes to `blue`; `validateDoc` rejects an unknown persisted id with `group-color:<id>`); optional `colorHex` must be canonical lowercase `#rrggbb` (host normalizes valid short/uppercase input; alpha/invalid persisted values reject with `group-color-hex:<id>`).
2. `parentId` null or existing group; no cycles; max depth 8 (UI soft 4).
3. A session id appears at most once across all groups and `ungrouped`.
4. `revision` host-owned; clients send only `baseRevision`.
5. Doc stores no titles, paths, workspace ids, archive flags, timestamps.
6. Empty groups valid.
7. Missing session ids allowed (orphans), never rendered, preserved until P1 cleanup. **Blank sessions are ephemeral**: DSH may discard a never-messaged blank on restart and allocate a new id. A placement referencing a vanished blank is an orphan; the client hides it and never auto-assigns the replacement blank to that group. The new blank appears ungrouped top (D7).
8. `ungrouped` is **not** the full session list: it is the persisted manual order for sessions the user explicitly ungrouped. Rendering derives:
   - `assigned = all group sessionIds`
   - `stored = ungrouped.filter(id => known && !assigned)`
   - `derived = visible root sessions not assigned and not in stored`, sorted `updatedAt` desc
   - display = `[...derivedNewestFirst, ...stored]` (new/unseen first, then manual order)
   - On first drag/reorder of ungrouped, write the full visible order into `ungrouped`.
   - **Opening the view never writes the doc.** New sessions appear via derivation only.
   - **V1.1 search/reveal**：搜索索引从 `sessionsById` 派生（含归档、未归组、blank；排除 subagent）；选中普通会话只 `openSession` + 展开 `collapsed` 视图态 + 滚动高亮，**不写 `ungrouped`/`groups`**。`revealSession` 仅返回新 `collapsed`；doc 中找不到的会话（宿主派生未归组）统一展开 `__ungrouped__`（视图态容器，不持久化）。
   - **0.2.3 virtualization**：未归组行只渲染 `.dsg-tree` 视口 + `overscan=8` 的行；`computeVirtualWindow` 按 `scrollTop/clientHeight/listTop/total` 返回 `{start,end,topPad,bottomPad}`，spacer 精确保留 `total*34-2` 的滚动高度。逻辑顺序仍是 `[...derived, ...stored]`，搜索索引/拖拽/归档过滤全部基于完整 `tree.ungrouped`，不因窗口化改变。搜索选中窗口外未归组会话时，先 `scrollToIndex` 再高亮/滚动。组树不虚拟化。

## 2. Host 路由

Base: `/dsh-session-groups`.

### GET `/dsh-session-groups/load`

200:

```json
{ "ok": true, "revision": 12, "doc": { "version": 1, "revision": 12, "groups": [], "ungrouped": [] } }
```

With corrupt file:

```json
{ "ok": true, "revision": 0, "doc": { "version": 1, "revision": 0, "groups": [], "ungrouped": [] },
  "warning": "corrupt-file" }
```

Unsupported version: 409 `{ "ok": false, "code": "unsupported-version", "message": "..." }`; do not overwrite.

### POST `/dsh-session-groups/commit`

Request:

```json
{ "baseRevision": 12, "doc": { "version": 1, "revision": 0, "groups": [], "ungrouped": [] } }
```

Responses:

- 200 `{ "ok": true, "revision": 13, "doc": { ... } }`
- 409 `{ "ok": false, "code": "conflict", "revision": 14, "doc": { ... } }`
- 422 `{ "ok": false, "code": "invalid", "message": "duplicate session id: s1" }`（含 malformed JSON body）
- 409 `{ "ok": false, "code": "unsupported-version" }`
- 405 + `Allow`（方法不符）；413 body too large；415 non-JSON；503 `fence-unavailable`/io。

Rules:

- Body limit 256 KiB; JSON only.
- Fence: `ctx.connection.requestRejection(req)` required. If missing, **fail closed 503 `fence-unavailable`**. `ctx.connection.fetch.register` is **P1 evaluation only**（path 必须在 `/api` 下、客户端 base 不同，需单独 spike），不进 V1 正式路径。Do not ship a weak loopback-only fallback.
- Serialize writes in-process via promise tail; `fsync` file + directory where supported; temp name unique (`<name>.<pid>.<rand>.tmp`) + rename; keep `.bak`; retry rename on Windows `EPERM/EBUSY` 3× with 20ms backoff.
- Corrupt file: rename to `dsh-session-groups.corrupt-<ts>.json`, return empty doc + `warning:"corrupt-file"`; invariant violation returns `warning:"invalid-file"`; do not overwrite until first successful commit (which writes `.bak`). `detail`/`quarantinedTo` may be additive; client depends only on `code`/`warning`.
- No CORS; no egress; no auth token.

### File

`path.join(dshHomePath('storages'), 'dsh-session-groups.json')`

- `dshHomePath` from `@deepseek-ai/dsh-home-paths`; fallback `profileContext.home` → `$DSH_HOME` → `~/.dsh`, log source.
- `@deepseek-ai/dsh-home-paths` 必须写进 package.json `peerDependencies`（linked 插件 import 安装侧包的解析前提）。
- Only this file is written by group operations; `.tmp` 用唯一名，避免跨进程重名。

### POST `/dsh-session-groups/diagnostics`（0.2.5，additive）

请求：

```json
{ "runId": "dsg-...", "schemaVersion": 1, "events": [ { "v": 1, "runId": "dsg-...", "seq": 1, "t": 123.4, "ts": 1760000000000, "type": "native.dragover", "ctx": {}, "phase": "capture" } ] }
```

响应：

- 200 `{ "ok": true, "appended": 20 }`
- 405 + `Allow: POST`（方法不符）
- 413 body too large；415 non-JSON；422 `events` 非数组/为空/超过 500 条/含非对象；503 `fence-unavailable` / `io`。

Rules:

- **append-only**：逐 batch 追加到 `path.join(dshHomePath('storages'), 'dsh-session-groups.diagnostics.ndjson')`；每行 envelope `{receivedAt, runId, schemaVersion, event}`，不重写、不 fsync、不写 `.bak`。
- 与 `load`/`commit` 相同 fence 与 `cache-control: no-store`；**不读取也不修改** `dsh-session-groups.json`、`workspace.json`、session 数据。目录不存在时递归创建。
- body 上限 256 KiB、单批 ≤500 事件（客户端 20 事件/500ms 或 120 事件/批；dragend/visibility hidden 用 `sendBeacon`）。诊断关闭时不发请求。
- 隐私：事件只含 ID/testid/分组名/翻译后的拖拽 label，不含会话标题或 transcript；文件仅留在本机 storages。

## 3. Shared model API

Path `src/shared/model.js`; pure functions.

```ts
emptyDoc(): GroupDoc
cloneDoc(doc): GroupDoc
validateDoc(doc): { ok: boolean; errors: string[] }
findGroup(doc, groupId): Group | null
childrenOf(doc, parentId): Group[]
isDescendant(doc, groupId, maybeAncestorId): boolean
createGroup(doc, { name, icon, color, parentId, index }): GroupDoc
renameGroup(doc, groupId, name): GroupDoc
setGroupIcon(doc, groupId, icon): GroupDoc
setGroupColor(doc, groupId, color): GroupDoc
isKnownColor(color): boolean
normalizeColor(color): GroupColor
groupColor(group): GroupColor
groupSubtreeHeight(doc, groupId): number
deleteGroup(doc, groupId): GroupDoc
deleteGroupTo(doc, groupId, destinationId: string | null): GroupDoc
moveGroup(doc, groupId, parentId, index): GroupDoc
assignSession(doc, sessionId, groupId, index): GroupDoc
removeSession(doc, sessionId): GroupDoc
reorderUngrouped(doc, sessionIds): GroupDoc
workspaceOfSession(workspaces, sessionId): WorkspaceRef | null
inferWorkspaceId(doc, groupId, sessionsById, workspaces, currentSessionId): string | null
buildRenderTree(doc, sessionsById, workspaces, options): RenderNode[]
```

`options`:

```ts
{
  archivedSessionIds: string[];      // array, not Set
  filter: 'hidden' | 'all' | 'only';
  currentSessionId: string | null;
  statuses: Map<string, { running: boolean; pendingInteraction?: { kind: string }; completionUnread: boolean }>;
  subagentCounts?: Map<string, number>; // 0.2.8 host projection count; missing -> 0
}
```

`deleteGroup`: 0.2.9 compatibility wrapper — defaults to `deleteGroupTo(doc, groupId, group.parentId)`. `deleteGroupTo`: prepends the group's direct sessions to the destination (or ungrouped), reparents direct child groups to `destinationId` (or root), preserves their subtrees, then removes only the deleted group. Throws `group-not-found`, `parent-not-found`, `cycle` (self/recursive descendant) or `depth-exceeded` (a child subtree would exceed `MAX_DEPTH`); `null` root is always allowed. No archive/delete of sessions.

`buildRenderTree`:

- Exclude `origin === 'subagent'`; exclude blank except current/just-created.
- Archived rows included in `all`, muted; `only` includes archived only; `hidden` excludes.
- Groups always returned; `emptyVisible` when no visible children.
- Subgroups before sessions; no interleaving.
- `RenderNode`: `group` with `children`, `visibleCount`, `emptyVisible`; `session` with `session`, `workspace`, `archived`, `status`, `runningSubagentCount` (0 when the host exposes no projection).

## 4. Client surface

Path `src/client/index.js`; bundle via `window.__ModuleLoader__.load({ id: 'dsh-session-groups', factory: (require) => { ... return module.exports; } })`.

Injected services:

- `slots` — `sidebar.workspaces` (single, priority -1), `sidebar.footer.action` (list, id required).
- `sessions` — `useSessions`; `sessions.using(id, { source:'workspaceOperation' }, ref => ref.binding.session.rename(title))` (exact shape Gate 0).
- `workspaces` — `useWorkspaces`; membership。`workspaceDisplayTitle` **未暴露**，V1 自实现 `workspaceLabel(ws)`：`title?.trim() || basename(path) || workspaceId`。
- `uiWorkspace` — `connectWorkspace(workspaceId)` returns session id, **does not navigate**; `startSession` returns void; `openSession(id)`; `archiveSession(id, { stopActivity:true })`; `unarchiveSession`; `pinSession`/`unpinSession`.
- `connection` — same-origin HTTP; `fetch` uses `document.baseURI` relative path.
- `locale`, `ui` optional.

Lifecycle:

- One `ctx.effect`-managed controller owns the current `slots.inject('sidebar.workspaces')` disposer.
- `setMode('groups')`: dispose old (if any) + inject/register new; `setMode('workspace')`: dispose and let official render.
- Plugin unload disposes via effect; catch duplicate priority errors and fall back to footer-only + toast.
- Footer action `{ name:'sidebar.footer.action', id:'dsh-session-groups.toggle', order:100 }`; the component renders its own label/tooltip/`aria-pressed` (slot does not project label).

Visibility/status:

- `archivedSessionIds` is an **array**; use `.includes`.
- `useSessionStatus` is a **Map**; fields `running`, `pendingInteraction?.kind`, `completionUnread`.
- 0.2.8 status model mirrors the official `sessionStatuses` exactly: primary pending (`approval` / `plan-review` / `question`, only those three kinds), else running, else subagents-only, else completed, else idle. `runningSubagentCount` comes from `useSessions().projectionsBySession[parentId].values.subagentCatalog` (a child counts when its status `running` or row `running` is true); it is a coexisting secondary status for pending/running and the only status (ongoing renderer, subagents label) when nothing else applies. Unknown pending kinds are ignored; unavailable projection data omits the marker.
- Current session: `retainedBy.mainView > 0`; do not highlight when a panel is active (`activePanelId !== null`).
- Subagent: `origin === 'subagent'`; `parentId` is fork lineage, do not use for hiding。普通 `SessionListEntry` 的键只有 `blank,cwd,displayTitle,formatStatus,id,projectionValues,retainedBy,running,updatedAt`，**`origin`/`parentId` 可缺失**（仅 subagent 行带），读取必须容错。
- Blank: only current blank visible; a renamed blank still shows its title. Blank placement is host-ephemeral: after restart the old id may vanish (orphan hidden) and the new blank starts ungrouped.
- Title: `summary.title?.trim()`; blank -> “新会话”; missing -> “未命名”; workspace label 用 shared `workspaceLabel`（title/path basename/id）。
- Archived rows are not openable; provide unarchive.

### 4.0 Optimistic commit queue（0.2.4）

`src/client/optimistic.js` 是客户端唯一 doc 写者。语义（单测 `tests/client/optimistic.test.js` 固定）：

- **立即 dispatch**：`commitOptimistic(updater)` 以当前 store 的**乐观 doc**（含尚未持久化的 drop）为输入同步计算并 dispatch `optimistic-doc`；`revision` 不随乐观 dispatch 变化，始终是最近一次服务端确认值。
- **合并**：同一 tick 的多次乐观提交只保留最后一个 `pendingDoc`；一次请求在飞行时到达的新 drop 只追加为下一次请求（最新 doc），绝不发送中间态。请求的 `baseRevision` = 发送时 store 的确认 revision。
- **成功 reconcile**：服务端返回 `{ok:true, doc, revision}` 且无更新 pending 时，以服务端 doc/revision 替换视图；若有更新 pending，则只推进 `lastConfirmed`/`revision`，保留更新乐观 doc，下一次写入使用新 revision。
- **失败/冲突回滚**：任何持久化失败/409 都回到 `lastConfirmed` doc 与确认 revision，清空 pending，沿用 `banner.conflict` / `toast.dropFailed` 提示；错误标记 `reported`，调用方不重复 toast。
- **非乐观提交协调**：`commitStrict(updater)` 先 `flush()` 乐观队列，再持单写者锁；updater 在锁内对最新 doc 求值。严格写期间的乐观 drop 延迟到锁释放后，再对服务端确认 doc 求值，避免旧 doc 覆盖新状态。建组/重命名/删除/图标/移动会话/移动分组全部走此路径。

### 4.05 Selection dialogs（0.2.6）

五类小选择对话框（`icon` / `move-session` / `move-group` / `new-session` / `group-color`）共用同一交互；0.2.9 起 `delete-group` 也加入该契约：

- 打开时按当前值/推断值预选（icon=当前图标；move-*=当前组/父级；new-session=`inferred` workspace；group-color=当前颜色或蓝），预选项必须有可见高亮（`aria-selected` 或 `aria-checked`）。`delete-group` **不预选**：目的地必须由用户明确选择，Confirm 初始 disabled。
- 点击选项只更新高亮，不关闭对话框、不写 doc/host；已选项 `data-selected="true"`。
- footer 固定 Cancel/Confirm：Confirm 仅在存在有效选择时可用（无有效选择时 disabled），点击后走既有 `commitStrict`/host action；Cancel/Escape/点击 backdrop 关闭且不改变任何状态。`delete-group` 的 Confirm 为 danger，文案「移动并删除」/「Move and delete」，payload 为 `{ destinationId: string | null }`。
- 输入类（new/rename）与 archive-running 对话框保持原行为（输入 Enter 确认；archive-running 的 Confirm 为 danger）。空叶分组删除不进入对话框，直接单次提交并 toast。
- 实现：纯函数 `src/client/dialog-selection.js`（初始选择/有效性/confirmation payload/删除目的地过滤），组件只渲染；单测 `tests/client/dialog-selection.test.js`。

### 4.1 Stable UI test ids（E2E 契约）

V1 client 必须输出这些 `data-testid`，E2E 依赖它们；改名需同步 `docs/TEST-PLAN.md`。

V1.1（0.2.0）additive 追加：`session-groups-resize-handle`、`session-groups-header-row`、`session-groups-search`、`session-groups-search-results`、`session-groups-search-result`、`session-groups-search-empty`、`session-groups-group-drop`、`session-groups-group-move-up` / `session-groups-group-move-down`；`session-groups-menu` 为既有菜单根，本批补登记。旧 testid 一律保留。

V1.1（0.2.2）additive 追加：`session-groups-search-toggle`（header 搜索开关）、`session-groups-search-close`（搜索行关闭/收起）、`session-groups-view-options`（header 视图选项按钮）、`session-groups-view-options-popover`（归档三态 popover）。搜索行默认不渲染；搜索图标开合，Escape（无下拉时）与关闭按钮收起整行。`session-groups-archive-filter` 从旧的循环按钮改为 popover 内三行（`data-filter=hidden|all|only` + `data-active`）；`session-groups-return` 只在错误/扁平回退里保留。**0.2.3 删除 footer 两段 testid** `session-groups-toggle-groups` / `session-groups-toggle-workspace`；`session-groups-toggle` 恢复为单个按钮（`data-mode`/`data-target`/`data-wide`/`aria-pressed`/`title`），并新增 `session-groups-virtual-spacer`（`data-position=top|bottom`）。未归组头增加 `data-count`（逻辑行数），虚拟列表行容器增加 `data-virtual-start|end|count|total`。

V1.1（0.2.5）additive 追加：`session-groups-diagnostics-hud`（诊断 HUD 根，`pointer-events:none`，纯 DOM 文本；`data-run-id`/`data-schema-version`）。HUD 只在诊断开启（默认）时挂载；`localStorage['dsh-session-groups.diagnostics']='0'` 时不渲染 HUD、不发 diagnostics 请求。header 三个按钮的 testid 不变，仅内部 SVG 换成官方 artwork。

V1.1（0.2.6）additive 追加：`session-groups-dialog-options`（选择对话框选项容器，`role=listbox|radiogroup`）、`session-groups-dialog-workspace`（`data-workspace-id`/`data-selected`/`aria-selected`）、`session-groups-dialog-group`（`data-group-id`，空串=未归组）、`session-groups-dialog-icon`（`data-icon`/`aria-checked`）、`session-groups-dialog-color`（`data-color`/`aria-checked`）。分组行新增 `data-color="blue|green|orange|red|purple|gray"`；`session-groups-dialog-confirm`/`.dsg-dialog-cancel` 现在对所有对话框都存在。

V1.1（0.2.7）additive 追加：`session-groups-group-count`（组行最右计数）、`session-groups-session-time`（会话行最右相对更新时间，`title` 为绝对时间）、`session-groups-dialog-color-check`（每个色板 cell 固定的 16px check 槽，未选中 `visibility:hidden`/`data-empty=true`）、`session-groups-dialog-color-hex`（自定义 hex 文本输入，maxlength 7）、`session-groups-dialog-color-native`（`input[type=color]` 自定义 swatch）、`session-groups-dialog-color-hint`（11px `aria-live=polite` 提示/错误）。组 wrapper 新增内联 `--dsg-group-color` 与可选 `data-color-hex="#rrggbb"`；组行/会话行新增 `aria-haspopup="menu"`，右键/ContextMenu 菜单仍使用 `session-groups-menu`。

V1.1（0.2.8）additive 追加：`session-groups-session-status`（会话行首位 16×20 状态槽；`data-state="idle|ongoing|warning|done"`、`data-status-kind="idle|running|pending|subagents|completed"`；idle/archived/blank 槽内为空，状态文本走 `.dsg-visually-hidden`）。`session-groups-session-time` 同时承载 pending 的 compact 文案（`data-compact-status="approval|plan-review|question"`），普通时间仍为 10/16。`session-groups-empty` 改为整宽 dashed drop box（`data-drop-active`、组上 `data-group-id`、未归组 `data-ungrouped="true"`；含 14px plus 与 12px label）。`session-groups-floating-label` 仍是唯一拖拽浮层节点；0.2.8 复用/隐藏重复节点，不新增第二个。

V1.1（0.2.9）additive 追加：`session-groups-dialog-delete-body`（非空删除对话框的说明文本，含会话/子组计数）、`session-groups-dialog-delete-options`（目的地 listbox；选项仍复用 `session-groups-dialog-group`，空串 `data-group-id` = 未归组/根目录）。删除对话框的 Confirm 仍使用 `session-groups-dialog-confirm`（`data-variant="danger"`，文案「移动并删除」/「Move and delete」，未选择有效目的地时 disabled）；`dialog.groupColor`/`group.color` 文案改为「修改颜色」/「Change color」，testid 不变。

| testid | 位置 | 附加属性 |
|---|---|---|
| `session-groups-toggle` | footer 单个视图切换按钮（28px） | `data-mode="workspace|groups"`, `data-target`, `data-wide`, `aria-pressed`, `title`/`aria-label` |
| `session-groups-view` | 分组视图根 | `data-mode="groups"`, `data-optimistic="true|false"`（0.2.4 乐观写入未 reconcile） |
| `session-groups-header` | 视图头（36px 单行 + 可选 30px 搜索行） | `data-search-open`, `data-options-open` |
| `session-groups-header-row` | 视图头标题/操作行（0.2.2 起单行 28px 控件；0.2.3 右侧顺序 search → view-options → plus） | — |
| `session-groups-search-toggle` | header 搜索图标按钮 | `aria-expanded` |
| `session-groups-search-close` | 搜索行关闭按钮（清空并收起整行） | — |
| `session-groups-view-options` | header 视图选项图标按钮 | `data-filter`, `aria-expanded`, `aria-haspopup` |
| `session-groups-view-options-popover` | 视图选项 popover（归档三态） | `role="menu"` |
| `session-groups-return` | 返回工作区（仅 FlatFallback 错误回退） | — |
| `session-groups-archive-filter` | 归档三态行（popover 内，共 3 行） | `data-filter`, `data-active`, `aria-checked` |
| `session-groups-new-group` | header 新建分组 `+`（28×28） | — |
| `session-groups-ungrouped` | 未归组区块/头 | `data-count`（逻辑会话数）, `data-drop-kind` |
| `session-groups-virtual-spacer` | 虚拟未归组列表的 top/bottom 占位 | `data-position="top"|"bottom"` |
| `session-groups-group` | 组行 | `data-group-id`, `data-depth`, `data-expanded`, `aria-haspopup` |
| `session-groups-group-count` | 组行最右计数（0.2.7） | — |
| `session-groups-session-time` | 会话行最右尾格（0.2.7 时间 / 0.2.8 pending compact） | `title` 绝对时间；compact 时 `data-compact-status` |
| `session-groups-session-status` | 会话行首位 16×20 状态槽（0.2.8） | `data-state`, `data-status-kind` |
| `session-groups-group-add` | 组头 `+` | `data-group-id` |
| `session-groups-group-menu` | 组 `…` | `data-group-id` |
| `session-groups-group-move-up` / `session-groups-group-move-down` | 组菜单上移/下移 | `data-group-id`, `data-disabled` |
| `session-groups-menu` | 组/会话操作菜单根 | — |
| `session-groups-session` | 会话行 | `data-session-id`, `data-group-id` 或 `data-ungrouped="true"`, `aria-haspopup` |
| `session-groups-workspace-badge` | 悬浮工作区标签 | `data-session-id` |
| `session-groups-drop-indicator` | 插入点行高占位（0.2.4 起；会话 32px / 分组 34px，取代旧 2px 线） | `data-drop-kind`, `data-drop-target`, `data-drop-height` |
| `session-groups-group-drop` | 组体子组缝隙槽（n 个子组 = n+1 个槽；激活时 6px→34px 占位） | `data-parent-id`, `data-before-group-id`（末尾/空组为空串）, `data-drop-active` |
| `session-groups-empty` | 空组/空未归组 drop box（0.2.8 整宽 dashed；组内 placeholder 渲染时隐藏） | `data-group-id` 或 `data-ungrouped="true"`, `data-drop-active` |
| `session-groups-flat-fallback` | 加载失败扁平回退 | — |
| `session-groups-error` | 错误 banner | — |
| `session-groups-dialog` | 新建/改名/确认对话框根 | `data-kind` |
| `session-groups-dialog-input` | 对话框输入 | — |
| `session-groups-dialog-confirm` | 对话框确认 | 删除分组：`data-variant="danger"`，文案「移动并删除」 |
| `session-groups-dialog-delete-body` | 非空删除对话框说明（0.2.9） | 含会话/直接子组计数 |
| `session-groups-dialog-delete-options` | 删除目的地列表（0.2.9，`role=listbox`；选项复用 `session-groups-dialog-group`） | 空串 `data-group-id` = 未归组/根目录 |
| `session-groups-rail` / `session-groups-rail-expand` | 56px rail / 展开 | — |
| `session-groups-resize-handle` | 左栏右边缘宽度把手（仅 `wide` 且可覆盖） | `role="separator"`, `aria-valuemin/max/now` |
| `session-groups-search` | header 第二行搜索输入（由搜索图标展开，非始终可见） | `role="combobox"`, `aria-expanded`, `aria-controls` |
| `session-groups-search-results` | 搜索下拉列表 | `role="listbox"` |
| `session-groups-search-result` | 单条搜索结果 | `data-session-id`, `data-archived`, `aria-disabled`（归档项） |
| `session-groups-search-empty` | 搜索无结果空态 | — |
| `session-groups-banner` | 加载/冲突/错误 banner | `data-kind` |
| `session-groups-toast` | 操作提示 toast | — |
| `session-groups-diagnostics-hud` | 固定右下诊断 HUD（0.2.5，默认开启；pointer-events:none，≤4Hz 纯 DOM 更新） | `data-run-id`, `data-schema-version="1"`, `aria-hidden` |
| `session-groups-dialog-workspace` | 组内新建的工作区选择 | — |

## 5. Host action mapping

| UI action | Call | Notes |
|---|---|---|
| Open | `uiWorkspace.openSession(id)`; fallback `sessions.retain(id,{source:'mainView'})` | Gate 0 verified |
| Rename | `sessions.using(id,{source:'workspaceOperation'}, ref=>ref.binding.session.rename(title))` | Gate 0; no local title |
| Archive | `uiWorkspace.archiveSession(id,{stopActivity:true})` after confirmation | running -> `workspace/session-active` details.activity |
| Unarchive | `uiWorkspace.unarchiveSession(id)` | returns to group |
| New in group | `uiWorkspace.startSession(workspaceId)` → sessions 快照 diff 捕获新 id → `openSession(id)` → 移到组首 | `startSession` 返回 void；`connectWorkspace` 只作 fallback，且仅接受未被任何组/未归组占用的 id；blank 重启换 id，不承诺归属保留 |
| Pin | `uiWorkspace.pinSession(id)` / `unpinSession` | P1 |
| Delete | none | DSH has no session delete |

`workspace/session-active` handling:

- Catch error; read `details.activity` families (turn/subagent/job/schedule).
- Confirm dialog lists families; on confirm call `archiveSession(id,{stopActivity:true})`.
- On cancel: no change, toast “会话仍在运行”.

## 6. Errors / fallback

- Load failure: flat session list + banner “分组数据加载失败，已降级为扁平列表” + retry.
- Commit failure: revert to last confirmed doc, toast; no silent overwrite.
- Corrupt file: banner; empty doc; first commit writes `.bak`.
- Route unavailable: flat fallback。503 `fence-unavailable` 与 503 `io` 都按路由不可用处理；404 无 content-type 同样降级。
- Missing host API: disable that action with tooltip; never throw on render.
- Render error: error boundary -> flat list; slot abdication is last resort.

## 6.5 Implementation constraints（Gate 0 实测）

- Cordis 4.0.5：插件 `apply` **必须返回 void**；返回对象会被当作 effect 列表并导致 `TypeError: Invalid effect`/静默 unload。注册一律 `ctx.effect`。
- linked (`link:`) 插件 import 安装侧包（如 `@deepseek-ai/dsh-home-paths`）必须在 package.json **peerDependencies** 声明，app-boot 才按 peer 名路由；否则静默解析失败。
- `ctx.connection` 在 apply 时可能不可见（`connectionAtApply=deferred`），请求时可见；围栏按请求 feature-detect，不要 `inject:['connection']` 硬等。
- 卸载后 `GET /dsh-session-groups/load` 落 SPA fallback：**404 + 无 content-type**；客户端降级按非 JSON 处理。
- 无围栏时两路由 **503 `fence-unavailable`**；`connection.fetch.register` 仅 P1 评估。
- `apply` 不要依赖 import 时的 host service 单例；所有服务在请求/渲染时从 ctx 取。

## 7. Forbidden

- No writes to `workspace.json`, session logs, `cordis.patch.yml` at runtime.
- No `@deepseek-ai/dsh-client-runtime` import.
- No second `sidebar.workspaces` registration at same priority.
- No reimplementation of official workspace browser.
- No titles/paths/workspace ids/archive flags in group doc.
- No weak loopback-only fence in production.
- No `parentId` for subagent detection.
- No host hero new-session switching for group `+`.

## 8. Gate 0 must answer (updated)

1. priority -1 + dispose 10 次切换；官方搜索/添加工作区回来；故意抛错触发 abdication。
2. `useSessions`/`useWorkspaces`/`useSessionStatus`（Map）/`archivedSessionIds`（数组）/`origin`/`blank`/`retainedBy` 形状。
3. `uiWorkspace.connectWorkspace(id)` 返回 id 且不导航；`startSession` 返回 void；hero 切换 id 变化记录。
4. rename/archive/unarchive/pin 精确形状；运行中归档 `workspace/session-active` + `stopActivity:true`。
5. `requestRejection` 401/403；`connection.fetch.register` 是否存在；坏 body/409/坏文件/重启。
6. bundle `__ModuleLoader__.load` + react externals + 禁用/启用干净。
7. 56px rail；`DSH_HOME` 隔离；`dshHomePath` 来源。
8. 第二个 -1 占用者的错误文本与捕获。
9. 组头 `+` 预创建菜单端到端：只落一条、正确工作区、无孤儿 blank。
