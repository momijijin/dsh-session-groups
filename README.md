# dsh-session-groups

DSH 左侧栏的全局会话分组视图：分组只服务显示层，跨工作区组织会话，不改标题、不搬日志、不动工作区注册表。

- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 工作名：`dsh-session-groups`（显示名：全局会话分组）
- 版本：`0.2.6`（V1.1 group color + selection dialogs patch）
- 状态：**V1.1 QA 全绿（0.2.6：248/248 tests、E2E 19/19、diagnostics HUD/route PASS、audit PASS）**，待用户验收；未安装到 desktop profile

## V1.1 新增（0.2.0）

- **左栏宽度**：分组视图内可拖 264–760px（主内容至少 480px），默认 420，双击把手复位；只覆盖分组视图，切回官方/rail 恢复官方宽度，宽度持久化。
- **分组拖拽**：组头拖拽同级排序/改父级，子树跟随，禁止移入自身/后代；组体子组缝隙（n+1 槽）可落为子组；组菜单新增「上移/下移」兜底。
- **会话搜索**：视图头第二行搜索框，匹配标题/工作区/组路径；选中普通会话即打开、展开所在组及全部祖先、滚动并高亮；归档结果列出但置灰不可打开；搜索只读，不写分组记录。

### 0.2.1 排版与间距对齐（patch）

- 分组视图排版/图标对齐官方工作区侧栏：根节点**继承宿主 font-family/font-size**（官方侧栏基线 14px），**没有插件专属字号设置、没有新增配置**；固定尺寸使用官方 `--dsw-font-*` token（带 px fallback）。
- 组行 34px、会话行 32px，标题 14/20；会话工作区徽标 12px、归档徽标 10/16；搜索框 30px/13px、结果标题 14/20；操作图标统一 16px（rail 保持 18px）。
- 间距按官方工作区 chrome 同步放大：行 `padding: 0 8px`、行 gap 6px，树/组体/组线纵向 gap 2px，组缩进 10/10，header `padding: 4px 4px 4px 2px`（0.2.2 单行 36px）+ row gap 8px，搜索/菜单/对话框改用更大 padding（菜单项 30px、对话框 16/12），264px 最小宽度仍无横向溢出。
- E2E step 16 `typography-matches-official-sidebar` 直接断言 computed style、字号/行高/图标、间距与 264px 无溢出（不依赖截图）。

### 0.2.6 分组颜色 + 选择对话框（patch，当前）

- **header 标题**：`分组` 文案与 accent 图标统一使用 primary accent（`--dsw-alias-state-business-primary`），保持 14/20、weight 400 与官方图标/顺序。
- **行操作命中区**：分组/会话行右侧 hover 按钮 28×28（与 header 一致）、glyph 16px、gap 4px；行高仍 34/32，名称/计数继续 ellipsis，264px 无溢出。
- **组引导线**：移到父级 caret 尖端（行 padding 8 + 16px caret → x=16），2px 宽，子内容 padding 4px；每级缩进仍 20px，最大深度/264px 安全。
- **分组颜色**：`Group` 新增可选 `color`（blue/green/orange/red/purple/gray，默认蓝；旧记录无 color 合法并按蓝显示，host commit 归一化蓝落盘；`DOC_VERSION` 不变）。分组菜单新增「颜色」色板对话框；组行图标与子组引导线使用所选颜色。
- **选择对话框**：icon、move-session、move-group、new-session workspace 与 group-color 统一「点击只高亮（`aria-selected`/`aria-checked`），footer 确认/取消才生效」；预选当前/推断值，无有效选择 Confirm disabled；输入/删除/运行中归档对话框保持原行为。
- 保留 0.2.5 诊断（默认开启/HUD/trace）、0.2.4 乐观提交/行高占位、0.2.3 虚拟化、主题/排版契约；`npm test` 248/248、E2E 19/19。

### 0.2.5 官方 header 图标 + 拖拽诊断（patch，历史）

- **官方图标**：header 三个按钮改用 DSH Desktop 2.0.18 `@deepseek-ai/dsh-client-ui-primitives` 的原始 artwork——搜索 `IconSearchOutlineRegular`、视图选项 `IconSlidersTwoOutlineRegular`、新建分组 `IconProjectAddOutlineRegular`（viewBox 0 0 16 16、1px stroke、16px 渲染，几何逐字节复制；顺序仍为 search → view-options → plus）。不再使用自定义 search/sliders/plus 近似图形。
- **拖拽诊断（默认开启）**：新增事件环（上限 4000）与批量上报，覆盖 native `dragstart/dragenter/dragover/dragleave/drop/dragend`（capture+bubble、target tag/testid/sessionId/groupId、clientX/Y、defaultPrevented before/after、trusted）、插件 handler（会话/分组/slot/ungrouped、auto-expand schedule/fire/cancel、dropTarget change、placeholder insert/remove、label change、drop accept、optimistic enqueue/coalesce/send/HTTP/reconcile/rollback、dragend）与 timing（handler ms、rAF frame gap、longtask、React render counters、revision/optimistic、tree counts、viewport/sidebar、build/mode/theme）。
- **落盘**：`POST /dsh-session-groups/diagnostics`（fence + JSON + bounded batch）把 NDJSON 追加到 `<dshHomePath('storages')>/dsh-session-groups.diagnostics.ndjson`；客户端 20 事件/500ms 批量 flush，dragend/visibility hidden 用 `sendBeacon`；只写该文件，绝不碰 `dsh-session-groups.json`/workspace/session 数据。
- **HUD**：固定右下、`pointer-events:none`、纯 DOM 文本、≤4Hz 刷新（不经 React），显示 runId、native dragover 数、target changes、renders、last handler ms、last frame gap、last label、drop/optimistic 状态。默认启用；`localStorage['dsh-session-groups.diagnostics']='0'` 可无重建关闭。
- **分析器**：`node scripts/qa/analyze-drag-trace.mjs <ndjson>` 输出每 run 的事件/handler 计数、target/label 时间线、>100ms gaps、native vs synthetic、auto-expand、placeholder、optimistic/HTTP 相位、最后指针移动后的 burst 与疑似 stall。
- 隐私：日志只含 ID、testid、分组名与翻译后的拖拽提示，**不含会话标题或 transcript**；文件仅在本地 `storages`。

### 0.2.4 拖拽落点占位 + 乐观提交 + 官方 header/footer（patch，历史）

- **拖拽插入占位**：有效落点不再只画 2px 线，而是在插入点插入真实行高占位（会话 32px / 分组 34px）：主题感知 accent 背景 + 虚线边框 + 「放到这里」/目标分组名。覆盖 session-before/after、group-before/after、子组缝隙（6px 槽激活时展开为 34px）、group-append（展开时组体末尾 / 收起时组头之后）、ungrouped 与 root-end；占位真实参与布局，后续行整体下移；dragleave/drop/dragend 立即消失；264px 无横向溢出。testid 沿用 `session-groups-drop-indicator`，新增 `data-drop-height`。
- **乐观 drop 提交**：会话移动、分组移动（拖拽与菜单上移/下移）在 drop 当帧按当前**乐观 doc** 计算并 dispatch，`revision` 始终保持服务端已确认值；HTTP 写入进入单写者合并队列（同 tick 快速移动合并为一个请求，飞行中只追加最新 doc 的下一次写入），成功后 reconcile 服务端 revision/doc，失败/冲突回滚到最近确认状态并沿用既有错误 toast。重命名/归档等非乐观提交先 flush 乐观队列、再在最新 doc 上执行，避免旧快照覆盖新状态。
- **header/footer 官方化**：`.dsg-header-title` 去掉额外 600，改为官方 section label 的 400（保持 14/20）；footer 单按钮文案精确为「切换到自由分组视图」/「返回默认工作区视图」（en 同步），仍为 28px/16px glyph/13px，rail 仅图标。
- 保留 0.2.3 虚拟化、0.2.2 主题感知 surfaces、0.2.1 排版/间距；`npm test` 211/211、E2E 18/18。

### 0.2.3 虚拟化与 UI 回退（patch，历史）

- **footer 回退单按钮**：点击切换分组/工作区，图标（folderAdjust ⇄ grid）与文案（0.2.3 为「分组视图 ⇄ 工作区视图」，0.2.4 改为「切换到自由分组视图 ⇄ 返回默认工作区视图」）随目标变化；28px 高、16px glyph、13px 文本，`data-mode`/`title`/`aria-pressed` 反映当前态；rail 为 28px 图标按钮。0.2.2 两段切换及其 CSS/文案/testid 删除。
- **header 右侧顺序对齐官方工作区段头**：**搜索 → 视图选项（sliders）→ `+` 新建分组**；均 28×28/16px，搜索行仍按需展开，view-options 仍含归档三行。
- **未归组列表虚拟化**：未归组可能达 1,500+ 行；现在只渲染 `.dsg-tree` 视口 + overscan=8 的行（固定 32px 行高、2px gap、34px 段头），top/bottom spacer 精确保留总滚动高度；组树完整渲染。搜索选中窗口外未归组会话会先强制滚入窗口再高亮；拖拽/归档/工作区徽标/当前会话行为不变。
- **实测（同 1,510 行 fixture）**：DOM 未归组行 1,510 → 20；hover 12.2 → 3.8ms、dragover 48 → 20ms、窗口外 search reveal 266 → 193ms、可见行拖放 85 → 60ms；`scrollHeight` 保持 51,616。真实 home 的 1,639 个 session 目录中 1,474 个是 subagent（UI 过滤），实际可见未归组约 10 行。
- 保留 0.2.1 排版/间距与 0.2.2 主题/header 布局；`npm test` 203/203、E2E 17/17。

### 0.2.2 布局与主题（patch，历史；footer 已被 0.2.3 回退）

- **底部两段切换**（0.2.2，0.2.3 已删除）：`分组视图 / 工作区视图` 两段同时显示。
- **header 右侧**（0.2.2 顺序为 `+`/搜索/视图选项；0.2.3 已改为搜索 → 视图选项 → `+`）：搜索图标按需展开 30px 搜索行；视图选项（sliders）28×28；正常 header 移除「返回工作区」（仅错误回退保留）。
- **视图选项 popover**：归档三态 `隐藏已归档 / 全部对话（显示已归档）/ 仅显示已归档` 三行 30px，active 行带 check；点击复用现有 `archive-filter` 并关闭，Escape/点外关闭。
- **标题**：`分组` 14/20 primary 文本 + 16px accent folder 图标。
- **主题感知 surfaces**：菜单/搜索下拉用 `--dsw-specific-menu`，对话框 `--dsw-alias-bg-layer-2`，输入 `--dsw-alias-bg-layer-1`，边框 `--dsw-alias-border-l2/l3`，文本 `--dsw-alias-label-primary/secondary`；深色主题无白色卡片，E2E step 17 以 computed background + ≥4.5:1 对比度断言。
- 保留 0.2.1 排版/间距：header 收起 36px（展开搜索 74px）、搜索 30/13、行 34/32、图标 16、264px 无溢出；无插件字号设置。

V1 能力（建组/嵌套/跨工作区拖会话/归档三态/组内新建/重命名/rail/失败降级）保持。

## 安装

```powershell
npm pack
# 产物：dsh-session-groups-0.2.6.tgz
```

DSH Desktop：设置 → 插件 → 添加插件 → 选择该 `.tgz`（或本地目录），启用后重启/刷新。
不要用 `dsh plugin --profile desktop` 修改 App 管理的 profile；隔离 profile 的验证步骤见 `docs/RELEASE.md` §3。

## 文档

- [V1/V1.1 方案](docs/V1-PLAN.md) — 范围、交互、验收
- [V1.1 设计 spec](docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md) — 宽度/组拖/搜索契约
- [V1.1 实施计划](docs/superpowers/plans/2026-10-28-session-groups-v1.1.md)
- [契约](docs/CONTRACTS.md) — 数据模型、路由、API、testid、生命周期
- [Gate 0 Spike](docs/SPIKE.md) / [Gate 0 结论](docs/GATE0-SUMMARY.md)
- [测试计划](docs/TEST-PLAN.md) — 单测/宿主集成/19 步 E2E/数据审计
- [V1/V1.1 测试结果](docs/TEST-RESULTS.md) — 19/19 E2E、248/248、诊断 trace/HUD、大列表 before/after、审计与打包证据
- [发布说明](docs/RELEASE.md) — 构建/打包/安装/卸载/已知限制
- [ADR-001 左栏模式切换](docs/adr/0001-sidebar-mode-switch.md) / [ADR-002 分组存储](docs/adr/0002-group-storage.md) / [ADR-003 路由围栏](docs/adr/0003-route-fence.md)

## 关键约束

- 分组只写 `dshHomePath('storages')/dsh-session-groups.json`；不写 `workspace.json`、session 日志、`cordis.patch.yml`。
- 重命名/归档/新建全部走宿主服务；运行中归档需确认后 `stopActivity:true`。
- 组内新建用插件自己的预创建工作区菜单，不依赖宿主 hero 切换。
- 宽度覆盖依赖宿主布局 DOM，找不到 frame/sidebarRoot 时 fail-soft（只隐藏把手，分组/搜索正常）。
- Gate 0/测试必须使用独立 `DSH_HOME`（`.spike-homes/<agent>`）；`dsh.cmd` 硬编码真实 home，不能直接用。

## 当前阶段

- V1 实现完成；V1.1（0.2.6）完成左栏宽度、分组拖拽排序/改父级、会话搜索、官方侧栏排版/间距/图标对齐、单按钮视图切换/header 操作区/主题感知 surfaces、未归组列表虚拟化、拖拽行高占位与乐观提交、官方 header 三图标 + 拖拽诊断 trace/HUD/分析器、**分组颜色与统一选择对话框**。
- 验证：`npm test` 248/248；官方 E2E 19/19（默认诊断开启；含 step 2/16 footer 文案与 header title accent/400、step 16 排版/间距/28px 行操作/2px 组引导线/264px/虚拟窗口、step 17 深色主题、step 18 九类占位 + 乐观 DOM 位移 + HUD、step 19 分组颜色与五类选择对话框）；E2E runner 另验证 `/dsh-session-groups/diagnostics` 在隔离 home 追加 NDJSON（native/handler/optimistic 齐全）；数据审计只写记录文件、诊断文件按 append-only 单独放行；真实 `~/.dsh` 零写入。
- **尚未安装到用户 desktop profile**；等待用户验收后再安装。
- 已知限制见 `docs/RELEASE.md` §5（运行中归档 BLOCKED-ENV、宽度 DOM 依赖、搜索范围、诊断文件增长、P1/P2 未实现项）。
