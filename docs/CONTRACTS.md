# V1/V1.1 契约（Host / Client / Shared）— Gate 0 修订稿

- 状态：**Frozen（Gate 0 PASS，2026-10-18）**；后续变更需 Gate 1 评审
- V1.1（0.2.0，2026-10-28）：**additive** 扩展——左栏宽度覆盖、分组拖拽排序/改父级、会话搜索下拉；数据模型、Host 路由、存储路径均不变
- V1.1（0.2.1，2026-10-28）：**typography/spacing-only patch**——分组视图排版/间距/图标对齐官方侧栏，消费宿主继承字体；无契约/数据/路由变化
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
| 图标 | 插件自带 8 个 16px inline SVG | 宿主图标集命名/集合不稳定 |
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
  | 'rocket';

export interface Group {
  id: string;            // "g-" + 12 hex
  name: string;          // 1..80 chars, trimmed; >80 -> reject
  icon: GroupIcon;
  parentId: string | null;
  sessionIds: string[];  // display order
}

export interface GroupDoc {
  version: 1;
  revision: number;      // host-owned, starts at 0
  groups: Group[];       // flat; sibling order = array order filtered by parentId
  ungrouped: string[];   // persisted manual order of explicitly ungrouped sessions
}
```

Invariants:

1. `id` unique; `name` trimmed 1..80; invalid icon -> `folder`.
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

## 3. Shared model API

Path `src/shared/model.js`; pure functions.

```ts
emptyDoc(): GroupDoc
cloneDoc(doc): GroupDoc
validateDoc(doc): { ok: boolean; errors: string[] }
findGroup(doc, groupId): Group | null
childrenOf(doc, parentId): Group[]
isDescendant(doc, groupId, maybeAncestorId): boolean
createGroup(doc, { name, icon, parentId, index }): GroupDoc
renameGroup(doc, groupId, name): GroupDoc
setGroupIcon(doc, groupId, icon): GroupDoc
deleteGroup(doc, groupId): GroupDoc
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
}
```

`deleteGroup`: children promoted to parent; sessions to parent head or ungrouped head; no archive/delete.

`buildRenderTree`:

- Exclude `origin === 'subagent'`; exclude blank except current/just-created.
- Archived rows included in `all`, muted; `only` includes archived only; `hidden` excludes.
- Groups always returned; `emptyVisible` when no visible children.
- Subgroups before sessions; no interleaving.
- `RenderNode`: `group` with `children`, `visibleCount`, `emptyVisible`; `session` with `session`, `workspace`, `archived`, `status`.

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
- Current session: `retainedBy.mainView > 0`; do not highlight when a panel is active (`activePanelId !== null`).
- Subagent: `origin === 'subagent'`; `parentId` is fork lineage, do not use for hiding。普通 `SessionListEntry` 的键只有 `blank,cwd,displayTitle,formatStatus,id,projectionValues,retainedBy,running,updatedAt`，**`origin`/`parentId` 可缺失**（仅 subagent 行带），读取必须容错。
- Blank: only current blank visible; a renamed blank still shows its title. Blank placement is host-ephemeral: after restart the old id may vanish (orphan hidden) and the new blank starts ungrouped.
- Title: `summary.title?.trim()`; blank -> “新会话”; missing -> “未命名”; workspace label 用 shared `workspaceLabel`（title/path basename/id）。
- Archived rows are not openable; provide unarchive.

### 4.1 Stable UI test ids（E2E 契约）

V1 client 必须输出这些 `data-testid`，E2E 依赖它们；改名需同步 `docs/TEST-PLAN.md`。

V1.1（0.2.0）additive 追加：`session-groups-resize-handle`、`session-groups-header-row`、`session-groups-search`、`session-groups-search-results`、`session-groups-search-result`、`session-groups-search-empty`、`session-groups-group-drop`、`session-groups-group-move-up` / `session-groups-group-move-down`；`session-groups-menu` 为既有菜单根，本批补登记。旧 testid 一律保留。

| testid | 位置 | 附加属性 |
|---|---|---|
| `session-groups-toggle` | footer 切换按钮 | `data-mode="workspace|groups"` |
| `session-groups-view` | 分组视图根 | `data-mode="groups"` |
| `session-groups-header` | 视图头（V1.1 起两行） | — |
| `session-groups-header-row` | 视图头第一行（V1.1） | — |
| `session-groups-return` | 返回工作区 | — |
| `session-groups-archive-filter` | 归档三态控件 | `data-filter` |
| `session-groups-new-group` | 新建分组 | — |
| `session-groups-ungrouped` | 未归组区块/头 | — |
| `session-groups-group` | 组行 | `data-group-id`, `data-depth`, `data-expanded` |
| `session-groups-group-add` | 组头 `+` | `data-group-id` |
| `session-groups-group-menu` | 组 `…` | `data-group-id` |
| `session-groups-group-move-up` / `session-groups-group-move-down` | 组菜单上移/下移 | `data-group-id`, `data-disabled` |
| `session-groups-menu` | 组/会话操作菜单根 | — |
| `session-groups-session` | 会话行 | `data-session-id`, `data-group-id` 或 `data-ungrouped="true"` |
| `session-groups-workspace-badge` | 悬浮工作区标签 | `data-session-id` |
| `session-groups-drop-indicator` | 吸附插入线/高亮 | `data-drop-kind`, `data-drop-target` |
| `session-groups-group-drop` | 组体子组缝隙槽（n 个子组 = n+1 个槽） | `data-parent-id`, `data-before-group-id`（末尾/空组为空串） |
| `session-groups-empty` | 空组/空筛选 | `data-group-id` |
| `session-groups-flat-fallback` | 加载失败扁平回退 | — |
| `session-groups-error` | 错误 banner | — |
| `session-groups-dialog` | 新建/改名/确认对话框根 | `data-kind` |
| `session-groups-dialog-input` | 对话框输入 | — |
| `session-groups-dialog-confirm` | 对话框确认 | — |
| `session-groups-rail` / `session-groups-rail-expand` | 56px rail / 展开 | — |
| `session-groups-resize-handle` | 左栏右边缘宽度把手（仅 `wide` 且可覆盖） | `role="separator"`, `aria-valuemin/max/now` |
| `session-groups-search` | 视图头第二行搜索输入 | `role="combobox"`, `aria-expanded`, `aria-controls` |
| `session-groups-search-results` | 搜索下拉列表 | `role="listbox"` |
| `session-groups-search-result` | 单条搜索结果 | `data-session-id`, `data-archived`, `aria-disabled`（归档项） |
| `session-groups-search-empty` | 搜索无结果空态 | — |
| `session-groups-banner` | 加载/冲突/错误 banner | `data-kind` |
| `session-groups-toast` | 操作提示 toast | — |
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
