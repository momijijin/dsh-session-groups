# V1/V1.1 测试计划

- 目标：证明“分组只改视图、不改宿主数据”，同时证明拖拽/嵌套/筛选/新建在真实 DSH 中可用；V1.1 追加证明左栏宽度、分组拖拽、会话搜索、官方侧栏排版对齐；0.2.4 追加证明拖拽行高插入占位与乐观 drop 提交（HTTP 未完成前 DOM 已移动）；0.2.5 追加证明官方 header 图标几何与拖拽诊断（HUD + NDJSON 落盘 + 分析器）；0.2.7 追加证明行 meta 布局、自定义颜色与右键/键盘菜单；0.2.8 追加证明官方会话状态（6 互斥 + subagents 次要）、空组 drop box 与单实例拖拽 label
- 负责人：QA（计划、证据、验收结论）；Host/Client 各写自己模块的测试；Lead 做最终审计
- 环境：先用独立 `DSH_HOME`（`.spike-homes/qa`）+ `groups-spike` profile，再 desktop profile 人工验收；profile 不隔离 `sessions/`/`storages/`，禁止用真实 `~/.dsh` 跑 E2E
- 关联：`docs/V1-PLAN.md`、`docs/CONTRACTS.md`、`docs/SPIKE.md`、`docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md`

## 1. 测试分层

| 层 | 工具 | 范围 | 归属 | 运行频率 |
|---|---|---|---|---|
| 单元 | Node `node --test` | `src/shared/model.js` 纯函数 | Host/Client 写，QA 审 | 每次提交 |
| Host 集成 | Node `node --test` + 临时目录 | 存储、原子写、revision、路由围栏 | Host | 每次提交 |
| Client 逻辑 | Node `node --test` | 可见性、筛选、工作区映射、拖拽 hit-test | Client | 每次提交 |
| E2E | Playwright（Chromium/CDP） | 真实 DSH web profile：建组/拖拽/归档/新建/重启 + V1.1 宽度/组拖/搜索/排版/深色主题 + 0.2.4 占位/乐观提交 + 0.2.5 HUD/诊断落盘 + 0.2.6 分组颜色/选择对话框 + 0.2.7 行 meta/自定义色/右键菜单 + 0.2.8 官方状态/空组 drop box/单实例拖拽 label（21 步 + 1 个非步骤持久化校验） | QA | 每日/合并前 |
| 诊断 trace | Node `node --test` + `analyze-drag-trace.mjs` | 环/flush/beacon/HUD、NDJSON 解析、target/label/gap/native/autoexpand/placeholder/optimistic/burst/stall | Client/QA | 每次提交 |
| 大列表 probe | Node CDP 脚本 | 1,500+ 未归组行：DOM 行数、初始/滚动/hover/dragOver/search/drop 耗时 | QA | 0.2.3 及后续性能改动 |
| 人工验收 | 清单 + 截图 | desktop profile 9 步 | QA + 用户 | 发布前 |
| 回归审计 | 脚本 + hash | 只写记录文件 | QA | 每次 E2E |
| 性能 | 合成大列表 QA home + CDP probe | 1,500+ 未归组行 | QA | 0.2.3 起每次性能相关提交 |

## 2. 单元测试矩阵（shared model）

文件：`tests/unit/model.*.test.js`

| ID | 用例 | 断言 |
|---|---|---|
| U1 | `createGroup` 根组/子组 | 新 id、parentId、顺序正确 |
| U2 | `renameGroup` trim/空名/80 字符 | 空名拒绝；超长截断或拒绝（契约定） |
| U3 | `deleteGroup` 有子组/有会话 | 子组提升；会话移到父组头/未归组头；无删除 |
| U4 | `moveGroup` 同级前/后、跨父级 | 顺序正确；子树跟随 |
| U5 | `moveGroup` 移入自身/后代 | 返回错误或原 doc；无环 |
| U6 | `assignSession` 从组 A 到组 B | 旧组移除；新组指定 index；不重复 |
| U7 | `assignSession` 到未归组 | 从所有组移除；ungrouped 插入 |
| U8 | `removeSession` 不存在 | 幂等，不抛 |
| U9 | `validateDoc` 重复 session、环、坏 parentId、坏 icon | 每条返回明确错误 |
| U10 | 孤儿 session id | 保留在 doc；`buildRenderTree` 不渲染 |
| U11 | 归档三态 | hidden/all/only 的可见集合正确 |
| U12 | 空组/全归档组 | 组仍渲染；`emptyVisible` 为 true |
| U13 | `inferWorkspaceId` 同质/混合/空组/无当前会话 | 返回规则符合 D6 |
| U14 | 工作区映射 | 每个 session 映射到 workspace；无归属返回 null |
| U15 | 顺序稳定性 | 同 doc 重复构建，输出一致 |

## 3. Host 集成

文件：`tests/host/*.test.js`

| ID | 用例 | 断言 |
|---|---|---|
| H1 | 首次 load 无文件 | 返回空 doc revision 0 |
| H2 | commit 写入 | 文件存在；revision+1；内容一致 |
| H3 | 旧 baseRevision | 409；返回当前 doc；不覆盖 |
| H4 | 非法 doc | 422；文件不变 |
| H5 | 原子写 | 临时文件不残留；`.bak` 存在 |
| H6 | 坏 JSON | 隔离为 `.corrupt-*`；返回空 doc + warning；不崩 |
| H7 | 版本过高 | `unsupported-version`；不覆盖 |
| H8 | 并发 commit 串行化 | 第二个拿到新 revision 或 409 |
| H9 | 路由围栏 | 非 loopback/坏 Origin 拒绝 |
| H10 | 只写记录文件 | `workspace.json`/session 日志 hash 不变 |
| H11 | 诊断路由（0.2.5） | 200 append；405/415/422/413 矩阵；追加不截断；只创建 `dsh-session-groups.diagnostics.ndjson`，记录文件不存在；fence 503 |

## 4. Client 逻辑

文件：`tests/client/*.test.js`

| ID | 用例 | 断言 |
|---|---|---|
| C1 | 过滤 subagent/blank | 默认树不含；当前/新建 blank 例外 |
| C2 | 归档筛选 + 组空态 | 组不消失；空态行出现 |
| C3 | 拖拽 hit-test：上/下半、组头、未归组、空白 | 返回正确 drop target |
| C4 | 拖拽非法目标：自身/后代/只读 | `not-allowed` |
| C5 | 折叠组悬停展开 | 500ms 后展开；离开取消 |
| C6 | 当前会话自动展开 | 打开视图时祖先组展开 |
| C7 | 未归组新 id 前插 | 最新在前；不重复 |
| C8 | 新建推断工作区 | 同质/混合/空组符合 D6 |
| C9 | 工作区标签 | 正确标题/路径；无归属显示“无工作区” |
| C10 | 失败降级 | load 失败渲染扁平列表 + banner |
| C11 | 左栏宽度（V1.1） | `clampSidebarWidth` min−1/min/max/max+1/窗口过小（返回 null）；存储键/默认 420/非法值回退/存储抛错不崩；覆盖只在 groups+wide，卸载/rail/官方恢复；**窄视口双击复位持久化 420（非 clamp 值），放宽后恢复 420；快速释放时 applied=stored** |
| C12 | 分组拖拽（V1.1） | `resolveGroupDrop` 同父前/后、跨父 child、有会话但 0 子组/空组=0 号槽、根末尾；同父移除后下标 −1；自身/后代 invalid；最新 `childrenOf` 重算锚点；no-op 不提交；**组 `+` 的 pointerdown 起点守卫（真实指针拖拽不产生 drag/drop 提交）；中间 50% invalid；同位置 after no-op；组菜单 move-up 启用路径** |
| C13 | 会话搜索（V1.1） | `buildSearchIndex` 排除 subagent、标题/工作区/组路径、归档标记；`matchSessions` 前缀优先/大小写/空查询/20 上限/稳定排序；`revealSession` 展开所在组+全部祖先、未归组 `__ungrouped__`、已展开同引用；**`buildSearchIndex(null)` 容忍；仅 `collapsed[id] === true` 视为折叠；blank/untitled 的英文别名匹配（显示仍本地化）** |
| C14 | 未归组虚拟化（0.2.3） | `computeVirtualWindow` 空列表/顶部/中部/底部/小列表/overscan/自定义行高 gap/非法输入；**top+bottom spacer 精确等于 `total*34-2`**；1,500 行窗口 <80；`virtualScrollOffset` 居中且 clamp 到最大滚动；`isVirtualIndexVisible` 边界 |
| C15 | 乐观提交队列（0.2.4） | `commitOptimistic` 同步 dispatch 且 revision 不变；同 tick 合并为 1 个请求且携带最新 doc；飞行中 drop 串行追加、baseRevision 用最新确认 revision；成功 reconcile；失败/409 回滚到 `lastConfirmed` + 既有 toast（错误 `reported`）；`commitStrict` 先 flush 乐观队列、锁内对最新 doc 求值；严格写期间的 drop 延迟并按新 doc 计算 |
| C16 | 拖拽插入占位（0.2.4） | CSS/源码契约：`.dsg-drop-placeholder` 32/34px、accent 虚线边框/背景、label；九类落点（session-before/after、group-before/after、group child slot、group-append expanded/collapsed、ungrouped、root-end）均渲染占位；旧 `.dsg-drop-indicator`/`.dsg-insert-*` 2px 样式删除；testid `session-groups-drop-indicator` + `data-drop-height` 保留 |
| C17 | 拖拽诊断（0.2.5） | 默认开启、`localStorage='0'` 关闭；环上限与 queue 上限；20 事件/500ms 批量；flush 失败重试/计数；dragend + visibility hidden 走 sendBeacon；native capture/bubble + target ids + prevented/trusted；target change 触发 placeholder insert/remove；label 去重；handler ms/renders 统计；HUD 仅 250ms 文本更新、pointer-events none；禁用路径零监听/零 HUD |
| C18 | 官方 header 图标（0.2.5） | `HEADER_ICON_NAMES` 恰为 search/view-options/project-add；三份 artwork 与 DSH 2.0.18 primitives 逐字节一致（search 圆+柄、sliders 两线两圆、project-add 填充轮廓+plus）；`renderHeaderIcon` 16px、1px stroke、currentColor、data-icon |
| C19 | 分组颜色 + 选择对话框（0.2.6） | 调色板恰为 `blue/green/orange/red/purple/gray`；`createGroup` 默认蓝、未知 color 归一化蓝、`setGroupColor` 只改目标且纯函数；`validateDoc` 允许缺省 color、拒绝未知 palette id；`normalizeDoc`/host commit 将缺省归一化蓝（round-trip）；`dialog-selection.js` 的初始选择/有效性/confirm payload 覆盖 icon、move-session、move-group（排除自身+后代）、new-session（inferred/无选择 disabled）、group-color；CSS/源码契约：blue header title、28×28 行操作、16px glyph/4px gap、2px guide@caret、色板 swatch、点击只高亮、footer Confirm/Cancel 对所有对话框存在 |
| C20 | 行 meta + 自定义色 + 右键菜单（0.2.7） | `colorHex` normalize（`#RGB`/`RGB`/大写/6 位；alpha/非法 null）、precedence、`setGroupColorHex`/`setGroupColor` 清 hex、`validateDoc` 拒绝非 canonical persisted hex、`normalizeDoc`/host load/commit 归一化；新建组默认 `hash`；`relativeTimeParts` just now/minutes/hours/days/years + 非法/未来省略 + absolute title；`clampMenuPosition`/pointer +2/row bottom+8 与 8px viewport clamp；dialog-selection custom initial/valid/payload；CSS/源码契约：组行 caret→icon→name→actions→count、会话行 actions→time、12/16 + 40px min-width、隐藏操作 pointer-events none、16/4/2px guide + 组色 60%/45%、caret 85%、2 列 32px 色板 + 固定 16px check 槽 + native/hex 行 + aria-live hint |
| C21 | 官方状态 + 空组 drop box + 拖拽 label（0.2.8） | `sessionStatuses` 官方优先级（3 个 pending kind > running > subagents-only > completed > idle）、未知 pending kind 忽略、subagents 与 pending/running 共存、非法 count 忽略；`runningSubagentCount` 取 `projectionsBySession.subagentCatalog`（status.running 优先、row.running 回落、external 计数同官方、无投影返回 0），`runningSubagentCounts` 只产出正数；model/filter 透传 `runningSubagentCount`；`createFloatingLabel` 单例复用/隐藏重复节点/文本+可见性+位置缓存/rAF 合并 last-wins/hide+dispose flush/rAF 缺失同步路径；CSS/源码契约：16×20 状态槽（idle 空、archived/blank 空）、14px 双圆 spinner（r9.5/track25%/dash 12 150/1.5s/reduced-motion）、10px 点（inset20%/warn+success token）、compact pending 尾格、visually-hidden 状态文本、时间 10/16、空组 dashed 32px 盒（plus14/12px/drop-active accent）、placeholder 抑制、`.dsg-session-dot`/`.dsg-group-empty` 删除 |

## 5. E2E（Playwright/CDP，21 步）

环境：

```powershell
$env:DSH_HOME = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\qa"
& "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe" --expose-internals `
  "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js" `
  --profile groups-spike --port 4402 --no-open
```

说明：PATH 上的 `dsh.cmd` 会硬编码 `DSH_HOME`，不能用于隔离；`web` 子命令在 rc.2 会报 too many arguments。

用例：

1. 打开 4402，侧栏默认官方工作区视图；用只读夹具复制真实 `sessions/` + `storages/workspace.json`，得到 3 工作区/约 30 会话/2 归档；footer 为**单个 28px 按钮**：初始 `data-mode=workspace`、`aria-pressed=false`、文案/标题精确为「切换到自由分组视图」、13px 文本/16px 图标；点击后 `data-mode=groups`、`aria-pressed=true`、文案/标题精确为「返回默认工作区视图」；再次点击恢复；0.2.2 的两个段 testid 必须不存在。
2. 点底部单按钮进入分组视图；header 右侧顺序为 **搜索 → 视图选项 → `+`**（各 28×28、16px glyph），搜索字段初始收起，正常 header 无「返回工作区」。
3. 新建 3 组（1 个二级嵌套），刷新后仍在。
4. 从 3 个不同工作区拖 10 个会话进组；每次检查插入占位（32px、accent 面/虚线边框、目标名/「放到这里」）、高亮与浮动标签；drop 后行立即移动、记录文件最终一致。
5. 组内/跨组拖拽排序；刷新后顺序保持。
6. 组头 `+` 打开预创建工作区菜单：默认推断正确；**0.2.6 点击工作区只高亮（`data-selected=true`、`aria-selected`），对话框不关闭、不创建；footer Confirm 才创建**；切换工作区后 `connectWorkspace` 创建；落在组第一行且无孤儿 blank。
7. 归档一个普通会话 → 隐藏；切「全部」可见；切「仅已归档」只显示它；取消归档回原组。再归档一个**运行中**会话 → 拒绝 → 确认框列出活动 → stopActivity 强制；取消路径不动。
8. 重命名 → 官方侧栏同步；本视图无删除入口。
9. 收起侧栏 → rail 展开按钮可用。
10. 重启 profile → 结构/顺序/筛选保持。
11. 切回工作区视图 → 官方浏览器原样；搜索/添加工作区可用。
12. 数据审计：`workspace.json` 与一个 sample session 目录 hash 不变；只新增/修改 `dsh-session-groups.json`。
13. **V1.1 宽度**：记录官方宽度 → 分组视图在 1024px 挂载（存储 620 → clamp 544）→ 1440px 恢复 620 → 拖到 760/620 → reload 保持 → 700px rail 不覆盖且无把手 → 双击复位 420 → 拖到 264 头部无水平溢出且 header 高 36px、**单 footer 按钮标签仍可见（28px 高/16px 图标）** → 折叠/展开保持 → **快速释放（move 后立即 up）断言 applied=stored** → **800px 双击复位持久化 420、applied=320；回 1440px 恢复 420** → 切回官方宽度恢复、官方把手回来。
14. **V1.1 组拖**：组 c → 有会话但 0 子组的组 b 体槽（index 0）；组 a（带子树）→ 空组 e；组 c → 未归组头（根末尾）；a → b 上缘；快速双拖 before/child 锚点按最新 doc 重算；自身/末位 no-op 不涨 revision；**同位置 after no-op**；**组头中间 50% 无效（toast、不提交）**；组菜单上移/下移首尾禁用 + **启用 move-up 实际生效**；全树 n+1 槽审计；**真实 CDP 指针从组 `+` 按钮拖向另一组：dragstart 被 preventDefault，根顺序/parent/revision 不变**。
15. **V1.1 搜索**：先断言搜索字段未渲染 → 点 header 搜索图标展开并聚焦 → 折叠组 a → 输入唯一标题 → ArrowDown/Enter → 组展开、行高亮、树滚动；**目标移入嵌套子组并折叠子组+祖先 a、筛选切 `only` 后选中：only→all、两级同时展开**；归档结果 `aria-disabled=true`、Enter 不改当前会话；**宽查询结果 >12，连按 ArrowDown 后 active option 保持在 320px listbox 可视 rect 内（listbox scrollTop>0）**；无结果空态；Esc/点击外部关闭；**无下拉时 Escape 收起搜索整行、header 关闭按钮收起整行**；搜索前后 `groups`/`ungrouped` 字节一致。
16. **V1.1 排版+间距对齐（0.2.1/0.2.2）**：step 15 结束时分组视图仍激活；先收起搜索字段，再用 `getComputedStyle`/`getBoundingClientRect` 断言（不依赖截图）：
    - `.dsg-root` 的 `font-size` 等于宿主侧栏祖先的 computed `font-size`（无祖先时按 14px 契约）且 font-family 继承；
    - `.dsg-group-row` 高 34px、`.dsg-session-row` 高 32px（±1）；
    - `.dsg-group-name`/`.dsg-session-title` 14px/20px、`.dsg-workspace-badge` 12px、header 标题 14px/20px **font-weight 400（官方 section label）且颜色 = primary accent** + accent 图标 16px（同 token）；
    - `.dsg-group-icon svg`、group caret、group action glyph、header accent 均 16×16，**组操作按钮 28×28（0.2.6 命中区）**，根内所有 `.dsg-glyph`/`.dsg-icon` 均 16px（0.2.8 空组 drop box 的 14px plus 除外）；
    - **footer**：单个按钮，`BUTTON` 标签、28px 高、13px 文本、16px 图标，`data-mode=groups`/`aria-pressed=true`、文案/标题精确为「返回默认工作区视图」/“Back to default workspace view”；header 三个 action 均 28×28、16px glyph、顺序 **搜索/视图选项/`+`**；
    - **间距**：组行/会话行 computed `padding-left/right` 8px、column-gap 6px；`.dsg-tree` row-gap 2px；组体 row-gap 2px；**0.2.6 组线 guide：margin-left 16px、content padding 4px、布局 border 0、`::before` 宽 2px/left -1px，线中心 = 父组 caret 中心且距行首 16px（±1）**；header `padding: 4px 4px 4px 2px`、row-gap 8px、单行标题 28px、收起总高 36px、展开搜索后总高 74px + 搜索行 30px；搜索输入 13px/30px；搜索结果 padding ≥6px/10px、结果 column-gap 8px、下拉 row-gap 2px（全部 ±1px 容差）；
    - **264px 最小宽度**：临时拖到 264px 断言 header/tree `scrollWidth ≤ clientWidth+1` 后恢复原宽度；再展开搜索断言 header/search row/input 仍无横向溢出并收起；
    - **虚拟窗口**：`.dsg-virtual-list` 的 `data-virtual-total` 等于未归组头 `data-count`；`end-start === renderedUngrouped`；rendered ≤80；rail footer 为 28×28 图标按钮（文本为空）；
    - `--dsg-font-14` 解析为 14px（官方 token 生效）。
    - 反例约束：不存在插件专属 font-size 设置/配置；宿主继承值变化时根字号随动；字号/行高/图标尺寸/行高不变。
17. **0.2.2 深色主题 surfaces**：`document.body.setAttribute('data-ds-dark-theme','')` 后打开搜索输入/搜索结果、会话菜单、新建分组对话框，断言 computed 背景不是白色（含半透明 token 与 body base 合成后）、text/背景对比度 ≥4.5:1；结束后恢复原 theme 属性。覆盖 `--dsw-specific-menu`（菜单/搜索下拉）、`--dsw-alias-bg-layer-2`（对话框）、`--dsw-alias-bg-layer-1`（输入）。
18. **0.2.4 插入占位 + 乐观提交**：
    - 用 `dragstart + dragenter/dragover` 悬停（不 drop）逐类断言 `session-groups-drop-indicator`：session-before/after（32px）、group-before/after（34px）、group child slot（6px→34px）、group-append（展开时组体末尾 / 折叠时组头之后）、ungrouped（header 下）、root-end（最后 root 之后）；占位 label 非空（「放到这里」/目标名），accent 虚线边框 + accent fade 背景；
    - 占位真实参与布局：hover 前后目标/后继行 top 位移 ≥28–30px；`dragleave` 后占位立即消失；drop/dragend 后清理；
    - 264px 下 hover 占位时 `.dsg-tree` / 占位 `scrollWidth ≤ clientWidth+1`，随后恢复宽度；
    - **乐观证据**：用 CDP `Fetch.enable`（Request 阶段）挂起 commit 请求（不注入页面 fetch 包装）；拖会话/分组后断言 DOM 顺序已改变、`data-optimistic="true"`、**记录文件 revision 仍等于拖拽前的值**（HTTP 未落盘），`Fetch.continueRequest` 后记录 revision 前进、`data-optimistic="false"` 且 DOM 顺序保持；
    - **0.2.5/0.2.6/0.2.7/0.2.8 诊断 HUD**：`session-groups-diagnostics-hud` 存在、computed `pointer-events:none`、文本含 `dsg 0.2.8` 与本轮 `n=`（native dragover）>0、`chg=`/`rend=` 计数；HUD 由 ≥10 次拖拽事件驱动但自身不产生 React 行渲染（只读文本断言）。E2E runner 在 21 步之后额外 POST 一个 `e2e-probe` batch 到 `/dsh-session-groups/diagnostics`，读取隔离 home 的 `storages/dsh-session-groups.diagnostics.ndjson`，断言 `schemaVersion=1`、行可解析、包含 `native.*`/`handler`/`optimistic|queue` 事件且 `runId` 分组正确（该检查不计入 21 步）。
19. **0.2.6 分组颜色 + 选择对话框**（step 18 留在分组视图）：
    - 分组菜单出现「颜色」；打开 `group-color` 对话框：6 个 palette 选项、当前颜色（默认蓝）高亮、footer Confirm/Cancel 存在且 Confirm 可用；点 purple 只高亮（`aria-checked`、唯一选中、对话框不关、行 `data-color` 不变、记录 revision 不变）；Cancel 关闭且不变；重开选 purple + Confirm → 行 `data-color=purple`、图标 computed color = `--dsg-color-purple`、记录 color=purple 且 revision 前进；
    - `icon` 对话框：当前图标高亮；点 star 只高亮、行图标 markup/revision 不变；Cancel 不改；重开 + Confirm → 记录 icon=star；
    - `move-session` 对话框：当前组预选；点另一 root 组只高亮、不移动、revision 不变；Confirm 后会话出现在目标组且记录落盘；
    - `new-session` 对话框：推断工作区可见预选（无推断则 Confirm disabled，点选后 enabled）；点击其他工作区只高亮且不写记录；Cancel 不创建会话（行数不变）；
    - Escape 与点击 backdrop 关闭 color 对话框且不改变颜色/revision；HUD 仍在且 build=0.2.8；264px 无溢出由 step 16/18/21 继续守护。
20. **0.2.7 行 meta + 自定义色 + 右键菜单**（step 19 留在分组视图）：
    - 组行 DOM 顺序 caret/icon/name/actions/count；count 12/16、tabular、右对齐、距行右 8px 且始终可见；actions 两键 28×28/gap 4，空闲 opacity 0 + pointer-events none，真实鼠标 hover 后 opacity 1/pointer-events auto；
    - 会话行 time 在 actions 之后、最右 8px、min-width 40、右对齐、tabular；文本匹配 just now/minutes/hours/days/years（zh/en），`title` 非空且为绝对时间；0.2.8 起字号为官方 10/16；缺失/非法 updatedAt 的省略由 C20 单测覆盖；
    - 未归组与组 guide 同为 margin 16/padding 4/2px/left -1/上下 2px，未归组颜色 = label-tertiary 45% mix、组 = 组色 60% mix；组 caret color = 组色且 opacity .85、icon = 组色 100%、wrapper 内联 `--dsg-group-color`；
    - color 对话框：2 列 × 3 行、每 cell 32px、6 个固定 16px check 槽（未选中 hidden）、native `type=color` + hex 输入；输入 `#0f0` → Confirm enabled、0 预设选中、custom selected、未 Confirm 不写；Confirm 后记录 `colorHex=#00ff00`、行 `data-color-hex`/icon/caret 生效；重开自定义色 → 0 预设选中且 hex 预填；输入 `#12` → Confirm disabled + error hint；Cancel 不写；选 purple + Confirm → 记录 color=purple 且 colorHex 移除；
    - 右键组/会话行：菜单 kind/source 正确、位置=光标+2px（clamp 后）、不展开/不打开/不选中；会话右下角右键 → 菜单完整落在 8px viewport inset；Escape 关闭并回焦来源行；Shift+F10 锚定行 left/bottom+8；滚动/resize/外部 pointerdown 关闭；group 拖拽中 contextmenu 被抑制；行与 `…` 暴露 `aria-haspopup=menu`。
21. **0.2.8 官方状态 + 空组 drop box + 单实例拖拽 label**（step 20 留在分组视图）：
    - 每条会话行有 16×20 `session-groups-session-status` 槽；idle/archived/blank 槽内 0 子节点、无 hidden 标签（不是透明点）；ongoing 渲染 14px spinner（`viewBox 0 0 24 24`、两个 r=9.5 圆、track/arc）；warning/done 渲染 10×10 点（6px core）；非 idle 行至少 1 个 `.dsg-visually-hidden` 文本；时间 10/16 且当前夹具无 compact 状态；
    - 新建空组：`session-groups-empty` 是整宽（与 `.dsg-group-line` 内容宽一致）dashed 32px 盒、radius 6、`padding 0 8px`、12px、居中 flex、14px plus + 非空 label；body `group-append` 占位出现时该盒消失（不双渲染），dragleave 后恢复；组 drag 的 `group-before` 边界落点保留该盒并切 accent（border/background/color 与 DropPlaceholder 一致）；264px 下 tree/盒无横向溢出；
    - 会话拖拽多次 dragover：`session-groups-floating-label` 始终只有 1 个节点、1 个可见、文本非空、`position:fixed`、left/top 24/120、位于 tree 外；dragend 后同一节点隐藏（不新增/不删除文件）。
22. **0.2.3 大列表 probe（独立 QA home，不并入日常 21 步）**：
    - 环境：`scripts/qa/setup.ps1 -QaHome .spike-homes/qa-0.2.3-large` → `node scripts/qa/make-large-list-fixture.mjs --home ... --extra 1500` → `start-web.ps1 -Port 4407`；
    - 断言 1,500+ 逻辑未归组行下 `domUngroupedRows` 在 20–30（<80），`treeScrollHeight` 与全量渲染一致（spacers 精确）；
    - 记录初始渲染、滚动两帧、hover、dragover 指示、窗口外搜索 reveal/scroll、可见行拖入组耗时；before(0.2.2)/after(0.2.3) 同 fixture 对比，写入 `docs/TEST-RESULTS.md` 与 `.superpowers/sdd/.../virtualization-report.md`。

V1.1 新增/相关 stable testids（详见 `docs/CONTRACTS.md §4.1`）：

`session-groups-resize-handle`、`session-groups-header-row`、`session-groups-toggle`（0.2.3 单按钮）、`session-groups-search-toggle`、`session-groups-search-close`、`session-groups-view-options`、`session-groups-view-options-popover`、`session-groups-search`、`session-groups-search-results`、`session-groups-search-result`、`session-groups-search-empty`、`session-groups-group-drop`、`session-groups-group-move-up`、`session-groups-group-move-down`、`session-groups-menu`、`session-groups-group-add`、`session-groups-virtual-spacer`（0.2.3）、`session-groups-drop-indicator`（0.2.4 行高占位，`data-drop-height`）、`session-groups-diagnostics-hud`（0.2.5，`data-run-id`/`data-schema-version`）、`session-groups-dialog-options` / `session-groups-dialog-workspace` / `session-groups-dialog-group` / `session-groups-dialog-icon` / `session-groups-dialog-color`（0.2.6 选择对话框，`data-selected`/`aria-selected|checked`）、`session-groups-group-count` / `session-groups-session-time` / `session-groups-dialog-color-check` / `session-groups-dialog-color-hex` / `session-groups-dialog-color-native` / `session-groups-dialog-color-hint`（0.2.7）、`session-groups-session-status`（0.2.8 状态槽，`data-state`/`data-status-kind`；`session-groups-empty` 0.2.8 起带 `data-drop-active`）。

Playwright 拖拽注意：

- 用 `page.mouse.move/down/up` 分步移动，不要只 `dragTo`；中间停 100ms 触发 `dragover`。
- 每次拖拽后断言 DOM 行顺序 + 记录文件内容。
- 失败时保存 trace/video/screenshot。

V1.1 回归注意：

- **step 2**：fresh server 的 session 快照异步 hydrate；进入分组视图后先等 session rows >0（30s）再计数/断言零组，避免冷启动误判。
- **step 10**：restart 后必须等待 sessions 快照（组数、可见行数、已知会话都就绪，最多 30s）再比对，避免半 hydration 误判。
- **step 13**：官方宽度在进入分组视图前实测记录，切回后按记录值 ±2px 比较，不写死 420。
- **step 14**：step 13 结束时停在官方视图，step 14 自己切回分组视图；step 15 依赖分组视图。
- **step 15**：会通过宿主归档一条会话（宿主侧副作用，记录文件不变），证据中记录该 sid/title。
- **step 16**：依赖 step 15 结束时仍在分组视图；先收起搜索字段再测 36px header，测量搜索结果时再展开并关闭；字号/间距为只读 DOM 断言；264px 探针会临时改宽度并恢复原宽度（不写记录文件）。失败信息必须列出「期望值 vs 实测值」。
- **step 17**：设置/移除 `body[data-ds-dark-theme]` 只影响本次浏览器文档；不写 profile、不写记录文件；结束后恢复原属性。
- **step 18**：占位检查全部用 hover-only（不落盘）；乐观检查用 CDP Fetch 挂起 commit，断言 DOM 已移动且记录 revision 未变；随后 continue 并等待 revision 前进/data-optimistic=false；264px 探针临时改宽度后恢复；**0.2.5 诊断默认开启**，HUD 只读断言，runner 末尾额外校验 NDJSON 落盘（失败只影响 diagnostics 结论，不改变 21 步编号）。
- **step 19**：依赖 step 18 结束时仍在分组视图；会真实写分组颜色/图标并移动一条会话（记录 revision 前进 3 次），选择/取消阶段只读；最后 Escape/backdrop 关闭不改状态；new-session 只 Cancel，不创建会话。
- **step 20**：依赖 step 19 结束时仍在分组视图；行布局/guide 为只读，颜色部分真实写 custom hex 再恢复 palette purple（revision 前进 2 次）；菜单部分只读并用 CDP mouse/KeyboardEvent 验证位置/关闭/回焦；右键/拖拽抑制不写记录。

## 6. 人工验收（desktop profile）

在真实 desktop profile 上重复 E2E 的 9 步；V1.1 追加重点：

- 左栏拖宽到 620/760、双击复位、切官方恢复原宽；264px 下搜索框/按钮不溢出；
- 组拖同级排序/改父级、菜单上移/下移、折叠组不提供子组落点；
- 搜索折叠组显现、归档置灰、264px 下拉不溢出；
- 官方视图/插件市场/设置不受影响；
- 主题深色、280px、150% 缩放；
- 中文文案；
- 现有 25 个会话不丢、不重复；
- 卸载/禁用插件后官方视图恢复，记录文件保留。

## 7. 回归审计脚本

`scripts/audit-no-host-writes.ps1`：

1. 记录**隔离 home** `.spike-homes/qa/storages/workspace.json` 的 SHA256（不要用真实 `~/.dsh`）；
2. 抽样 3 个 session 目录的 `*.jsonl`/`*.zstd` mtime + hash；
3. 执行分组操作（建组/拖拽/改名组/删组）；
4. 再算 hash；
5. 断言只有 `dsh-session-groups.json` 变化；输出 PASS/FAIL。

注意：重命名/归档/新建是用户主动的宿主动作，允许改变 session 数据；审计只针对**分组操作**。

## 8. 性能

- 0.2.3 大列表 fixture：1,510 逻辑未归组行（2 组/4 会话种子，真实 root 会话 + 1,500 synthetic clones）。
- before（0.2.2，DOM 全量 1,510 行）与 after（0.2.3，窗口 20–30 行）同 fixture 对比；指标：初始渲染、滚动两帧、hover 反馈、dragover 指示、窗口外搜索 reveal、可见行拖放。目标：DOM 行数 <80；hover/dragOver <100ms；搜索 reveal <1s；滚动高度不跳。
- 实测（2026-10-29，详见 `docs/TEST-RESULTS.md`）：DOM 1,510→20；初始 191→169ms；滚动 18→10ms；hover 12.2→3.8ms；dragOver 48→20ms；窗口外 search reveal 266→193ms；drop 85→60ms；scrollHeight 51,616 不变。
- 真实 home 的实际可见未归组约 22 行（1,639 个 session 目录中 1,474 个 subagent 被过滤，workspace.json 只登记 85 个，59 归档），远低于压力夹具；虚拟化仍按 1,500+ 设计。
- 0.2.5 诊断开销（Node 微基准，20,000 事件、fake transport，见 `TEST-RESULTS`）：trace 4.41µs/事件（ring 4000）/1.46µs（ring 500）≈ 60Hz dragover 0.26ms/s（0.03% CPU）；flush 20k 事件 ~4ms；HUD 250ms 刷新 0.24µs；关闭路径 1,000,000 次 no-op trace 1.6ms。E2E step 耗时与 0.2.4 同量级（见诊断报告对照表）。

## 9. 缺陷与门禁

- P0 缺陷：丢会话/重复行/写坏宿主数据/白屏/官方视图回不来/分组记录丢失 → 阻断发布。
- P1：拖拽误放、空态、图标缺失、文案 → 修复后发布。
- P2：颜色/搜索/折叠全部 → 记录。
- 每次修复必须补一条回归测试；QA 签字才算关闭。

## 10. 证据清单

- 单测/集成输出（TAP/日志）
- E2E trace/video（失败必存）
- E2E 21 步 JSON（`scripts/qa/evidence/e2e-<ts>.json`）+ 截图（分组视图、拖拽插入占位、组内新建、归档三态、rail、切回官方、宽度把手、组拖、搜索下拉、排版断言、深色主题 surfaces、乐观 drop、行 meta/自定义色/右键菜单、官方状态/空组 drop box/拖拽浮层）
- 数据审计输出（load-only + commit probe）
- 手工验收签字
- 已知问题清单（含 P2）
