# Global Session Groups V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH 左侧栏交付一个全局会话分组视图：分组独立存储，跨工作区拖拽，重命名/归档走宿主，V1 可安装、可验收、可回退。

**Architecture:** 一个 Cordis 插件，Host 半边负责 `dshHomePath('storages')/dsh-session-groups.json` 的 load/commit 与围栏，Client 半边通过 `sidebar.workspaces`（priority -1）接管左栏并用 footer action 在“分组视图 / 工作区视图”间切换。分组只存 session id 与树结构；标题、归档、新建全部调用宿主服务。

**Tech Stack:** Node 22 ESM（Host/Shared），React 18（Client，externals），esbuild（只打包 client bundle），Node `node --test`（unit/host），Playwright（E2E）。

**Spec:** `docs/V1-PLAN.md`、`docs/CONTRACTS.md`、`docs/SPIKE.md`

## Global Constraints

- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2；不要依赖 `@deepseek-ai/dsh-client-runtime`（已移除）。
- 只写 `dshHomePath('storages')/dsh-session-groups.json`；禁止写 `workspace.json`、session header/log、`cordis.patch.yml`。
- Gate 0/测试必须用独立 `DSH_HOME`；`dsh.cmd` 硬编码真实 home，不能直接用。
- `sidebar.workspaces` 是 single slot；同一时刻只能有一个我们的注册；切回必须 dispose。
- 客户端 HTTP 只用 `document.baseURI` 相对路径；不硬编码 `127.0.0.1:43120`。
- 分组数据不存标题、路径、workspaceId、归档状态、时间戳。
- 一个 session 最多属于一个组；树无环；删组非破坏性。
- 所有宿主 API 名称以 Gate 0 `docs/SPIKE.md` 实测为准；未验证的调用必须先 feature-detect。
- 默认中文文案；zh/en 词典；不引入 UI 框架。
- 代码无构建产物漂移：`lib/client.js` 由 `pnpm build` 生成并提交；CI/验收先跑 build 再测。

## Review Focus

1. **分组操作写坏宿主数据**：建组/拖拽/改名组/删组后，`workspace.json` 与 session 日志 hash 必须不变；由 Task 10 的数据审计测试覆盖。
2. **跨工作区拖拽静默 no-op**：会话从工作区 A 拖到工作区 B 的组，必须真的改变可见位置并持久化；由 Task 7 的跨工作区用例覆盖。
3. **组内新建落错工作区/重复 blank**：同质组预选正确；混合/空组可切换；创建后只出现一条；由 Task 9 覆盖。
4. **归档筛选让会话/组“消失”**：三态切换、取消归档回原组、空组仍显示空态；由 Task 8 覆盖。
5. **load/commit 失败丢分组或白屏**：409、坏文件、路由失败必须降级且不覆盖；由 Task 10 覆盖。

---

### Task 0: 仓库骨架、包清单、构建与测试入口

**Files:**
- Create: `package.json`
- Create: `cordis.patch.yml`
- Create: `dsh.plugin.json`
- Create: `scripts/build-client.mjs`
- Create: `tests/smoke.test.js`
- Create: `.gitignore`

**Interfaces:**
- Produces: `pnpm build` → `lib/client.js`; `npm test` → `node --test tests/**/*.test.js`; package exports `./client` and `main`.

- [ ] **Step 1: 写 `package.json`**

`name: dsh-session-groups`，`type: module`，`main: src/index.js`，`exports: {".":"./src/index.js","./client":"./lib/client.js","./package.json":"./package.json"}`，`dsh.bundle.patch: ./cordis.patch.yml`，`dsh.client.platform: web`，`dsh.client.inject` 只列真正的 client 包依赖（Gate 0 实测；不要混入 Cordis 服务名）；`scripts.build = node scripts/build-client.mjs`，`scripts.test = node --test tests`；devDependencies `esbuild`、`playwright`。

- [ ] **Step 2: 写 `cordis.patch.yml`**

```yaml
- insert:
    - id: dsh-session-groups
      name: 'dsh-session-groups'
```

- [ ] **Step 3: 写 `scripts/build-client.mjs`**

用 esbuild 把 `src/client/index.js` 打成 CJS（`format:'cjs'`，`platform:'browser'`，`target:'es2022'`，`bundle:true`），externals 至少 `react`、`react/jsx-runtime`；再用小包装器输出 `lib/client.js`：

```js
window.__ModuleLoader__.load({ id: 'dsh-session-groups', factory: (require) => { /* CJS module */ return module.exports } })
```

构建后 `node --check lib/client.js`；禁止 `format:'iife'`/`globalName`，否则拿不到平台 React。

- [ ] **Step 4: 写 smoke 测试并跑**

`tests/smoke.test.js` 断言 `src/shared/model.js` 可 import、`emptyDoc().version === 1`、`cordis.patch.yml` 含 `dsh-session-groups`。

Run: `npm test`；Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add package.json cordis.patch.yml dsh.plugin.json scripts tests src
git commit -m "chore: scaffold dsh-session-groups"
```

---

### Task 1: Shared 数据模型与纯函数

**Files:**
- Create: `src/shared/constants.js`
- Create: `src/shared/model.js`
- Test: `tests/unit/model.create.test.js`
- Test: `tests/unit/model.move.test.js`
- Test: `tests/unit/model.session.test.js`
- Test: `tests/unit/model.validate.test.js`

**Interfaces:**
- Produces: `emptyDoc()`, `validateDoc(doc)`, `createGroup`, `renameGroup`, `setGroupIcon`, `deleteGroup`, `moveGroup`, `assignSession`, `removeSession`, `reorderUngrouped`, `childrenOf`, `isDescendant`, `findGroup`, `buildRenderTree`, `inferWorkspaceId`, `workspaceOfSession`（签名见 `docs/CONTRACTS.md` §3）。

- [ ] **Step 1: 写失败的建组/改名测试**

断言 `createGroup(emptyDoc(), {name:'施工中', icon:'folder', parentId:null})` 返回一个 group，id 以 `g-` 开头，parentId 为 null；`renameGroup` trim 后保留 1..80 字符，空名抛 `Error('name-required')`，>80 抛 `Error('name-too-long')`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/model.create.test.js`；Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 constants/model 的建组/改名**

`GROUP_ICONS` 固定 8 个；`emptyDoc()` 返回 `{version:1,revision:0,groups:[],ungrouped:[]}`；所有函数返回新 doc，不原地改。

- [ ] **Step 4: 写移动/删除/环测试并实现**

断言同级前/后、跨父级、子树跟随；移入自身/后代抛 `Error('cycle')`；`deleteGroup` 把子组提升、会话移到父组头/未归组头，不删 session。

- [ ] **Step 5: 写会话归属/顺序/孤儿测试并实现**

断言 `assignSession` 跨组不重复、index clamp、`groupId:null` 进 ungrouped；`removeSession` 幂等；`validateDoc` 检出重复 session、环、坏 parentId、坏 icon；孤儿保留但 `buildRenderTree` 不渲染。

- [ ] **Step 6: 写归档筛选/空组/工作区推断测试并实现**

`buildRenderTree` 三态、空组 `emptyVisible:true`、subagent/blank 过滤；`inferWorkspaceId` 同质→该工作区、混合→当前会话工作区、空组→当前会话工作区、无当前→null。

- [ ] **Step 7: 跑全部 shared 测试**

Run: `node --test tests/unit`；Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/shared tests/unit
git commit -m "feat(shared): group tree model and invariants"
```

---

### Task 2: Host 独立存储（原子写 / 备份 / 恢复）

**Files:**
- Create: `src/host/store.js`
- Test: `tests/host/store.test.js`

**Interfaces:**
- Consumes: `emptyDoc`, `validateDoc` from `src/shared/model.js`.
- Produces: `createStore({ dir, fileName })` → `{ load(), save(doc), path }`；`load()` 返回 `{doc, revision, warning?}`；`save(doc)` 返回新 doc（revision+1）。

- [ ] **Step 1: 写失败测试：无文件 load**

临时目录下 `load()` 返回空 doc、revision 0、无 warning。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/host/store.test.js`；Expected: FAIL。

- [ ] **Step 3: 实现 load/save**

`load`：读文件；不存在→空 doc；JSON 解析失败→把文件 rename 为 `.corrupt-<ts>`，返回空 doc + `warning:'corrupt-file'`；`version>1` 抛 `unsupported-version`。
`save`：校验 doc；写 `.<name>.tmp`，`fsync` 可选，`rename` 覆盖；覆盖前 copy 到 `.bak`；revision+1。

- [ ] **Step 4: 写原子写/备份/坏文件测试并跑**

断言 `.bak` 存在、tmp 不残留、坏文件被隔离、保存后 load 一致。

- [ ] **Step 5: 提交**

```bash
git add src/host/store.js tests/host/store.test.js
git commit -m "feat(host): atomic group store"
```

---

### Task 3: Host 路由与围栏

**Files:**
- Create: `src/host/routes.js`
- Create: `src/host/fence.js`
- Test: `tests/host/routes.test.js`
- Test: `tests/host/fence.test.js`

**Interfaces:**
- Consumes: `createStore`.
- Produces: `registerRoutes(ctx, store)` 注册 `GET /dsh-session-groups/load` 与 `POST /dsh-session-groups/commit`；`isAllowed(req, ctx)` 返回 boolean/拒绝原因。

- [ ] **Step 1: 写失败测试：load/commit 状态码**

用假 req/res 或直接调 handler：无文件 load 200 空 doc；commit 旧 baseRevision 409；非法 doc 422；成功 200 revision+1。

- [ ] **Step 2: 实现 handler 与 JSON body 限制**

`commit` 读取 body（≤256KiB），校验 `baseRevision` 与 doc；冲突返回当前 doc；成功 `store.save`。

- [ ] **Step 3: 实现围栏**

优先 `ctx.connection.requestRejection(req)`；缺失时改用 `ctx.connection.fetch.register`；两者都没有则 fail-closed 503。不要用弱 loopback-only 作为正式路径；非 JSON content-type 拒绝。

- [ ] **Step 4: 写围栏测试并跑**

非 loopback、坏 Origin、超大 body、GET 带 body 等。

- [ ] **Step 5: 提交**

```bash
git add src/host/routes.js src/host/fence.js tests/host
git commit -m "feat(host): group routes and loopback fence"
```

---

### Task 4: Host 入口与 profile 安装 smoke

**Files:**
- Create: `src/index.js`
- Modify: `cordis.patch.yml`
- Test: `tests/host/entry.test.js`

**Interfaces:**
- Produces: Cordis plugin `apply(ctx)`，注册 routes；`ctx.effect`/dispose 清理。

- [ ] **Step 1: 写失败测试：apply 注册两个路由**

用假 ctx（`webServer.register` 记录调用、`connection` 可选）调 `apply`，断言路径与 handler。

- [ ] **Step 2: 实现 `src/index.js`**

`createStore({ dir: path.join(dshHome, 'storages'), fileName: 'dsh-session-groups.json' })`；`registerRoutes(ctx, store)`；没有 `webServer` 时 fail-soft 日志，不抛。

- [ ] **Step 3: 在 disposable profile 安装 smoke**

```powershell
$env:DSH_HOME = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\host"
$desktop = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe"
$cli = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
& $desktop --expose-internals $cli plugin --profile groups-spike add "link:C:\Users\Momiji\Projects\dsh-session-groups"
& $desktop --expose-internals $cli --profile groups-spike --port 4400 --no-open
```

访问 load，确认 200；重启后仍 200。

- [ ] **Step 4: 提交**

```bash
git add src/index.js cordis.patch.yml tests/host/entry.test.js
git commit -m "feat(host): mount group storage routes"
```

---

### Task 5: Client 壳、槽位切换、footer action

**Files:**
- Create: `src/client/index.js`
- Create: `src/client/shell.js`
- Create: `src/client/state.js`
- Create: `src/client/locale.zh.json`
- Create: `src/client/locale.en.json`
- Test: `tests/client/state.test.js`

**Interfaces:**
- Consumes: `slots`, `locale`.
- Produces: `apply(ctx)`；`viewMode`（localStorage `dsh-session-groups.view.v1`）；`registerGroupsView(ctx)` / `disposeGroupsView()`；footer action label。

- [ ] **Step 1: 写失败测试：viewMode 默认 workspace、切换持久化**

纯 state 模块，不依赖 React；断言默认 `workspace`、`setViewMode('groups')` 后读回 `groups`。

- [ ] **Step 2: 实现 state + shell 骨架**

`apply` 用 `ctx.effect` 兜底一个 mode controller：footer action 点击 `setMode`；`groups` 时通过 `ctx.slots.inject('sidebar.workspaces', …)` 注册 `priority:-1` 的 `GroupsView` 并持有 disposer；`workspace` 时 dispose 并让官方渲染；插件卸载由 effect 统一清理。捕获同 priority 重复注册错误，fail-soft 到 footer-only + toast。

- [ ] **Step 3: 在 spike profile 验证**

点 footer 切换，确认官方视图回来/再接管；刷新后记住上次 mode；rail 下 footer 仍可见。

- [ ] **Step 4: 提交**

```bash
git add src/client
git commit -m "feat(client): sidebar mode switch shell"
```

---

### Task 6: Client 分组树渲染（图标/折叠/竖线/空组）

**Files:**
- Create: `src/client/tree.js`
- Create: `src/client/components/GroupRow.js`
- Create: `src/client/components/SessionRow.js`
- Modify: `src/client/shell.js`
- Test: `tests/client/tree-render.test.js`

**Interfaces:**
- Consumes: `buildRenderTree`.
- Produces: `renderTree(tree, handlers)`（React element）；`GroupRow` props：`group, depth, expanded, count, onToggle, onMenu, onAdd, dropTarget`；`SessionRow` props：`session, workspace, current, onOpen, onMenu, dropTarget`。组图标用 `src/client/icons.js` 的 8 个 inline SVG（`folder`/`folder-open`/`star`/`flag`/`bookmark`/`tag`/`bulb`/`rocket`）。

- [ ] **Step 1: 写失败测试：树形状**

用纯函数 `flattenRenderTree(tree)` 断言子组在会话前、空组出现、深度递增、可见计数正确。

- [ ] **Step 2: 实现树渲染**

组头：chevron/icon/name/count/`+`/`…`；竖线用容器 `border-left`，`min-height:24px`；空组显示“空分组，拖入会话”；折叠隐藏子项但保留组头。

- [ ] **Step 3: 样式对齐 264/280/420px**

用 CSS 变量/固定 12px 缩进；名称 `text-overflow: ellipsis`；不横向溢出；深色主题用 `--dsw-*` 变量。

- [ ] **Step 4: 提交**

```bash
git add src/client tests/client/tree-render.test.js
git commit -m "feat(client): group tree rendering"
```

---

### Task 7: Client 会话拖拽、吸附、跨工作区

**Files:**
- Create: `src/client/drag.js`
- Modify: `src/client/tree.js`
- Modify: `src/client/components/SessionRow.js`
- Test: `tests/client/drag-hit.test.js`

**Interfaces:**
- Produces: `hitTestSessionDrag({pointerY, rowRect, rowKind, targetGroupId, source})` → `DropTarget | null`；`DropTarget = {kind:'session-before'|'session-after'|'group-append'|'ungrouped'|'invalid', groupId?, sessionId?}`；`applyDrop(doc, source, target)` → `GroupDoc`。

- [ ] **Step 1: 写失败测试：上/下半、组头、未归组、无效**

断言会话行上半→before、下半→after；组头→append；未归组→ungrouped；拖到自身/后代→invalid。

- [ ] **Step 2: 实现 hit-test 与 drop 应用**

会话拖拽用 HTML5 DnD；`dataTransfer.setData('text/plain', sessionId)`；`dragover` 更新目标；`drop` 调 `applyDrop` 并 commit；Esc/拖出取消。

- [ ] **Step 3: 实现吸附视觉**

插入线（2px 品牌色）、目标组 `bw-drop-into` 浅底、浮动标签“放入『组名』”；折叠组悬停 500ms 展开；边缘自动滚动（可选 P1）。

- [ ] **Step 4: 集成测试：跨工作区**

用 mock doc + 3 个 workspace 的 session，断言从 A 拖到 B 的组后 `sessionIds` 与 `ungrouped` 正确，无重复。

- [ ] **Step 5: 提交**

```bash
git add src/client tests/client/drag-hit.test.js
git commit -m "feat(client): cross-workspace session drag and snap"
```

---

### Task 8: 归档三态、可见性、当前高亮、状态点

**Files:**
- Modify: `src/client/tree.js`
- Create: `src/client/filter.js`
- Test: `tests/client/filter.test.js`

**Interfaces:**
- Consumes: `archivedSessionIds`（数组，`includes`）、`useSessionStatus`（Map，`running`/`pendingInteraction.kind`/`completionUnread`）、`origin`/`blank`/`retainedBy`。
- Produces: `visibleTree(doc, sessions, workspaces, {filter, currentId, statuses})`；filter `'hidden'|'all'|'only'`。

- [ ] **Step 1: 写失败测试：三态与空组**

断言 hidden 排除归档、all 保留并标 archived、only 只留归档；组始终出现，`emptyVisible` 正确；`origin==='subagent'` 排除、fork 保留；blank 仅当前可见；归档行不可打开。

- [ ] **Step 2: 实现 filter + 视图头三态菜单**

菜单文案：隐藏已归档 / 全部 / 仅已归档；状态存 localStorage；当前会话祖先组自动展开；归档行 muted + 徽标。

- [ ] **Step 3: 状态点/当前高亮**

用 `useSessionStatus` Map 渲染 running/pendingInteraction/completionUnread；当前会话 `retainedBy.mainView > 0` 且无 active panel 时高亮；折叠组 P1 聚合计数。

- [ ] **Step 4: 提交**

```bash
git add src/client tests/client/filter.test.js
git commit -m "feat(client): archive filter and session status"
```

---

### Task 9: 重命名、归档、组内新建、工作区标签

**Files:**
- Create: `src/client/actions.js`
- Modify: `src/client/tree.js`
- Modify: `src/client/components/GroupRow.js`
- Modify: `src/client/components/SessionRow.js`
- Test: `tests/client/actions.test.js`

**Interfaces:**
- Consumes: `sessions.using(id,{source:'workspaceOperation'}, ref=>ref.binding.session.rename(title))`、`uiWorkspace.archiveSession(id,{stopActivity:true})`、`uiWorkspace.unarchiveSession`、`uiWorkspace.connectWorkspace`、`uiWorkspace.openSession`。
- Produces: `renameSession(id,title)`, `archiveSession(id)`, `unarchiveSession(id)`, `createSessionInGroup(groupId, workspaceId)`, `workspaceLabel(sessionId)`；`archiveSession` 捕获 `workspace/session-active` 并返回 `{needsConfirm, activity}`。

- [ ] **Step 1: 写失败测试：工作区推断与标签**

`inferWorkspaceId` 同质/混合/空组；`workspaceLabel` 有归属/无归属；新建后 `unshift` 到组首。

- [ ] **Step 2: 实现动作桥接**

重命名/归档调用宿主；成功后不本地改标题/归档；运行中归档先返回确认信息，确认后 `stopActivity:true`，取消不动；新建 `connectWorkspace` 得到 id → `openSession` → `unshift` 到组；失败 toast。

- [ ] **Step 3: 组头 `+` 与工作区切换**

`+` 打开我们自己的预创建工作区菜单（默认推断 + 全部工作区）；选定后 `connectWorkspace(workspaceId)` 创建并拿到 id；`openSession` 后放组首；不走宿主 hero 切换；`only` 筛选时切 all + toast。

- [ ] **Step 4: 悬浮/焦点工作区标签**

右侧 pill，`max-width:40%`，tooltip 全路径；键盘 focus 触发；无归属“无工作区”。

- [ ] **Step 5: 提交**

```bash
git add src/client tests/client/actions.test.js
git commit -m "feat(client): host action bridge and group create"
```

---

### Task 10: 持久化集成、409、降级

**Files:**
- Create: `src/client/api.js`
- Modify: `src/client/shell.js`
- Test: `tests/client/api.test.js`
- Test: `tests/host/conflict.test.js`

**Interfaces:**
- Produces: `loadDoc()`, `commitDoc(doc, baseRevision)`；409 时返回 `{conflict:true, doc, revision}`；失败时 shell 渲染扁平列表 + banner。

- [ ] **Step 1: 写失败测试：load/commit/409**

mock fetch：200、409、500、网络错误；断言只重试一次、冲突采用服务端 doc、失败降级不覆盖。

- [ ] **Step 2: 实现 api 与提交队列**

同源相对 URL；commit 串行；失败回滚到 lastConfirmed；toast 显示错误码。

- [ ] **Step 3: 实现 shell 降级**

load 失败：渲染扁平 session 列表 + “分组数据加载失败”banner + 重试；路由不可用同样；不白屏。

- [ ] **Step 4: 写 host 冲突测试**

两个并发 commit，一个 409；文件不被覆盖；`.bak` 保留。

- [ ] **Step 5: 提交**

```bash
git add src/client tests
git commit -m "feat: persistence conflict handling and fallback"
```

---

### Task 11: E2E 与数据审计

**Files:**
- Create: `e2e/groups.spec.js`
- Create: `playwright.config.js`
- Create: `scripts/audit-no-host-writes.ps1`
- Test: `e2e/groups.spec.js`

**Interfaces:**
- Consumes: 隔离 home `.spike-homes/qa` + `desktop-cli --profile groups-spike --port 4402 --no-open`（不是 `dsh ... web`）。
- Produces: E2E 12 步；审计脚本输出 PASS/FAIL。

- [ ] **Step 1: 写 Playwright 配置**

baseURL `http://127.0.0.1:4402`；trace/video/screenshot on failure；单 worker；fixture 从真实 home 只读复制到 `.spike-homes/qa`。

- [ ] **Step 2: 写 9 步验收 spec**

建 3 组/嵌套 → 跨 3 工作区拖 10 个会话 → 排序 → 归档三态 → 组内新建/切工作区 → hover 标签 → 重启 → 切回官方 → 断言无重复/丢失。

- [ ] **Step 3: 写审计脚本**

哈希 `workspace.json` + 3 个 sample session 目录；执行分组操作；再哈希；断言只有 `dsh-session-groups.json` 变化。

- [ ] **Step 4: 跑 E2E + 审计**

Run: `npx playwright test`；Expected: PASS；审计 PASS。

- [ ] **Step 5: 提交**

```bash
git add e2e playwright.config.js scripts
git commit -m "test: v1 acceptance e2e and host-write audit"
```

---

### Task 12: 安装 dry-run、卸载恢复、文档

**Files:**
- Create: `README.md`
- Modify: `docs/V1-PLAN.md`（Gate 结果）
- Create: `docs/RELEASE.md`

**Interfaces:**
- Produces: 可安装的 tarball/链接；卸载后官方视图恢复；记录文件保留。

- [ ] **Step 1: 在 groups-spike 安装并重启**

确认 load/commit、slot 切换、记录文件、官方视图恢复。

- [ ] **Step 2: 卸载测试**

卸载插件 → 官方视图恢复；记录文件保留；重装后分组还在。

- [ ] **Step 3: 写 README/RELEASE**

安装命令（web/desktop 分别）、权限说明、数据文件位置、已知限制、回退方法。

- [ ] **Step 4: 提交**

```bash
git add README.md docs
git commit -m "docs: install, uninstall and release notes"
```

---

## Self-Review

**Spec coverage:**
- A 模式切换 → Task 5。
- 分组 CRUD/嵌套/图标/竖线 → Task 1 + 6。
- 拖拽/吸附/跨工作区 → Task 7。
- 归档三态 → Task 8。
- 重命名/不可删除 → Task 9。
- 未归组/组内新建/工作区标签 → Task 9。
- 持久化/409/降级 → Task 2/3/10。
- 验收/审计 → Task 11。
- 安装/卸载 → Task 12。

**Placeholder scan:** 无 TBD；所有 API 名称以 Gate 0 为准，未验证处标 feature-detect。

**Type consistency:** `GroupDoc`/`Group`/`DropTarget`/`RenderNode` 在 CONTRACTS 定义；任务只引用，不重复定义。

**Review Focus coverage:** 5 条均有对应任务（Task 10、7、9、8、10）。
