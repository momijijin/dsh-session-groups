# V1/V1.1 测试计划

- 目标：证明“分组只改视图、不改宿主数据”，同时证明拖拽/嵌套/筛选/新建在真实 DSH 中可用；V1.1 追加证明左栏宽度、分组拖拽、会话搜索、官方侧栏排版对齐
- 负责人：QA（计划、证据、验收结论）；Host/Client 各写自己模块的测试；Lead 做最终审计
- 环境：先用独立 `DSH_HOME`（`.spike-homes/qa`）+ `groups-spike` profile，再 desktop profile 人工验收；profile 不隔离 `sessions/`/`storages/`，禁止用真实 `~/.dsh` 跑 E2E
- 关联：`docs/V1-PLAN.md`、`docs/CONTRACTS.md`、`docs/SPIKE.md`、`docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md`

## 1. 测试分层

| 层 | 工具 | 范围 | 归属 | 运行频率 |
|---|---|---|---|---|
| 单元 | Node `node --test` | `src/shared/model.js` 纯函数 | Host/Client 写，QA 审 | 每次提交 |
| Host 集成 | Node `node --test` + 临时目录 | 存储、原子写、revision、路由围栏 | Host | 每次提交 |
| Client 逻辑 | Node `node --test` | 可见性、筛选、工作区映射、拖拽 hit-test | Client | 每次提交 |
| E2E | Playwright（Chromium/CDP） | 真实 DSH web profile：建组/拖拽/归档/新建/重启 + V1.1 宽度/组拖/搜索/排版/深色主题（17 步） | QA | 每日/合并前 |
| 人工验收 | 清单 + 截图 | desktop profile 9 步 | QA + 用户 | 发布前 |
| 回归审计 | 脚本 + hash | 只写记录文件 | QA | 每次 E2E |
| 性能 | 合成数据/手工 | 200/1000 会话 | QA | P1 |

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

## 5. E2E（Playwright/CDP，17 步）

环境：

```powershell
$env:DSH_HOME = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\qa"
& "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe" --expose-internals `
  "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js" `
  --profile groups-spike --port 4402 --no-open
```

说明：PATH 上的 `dsh.cmd` 会硬编码 `DSH_HOME`，不能用于隔离；`web` 子命令在 rc.2 会报 too many arguments。

用例：

1. 打开 4402，侧栏默认官方工作区视图；用只读夹具复制真实 `sessions/` + `storages/workspace.json`，得到 3 工作区/约 30 会话/2 归档；footer 两段（分组视图/工作区视图）两标签可见、16px 图标、13px 文本、28px 高，工作区段 active。
2. 点底部「分组视图」段（不是盲切换），出现分组视图；header 右侧顺序为 `+`/搜索/视图选项（各 28×28、16px glyph），搜索字段初始收起，正常 header 无「返回工作区」。
3. 新建 3 组（1 个二级嵌套），刷新后仍在。
4. 从 3 个不同工作区拖 10 个会话进组；每次检查插入线/高亮/浮动标签。
5. 组内/跨组拖拽排序；刷新后顺序保持。
6. 组头 `+` 打开预创建工作区菜单：默认推断正确；切换工作区后 `connectWorkspace` 创建；落在组第一行且无孤儿 blank。
7. 归档一个普通会话 → 隐藏；切「全部」可见；切「仅已归档」只显示它；取消归档回原组。再归档一个**运行中**会话 → 拒绝 → 确认框列出活动 → stopActivity 强制；取消路径不动。
8. 重命名 → 官方侧栏同步；本视图无删除入口。
9. 收起侧栏 → rail 展开按钮可用。
10. 重启 profile → 结构/顺序/筛选保持。
11. 切回工作区视图 → 官方浏览器原样；搜索/添加工作区可用。
12. 数据审计：`workspace.json` 与一个 sample session 目录 hash 不变；只新增/修改 `dsh-session-groups.json`。
13. **V1.1 宽度**：记录官方宽度 → 分组视图在 1024px 挂载（存储 620 → clamp 544）→ 1440px 恢复 620 → 拖到 760/620 → reload 保持 → 700px rail 不覆盖且无把手 → 双击复位 420 → 拖到 264 头部无水平溢出且 header 高 36px、footer 两段标签仍可见 → 折叠/展开保持 → **快速释放（move 后立即 up）断言 applied=stored** → **800px 双击复位持久化 420、applied=320；回 1440px 恢复 420** → 切回官方宽度恢复、官方把手回来。
14. **V1.1 组拖**：组 c → 有会话但 0 子组的组 b 体槽（index 0）；组 a（带子树）→ 空组 e；组 c → 未归组头（根末尾）；a → b 上缘；快速双拖 before/child 锚点按最新 doc 重算；自身/末位 no-op 不涨 revision；**同位置 after no-op**；**组头中间 50% 无效（toast、不提交）**；组菜单上移/下移首尾禁用 + **启用 move-up 实际生效**；全树 n+1 槽审计；**真实 CDP 指针从组 `+` 按钮拖向另一组：dragstart 被 preventDefault，根顺序/parent/revision 不变**。
15. **V1.1 搜索**：先断言搜索字段未渲染 → 点 header 搜索图标展开并聚焦 → 折叠组 a → 输入唯一标题 → ArrowDown/Enter → 组展开、行高亮、树滚动；**目标移入嵌套子组并折叠子组+祖先 a、筛选切 `only` 后选中：only→all、两级同时展开**；归档结果 `aria-disabled=true`、Enter 不改当前会话；**宽查询结果 >12，连按 ArrowDown 后 active option 保持在 320px listbox 可视 rect 内（listbox scrollTop>0）**；无结果空态；Esc/点击外部关闭；**无下拉时 Escape 收起搜索整行、header 关闭按钮收起整行**；搜索前后 `groups`/`ungrouped` 字节一致。
16. **V1.1 排版+间距对齐（0.2.1/0.2.2）**：step 15 结束时分组视图仍激活；先收起搜索字段，再用 `getComputedStyle`/`getBoundingClientRect` 断言（不依赖截图）：
    - `.dsg-root` 的 `font-size` 等于宿主侧栏祖先的 computed `font-size`（无祖先时按 14px 契约）且 font-family 继承；
    - `.dsg-group-row` 高 34px、`.dsg-session-row` 高 32px（±1）；
    - `.dsg-group-name`/`.dsg-session-title` 14px/20px、`.dsg-workspace-badge` 12px、header 标题 14px/20px 且为 primary 文本 + accent 图标 16px；
    - `.dsg-group-icon svg`、group caret、group action glyph、header accent 均 16×16，组操作按钮 16×16，根内所有 `.dsg-glyph`/`.dsg-icon` 均 16px；
    - **footer**：容器/段高 28px、两段标签（分组视图/工作区视图）可见、13px 文本、16px 图标、active 段使用 accent；header 三个 action 均 28×28、16px glyph、顺序 `+`/搜索/视图选项；
    - **间距**：组行/会话行 computed `padding-left/right` 8px、column-gap 6px；`.dsg-tree` row-gap 2px；组体/组线 row-gap 2px、组缩进 margin/padding 10px；header `padding: 4px 4px 4px 2px`、row-gap 8px、单行标题 28px、收起总高 36px、展开搜索后总高 74px + 搜索行 30px；搜索输入 13px/30px；搜索结果 padding ≥6px/10px、结果 column-gap 8px、下拉 row-gap 2px（全部 ±1px 容差）；
    - **264px 最小宽度**：临时拖到 264px 断言 header/tree `scrollWidth ≤ clientWidth+1` 后恢复原宽度；再展开搜索断言 header/search row/input 仍无横向溢出并收起；
    - `--dsg-font-14` 解析为 14px（官方 token 生效）。
    - 反例约束：不存在插件专属 font-size 设置/配置；宿主继承值变化时根字号随动；字号/行高/图标尺寸/行高不变。
17. **0.2.2 深色主题 surfaces**：`document.body.setAttribute('data-ds-dark-theme','')` 后打开搜索输入/搜索结果、会话菜单、新建分组对话框，断言 computed 背景不是白色（含半透明 token 与 body base 合成后）、text/背景对比度 ≥4.5:1；结束后恢复原 theme 属性。覆盖 `--dsw-specific-menu`（菜单/搜索下拉）、`--dsw-alias-bg-layer-2`（对话框）、`--dsw-alias-bg-layer-1`（输入）。

V1.1 新增/相关 stable testids（详见 `docs/CONTRACTS.md §4.1`）：

`session-groups-resize-handle`、`session-groups-header-row`、`session-groups-toggle-groups`、`session-groups-toggle-workspace`、`session-groups-search-toggle`、`session-groups-search-close`、`session-groups-view-options`、`session-groups-view-options-popover`、`session-groups-search`、`session-groups-search-results`、`session-groups-search-result`、`session-groups-search-empty`、`session-groups-group-drop`、`session-groups-group-move-up`、`session-groups-group-move-down`、`session-groups-menu`、`session-groups-group-add`。

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

- 合成 doc：3 工作区、200/1000 sessions、30 组、4 层。
- 指标：打开视图 <200ms；拖拽反馈 <100ms；筛选 <100ms；无长任务 >50ms。
- 超过 200 会话若卡顿，记录并转 P2 虚拟化，不阻塞 V1。

## 9. 缺陷与门禁

- P0 缺陷：丢会话/重复行/写坏宿主数据/白屏/官方视图回不来/分组记录丢失 → 阻断发布。
- P1：拖拽误放、空态、图标缺失、文案 → 修复后发布。
- P2：颜色/搜索/折叠全部 → 记录。
- 每次修复必须补一条回归测试；QA 签字才算关闭。

## 10. 证据清单

- 单测/集成输出（TAP/日志）
- E2E trace/video（失败必存）
- E2E 17 步 JSON（`scripts/qa/evidence/e2e-<ts>.json`）+ 截图（分组视图、拖拽插入线、组内新建、归档三态、rail、切回官方、宽度把手、组拖、搜索下拉、排版断言、深色主题 surfaces）
- 数据审计输出（load-only + commit probe）
- 手工验收签字
- 已知问题清单（含 P2）
