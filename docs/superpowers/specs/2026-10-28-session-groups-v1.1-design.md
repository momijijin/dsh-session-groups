# dsh-session-groups V1.1 设计 spec

- 状态：**设计已由用户口头批准（2026-10-28）**；独立评审第一轮 NO-GO（B1/B2），第二轮复审 **GO**（B1/B2 闭环，仅 3 条非阻断建议已吸收）；待用户审阅本文件与本地 commit 授权
- 上游：`docs/V1-PLAN.md`、`docs/CONTRACTS.md`、`docs/TEST-RESULTS.md`
- 范围：左栏可拖宽、分组拖拽排序/改父级、会话搜索下拉
- 不改宿主包、不改 `workspace.json`/session 日志；记录仍只写 `dsh-session-groups.json`

## 1. 背景与硬约束

- 官方左栏可拖拽，但 `dsh-client-ui-layout` 的 `computeColumns` 把宽度钳在 **264–420px**；在宿主安装目录改 clamp 不可打包、升级会坏。
- 分组视图通过 `sidebar.workspaces` 槽接管左栏；官方侧栏仍在其外层，frame 的 `gridTemplateColumns` 第一轨决定左栏宽度。
- 官方 DOM 证据（DSH Desktop 2.0.18）：
  - frame：带内联 `grid-template-columns` 的祖先；
  - sidebar 根：带内联 `width` 的祖先（`SidebarRoot`）；
  - 官方拖拽把手：`[data-side="sidebar"]`，`style.left = cols.sidebar`，内部 `setSidebar` 仍会 clamp 到 420。
- V1 文档中的 D8（分组同级拖拽）实际未实现；本批补齐。D12 搜索原为 P1，本批实现。V1-PLAN §4 里“宽态 264–420px”的旧描述由本 spec 的 264–760px 取代，计划阶段同步修订。
- blank 会话仍是宿主临时占位，不因本批改变语义。

## 2. 目标与非目标

### 目标

1. 分组视图左栏可拖宽到 **264–760px**，至少给主内容留 **480px**；持久化；官方视图不变；双击把手恢复 420px。
2. 分组支持拖拽同级排序与拖拽改父级；落点即最终父级+序号；子树跟随；禁止进自身后代。组菜单补「上移/下移」作为无鼠标/键盘兜底。
3. 会话搜索下拉：标题/工作区/组路径匹配；选中普通会话即打开、展开祖先组、滚动到行并高亮；归档会话列出但置灰不可选。

### 非目标（本批不做）

分组颜色/图标上传、撤销、置顶徽标、折叠组聚合计数、多窗口实时合并、全文搜索、跨设备同步、宿主布局包修改。

## 3. 交互契约

### 3.1 左栏宽度

- 仅 `viewMode=groups` 且 `wide=true` 时显示把手；rail/官方视图不显示、不覆盖。
- 把手位于左栏右边缘，宽 6px，`cursor: col-resize`，悬浮/拖动时高亮。
- 指针拖动即时改宽；`requestAnimationFrame` 节流；松手持久化。
- 范围：
  - `MIN=264`；
  - `MAX=min(760, viewportWidth - 480)`；
  - 若 `MAX <= MIN`，不启用覆盖，保持官方宽度，把手隐藏；
  - 挂载时读取存储值并 clamp；窗口 resize 时重新 clamp。
- 默认值 420；双击把手恢复 420；键盘 `ArrowLeft/ArrowRight` ±16，`Home=264`，`End=MAX`。
- 持久化键：`dsh-session-groups.width.v1`（localStorage，数值 px）；存储不可用时仅当前会话生效。
- 切回官方/卸载分组视图：移除所有覆盖，官方宽度恢复；再次进入恢复上次宽度。官方宽度不写死；E2E 在进入分组视图前记录官方宽度，切回后按记录比较。
- 官方拖拽把手在覆盖期间隐藏，避免两个把手同时存在；移除覆盖后恢复。

### 3.2 分组拖拽

拖动源：组头整行可拖；`+`/`…` 按钮不触发拖拽；单击仍折叠/展开；拖动结束不触发点击。

落点：

| 悬停位置 | 结果 |
|---|---|
| 组头上缘（上 25%） | 插到该组**前**，父级=该组父级 |
| 组头下缘（下 25%） | 插到该组**后**，父级=该组父级 |
| 组体的子组缝隙 | 成为该组子组，插入缝隙对应序号 |
| 无子组的组体（含空组/有会话但无子组） | 唯一 0 号槽，成为该组第一个子组 |
| 未归组头部 | 移到根级末尾 |
| 折叠组 | 不提供子组落点；需先展开 |
| 自身/自身后代 | 禁止态，不显示可落插入线 |

- 组体**恒有 n+1 个槽**（n=该组当前子组数），与组内是否有会话无关：n=0 时就是唯一 0 号槽；槽不渲染在会话行之间，也不因组内有会话而消失。
- 插入线实时显示；浮动标签显示“放入『组名』前/后/内”。
- 落点计算：
  - 同级排序用 `target` 在 `childrenOf(doc, target.parentId)` 中的下标；after=下标+1；
  - **所有落点**（before/after/child）统一由 `resolveGroupDrop` 按“移除拖拽组后的兄弟数组”修正：同父且原下标 < 插入下标时 `-1`；
  - 子组槽 index = 槽前的子组数量（0..n）；无子组=0；
  - 根末尾 index = 根组数量。
- 提交：`moveGroup(doc, draggedId, parentId, index)`；已存在 cycle/depth 校验；失败 toast，不提交。
- 子树跟随：仅改 `group.parentId` 与 `doc.groups` 顺序；`sessionIds` 不变。
- **组拖中** auto-expand 不做（与“折叠组不提供子组落点”一致），用户先展开目标组；现有**会话拖拽**的 500ms 折叠组悬停展开保持不变。
- 键盘/菜单兜底：现有「移动到分组…」菜单仍可用；组菜单新增「上移/下移」，在同父兄弟序列中移动（首/尾禁用），与拖拽共用 `moveGroup`。

### 3.3 搜索

- 视图头改为两行：第一行保留标题/归档筛选/新建分组/返回工作区，第二行整行搜索输入框（避免 264px 宽时挤压按钮）。两行均 `min-width:0`、允许换行/收缩，264px 下不得出现水平溢出。输入即时查询；空查询关闭下拉。
- 索引字段：会话标题（`sessionTitle`）、工作区标签、组路径（`groupPath`）；大小写不敏感。
- 范围：所有非 subagent 会话（含归档、含未归组、含 blank）；归档结果置灰并标“已归档”，不可选中。
- 结果排序：标题前缀命中优先，其次标题包含，再次工作区/组路径命中；同分按标题/会话 id 稳定排序；最多 20 条。
- 下拉项显示：标题、工作区标签、组路径、归档徽标。
- 键盘：`ArrowDown/ArrowUp` 移动（可经过归档项）、`Enter` 选中、`Escape` 关闭；鼠标点击选中；点击外部关闭。归档项聚焦时按 Enter 不动作并提示“已归档会话不可打开”。
- 选中普通会话：
  1. 清空搜索并关闭下拉；
  2. 若当前归档筛选为 `only`，切到 `all`（否则行不可见）；
  3. `openSession(sessionId)`；
  4. 展开该会话的**所在容器**（所在组本身；未归组用 `__ungrouped__`）**及其所有祖先**；用纯函数 `revealSession(doc, collapsed, sessionId)` 一次返回新 collapsed；
  5. 等行真正出现后（最多重试 2 帧），用 rect 差法把行滚到树滚动容器可视区上部约 1/3；加 1.5s 高亮；
  6. 行仍不存在/孤儿：只打开会话，不滚动，不报错（但展开状态已更新）。
- 选中归档结果：不打开、不滚动，显示“已归档会话不可打开”提示。
- 搜索不写分组记录；不改变归档筛选（除上述 only→all 的可见性修正）。

## 4. 技术设计

### 4.1 模块划分

新增：

- `src/client/sidebar-width.js`：纯函数 `clampSidebarWidth`、`readStoredWidth`/`writeStoredWidth`，DOM 适配 `findLayoutNodes`/`applyWidthOverride`/`clearWidthOverride`。
- `src/client/group-drag.js`：纯函数 `resolveGroupDrop`（输入 draggedId、target、zone、doc、index，返回 `{parentId,index}` 或 `{invalid}`），以及同一父级下标修正。
- `src/client/search.js`：纯函数 `buildSearchIndex`/`matchSessions`/`revealSession`（所在组/未归组 + 全部祖先）。
- `src/client/components.js`：新增 width handle、group drop slots、search box/dropdown；组头改为可拖；组菜单加上移/下移。
- `src/client/state.js`：宽度读写（沿用 `safeStorage`）。
- `src/client/css.js`：宽度把手、组拖插入线、搜索下拉、高亮样式。
- `src/client/locale.js` + `locale/zh.json` + `locale/en.json`：搜索/宽度/拖组/归档禁用等新文案，zh/en 必须同步（parity 测试）。
- `src/shared/model.js`：不新增数据模型；复用 `moveGroup(doc, id, parentId, index)`；仅补测试。

### 4.2 宽度覆盖（方案 A）

组件挂载时：

1. 从分组视图根向上查找：
   - `frame`：祖先中 `style.gridTemplateColumns` 非空；
   - `sidebarRoot`：祖先中 `style.width` 非空（`SidebarRoot`）；
   - `officialHandle`：`frame.querySelector('[data-side="sidebar"]')`。
2. 捕获 `frame.style.gridTemplateColumns` 原始值。
3. 给 frame/sidebarRoot 加 `data-dsg-sidebar-frame` / `data-dsg-sidebar-root`。
4. 生成并插入 `<style data-dsg-width>`：
   - `[data-dsg-sidebar-frame]{grid-template-columns:<width>px <rest>!important}`
   - `[data-dsg-sidebar-root]{width:<width>px!important;max-width:none!important}`
   - `[data-dsg-sidebar-frame] [data-side="sidebar"]{display:none!important}`
   - `<rest>` 来自原始模板去掉第一轨（如 `minmax(400px,1fr) minmax(0px, 638px)`），保留右栏轨道。
5. 若找不到 frame/sidebarRoot，`supported=false`，不显示把手，功能降级不影响分组。
6. `MutationObserver` 同时监听 frame `style` 与 `document.body` 的 `childList`；宿主替换 frame/侧栏或移除属性时重新 `findLayoutNodes` 并检查 `frame.isConnected`；重新找不到则清除覆盖、隐藏把手。宽度拖动开始、窗口 resize、视图重新挂载时也重跑查找。
7. 更新宽度：写 CSS 规则 + 修改 sidebarRoot/frame 的 `data-*` 无需重设；把手 `left=width-3`。
8. 卸载/切回官方：移除 `data-*`、`<style>`，恢复官方把手；不写死官方宽度值，由宿主状态决定。E2E 在进入分组视图前记录官方宽度，切回后按记录值比较（不要求固定 420）。

指针拖动：

- `pointerdown` 记录起点与起始宽度，`setPointerCapture`；
- `pointermove` 计算 `next = clamp(startWidth + dx, min, max)`；rAF 更新；
- `pointerup/cancel` 持久化并释放 capture；
- 双击 `reset=420`；
- 键盘事件按 §3.1。

### 4.3 分组拖拽

- 组头 `draggable=true`；`onDragStart` 写入 `application/x-dsh-group-id`；若事件源在 `button` 内则 `preventDefault` 并 return。
- 组头 `onDragOver` 根据 `event.clientY` 与 rect 计算上/下缘；上/下 25% 设置 `dropTarget={kind:'group-before'|'group-after', targetId}`；**中间 50% 对组拖为 invalid**（不落 session append）。
- `GroupDropSlot` 渲染在每个子组前和最后一个子组后（n 个子组 = n+1 个槽）；无子组时在组体顶部渲染一个 index=0 的槽；`data-parent-id`、`data-index`；`onDragOver`/`onDrop` 设置 `group-child`。槽不渲染在会话行之间。
- 未归组头部 `onDragOver`/`onDrop` 设置 `{kind:'group-root-end'}`。
- 纯函数 `resolveGroupDrop`：
  - 校验 draggedId 存在；
  - **`targetId===draggedId` 一律 invalid**（含组头上/下缘，避免同父 no-op 被当作可落点）；
  - target 父级/序号；
  - `isDescendant(doc,parentId,draggedId)` 或 `parentId===draggedId` → invalid；
  - 所有 kind（before/after/child）统一按“移除拖拽组后的兄弟数组”修正同父下标；
  - 返回 `{parentId,index}`；`parentId` 为目标组自身（child）或目标组父级（before/after）。
- `onDrop` 使用与 session drop 相同的队列更新：`rt().commitDoc(doc => moveGroup(doc, draggedId, parentId, index))`，由队列在最新确认 doc 上执行；`moveGroup` 返回新 doc 或抛错（cycle/depth），没有 `applied` 字段。**落点与当前位置相同（同父且 index 等于移除后的原下标）时显式跳过 commit**，避免 no-op revision；其余错误 toast、不提交。
- 点击与拖拽：`suppressNextClick` 标记在 dragstart 时置位，click 时消费并清空；另设 400ms 超时清除，不依赖 dragend 后的 `dragRef` 状态。
- 组拖与现有 session drop handler 按 `dragRef.kind` 分流；组拖经过会话行/未归组体时不得走 session 的 preventDefault/提交路径。两种 drag 用不同 `dataTransfer` 类型 + `dragRef.kind` 区分。

### 4.4 搜索

- `buildSearchIndex({doc, sessionsById, workspaces, archivedSessionIds})`：
  - 遍历 `sessionsById`，排除 `origin==='subagent'`；
  - 用 `groupAncestors`/`groupPath` 定位组路径；未归组路径为空；
  - `archived = archivedSessionIds.includes(id)`；
  - 标题用 `sessionTitle`；
  - 工作区用 `workspaceLabel(workspaceOfSession(...))`。
- `matchSessions(index, query)`：trim/大小写折叠；空→[]；按评分/标题排序；`slice(0,20)`。
- 组件：
  - `SearchBox` 受控输入 + `role=combobox` + `aria-expanded` + `aria-controls`；
  - 结果 `role=listbox`/`option`，`aria-disabled` 对归档；
  - `activeIndex` 键盘维护；`onSelect` 调用 `handlers.searchSelect(entry)`。
- 选中：
  - 若 archived：toast info；return；
  - 若 `archiveFilter==='only'`：`dispatch('archive-filter',{filter:'all'})`；
  - `rt().actions.openSession(id)`；
  - `revealSession(doc, collapsed, sessionId)`：返回新的 collapsed（删除该会话所在组 id 或 `__ungrouped__`，以及其全部祖先的折叠标记）；**若 doc.groups 中找不到该会话，一律展开 `__ungrouped__`**（覆盖宿主派生未归组会话）；一次 `store.update({collapsed})`；
  - 等行出现后（最多重试 2 帧）调用 `scrollRowIntoView(id)`；
  - `scrollRowIntoView`：`data-session-id` 行与 `.dsg-tree` 容器用 `getBoundingClientRect` 差值计算 `scrollTop = container.scrollTop + (row.top - container.top) - 0.3*container.clientHeight`，clamp；加 `dsg-search-hit` 1.5s 后移除。
- 若打开失败/行不存在：不抛错；清理高亮。

### 4.5 状态与持久化

- 新增 `SIDEBAR_WIDTH_KEY='dsh-session-groups.width.v1'`；`readSidebarWidth`/`writeSidebarWidth` 复用 `safeStorage`，非法值回退 420。
- 搜索 query/activeIndex 仅组件 state，不持久化。
- 分组拖拽只改 doc，沿用现有 `commitDoc` 队列/409 处理；不新增 host route。
- 不修改 `dsh-session-groups.json` 的 version/字段。

## 5. 错误与边界

| 场景 | 行为 |
|---|---|
| 宿主 DOM 找不到 frame/sidebarRoot | 宽度功能降级，把手隐藏，分组/搜索正常 |
| localStorage 不可用 | 宽度仅当前会话，刷新回默认 |
| 窗口 < 744px 或 clamp 后 max<=min | 不覆盖，官方宽度/rail |
| 拖组进自身/后代 | 插入线不出现；drop no-op + toast |
| 拖组超过硬深 8 层 | `moveGroup` 抛 depth-exceeded，toast，不提交；软深 4 只是缩进 clamp，不报错 |
| 拖组提交 409 | 沿用 conflict banner + 服务端 doc；不重试 |
| 搜索无结果 | 空态“没有匹配的会话” |
| 搜索选中归档 | 置灰不可选；若强制选择则提示 |
| 搜索选中会话被宿主删除 | 行不存在；只打开/提示，不崩 |
| 搜索选中时行被筛选隐藏 | only→all 修正；其余保持 |
| 宽度覆盖时宿主重渲染 | MutationObserver 重套；找不到节点则清除覆盖 |

## 6. 可访问性

- 宽度把手：`role="separator"`、`aria-orientation="vertical"`、`aria-valuemin/max/now`、`tabindex=0`；左右键调节，Home/End，双击重置。
- 搜索：combobox/listbox 语义、`aria-activedescendant`、Esc 关闭、方向键/Enter；结果文本包含归档状态。
- 组拖拽保留菜单路径；拖拽不可用时用户仍能通过「移动到分组…」改父级，通过菜单「上移/下移」调整同级顺序（首/尾禁用）。
- 插入线/禁止态不仅靠颜色，配 `data-*` 与浮动标签。

## 7. 测试与验收

### 单元/逻辑

- `clampSidebarWidth` 的 min−1/min/max/max+1/窗口过小/存储非法。
- `resolveGroupDrop`：同父前/后、跨父、**有会话但 0 子组** index 0、空组 index 0、根末尾、自身/后代 invalid、深度边界；同父 child 槽的移除后下标修正；移动后顺序与子树。
- 组菜单上移/下移：首/尾禁用、同父顺序、子树跟随、跨父不出现。
- `buildSearchIndex`/`matchSessions`：标题前缀/包含、工作区、组路径、归档标记、subagent 排除、空查询、20 条上限、稳定排序。
- `revealSession`：目标组折叠→同时展开所在组；嵌套→展开全部祖先；未归组折叠 `__ungrouped__`→展开；**doc.groups 找不到的派生未归组会话→展开 `__ungrouped__`**；普通已展开→collapsed 不变（引用相等）。
- **不新增 DOM/React 测试依赖**：持久化/重置/卸载清理、点击不误触、搜索键盘/归档禁用、滚动高亮全部放在 E2E（仓库现有 devDeps 仅 esbuild/playwright；依赖变更需用户手动）。

### 新增 stable test ids（**additively** 追加到 `CONTRACTS.md §4.1` 与 `TEST-PLAN.md`；同时把现有 `session-groups-menu` 补登记）

| testid | 位置 | 附加属性 |
|---|---|---|
| `session-groups-resize-handle` | 左栏右边缘把手 | `role=separator`, `aria-valuenow` |
| `session-groups-search` | 搜索输入 | `role=combobox`, `aria-expanded` |
| `session-groups-search-results` | 下拉列表 | `role=listbox` |
| `session-groups-search-result` | 单条结果 | `data-session-id`, `data-archived` |
| `session-groups-search-empty` | 无结果 | — |
| `session-groups-group-drop` | 组体子组缝隙 | `data-parent-id`, `data-index` |

### E2E（新增，全部走 CONTRACTS §4.1 testid）

- `session-groups-resize-handle`：进入分组视图前记录官方 sidebar 宽度；拖到 620；断言 sidebar 根宽/frame 第一轨；reload 后仍 620；双击回 420；再拖到 264 断言头部搜索/按钮无水平溢出；切官方后把手消失且宽度等于记录的官方值。
- 组拖：4 组，A/B/C/D；D 拖到 A 上缘→顺序 D,A,B,C；先把 C 放入 **有会话但 0 子组** 的 B 组体槽（断言 `{parentId:B,index:0}` 生效，覆盖 B2）；再把 D 拖到 B 的子组 C 前/后；尝试把 B 拖进 B 的子组→无效；拖到未归组头→根末尾。
- 搜索：折叠目标组后输入唯一标题→结果；↓/Enter 选中→会话打开、**目标组与祖先全部展开**（`data-expanded=true`）、行可见、行高亮、滚动容器 rect 位置变化（覆盖 B1）；归档结果 `aria-disabled=true`；无结果空态。
- locale parity：`locale/zh.json` 与 `locale/en.json` key 集合一致，新 key 都有翻译。
- 回归 V1 12 步全 PASS。

### 验收标准

- 以上新增用例与 V1 12 步全绿；`npm test` 全绿；无插件 console error。
- 只写记录文件；`workspace.json`/session 日志在分组操作下不变。
- 官方视图宽度/布局与未安装插件时一致。
- 未获用户验收前不安装 desktop profile、不 push。

## 8. 风险与回退

- 宿主 DOM 内部结构变化：宽度覆盖 fail-soft，只影响加宽；分组/搜索独立。
- CSS `!important` 与 React 重渲染竞争：MutationObserver + 卸载清理；E2E 刷新/重启覆盖。
- 组头整行拖拽与点击冲突：`suppressNextClick` 标记 + 400ms 超时；菜单路径兜底。
- 搜索性能：索引按 `doc/sessions/workspaces/archived` memo 化；上限 20；不扫描 DOM。
- 409：沿用 V1 队列/冲突 UI，不新增合并。

**回退**：宽度模块可整体不挂载（把手不渲染）即恢复官方；搜索组件可隐藏；组拖可通过不设置 `draggable` 关闭。三项均不改变分组数据格式。
