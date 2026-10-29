# DSH 全局会话分组视图 — V1/V1.1 方案（已对齐）

- 状态：V1 已交付（0.1.0）；**V1.1 已实现（0.2.4，2026-10-29）：左栏宽度、分组拖拽、会话搜索、官方侧栏排版对齐、单按钮视图切换/header 操作区/主题感知 surfaces、未归组列表虚拟化、拖拽行高插入占位与乐观 drop 提交**；待用户验收后才安装 desktop profile
- 日期：2026-10-18（V1）；2026-10-28（V1.1 增补）；2026-10-29（0.2.3 虚拟化 patch；0.2.4 占位/乐观提交 patch）
- 仓库：`C:\Users\Momiji\Projects\dsh-session-groups`
- 目标宿主：DSH Desktop 2.0.18 / DSH 0.2.1-rc.2
- 工作名：`dsh-session-groups`（显示名：全局会话分组）

## 1. 一句话

在 DSH 左侧栏增加一个**只服务显示层的全局会话分组视图**：分组记录独立存放，不改会话标题、不搬会话日志、不改工作区注册表；用户可以把任意工作区的会话拖进任意分组，重命名/归档仍由宿主消费。

## 2. 已锁定的决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | 视图形态 | **A：左栏模式切换**。分组视图激活时接管 `sidebar.workspaces`；切回时 dispose，官方工作区浏览器原样恢复。默认仍显示官方视图。 |
| D2 | 与宿主数据的关系 | 分组只写独立记录文件；会话标题、cwd、日志、`workspace.json` 一律不因分组操作改变。 |
| D3 | 重命名 | 调用宿主 `session.rename`；视图订阅宿主标题，不建第二标题。 |
| D4 | 归档 | 调用宿主归档动作；视图读取 `archivedSessionIds`（数组，`includes`），只做三态筛选，不复制归档状态。运行中会话归档会被宿主以 `workspace/session-active` 拒绝；V1 弹确认框列出 turn/subagent/job/schedule 活动，确认后 `stopActivity:true` 强制归档，取消则不动。 |
| D5 | 删除 | 本视图不提供会话删除；DSH 没有 session delete API。分组删除是非破坏性的。 |
| D6 | 分组与工作区 | 分组**没有工作区概念**。组内 `+` 打开我们自己的「预创建工作区菜单」：默认推断（同质→该工作区；混合/空组→当前会话工作区），菜单列出全部工作区供用户切换；选定后 `uiWorkspace.startSession(id)` 创建并导航，通过 sessions 快照 diff 捕获新 id（60×50ms），再放组首。`connectWorkspace` 可能复用已有 blank，只作 fallback 且仅接受未被任何组/未归组占用的 id。不依赖宿主 hero 新建界面切换工作区。**blank 是宿主临时占位，重启后可能换 id；不承诺 blank 归属跨重启保留。** |
| D7 | 其他面板新建的会话 | 进入顶部「未归组」收件箱，最新在前，永久保留到被拖走；不自动 pin。 |
| D8 | 分组能力 | 任意嵌套（建议 ≤4 层）、同级拖拽排序、拖组时子树跟随；**V1.1 已实现拖拽改父级**（V1 仅菜单），组菜单「上移/下移」兜底。 |
| D9 | 颜色/图标 | V1 用插件自带的 8 个 16px inline SVG 图标（不绑定宿主图标集版本），颜色 P2。 |
| D10 | 存储 | 独立文件 `dshHomePath('storages')/dsh-session-groups.json`（尊重 `$DSH_HOME`）；V1 用自带原子写 JSON + `.bak` + 写入串行（Host spike 已实测 409/坏文件/重启）；storageDomain 作为 P1 备选，避免信封格式影响可读/可备份。本机、单窗口 V1；跨设备 P2。 |
| D11 | 竖线 | 跟组内容高度（含子组），不是撑满视口剩余高度；空组 24px stub。 |
| D12 | 搜索 | **V1.1 已实现**标题/工作区/组路径下拉搜索（归档置灰、选中展开祖先并滚动高亮）；全文搜索仍 P2。 |

## 2.1 V1.1 增补（0.2.0，2026-10-28；0.2.1 排版 patch；0.2.2 UI layout patch；0.2.3 虚拟化 patch；0.2.4 占位/乐观 patch；0.2.5 图标/诊断 patch；0.2.6 颜色/选择对话框 patch）

| # | 变更 | 结论 |
|---|---|---|
| V1.1-1 | 左栏宽度 | 分组视图内可拖 **264–760px**（至少给主内容留 480px），默认 420，双击复位；仅 `groups + wide` 生效，官方视图/rail 恢复官方宽度。**取代 §4 旧“264–420px”描述**；官方布局包自身 clamp 仍为 264–420，本插件不改宿主包。 |
| V1.1-2 | 分组拖拽 | 补齐 D8：组头拖拽同级排序/改父级，落点即最终父级+序号，子树跟随，禁止自身/后代；组菜单新增「上移/下移」键盘/无鼠标兜底。折叠组不提供子组落点（需先展开）。 |
| V1.1-3 | 会话搜索 | 补齐 D12：header 搜索图标展开第二行搜索框，匹配标题/工作区/组路径；结果最多 20 条，归档项置灰不可打开；选中普通会话则打开、展开所在组+全部祖先、滚动并高亮；只读，不写分组记录。 |
| V1.1-4 | 排版/间距对齐（0.2.1/0.2.2） | 分组视图消费宿主继承的 font-family/font-size（官方侧栏基线 14px），**不提供插件字号设置、不新增配置**；固定尺寸走官方 `--dsw-font-*` token/px fallback；组行 34/会话行 32、标题 14/20、操作图标 16（rail 18）；间距按官方 chrome：行 `0 8px`/gap 6、树/组体 2px 纵距、组缩进 10/10、header `4 4 4 2`/row gap 8（收起 36px，展开搜索 74px）、搜索/菜单/对话框放大 padding，264px 无溢出。E2E step 16 以 computed style 验收。 |
| V1.1-5 | UI layout（0.2.2，已被 0.2.3 部分取代） | footer 改为两段（分组视图/工作区视图，16px 图标 + 13px/28 文本，active accent，点击各自 `setMode`）；header 右侧 `+`/搜索/视图选项（28×28），归档三态移入 view-options popover（3×30px + check）；菜单/搜索下拉/对话框/输入使用官方主题 token，深色主题无白底；正常 header 移除「返回工作区」。 |
| V1.1-6 | UI 回退 + 虚拟化（0.2.3） | **footer 回退为单个 28px 按钮**：点击切换分组/工作区，图标与文案随目标视图变化（16px glyph、13px 文本），当前态写入 `data-mode`/`title`/`aria-pressed`；rail 为 28px 图标按钮。**header 右侧顺序对齐官方工作区段头：search → view-options → plus**。**未归组列表虚拟化**：固定行高 32 + 2px gap + 34px 段头，按 `.dsg-tree` 视口 + overscan=8 只渲染可见行，top/bottom spacer 精确保留总高；搜索选中窗口外未归组行先强制滚入窗口再高亮。真实 home 的 1,639 个 session 目录中仅 ~96 个 root（1,474 个 subagent 被过滤），实际可见未归组 **10**；1,500 行场景用 QA 大列表 fixture 验证（DOM 行数 1,510→20，见 TEST-RESULTS）。 |
| V1.1-7 | 拖拽占位 + 乐观提交（0.2.4） | **插入占位**：有效落点渲染真实行高占位（session 32px / group 34px，accent 背景 + 虚线边框 + 「放到这里」/目标名），覆盖 session-before/after、group-before/after、child slot（6→34px）、group-append（展开组体末尾 / 收起组头后）、ungrouped、root-end；后续行物理下移，dragleave/drop/dragend 清除；264px 无溢出。**乐观提交**：drop 当帧按当前乐观 doc dispatch，revision 保持确认值；单写者队列合并快速移动，成功 reconcile、失败/冲突回滚 + 既有 toast；非乐观 doc 提交先 flush 再按最新 doc 执行。footer 文案精确为「切换到自由分组视图」/「返回默认工作区视图」；header title 去 600 → 400（官方 section label 14/20）。 |
| V1.1-8 | 官方 header 图标 + 拖拽诊断（0.2.5） | **图标**：header search/view-options/new-group 改用 DSH Desktop 2.0.18 primitives 原始 artwork（`IconSearchOutlineRegular` / `IconSlidersTwoOutlineRegular` / `IconProjectAddOutlineRegular`，16px、1px stroke，顺序不变），不再用自定义近似图形。**诊断**：默认开启的客户端事件环（native+plugin+timer/render/context）+ `POST /dsh-session-groups/diagnostics` 追加 NDJSON 到 `storages/dsh-session-groups.diagnostics.ndjson` + ≤4Hz 纯 DOM HUD + `scripts/qa/analyze-drag-trace.mjs`；`localStorage['dsh-session-groups.diagnostics']='0'` 可关闭；只写诊断文件，不碰官方数据。 |
| V1.1-9 | 分组颜色 + 选择对话框（0.2.6） | `Group` 新增**可选** `color`（`blue/green/orange/red/purple/gray`，默认 `blue`；旧文档缺省按蓝显示，commit 归一化蓝落盘；`DOC_VERSION` 不变）+ `setGroupColor` + 分组菜单「颜色」色板对话框；组行图标/子组引导线使用所选颜色。header 标题与 accent 同 primary accent；行 hover 操作按钮 16→28px（glyph 16/gap 4）；组引导线移到父 caret 尖端（x=16、2px、content padding 4、缩进仍 20/级）。icon/move-session/move-group/new-session/group-color 五类对话框统一「点击只高亮 + footer Confirm/Cancel」；输入/删除/归档对话框不变。 |

V1.1 明确不做：图标上传、撤销、置顶徽标、折叠组聚合计数、多窗口实时合并、全文搜索、跨设备同步、宿主布局包修改。

## 3. 平台硬约束（必须记住）

- `sidebar.workspaces` 是 **single slot**；官方工作区浏览器占着它。没有 additive 的“第二个左栏列表”槽位。
- 插件可以用更低 `priority` 接管；dispose 后官方占用者立即回来。已有 `dsh-workspace-categories` 用这个机制做过“自定义树 ⇄ 官方列表”。
- 因此 A 形态下，分组视图激活时官方工作区浏览器的这些 UI 暂时不可见：搜索、添加工作区、重命名/删除工作区、视图选项。用户通过「返回工作区」切回。
- 官方工作区浏览器的组件没有导出，不能把它嵌进我们的 Tab；不要尝试同屏双列表。
- 会话是全局可读的：`useSessions` / `useWorkspaces` / `archivedSessionIds`（数组，`includes`）/ `useSessionStatus`（Map）；subagent 判定用 `origin === 'subagent'`，不要用 `parentId`（fork 血缘）。
- 新建会话走 `uiWorkspace.connectWorkspace(workspaceId)`：返回 session id、**不导航**；`uiWorkspace.startSession` 返回 void。组内 `+` 用我们自己的预创建工作区菜单，不依赖宿主 hero 切换。
- 独立记录文件放 `dshHomePath('storages')`；JSON 后端单次整单元重写、原子替换，但**没有跨进程写锁**，所以 V1 单窗口 + revision。
- 当前真实数据（2026-10-29 read-only 测量）：3 个工作区、1,639 个 session 目录，但 `workspace.json` 只登记 85 个会话（59 归档、当前分组记录 2 组 / 4 会话）；1,639 个目录中 1,474 个是 subagent（UI 过滤），仅 ~96 个 root，因此**实际可见未归组约 10 行**。0.2.3 仍按 1,500+ 行设计：未归组列表窗口化，DOM 行数不随逻辑行数增长；组树保持完整（真实分组数量小）。

## 4. 信息架构

```
侧栏（宽态）
┌─────────────────────────────┐
│ 品牌 / 新建会话              │
│ 插件 / 插件市场 / ...        │  ← 官方项不动
│─────────────────────────────│
│ 分组                     [🔍][☰][+] │  ← 标题 + search/view-options/plus（官方段头顺序）
│ [🔍 搜索会话…]  (按需展开)          │
│                             │
│ 未归组 (1,500)              │  ← 收件箱，最新在前；窗口化只渲染可见行
│   ○ 会话 A        [工作区X] │
│   ○ 会话 B                  │
│                             │
│ ▾ 🗂 施工中 (5)          +  │  ← 组头：图标/名称/计数/新建
│ │   ▾ 🗂 子组 (2)        +  │
│ │   │   ○ 会话 C            │
│ │   │   ○ 会话 D            │
│ │   ○ 会话 E                │
│ │   ○ 会话 F                │
│ │                           │  ← 竖线跟随内容高度
│ ▾ 🗂 已完成 (2)          +  │
│ │   ○ 会话 G                │
└─────────────────────────────┘
底部：[→ 工作区视图] 单个 28px 切换按钮（图标/文案指向目标视图）
```

- 宽态侧栏 **264–760px**（V1.1 取代旧 264–420；主内容至少 480px，超出视口时可拖上限自动收窄；默认 420，双击把手复位）；56px rail 只显示展开按钮，不渲染分组树，也不做宽度覆盖。
- 组头：折叠箭头、固定图标、名称、计数、`+`、`…` 菜单。
- 子组排在会话上方；V1 不做交错。
- 竖线：组内容容器左侧 1px 低对比线，从组头下缘到最后一项；每级缩进 12px；空组 24px stub；折叠时隐藏。
- 当前会话高亮；运行/待交互/完成状态点复用宿主状态。

## 5. 交互规则

### 5.1 建组 / 改名 / 删组 / 嵌套

- 新建：视图头「新建分组」或组菜单「新建子分组」；输入名称，可带 `/` 建嵌套？V1 用对话框选父组 + 名称，避免标题前缀解析。
- 改名：双击组名或菜单；同级允许重名，菜单/tooltip 显示父路径。
- 删组：确认框显示“子组将提升、N 个会话移到父级/未归组”，不删会话、不归档。
- 嵌套：菜单「移动到分组…」选父组；**V1.1 支持拖拽改父级**（组体子组缝隙/组头上下缘/未归组头）。环检测：不能移入自身后代。
- 排序：同级拖拽（上/下半区），子树跟随；**V1.1 组菜单「上移/下移」已实现**（首/尾禁用）。
- 图标：固定图标集（16px 宿主图标），新建时可选，默认文件夹；不做上传。

### 5.2 会话拖拽与吸附

统一 drop target：

| 落点 | 行为 |
|---|---|
| 会话行上半/下半 | 插到该行前/后，归入该行所在组 |
| 组头（展开/折叠） | 追加到该组末尾；折叠组 500ms 后自动展开 |
| 「未归组」头/空白 | 移出分组，进入未归组 |
| 无效目标（自身、后代） | `not-allowed`，不写入 |

- 视觉：2px 品牌色插入线 + 目标组浅色高亮 + 浮动标签「放入『组名』」；Esc 取消；拖到视图外 no-op。
- 跨工作区允许；这是本插件的核心差异。
- 右键「移动到分组…」是键盘/误拖兜底，P0。
- 组内顺序、组顺序、未归组顺序都持久化；不使用时间排序覆盖手动顺序。

组拖（V1.1）：

| 落点 | 行为 |
|---|---|
| 组头上缘/下缘（各 25%） | 插到该组前/后，父级=该组父级 |
| 组体子组缝隙（n 个子组 = n+1 个槽） | 成为该组子组，插入槽序号；与组内是否有会话无关 |
| 未归组头 | 移到根级末尾 |
| 自身/自身后代 | 禁止态，不显示插入线；折叠组不提供子组槽 |

- 组拖沿用 `moveGroup` 的环/深度校验与 commit 队列；落点与当前位置相同显式跳过，不产生 no-op revision。
- 组头单击仍折叠/展开；拖动结束抑制下一次 click；`+`/`…` 不触发拖拽。

### 5.3 组内新建

- 组头 `+` 打开**我们自己的预创建工作区菜单**：默认推断（同质→该工作区；混合/空组→当前会话工作区）；菜单列出全部工作区，用户可切换；没有可用工作区时提示先添加工作区/切回工作区视图。
- 选定后 `uiWorkspace.startSession(workspaceId)` 创建并导航；通过 sessions 快照 diff 捕获新 id（60×50ms），`openSession(id)` 后放组首。`connectWorkspace` 只作 fallback，且仅当返回 id 未被任何组/未归组占用；不依赖宿主 hero 新建界面。
- blank 是宿主临时占位：重启后可能被丢弃并分配新 id。V1 不自动把新 blank 塞进旧组；旧 blank 成为孤儿隐藏，新 blank 按 D7 出现在未归组顶部。
- 如果当前归档筛选是「仅已归档」，创建后切到「全部」并 toast 说明。
- 失败：toast；不写分组记录。

### 5.4 归档 / 重命名 / 删除

- 归档三态：隐藏已归档（默认）/ 全部 / 仅已归档；读宿主集合；筛选状态存本地 view state。
- 组不因筛选消失：无可见会话时显示「无可见会话 / 无归档会话」空态行。
- 归档会话保留组归属；取消归档回原位置；归档行不可打开，提供取消归档。
- 运行中会话归档：宿主返回 `workspace/session-active`，弹确认框列出 turn/subagent/job/schedule，确认后 `archiveSession(id,{stopActivity:true})`；取消则不动。
- 重命名：宿主 `sessions.using(id,{source:'workspaceOperation'}, ref=>ref.binding.session.rename(title))`；自动标题变化实时反映；本视图无删除入口。
- 别处删除/失联：记录保留但隐藏；P1 提供清理入口，不因孤儿崩。

### 5.5 未归组 / 悬浮标签

- 未归组在顶部，可折叠；`ungrouped` 只存“显式未归组”的手动顺序；新出现且未归组的 session 由派生规则前插，最新在前；打开视图不写盘，首次拖拽/排序才写。
- 标记“新”直到打开。
- hover/focus 会话行右侧出现工作区标签；tooltip 全路径；无工作区显示“无工作区”；280px 下截断不遮标题。
- 混合组建议常显标签 P1。

### 5.6 未归组虚拟化（0.2.3）

- 未归组是唯一可能达到 1,500+ 行的区域；组树保持完整渲染（真实分组数量小）。
- 固定度量：会话行 32px、行 gap 2px、段头 34px；视口取 `.dsg-tree` 的 `clientHeight/scrollTop`，`listTop` 由段体 rect 实时测量，overscan=8。
- 只渲染 `[start,end)` 窗口；`start*34` 与尾部 `tail*34-gap` 的 top/bottom spacer 精确保留 `total*34-2` 的总高（滚动条长度/滚动位置不跳）。
- 搜索选中窗口外未归组会话：先 `scrollToIndex(index)`（把目标放到视口 30% 处）再走原有 rect 滚动/1.5s 高亮；目标在折叠的未归组里时，等段体挂载后重试（最多 8 帧）。
- 拖拽/归档筛选/工作区徽标/当前会话高亮全部沿用完整 `tree.ungrouped` 逻辑顺序；只影响 DOM 行数，不改数据/记录。
- 纯函数 `computeVirtualWindow`/`virtualScrollOffset`（`src/client/virtual-list.js`）+ 单元测试；大列表 probe 验证 1,500 行下 DOM 行数 <80、搜索窗口外 reveal、可见行拖放。

## 6. 数据模型（详见 `docs/CONTRACTS.md`）

```json
{
  "version": 1,
  "revision": 42,
  "groups": [
    {
      "id": "g1",
      "name": "施工中",
      "icon": "folder-open",
      "parentId": null,
      "sessionIds": ["s1", "s2"]
    }
  ],
  "ungrouped": ["s3", "s4"]
}
```

- 一个 session 最多属于一个组；`sessionIds` 数组顺序即显示顺序。
- 组没有 workspace 字段；`+` 的工作区是运行时推断。
- 只存 session id、组名、图标、父子关系、顺序；不存标题、路径、归档状态。
- `revision` 每次 mutation +1；客户端带 baseRevision，冲突 409 + 重新拉取。
- 原子写：temp + rename；保留 `.bak`；schema version 迁移；坏文件重命名后空启动并提示。

## 7. 宿主动作映射

| 视图动作 | 宿主动作 | 说明 |
|---|---|---|
| 打开会话 | 宿主 open session | 不改归属 |
| 重命名 | `sessions.using(id,{source:'workspaceOperation'}, ref=>ref.binding.session.rename(title))` | 视图只读标题 |
| 归档/取消归档 | `uiWorkspace.archiveSession(id,{stopActivity:true})` / `unarchiveSession` | 视图读 `archivedSessionIds`（数组） |
| 组头 `+` 新建 | `uiWorkspace.startSession(workspaceId)` + sessions 快照 diff 捕获 id | `connectWorkspace` 仅 fallback；blank 重启换 id 不承诺归属 |
| 置顶/取消置顶 | 宿主 pin | 视图显示 pin 徽标，不改变组内手动序（P1） |
| 删除会话 | 不提供 | 宿主无 delete API |

## 8. V1 范围

### P0（必须交付）

1. 左栏模式切换 + 视图壳 + rail + 失败扁平回退。
2. 分组 CRUD/名称/固定图标/嵌套（菜单）/同级拖拽排序/折叠/竖线。
3. 会话跨工作区拖入/移出/组内排序 + 统一吸附 + 菜单兜底。
4. 归档三态筛选。
5. 宿主重命名 + 本视图无删除 + 孤儿安全。
6. 未归组收件箱 + 其他面板新会话置顶。
7. 组头 `+` 新建（工作区推断 + 可切换）。
8. 悬浮/focus 工作区标签。
9. 持久化/revision/原子写/备份/损坏降级。
10. 可见性/当前高亮/运行状态点/空态/错误态。

### P1（建议，不阻塞 V1）

- **V1.1 已交付：拖组改父级、标题/工作区/组路径搜索、组菜单上移/下移。**
- 撤销上次移动。
- 分组颜色。
- 折叠全部。
- 多窗口冲突提示。
- 混合组常显工作区标签。
- 批量移动。
- 组头折叠状态下的待审批/运行计数。

### P2（暂缓）

跨设备同步、AI 自动分组、自定义图标上传、全文搜索、触屏、分组模板、按时间排序切换、会话删除。

## 9. 验收

在 3 工作区、34–36 条 session 条目（真实 home 当前量级）的**隔离 home 夹具**上：

1. 建 3 组，其中 1 个二级嵌套。
2. 10 个跨工作区会话拖入/拖出/排序。
3. 同级拖拽调整组顺序。
4. 切换归档三态。
5. 组内 `+` 打开预创建工作区菜单，确认默认推断正确、可切换工作区，创建后落组第一行且无孤儿 blank。
6. hover/focus 看到工作区标签。
7. 重启应用，结构/顺序/筛选保持。
8. 一键切回官方工作区视图，官方功能原样。
9. 审计：会话标题、工作区归属、`workspace.json`、session 日志未因分组操作改变；只写 `dsh-session-groups.json`。

V1.1 加验（19 步 E2E，0.2.6）：

10. 左栏宽度 264–760：官方宽度进入前记录、切回后一致；reload/rail/双击复位；264px 头部无水平溢出且单个 footer 按钮标签可见、rail 28px 图标。
11. 组拖：同级排序/跨父改父级/空组与 0 子组槽/根末尾/自身后代无效/快速双拖/菜单上移下移/子树跟随；no-op 不涨 revision。
12. 搜索：折叠组显现（展开祖先+滚动+高亮）、归档置灰、无结果空态、Esc/点外关闭、搜索不写记录。
13. 排版：`getComputedStyle`/rect 断言根字号继承宿主（14px 基线）、组行 34/会话行 32、标题 14/20、徽标 12、搜索框 13/30、图标 16；无插件字号设置。
14. UI layout/主题：footer 单按钮图标/文案随模式变化、header **search → view-options → plus** 28×28 与顺序、view-options popover 3×30 行；深色主题下搜索/菜单/对话框/输入 computed 背景非白且对比度 ≥4.5。
15. 虚拟化大列表 probe：1,500+ 逻辑未归组行下 DOM 行数 <80、滚动高度保持、窗口外搜索 reveal、可见行拖放；before/after 行数与耗时见 `docs/TEST-RESULTS.md`。
16. 占位/乐观：九类插入点均渲染 32/34px accent 占位、后续行下移、dragleave 清除、264px 无溢出；CDP Fetch 挂起 commit 时 drop 后 DOM 已移动且记录 revision 未变，放行后 revision 前进、顺序保持。
17. 官方图标/诊断（0.2.5）：header 三图标几何与 2.0.18 primitives 一致（16px/1px）；HUD 可见且 `pointer-events:none`、native dragover/chg/rend 计数非零；`POST /dsh-session-groups/diagnostics` 在隔离 home 的 `storages/dsh-session-groups.diagnostics.ndjson` 追加 `runId/schemaVersion` 行，含 native/handler/optimistic 事件，且记录文件/官方数据不变。
18. 分组颜色/选择对话框（0.2.6）：分组菜单「颜色」→ 6 色板、当前色高亮；点击只高亮（不关框/不写记录），Cancel 不变，Confirm 后行 `data-color`/图标颜色/记录 color 一致；icon/move-session/new-session 对话框同样先高亮后 Confirm，Escape/backdrop 关闭不变；header 标题与 accent 同 primary accent；行操作 28×28；组引导线在父 caret 尖端（2px）。

通过标准：V1 9 步 + V1.1 3 组全过；20 次拖拽误放 ≤1；0 次丢会话/重复行；0 次标题被分组操作改写；坏文件/路由失败不白屏。

## 10. 风险与 Gate

| 风险 | 缓解 |
|---|---|
| A 形态官方 UI 暂时不可见 | footer 单个常驻切换按钮（图标/文案指向目标视图）+ 首次提示；用户已接受 |
| rc.2 API 未实测 | Gate 0 可丢弃 profile spike；失败则回退 B 或调整 |
| 存储后端 | V1 自带原子写 JSON（已实测）；storageDomain 作为 P1 备选，避免信封/备份差异 |
| profile 不隔离数据 | Gate 0 全部用独立 `DSH_HOME`；夹具只读复制；真实 home 零写入 |
| 运行中归档被拒 | 捕获 `workspace/session-active`；确认后 stopActivity；取消不动 |
| 组内新建换 id/孤儿 blank | 用预创建工作区菜单 + `connectWorkspace` 返回 id，不走宿主 hero 切换 |
| 多窗口覆盖 | V1 单窗口 + revision 409 + 提示 |
| 孤儿 session id | 保留隐藏；P1 清理入口 |
| 深嵌套窄栏 | 软上限 4 层；12px/级；省略号 |
| 拖拽误放 | 行高插入占位（32/34px accent 面 + 目标名）+ 高亮/浮动标签 + 菜单兜底 + P1 撤销 |

## 11. 团队

- Lead：契约/集成/验收
- Host 工程师：宿主/存储/路由/动作桥接
- Client 工程师：槽位/树/拖拽/筛选/标签
- QA：单测/集成/E2E/数据审计
- 评审：架构（Gate 0/1/4）、UX（Gate 3）、安全（Gate 4）

## 12. 非目标

- 不移动会话到其他工作区（不改 header/cwd/日志）。
- 不替换/复刻官方工作区浏览器。
- 不做会话删除。
- 不做跨设备同步。
- 不做分组颜色/自定义图标上传（V1 用插件自带 8 个 inline SVG；颜色/上传 P2）。
