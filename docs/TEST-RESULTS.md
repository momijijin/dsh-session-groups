# V1/V1.1 Test Results（QA 验证线）

> Owner：QA（task-6/7）。上游：`docs/TEST-PLAN.md`、`docs/CONTRACTS.md`（frozen）、`docs/V1-PLAN.md`、`docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md`。
> 环境：隔离 `DSH_HOME=<repo>\.spike-homes\qa` + profile `groups-spike` + 端口 **4402**（0.2.2 UI patch 用独立 home `.spike-homes/qa-0.2.2-ui-2` + 4406 与并行 QA 隔离）；直调 Desktop runtime；
> 真实 `~/.dsh` **只读**（fixture 来源 + 前后 fingerprint），不复制 credentials；
> Host/Client 实现（`src/**`）不由 QA 修改；缺陷开给 owner。

## 0. V1.1 patch 0.2.5 最终结论（2026-10-29，官方 header 图标 + 拖拽诊断 trace/HUD + 分析器）

**V1.1 patch 0.2.5 QA 验证线 PASS（隔离 home `.spike-homes/qa-0.2.5`；setup 端口 4402 / E2E 端口 4403；setup 18/18、真实 home 零写入）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **234/234 PASS**（0 fail / 0 skip，~3.9s；新增 diagnostics 11 条、analyzer 4 条、icons 5 条、host diagnostics route 3 条，并更新 route/entry 计数） | 控制台输出 |
| E2E 18 步（默认开启诊断） | **18/18 PASS**（step 合计 **83,956 ms**；`consoleErrors=[]`、`pageErrors=[]`）；step 18 HUD 断言 `pointer-events:none`、`n=28 / chg=54 / rend=5312`；step 18 乐观 DOM 位移会话 **304ms** / 分组 **12ms**，revision 在 HTTP 挂起期间未变（会话 29→30、分组 30→31） | `scripts/qa/evidence/e2e-20261029-134445.json` + 18 张截图（`scripts/qa/evidence/screenshots/e2e/`） |
| 诊断持久化（E2E runner 非步骤校验） | **PASS**：页面 POST `e2e-probe` → 200 `{ok:true,appended:1}`；隔离 home NDJSON **3,091 行（E2E 记录时）/ 12 runs / 0 invalidLines**，`nativeSeen` / `handlerSeen` / `optimisticSeen` 全为 true（native/handler/optimistic/HTTP 相位齐全）；文件 `storages/dsh-session-groups.diagnostics.ndjson` 约 **1.8 MB** | 同上 `diagnostics` 字段 + `.spike-homes/qa-0.2.5/storages/dsh-session-groups.diagnostics.ndjson` |
| 分析器真实 trace | **PASS**：`analyze-drag-trace.mjs` 解析 **12 runs / 0 parseErrors**；placeholder insert/remove、target/label 序列、autoexpand、optimistic/HTTP 相位齐全；慢 handler（≥50ms）**0**；longtask 仅应用启动/宿主渲染，拖拽内无 >2s freeze；burst 窗口 15 事件/1ms，未超阈值 | 同一 trace（`node scripts/qa/analyze-drag-trace.mjs <trace>`） |
| setup（0.2.5 隔离 home） | **PASS 18/18**；`HOME-0 removed=2`（重置旧隔离 home 记录，无用户文件删除）；真实 home 前后 fingerprint 一致；client build **227,938 bytes** / sha256 `93614e9a96e693e376754c57bbd66bf0d11e0bb95a189d706df8f5aecc4d4492`；package version `0.2.5` | `scripts/qa/evidence/setup-20261029-133829.json` |
| 数据审计 | **PASS**（verify 7/7）：只 `dsh-session-groups.json` 变更（revision 16）；`workspace.json` 由宿主会话操作改动（`-AllowHostSessionChanges` 放行）；3 sample sessions / desktop/web profile 指纹不变；诊断文件按 append-only 放行（AUD-5） | `scripts/qa/evidence/audit-baseline-20261029-134315.json` / `audit-verify-20261029-134354.json` |
| 打包 | `npm pack` → `dsh-session-groups-0.2.5.tgz`（**148,971 bytes**；unpacked **580,470**；**36 files**；sha256 `2D564CDBAD7CE24B17C1DF43561759834FC213F4387F1F6EC13A9C1694C08D91`） | 本文件 §0.2 |

> 证据文件位于 `scripts/qa/evidence/`（`scripts/qa/.gitignore` 排除，本地保留；不入包/不入库）；真实 trace 位于 `.spike-homes/qa-0.2.5/storages/`（gitignore）。E2E 截图同目录 `screenshots/e2e/`。

### 0.1 0.2.5 变更明细（本次 patch）

- **官方 header 图标**：`src/client/icons.js` 新增 `HEADER_ICON_ARTWORK` / `renderHeaderIcon`，逐字节复制 DSH Desktop 2.0.18 `@deepseek-ai/dsh-client-ui-primitives` 的 `IconSearchOutlineRegular`（圆+柄）、`IconSlidersTwoOutlineRegular`（两横线+两圆）、`IconProjectAddOutlineRegular`（填充项目轮廓+plus）；`components.js` 的 `IconButton` 支持 `icon`，header search/view-options/new-group 使用 16px 官方 artwork，顺序不变。
- **客户端诊断**：新增 `src/client/diagnostics.js`（环 4000、队列 800、20 事件/500ms、120/批、beacon 48KB 分片、rAF frame gap、longtask、render counts、HUD 250ms 纯 DOM）；`components.js` 记录 native 文档事件（capture+bubble）、每个拖拽 handler ms、dropTarget change/placeholder、drop accept/reject、auto-expand、drag start/end；`optimistic.js` 记录 enqueue/coalesce/dispatch/send/reconcile/rollback/strict；`api.js` 记录 http start/end；`plugin.js` 初始化诊断、label change、mode change、卸载清理。
- **Host 路由**：`POST /dsh-session-groups/diagnostics`（fence + JSON + 256 KiB + ≤500 事件）追加 NDJSON 到记录文件同目录；`index.js` 以 `dirname(record.filePath)` 定位（生产即 `dshHomePath('storages')`），因此覆盖 `filePath` 的测试 seam 绝不会指向真实 home。
- **HUD/开关**：`session-groups-diagnostics-hud` 固定右下、`pointer-events:none`、≤4Hz；默认开启，`localStorage['dsh-session-groups.diagnostics']='0'` 关闭；隐私：无会话标题/transcript。
- **QA**：`scripts/qa/analyze-drag-trace.mjs` + `audit.ps1` 将诊断 NDJSON 列为允许的 append-only 文件（AUD-5），E2E runner 增加 HUD/NDJSON 校验（不计入 18 步）。
- **不变**：数据模型、`load`/`commit`、记录文件、官方数据写入、宽度/搜索/虚拟化/占位/乐观语义与依赖集合。

### 0.2 0.2.5 打包记录

- 命令：`npm run build`（lib/client.js **227,938 bytes** / sha256 `93614e9a…`）→ `npm pack`。
- 产物：`dsh-session-groups-0.2.5.tgz`；**148,971 bytes**；unpacked **580,470 bytes**；**36 files**。
- sha256：`2D564CDBAD7CE24B17C1DF43561759834FC213F4387F1F6EC13A9C1694C08D91`；npm shasum `abb115943333270120d87a7be8429e79c916b2d9`；integrity `sha512-kRuTlW7Cizlp9KMPHI4Hw0e86kHYBmL58rosIx0mbH07wDMmzOuxfFq/8gHRuHmatfikNro4j/g94ABjxt0ePQ==`。
- 内容：`src/**`（29，含新增 `src/client/diagnostics.js`）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`（共 36）。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

## 0-0.2.4. V1.1 patch 0.2.4 最终结论（2026-10-29，拖拽行高占位 + 乐观 drop 提交 + header/footer 精确化，历史）

**V1.1 patch 0.2.4 QA 验证线 PASS（隔离 home `.spike-homes/qa-0.2.4-final4` + 4419；全新 setup，0 删除）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **211/211 PASS**（0 fail / 0 skip；新增 `tests/client/optimistic.test.js` 8 条队列语义 + 占位/文案/权重源码契约断言） | 控制台输出 |
| E2E 18 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **18/18 PASS**（step 时间和 **79,277 ms**，~79s；`consoleErrors=[]`、`pageErrors=[]`） | `scripts/qa/evidence-perf/024-final2/e2e-20261029-120454.json` + 18 张截图 |
| step 10 重启 hydration | **PASS**：groups=4、filter=hidden、`blankLifecycle.drift=false`；**虚拟化感知断言**：DOM 会话行 28→28、floor 20、10 条组内会话全部在场；不再要求「重启前后 DOM 行数精确相等」（视口外未归组行不需要在 DOM） | 同上 step 10 detail |
| step 1/2/16 footer 文案 | **PASS**：初始精确「切换到自由分组视图」/“Switch to free grouping view”；groups 精确「返回默认工作区视图」/“Back to default workspace view”；28px/13px/16px 不变 | 同上 |
| step 16 header 权重 | **PASS**：`.dsg-header-title` 14/20、`font-weight: 400`（官方 section label），primary + accent icon 16px | 同上 |
| step 18 插入占位 | **PASS**：session-before/after 32px、group-before/after 34px、child slot 6→34px、group-append（展开/收起）、ungrouped 32px、root-end 34px；目标行实测下移 **36px**（32 + gap/margin）；dragleave 清除；264px 无溢出（tree 252/252，占位宽 225px） | 同上 step 18 detail |
| step 18 乐观提交 | **PASS**：CDP `Fetch.enable` 在 Request 阶段挂起 commit（`Fetch.continueRequest` 放行）；会话 drop 后 **296ms** 内 DOM 顺序先变、`data-optimistic=true`、记录 revision 仍 29；放行后 revision 29→30、`data-optimistic=false`、顺序保持；分组 drop 同理（14ms 内重排，revision 30→31） | 同上 step 18 detail |
| setup（0.2.4 全新隔离 home） | **PASS 18/18**；`HOME-0 removed=0`；真实 home 前后 fingerprint 一致；client build **195,772 bytes** / sha256 `1416bb40685164d0e2a8a359032c0656fff09c0620ac15457328d29d84a107d4`；package version `0.2.4` | `scripts/qa/evidence-perf/024-final2/setup-20261029-120032.json` |
| 打包 | `npm pack` → `dsh-session-groups-0.2.4.tgz`（**128,218 bytes**；unpacked **500,532**；**35 files**；sha256 `F519BFBD6B9F180BBCBA4E46CCC3DC46BBD0A92B2FA9D800422D9B97EA358C45`） | 本文件 §0.2 |

### 0.1 0.2.4 修复/变更明细（本次 patch）

- **插入占位**：`src/client/components.js` 新增 `DropPlaceholder`，用真实 flex 行高占位替代 2px 线/边框；`GroupNode`/`UngroupedSection`/`GroupsView` 按落点插入；`GroupDropSlot` 激活时 6→34px；CSS `.dsg-drop-placeholder` 32/34px + accent 虚线边框 + accent fade 背景；`onDragLeave` 清除（忽略进入子元素/占位自身）；testid `session-groups-drop-indicator` 保留 + `data-drop-height`。
- **乐观提交**：新增 `src/client/optimistic.js` 单写者队列；`state.js` 新增 `optimistic-doc`/`optimistic-confirmed`/`optimistic-rollback` 与 `optimistic` 标记；`plugin.js` 的 `commitDoc` 改为 `commitStrict`（先 flush 后锁内求值），新增 `commitOptimistic`；会话/分组拖拽与菜单上移/下移改走乐观路径；create/rename/delete/icon/move 对话框改为 updater，避免旧快照覆盖。
- **header/footer**：`.dsg-header-title` 600→400；`footer.toGroups`/`footer.toWorkspace` zh/en 精确文案；E2E step 1/2/16 改为全等断言。
- **不变**：数据模型/Host 路由/存储路径/宽度/搜索/虚拟化/主题 token/依赖集合；0.2.3 的虚拟化与 0.2.1 排版保持。

### 0.2 0.2.4 打包记录

- 命令：最终 `npm run build`（lib/client.js **195,772 bytes** / sha256 `1416bb40…`）后 `npm pack`（`files` 只含发布文件）。
- 产物：`dsh-session-groups-0.2.4.tgz`；**128,218 bytes**；unpacked **500,532 bytes**；**35 files**。
- sha256：`F519BFBD6B9F180BBCBA4E46CCC3DC46BBD0A92B2FA9D800422D9B97EA358C45`；npm shasum `5b6bd9b9f2060d3fee0c01974dbddcd64a3943e3`；integrity `sha512-18NYqmGqZiLeXlg64D1KeHKwZBAWNu/Nazr9dFWFpuxacDDqffwR391ZYmu1mEO35Al+vFaFKmdx490GGJhMQg==`。
- 内容：`src/**`（28，含新增 `src/client/optimistic.js`）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`（共 35）。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

## 0-0.2.3. V1.1 patch 0.2.3 最终结论（2026-10-29，footer/header 回退 + 未归组虚拟化，历史）

**V1.1 patch 0.2.3 QA 验证线全绿 PASS（隔离 home `.spike-homes/qa-0.2.3-e2e` + 4408；大列表 `.spike-homes/qa-0.2.3-large` + 4407）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **203/203 PASS**（0 fail / 0 skip，~3.9s；新增 `tests/client/virtual-list.test.js` 12 条窗口/占位/边界单测） | 控制台输出 |
| E2E 17 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **17/17 PASS**（step 时间和 **82,357 ms**，~82s）；`consoleErrors=[]`、`pageErrors=[]` | `scripts/qa/evidence-perf/e2e/e2e-20261029-074237.json` + 17 张截图 |
| step 1 footer 单按钮 | **PASS**：初始 `BUTTON`/`data-mode=workspace`/`aria-pressed=false`/「分组视图」/28px/13px/16px；点击后 `groups`/`true`/「工作区视图」/图标变化；再次点击完全恢复；0.2.2 两段 testid 不存在 | 同上 step 1 detail |
| step 2/16 header 顺序 | **PASS**：`search-toggle → view-options → new-group`（28×28、16px glyph） | 同上 step 2/16 detail |
| step 9 rail footer | **PASS**：28×28、`data-wide=false`、文本为空、16px 图标、`data-mode=groups` | 同上 step 9 detail |
| step 13/16 footer | **PASS**：264px 下标签仍可见、无横向溢出；footer 28px/13px/16px；264px header/tree 252/252 | 同上 step 13/16 detail |
| step 16 虚拟窗口 | **PASS**：`data-virtual-total == data-count`（14）、`end-start == rendered`（8）、rendered ≤80；组树 2 组完整 | 同上 step 16 detail |
| setup（0.2.3 全新隔离 home） | **PASS 18/18**；`HOME-0 removed=0`；真实 home 前后 fingerprint 一致；client build **182,529 bytes** / sha256 `774d8fc036cbe5c3987b2ce543b1e7e3ee59d0f26e753ed658dfe08211c738ed`；package version `0.2.3` | `scripts/qa/evidence-perf/e2e-setup/setup-20261029-073936.json` |
| 大列表 probe（同 fixture before/after） | **PASS**：1,510 逻辑未归组行；DOM 未归组行 **1,510 → 20**（总 session 行 1,514 → 24）；`scrollHeight` 51,616 不变；搜索窗口外 reveal、可见行拖放均 PASS | `scripts/qa/evidence-perf/large-before.json` / `large-after.json` |
| 真实 home 数据测量（只读） | 1,639 session 目录 / 3 工作区；`workspace.json` 85 ids（59 归档、12 blank）、当前记录 2 组 4 会话；QA 同源 fixture 全目录扫描 1,474 subagent + 96 root；登记的 85 个均为 root → **实际可见未归组 10 行**（非 1,500；1,500 用 QA 大列表 fixture 压测） | 只读扫描 + workspace/record JSON |
| 打包 | `npm pack` → `dsh-session-groups-0.2.3.tgz`（**119,275 bytes**；unpacked **466.3 kB**；**34 files**；sha256 `77011E393E4C144006060C60074ECAA6C5B9A12B0AD07AC36981737894F44D5F`） | 本文件 §0.2 |

### 0.1 0.2.3 修复/变更明细（本次 patch）

- **footer**：删除 0.2.2 两段切换及 `.dsg-footer-switch`/`.dsg-footer-segment` CSS、`footer.switchLabel` locale、两个 segment testid；恢复单个 `session-groups-toggle` `BUTTON`：图标/标签描述目标视图并随点击变化（folderAdjust「分组视图」⇄ grid「工作区视图」），保持 28px 高/16px glyph/13px 文本，`data-mode`/`title`/`aria-pressed` 反映当前态；rail 为 28px 图标按钮（标签隐藏）。
- **header**：右侧顺序改为官方工作区段头 **search → view-options → plus**；保留 0.2.2 的 28×28/16px、搜索切换、view-options 三行归档 popover。
- **未归组虚拟化**：`src/client/virtual-list.js` 纯 helper（`computeVirtualWindow`/`virtualScrollOffset`/常量）；`UngroupedSection` 监听 `.dsg-tree` scroll/resize，只渲染视口 + overscan=8，top/bottom spacer 精确保留 `total*34-2` 滚动高度；组树完整。拖拽/归档/工作区徽标/当前会话仍基于完整逻辑列表。
- **搜索 reveal**：窗口外未归组目标先 `scrollToIndex` 再走 rect 滚动 + 1.5s 高亮；未归组折叠时等段体挂载后重试（最多 8 帧）。
- **不变**：数据模型/Host 路由/存储/宽度/组拖/搜索索引/排版间距/深色 surfaces；无新增依赖/配置。

### 0.2 0.2.3 打包记录

- 命令：`npm pack`（最终 `npm run build` 后；`files` 只含发布文件）。
- 产物：`dsh-session-groups-0.2.3.tgz`；**119,275 bytes**；unpacked **466.3 kB**；**34 files**。
- sha256：`77011E393E4C144006060C60074ECAA6C5B9A12B0AD07AC36981737894F44D5F`；npm shasum `b0078c85e179874685c643dc843ca5d9e431e1b4`。
- 内容：`src/**`（含新增 `src/client/virtual-list.js`，27 files）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`（共 34）。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

### 0.3 大列表 before/after 实测（同 fixture，1,510 逻辑未归组）

| 指标 | 0.2.2（DOM 全量） | 0.2.3（窗口化） | 变化 |
|---|---|---|---|
| DOM 未归组行 | 1,510 | 20–30 | **−98.5%+** |
| DOM session 行（含 2 组 4 行） | 1,514 | 24 | −98.4% |
| 初始渲染（click → 首行） | 191.2ms | 168.5ms | −12% |
| 滚动两帧 | 18.0ms | 10.3ms | −43% |
| hover 反馈（真实指针） | 12.2ms | 3.8ms | −69% |
| dragover 指示 | 48.0ms | 19.9ms | −59% |
| 窗口外搜索 reveal | 265.5ms | 192.9ms | −27% |
| 可见行拖入组 | 84.8ms | 59.6ms | −30% |
| `tree.scrollHeight` | 51,616 | 51,616 | 不变（spacer 精确） |

搜索目标为记录尾部 `ungrouped` 的真实 root 会话（`session-14168603…`）：before 全量 DOM 中已存在；after 初始窗口 `targetRendered=false`，选中后 `scrollTop=51,158`、行渲染并高亮、下拉关闭。拖放目标为种子组 `g-large-a`，行落组成功。

## 0-0.2.2. V1.1 patch 0.2.2 最终结论（2026-10-29 00:28，UI layout + 主题感知 + drag perf，历史）

**V1.1 patch 0.2.2 UI layout + 拖拽性能 QA 验证线全绿 PASS（最终复跑隔离 home `.spike-homes/qa-0.2.2-e2e-4` + 4405）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **190/190 PASS**（0 fail / 0 skip，~3.9s；本 patch 新增 5 条 UI layout + 3 条 `sameDropTarget` 单测） | 控制台输出 |
| E2E 17 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **17/17 PASS**（step 时间和 72,511 ms，~73s）；`consoleErrors=[]`、`pageErrors=[]` | `scripts/qa/evidence-perf/e2e-20261029-002840.json` + 17 张截图（`screenshots/e2e/`） |
| step 10 重启 hydration | **PASS**（15.6s；groups=4、filter=hidden、`blankLifecycle.drift=false`） | 同上 step 10 detail |
| step 15 搜索开关/关闭 | **PASS**（9.0s）：搜索行默认不渲染 → 搜索图标展开并聚焦；无下拉时 Escape 收起整行、header 关闭按钮收起整行；`searchToggle={escapeCollapsedRow:true, closeButtonCollapsedRow:true}`；嵌套 reveal / only→all / 键盘 listbox 滚动断言保持 | 同上 step 15 detail |
| **step 16 排版+布局** | **PASS**（2.8s）：host/root 14/14 + family 继承；组行 34/会话行 32；组名/标题 14/20；footer 高 28、两段标签 13px/16px、active accent；header action `+`/搜索/视图选项各 28×28、glyph 16、顺序正确；header 收起 36px / 展开搜索 74px + 搜索行 30px；行 padding 8/8、column-gap 6、tree/组体/组线 row-gap 2、组缩进 10/10；搜索列表 6/10 + gap 8/2；**264px header/tree 252/252 无溢出，展开搜索时 header/search row/input 也无溢出** | 同上 step 16 detail |
| **step 17 深色主题 surfaces** | **PASS**（1.8s）：`body[data-ds-dark-theme]` 下搜索结果 bg `rgb(42,43,46)` / text `rgb(249,250,251)`（13.61:1）、菜单 13.61:1、对话框 bg `rgb(44,44,46)`（13.34:1）、dialog input 15.03:1、search input 15.03:1、view-options popover 同菜单材质；全部非白；恢复原 theme 属性 | 同上 step 17 detail |
| 拖拽性能探针（803 行压测） | **PASS**：hold 45 事件 `GroupsView` 47→3、`SessionRow` 1,175→75、`GroupNode` 37,741→2,409；paced 32→10 / 800→250；frame avg 24.07→17.15ms；drop→next frame 17.2→16.2ms；`saving` 标记消失 | `scripts/qa/evidence-perf/perf-before-800.json` / `perf-after-800.json`；`.superpowers/sdd/2026-10-28-session-groups-v1.1/ui-perf-report.md` |
| setup（隔离 home 重建） | **PASS 18/18**；`HOME-0 removed=0`；真实 home 前后 fingerprint 一致；client build **176,007 bytes** / sha256 `59f45afa9a1df79a1d9d9fcbd41ef40e40ffb577ee338bbb6b6aff4c27842b90`；package version `0.2.2` | `scripts/qa/evidence-perf/setup-20261029-002652.json` |
| 打包 | `npm pack` → `dsh-session-groups-0.2.2.tgz`（**113,452 bytes**；unpacked **447,642**；**33 files**；sha256 `3625A5F23968EDB83A79859B442FD1A54A39E220F8153BF60A9E816CA4865DC7`） | 本文件 §0.2 |
| 隔离状态 | `.spike-homes/qa-0.2.2-e2e-4`（+ 0.2.2 UI/perf lanes）保留；4405/4406 已释放；真实 home 零写入 | setup evidence |

### 0.1 0.2.2 UI layout 修复明细（本次 patch）

- **footer**：旧单按钮改为两段 `分组视图 / 工作区视图`（容器 28px、段 28px、13px/20 文本、16px 图标、6px gap，active 段 accent 文本 + 14% accent 底）；点击分别 `setMode('groups')` / `setMode('workspace')`，非盲 toggle；rail 下两段堆叠为 36px 图标按钮（标签由 CSS 隐藏）。
- **header**：标题 `分组` 改为 14/20 primary 文本 + 16px accent folder 图标；右侧固定 `+` → 搜索 → 视图选项（各 28×28 / 16px glyph）；搜索字段默认不渲染，点搜索图标展开 30px 搜索行（打开即聚焦）；正常 header 移除「返回工作区」按钮（仅 FlatFallback 保留）。
- **归档三态**：移入 view-options popover（3 行 × 30px，active 行 check）；点击复用既有 `archive-filter` dispatch 并关闭；Escape/点外关闭；按钮 `data-filter` 保留筛选状态。
- **主题 surfaces**：搜索下拉/菜单/view-options 用 `--dsw-specific-menu`（fallback layer-2/Canvas），对话框 `--dsw-alias-bg-layer-2`，搜索/对话框输入 `--dsw-alias-bg-layer-1`，边框 `--dsw-alias-border-l2/l3`，文本 `--dsw-alias-label-primary/secondary`；移除 `--dsw-elevation-surface` 与所有 `#fff` surface；`Canvas`/`CanvasText` 仅作最后 fallback。
- **拖拽性能（本次同批修复）**：`sameDropTarget` 稳定目标比较 + `setDropTargetTracked` 去重，dragover 目标未变时不再触发 React 全树渲染；`commitDoc` 移除无人消费的 `saving:true/false` 两次全树渲染（state/action 保留兼容）。基准/复测见 `scripts/qa/evidence-perf/`，根因与逐项数字见 `.superpowers/sdd/2026-10-28-session-groups-v1.1/ui-perf-report.md`。
- **不变**：数据模型/Host 路由/存储/宽度/组拖/搜索逻辑未改；无插件字号设置、无新增依赖/配置。

### 0.2 0.2.2 打包记录（UI layout patch）

- 命令：`npm pack`（工作树 = 0.2.2 发布文件；最终 `npm run build` 后重新打包，`lib/client.js` 176,007 bytes；`files` 只含发布文件）。
- 产物：`dsh-session-groups-0.2.2.tgz`；**113,452 bytes**；unpacked **447,642 bytes**；**33 files**。
- sha256：`3625A5F23968EDB83A79859B442FD1A54A39E220F8153BF60A9E816CA4865DC7`。
- 内容：`src/**`（26）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`（共 33）。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

## 0A. V1.1 patch 0.2.1 最终结论（2026-10-28 21:50，排版 + 间距对齐）

**V1.1 patch 0.2.1 spacing QA 验证线全绿 PASS（隔离 home `.spike-homes/qa-0.2.1-spacing` + 4402）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **183/183 PASS**（0 fail / 0 skip，~3.8s；无新增单测） | 控制台输出 |
| E2E 16 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **16/16 PASS**（~81s）；`consoleErrors=[]`、`pageErrors=[]` | `scripts/qa/evidence/e2e-20261028-215034.json` + 16 张截图 |
| step 10 重启 hydration | **PASS**（19.1s；groups=4、filter=hidden、`blankLifecycle.drift=false`） | 同上 step 10 detail |
| **step 16 排版+间距** | **PASS**（2082ms）：host/root 14/14 + font-family 继承；组行 34/会话行 32；组名/标题 14/20；icon/caret/action 16×16；**行 padding 8/8、行 column-gap 6、tree/组体/组线 row-gap 2、组缩进 10/10、header padding 4/6/8/2 + row-gap 8、header 78px（标题行 28 + 搜索行 30）、搜索列表 padding 6/10 + 结果 column-gap 8 + list row-gap 2、264px header/tree 252/252 无溢出** | 同上 step 16 detail |
| setup（隔离 home 重建） | **PASS 18/18**；`HOME-0 removed=0`；真实 home 前后 fingerprint 一致；client build 159,541 bytes / sha256 `cef4fb475e6d6ecfbe2456fd16c13225e41151eb702f628095a011428ff0a464` | `scripts/qa/evidence/setup-20261028-214318.json` |
| 打包 | `npm pack` → `dsh-session-groups-0.2.1.tgz`（**103,874 bytes**；unpacked **407,846**；32 files；sha256 `4ED5DE48F91366A389F80DC67522EDE2846091ED0B911AF1FC95FE634839E2E4`） | 本文件 §0.2 |
| 隔离状态 | `.spike-homes/qa-0.2.1-spacing` 保留；4402 已释放；真实 home 零写入 | setup evidence |

### 0.1 0.2.1 间距修复明细（本次 patch）

- **行**：组行/会话行保持 34/32 高度、`padding: 0 8px`，行内 column-gap 4→**6px**（对齐官方 `projectRow/sessionRow`）；操作按钮 gap 1→2。
- **树/组**：`.dsg-tree` / `.dsg-flat` / `.dsg-ungrouped` / `.dsg-group-body` / `.dsg-group-line` 纵向 gap 统一 1→**2px**；组缩进 margin/padding **9/8 → 10/10**；264px 最小宽度 header/tree 仍无横向溢出（252/252）。
- **header**：padding 2/4/6/2 → **4px 6px 8px 2px**，叠层/行 gap 4/6 → **8px**；28px 文本按钮上保持官方 36px section-header 等效纵节奏（28px 控制行 + 12px 纵向 padding = 40px）；header 总高 78px（28+8+30+4+8）。
- **搜索**：结果 padding 5/8 → **6px 10px**，结果内 gap 6→8；下拉 padding 4→**6px 10px**，结果间 gap 1→2；搜索框仍 30px/13。
- **菜单**：item 28→**30px**、padding 0 8→**0 10px**、gap 6→8；menu padding 4→6、gap 1→2；section padding 4/8/2→**6px 10px 2px**。
- **对话框**：padding 14→**16px**、gap 10→12；input padding 0 8→**0 10px**；actions gap 8→10；confirm/cancel 横 padding 12→**14px**。
- **未归组/横幅/空组**：未归组头 gap 4→6；banner padding 6/8→**8px 10px**、margin 4/2/6→**6px 2px 8px**；组空态 padding 3/6→**4px 8px**。
- **不变**：字体/字号/行高/图标尺寸均未改；无插件字号设置、无新增配置/依赖、无数据/路由/契约变化。

### 0.2 0.2.1 打包记录（spacing patch）

- 命令：`npm pack`（工作树 = 0.2.1 发布文件；README 已定稿；`files` 只含发布文件；旧 0.2.1 tarball 被同名替换）。
- 产物：`dsh-session-groups-0.2.1.tgz`；**103,874 bytes**；unpacked **407,846 bytes**；**32 files**。
- sha256：`4ED5DE48F91366A389F80DC67522EDE2846091ED0B911AF1FC95FE634839E2E4`；npm shasum `32404ed0e57942c30de9d81a07a1f1851e58728f`；integrity `sha512-XRnkwYJ5cxqj0y3FaVeu4sUiZniFitGOvyPrhzs/M3N93amyIDO+vi7yFqE88ozMMdVfCDA6LoR91LfzGeh39w==`。
- 内容：`src/**`（25）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`（共 32）。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

## 0B. V1.1 patch 0.2.1 typography-only（2026-10-28 21:24，历史）

**V1.1 patch 0.2.1 typography-only QA 验证线（历史；已被 §0A spacing patch 取代，隔离 home `.spike-homes/qa-0.2.1-final` + 4402）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **183/183 PASS**（0 fail / 0 skip，~3.8s） | 控制台输出 |
| E2E 16 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **16/16 PASS**（~71.5s）；`consoleErrors=[]`、`pageErrors=[]` | `scripts/qa/evidence/e2e-20261028-212407.json` + 16 张截图 |
| step 10 重启 hydration | **PASS**（17.2s；groups=4、filter=hidden、`blankLifecycle.drift=false`） | 同上 step 10 detail |
| **step 16 排版（新增）** | **PASS**（256ms）：host/root font-size **14/14**、font-family 继承；组行 **34**、会话行 **32**；组名/会话标题 **14/20**；workspace 徽标 **12**；搜索框 **13/30**；group icon **16×16**、caret **16×16**、action glyph/button **16×16**；根内 **48** 个 `.dsg-glyph`/`.dsg-icon` 全 16px；`--dsg-font-14` 解析 **14px** | `e2e-20261028-212407.json` step 16 detail |
| setup（隔离 home 重建） | **PASS 18/18**；`HOME-0 removed=0`；真实 home 前后 fingerprint 一致；client build sha256 `711f57be…b36d9d5a` | `scripts/qa/evidence/setup-20261028-212010.json` |
| 打包 | `npm pack` → `dsh-session-groups-0.2.1.tgz`（**103,391 bytes**；32 files；sha256 `88DF099F449636F80CC0C7748BFFAE7EC382DA189EA997DE93E6EB3705952D8B`） | 本文件 §0A.2 |
| 隔离状态 | `.spike-homes/qa-0.2.1-final` 保留待最终清理；4402 已释放；真实 home 零写入 | setup evidence |

### 0A.1 0.2.1 排版修复明细

- **无插件字号设置**：`.dsg-root` 使用 `font-size: inherit; font-family: inherit; line-height: 1.4`；宿主侧栏基线（DSH Desktop 2.0.18 = 14px）为准，没有字号 config/setting、没有新增依赖。
- **官方 token**：固定字号统一经 `--dsg-font-14/13/12/11` → 官方 `--dsw-font-s-14-font-size` / `--dsw-font-xs-13-font-size` / `--dsw-font-xxs-12-font-size` / `--dsw-font-xxxs-11-font-size`（px fallback；10px 徽标无官方 token，固定 10px）。注：任务书写的 `--dsw-font-sm-14` 在 2.0.18 不存在，实测官方 token 为 `--dsw-font-s-14-font-size`（theme `lib/client.js`），按实际宿主 token 实现。
- **官方度量**：组行/未归组头 34px、会话行 32px、标题 14/20；组计数 12、workspace 徽标 12、归档徽标 10/16；搜索框 30/13、结果标题 14/20、meta 12/20、badge 10/16、空态 13；header 标题 14/20、文本按钮 28/13、图标按钮 28×28；菜单项 13/28、菜单 section 11；dialog 标题 14/正文 13/输入 13×32/按钮 13；toast 13、banner 12、rail label 11、floating label 12、group empty/empty/flat 13。
- **图标**：`renderGlyph` 默认 16；组 caret / 组图标 / IconButton / 组与会话操作按钮均 16px（操作按钮 16×16）；rail 保持 18px。
- **E2E**：step 16 在 step 15 后（分组视图仍激活）纯读 DOM 断言；无插件状态写入，不依赖截图（runner 仍按惯例保留截图）。

### 0A.2 0.2.1 打包记录

- 命令：`npm pack`（工作树 = 0.2.1 发布文件；README 已定稿；`files` 只含发布文件）。
- 产物：`dsh-session-groups-0.2.1.tgz`；**103,391 bytes**；unpacked **406,821 bytes**；**32 files**。
- sha256：`88DF099F449636F80CC0C7748BFFAE7EC382DA189EA997DE93E6EB3705952D8B`；npm shasum `e897b33546173d53411d8746546bf30d218b0cd4`；integrity `sha512-QxIFgiz4Ctw5EFKZvAkO4LEfT59l5/4tPR5g6p+DX3Ec+WORCrs40QKEIRHBHpiBRJ1+RtEjfH2MErKhGZaBlw==`。
- 内容：`src/**`（25）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`（共 32）。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

## 0C. V1.1（0.2.0）最终结论（2026-10-28 19:24，历史）

**V1.1 QA 验证线全绿 PASS（0.2.0，隔离 home `.spike-homes/qa` + 4402）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **183/183 PASS**（0 fail / 0 skip，~3.8s） | 控制台输出 |
| E2E 15 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **15/15 PASS**（~76s）；`consoleErrors=[]`、`pageErrors=[]` | `scripts/qa/evidence/e2e-20261028-192421.json` + 15 张截图 |
| step 10 重启 hydration | **PASS**（16.0s；等待组数/行数/已知会话就绪；`blankLifecycle.drift=false`） | 同上 step 10 detail |
| 数据审计 commit probe | **PASS 11/11**：revision **31→32**；仅 `dsh-session-groups.json` 变化；`workspace.json` + 3 sample session + desktop/web profile 指纹不变 | `scripts/qa/evidence/audit-exercise-20261028-192609-commit.json` |
| setup（隔离 home 重建） | **PASS 18/18**；真实 home 前后 fingerprint 一致；client build sha256 匹配 | `scripts/qa/evidence/setup-20261028-192032.json` |
| 打包 | `npm pack` → `dsh-session-groups-0.2.0.tgz`（102,152 bytes；32 files；sha256 `96BDBF5252B1BD785E63D6FF9DFDF5D1B92FDA4F0ECFE99D3BFFCBDABCE82C8A`） | 本文件 §0B.3 |
| 隔离状态 | `.spike-homes/qa` **保留**待最终清理；4402 已释放；真实 home 零写入 | setup/audit evidence |

### 0B.1 V1.1 新增三步明细（final fix wave 增量）

- **step 2 冷启动**：进入分组视图后显式等待会话行 >0（30s 上限）再做计数，消除 fresh server 快照未 hydrate 的 step 2 抖动。
- **step 13 宽度**：官方宽度 280 → 1024px 挂载 clamp 544 → 1440px 恢复 620 → 拖到 760/620 → reload 620 → 700px rail 不覆盖（无把手，官方 280）→ 1440px 恢复 620 → 双击 420 → 拖到 264 且 header `scrollWidth 252 ≤ clientWidth 252` → 折叠/展开保持 264 → **快速释放拖到 500 时 applied=stored=500** → **800px 双击复位 applied=320 但偏好持久化 420；回 1440px 恢复 420** → 官方宽度 280、官方把手恢复。
- **step 14 组拖**：c→b 组体槽（b 有会话 0 子组，index 0）→ c 拖回根 → a（带子组）→ 空组 e（子树跟随）→ c→未归组头（根末尾）→ a→b 上缘；快速双拖根/child 锚点均按最新 doc 重算；自身/末位 no-op 不涨 revision；**组菜单上移启用路径 [b,e,a]**、**中间 50% 无效落点不提交且出无效 toast**、**同位置 after 落点不提交**；全树 `n+1` 槽（3/1/1/2…）且无槽渲染在会话行后；b 的会话数始终 3；**真实指针从组 `+` 按钮拖向 e：dragstart `prevented=true`，根顺序/parent/revision 全部不变（probe 记录于 evidence）**。
- **step 15 搜索**：把重命名后的廉价 blank 目标移入嵌套子组，折叠子组与祖先 a 并切归档筛选 `only` 后搜唯一标题 → ArrowDown/Enter → **筛选 only→all**、**a 与子组同时 `data-expanded=true`**、行 `dsg-search-hit`、树滚动 `0→2188`；归档会话结果 `data-archived=true`/`aria-disabled=true`，Enter 不切当前会话；**宽查询 `Projects` 结果 >12，连按 ArrowDown 后 active option 完全在 320px listbox rect 内且 `scrollTop=119`**；无结果空态、Esc/点外关闭；`groups`/`ungrouped` 前后一致（rev 31，记录不变）。

### 0B.2 冷启动观察

- 本轮 fresh setup 后的 E2E 尝试中，step 2 均未再出现 zero rows；step 2 已与 step 10 一样等待 session rows >0（30s）后才断言。final fix 后官方 E2E 一次 15/15 PASS（`e2e-20261028-192421.json`）。
- 调试过程证据保留：`e2e-20261028-190917.json`、`e2e-20261028-191709.json` 两次在 step 14 失败（真实指针拖动前 `+` 按钮被 tree 滚动裁剪，护栏尚未命中），不作为验收证据；`e2e-20261028-180738.json` 为上一轮 15/15 通过记录，可追溯。

### 0B.3 0.2.0 打包记录

- 命令：`npm pack`（工作树 = final fix wave 的发布文件；README 已在打包前定稿，`files` 只含发布文件；打包后只改不随包发布的 `docs/`）。
- 产物：`dsh-session-groups-0.2.0.tgz`；**102,152 bytes**；unpacked 402,471 bytes；**32 files**。
- sha256：`96BDBF5252B1BD785E63D6FF9DFDF5D1B92FDA4F0ECFE99D3BFFCBDABCE82C8A`；npm shasum `de5c52186c1a1c092bcb77e27a8b32b5f8bc7169`；integrity `sha512-ZR8yoB7R6PXCAmpopxdbPEtDOhzamMf6Ixe/c7VBrp3NUxHBl01vbeiwqAHVJtRbnDLo6LzSnPsY06YvRA+FAg==`。
- 内容：`src/**`（25）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

## 0D. V1 最终结论（2026-10-19 02:51，历史）

**V1 QA 验证线全绿 PASS：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量，含 QA 独立线） | **151/151 PASS**（0 fail / 0 skip，~3.9s） | 控制台输出 |
| Host 集成（QA 独立，`tests/integration/**`） | **16/16 PASS**：H1–H10 + 契约状态码/原子写/坏文件/版本过高/并发/围栏/只写记录文件/入口/存储路径 | §2；临时目录 + fake ctx 驱动真实 route handlers |
| Client 逻辑（QA 独立，`tests/client-logic/**`） | **19/19 PASS**：shared invariants + state/filter/drag/tree 纯函数 + bundle/testid 静态检查 | §2 |
| E2E 12 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **12/12 PASS**（~35s） | `scripts/qa/evidence/e2e-20261019-025116.json` + `evidence/screenshots/e2e/`（20 张） |
| 数据审计 load-only | **PASS 10/10**：`workspace.json` + 3 sample session + 真实 profile 指纹不变；记录文件未变（rev 16） | `evidence/audit-exercise-20261019-025226-load.json` |
| 数据审计 commit probe | **PASS 11/11**：仅 `dsh-session-groups.json` 变化（rev **16→17**），其它全不变 | `evidence/audit-exercise-20261019-025228-commit.json` |
| setup / teardown（隔离 home） | **PASS 18/18** / **PASS 6/6**；真实 home fingerprint 前后一致；`.git` 与仓库根未被触碰 | `evidence/setup-20261019-025017.json`、`evidence/teardown-20261019-025300.json` |
| 真实 home 安全 | 全程零写入（四处 fingerprint 一致）；`.spike-homes/qa` 已整删；4402 已释放 | 同上 |

## 1. E2E 12 步明细（V1 终验，`e2e-20261019-025116.json`；V1.1 新增 13-17 见 §0/§0C.1）

| # | 步骤 | 结果 | 关键观察 |
|---|---|---|---|
| 1 | 打开 4402，默认官方工作区视图 | PASS | `toggle[data-mode=workspace]`，无 groups view；3 个 fixture workspace 标题渲染 |
| 2 | 点「分组视图」 | PASS | `session-groups-view` 出现；14 个 ungrouped 会话、0 组 |
| 3 | 建 3 组（1 个二级嵌套） | PASS | 4 个组行，嵌套组 `data-depth=1` |
| 4 | 跨工作区拖 10 个会话 | PASS | 14→4 ungrouped；10 条落组，行 `data-group-id` 正确 |
| 5 | 组内拖拽排序 | PASS | 同组顺序改变并持久化 |
| 6 | 组头 `+` 新建（预创建工作区菜单） | PASS | 落组首行、全局只 1 条；工作区 `CosineVoiceProjects ★` |
| 7 | 归档三态 | PASS | hidden/all/only 三态正确；取消归档回原组 |
| 8 | 重命名 → 官方侧栏同步 | PASS | 目标 ∈ `hostSessionIds()` 且非 blank/合成；官方侧栏展开 workspace + 搜索均命中新标题；无删除入口 |
| 9 | 56px rail 可展开 | PASS | rail 占位 + 展开按钮，展开后分组视图恢复 |
| 10 | 重启 profile 后结构/顺序保持 | PASS | 非 blank 组顺序一致；归档 filter 保持；重命名保留；`blankLifecycle.drift=false`（宿主保留同一 current blank；旧 blank 未复活、新 blank 未进组） |
| 11 | 切回官方视图无重复 | PASS | groups view 卸载；workspace 标题齐全；重命名标题出现 ≤2 次（无重复行） |
| 12 | 数据审计（E2E 内） | PASS | 基线→操作后只有记录文件变化（`-AllowHostSessionChanges` 把宿主会话动作记 WARN） |

## 2. 测试层覆盖

### Host 集成（`tests/integration/`，独立于 `tests/host`）
- `host-routes.test.js`：H1 首次 load、H2 commit、H3 409 不覆盖、H4 422、H5 原子写（无 tmp、`.bak` 存在）、H6 坏 JSON 隔离+warning、H7 version>1 409 不覆盖、H8 并发（一 200 一 409）、H9 围栏（缺失 503 / reject 403 / throw fail-closed）、H10 只写记录文件（workspace.json/session hash 不变）、契约状态码（405+Allow/413/415/422/503）、响应头（JSON、no-store、无 CORS）。
- `host-entry.test.js`：`apply()` 返回 void、`ctx.effect` 注册/清理、无 webServer fail-soft。
- `host-home.test.js`：`dshHomePath('storages')`/fallback 在注入 `DSH_HOME` 下解析，无硬编码真实 home。

### Client 逻辑（`tests/client-logic/`，独立补强，不重复实现方测试）
- `shared-invariants.test.js`：CONTRACTS invariant 8（ungrouped 派生 newest-first+stored）、归档三态/空组、subagent(origin)/fork(parentId)/blank(仅当前) 可见性、孤儿保留不渲染、D6 工作区推断矩阵、确定性/不可变、80/81 名称边界、跨父级 move 顺序/子树、assign index clamp、删除非破坏幂等、validate/normalize 分类。
- `client-surface.test.js`：state viewMode/filter 持久化默认与 key；`buildVisibleTree` 三态；`hitTest`/`applyDrop`（before/after/append/ungrouped/invalid/自身无效/no-op）；`groupAncestors`/`groupPath`/`flattenTree`（折叠只出组头）；无 dsh-client-runtime + react externals；CONTRACTS §4.1 testid 静态存在性。

### E2E runner
`e2e/groups.spec.mjs`（+ `e2e/cdp.mjs`）：零依赖，直连 Playwright 缓存的 Chromium（CDP + Node 内置 WebSocket），选择器全部取自 CONTRACTS §4.1 testid；per-step watchdog + CDP 请求超时 + 安全截图，保证失败可诊断不挂死；BLOCKED(exit 3) 与 FAIL(exit 1) 区分。证据：`evidence/e2e-<ts>.json`、`evidence/screenshots/e2e/NN-*.png`、`evidence/e2e-live.log`。

## 3. 数据审计（`scripts/qa/audit.ps1`，仅 `.spike-homes/qa`）

- 对象：`storages/workspace.json`、3 个 sample session 目录（逐文件 SHA256 manifest）、记录文件、真实 desktop/web/groups-spike profile 指纹。
- load-only：workspace/sample/profile 全不变；记录文件未变（revision 16）。
- commit probe：仅记录文件变化（revision 16→17）；workspace/sample/profile 不变。
- E2E step 12 使用 `-AllowHostSessionChanges` 区分“分组操作（必须只写记录文件）”与“用户主动宿主会话动作（新建/改名/归档，允许改 workspace/session）”——与 `docs/TEST-PLAN.md §7` 一致。

## 4. 隔离与安全（含 2026-10-19 incident 收口）

- `setup.ps1` 以 `<repo>\.spike-homes\qa\staging\dsh-session-groups` 复制发布文件后 `link:` staging，**不 link 仓库根**。已验证：profile `node_modules/dsh-session-groups` = Junction → `Target=<home>/staging/dsh-session-groups`（非仓库根），无递归 `.spike-homes` 嵌套。
- `teardown.ps1` 先移除 profile 下 junction/symlink（不跟随），再仅删除 `.spike-homes/qa`；删除前打印绝对路径并断言前缀。
- 本日曾发生 junction 指向仓库根导致 pnpm 递归、`.git` 被跟随删除的 incident；Lead 已从对象库恢复 `.git`。根因修复即上述 staging 方案。本次终验前后 `git rev-parse HEAD` 相同（672b40c）、status 与 `.git` 顶层条目数（11）一致；仓库根与真实 home 零写入。
- 真实 home 只读：fixture 复制 `sessions/** + storages/workspace.json + storages/session_projcache/**`；**不复制** `.credentials.yaml` / `.anonymous-user-id`；setup/teardown/audit 多处 fingerprint 一致。

### Fixture 说明
- 真实 home 的会话以 subagent 会话为主（UI 过滤），可见 root 会话仅 ~7 个；为满足 E2E step 4“跨工作区拖 10 个会话”，`scripts/qa/make-fixtures.mjs` 在隔离 home 内**克隆真实 root 会话**（重写 zstd v4 JSONL header 内 session id，保证 host 校验一致）并登记到夹具 workspace.json —— 仅写 `.spike-homes/qa`，真实 home 零写。合成 id 形如 `session-00000000-…`；E2E step 8 目标刻意排除合成/blank（`hostSessionIds()` 过滤），保证官方 rename/search 可落盘。

## 5. 缺陷 / 观察 / 已知限制

| ID | 类型 | 描述 | Owner | 状态 |
|---|---|---|---|---|
| QA-V1-001 | 已修复（client） | drop 冒泡到父组、快速连续 drop stale doc 覆盖、组内新建用 startSession+快照 diff、blank 改名后 title 同步 | client-engineer | FIXED（be3171f；E2E 复验） |
| QA-V1-002 | 测试夹具 | E2E 目标曾命中无 session 目录的 blank/合成会话 → host rename 无法落盘；已加 `hostSessionIds()` + non-blank 过滤 | QA | FIXED |
| QA-V1-003 | 测试工具 | E2E step10 重启曾因 `spawnSync` 继承 stdio 等 EOF 卡 300s；已改 `spawnPwshQuiet`（stdio ignore） | QA | FIXED |
| QA-V1-004 | 已知限制（BLOCKED-ENV） | 运行中归档确认框（`archive-running` / stopActivity）未 live 跑：隔离 home 无 running 会话；建议真实 profile 按 TEST-PLAN §6 手工补验 | client-engineer / 用户 | OPEN（不阻塞 12 步） |
| QA-V1-005 | 环境性 warning | 隔离 home 首启有宿主 `[session-controller] control stream failed` 日志 / preview overlay；非插件错误，smoke 插件 console error = 0 | 宿主环境 | KNOWN |
| P2 记录 | 范围 | V1.1 已交付：拖组改父级、标题/工作区/组路径搜索、组菜单上移/下移；仍 P1：撤销/置顶徽标/折叠组聚合计数；颜色等 P2 | Client | V1.1 部分关闭 |
| P2 记录 | 宿主 | `--from-default-profile` 在 Windows 偶发 staging 目录 EPERM/ENOTEMPTY（残留目录，不影响功能；teardown 整删 home） | 宿主 | 记录 |

## 6. 复现命令

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups

# 仓库全量测试（含 QA 独立线）
npm test

# 一键 V1/V1.1 QA（setup → integration → build → start 4402 → smoke → E2E 18 步 → audit → teardown）
pwsh -NoProfile -File scripts/qa/run-v1.ps1

# 分步
pwsh -NoProfile -File scripts/qa/setup.ps1
pwsh -NoProfile -File scripts/qa/start-web.ps1
node e2e/groups.spec.mjs --evidence-dir scripts/qa/evidence --port 4402
pwsh -NoProfile -File scripts/qa/audit.ps1 -CommitProbe
pwsh -NoProfile -File scripts/qa/teardown.ps1
```

E2E 期间 4402 为 QA 独占；client 用复制 home + 4403，互不干扰。

## 7. 更新记录

- 2026-10-29 12:05：**0.2.4 插入占位 + 乐观 drop 提交 patch** —— `npm test` **211/211**；E2E **18/18 PASS**（79,277ms；`console/pageErrors=[]`；step 10 虚拟化感知重启断言：groups/filter/顺序/组内行全等，DOM 行只要求 floor 20；step 18 九类占位 32/34px、push 36px、264px 无溢出、会话 296ms/分组 14ms 内乐观重排且 HTTP 前 revision 不变）；setup 18/18（`removed=0`、client build 195,772 bytes / sha `1416bb40…`）；`npm pack` 35 files / 128,218 bytes / sha256 `F519BFBD…`；`.spike-homes/qa-0.2.4-final4` 保留，真实 home 零写入。
- 2026-10-29 08:07：**0.2.3 虚拟化 + footer/header 回退 patch** —— `npm test` **203/203**；E2E **17/17 PASS**（82,357ms；step 1 单按钮三态/rail 28px；step 2/16 header 顺序 search→view-options→plus；step 9 rail footer 28×28 图标；step 13/16 footer 28/13/16 + 264px 无溢出；step 16 虚拟窗口 total/end-start/rendered；`console/pageErrors=[]`）；大列表 probe **PASS**（1,510 逻辑行：DOM 1,510→20、hover 12.2→3.8ms、dragover 48→20ms、search 266→193ms、drop 85→60ms、scrollHeight 51,616 不变）；setup 18/18（`removed=0`、client build 182,529 bytes / sha `774d8fc0…`）；`npm pack` 34 files / 119,275 bytes / sha256 `77011E39…`；`.spike-homes/qa-0.2.3-e2e` + `qa-0.2.3-large` 保留，真实 home 零写入。
- 2026-10-29 00:28：**0.2.2 UI layout + 主题感知 + drag perf patch（最终复跑）** —— `npm test` 190/190；E2E **17/17 PASS**（step 时间和 72,511ms；step 1 footer 两段标签/active/显式 setMode 往返；step 2 header 顺序/搜索收起/view-options 三行 30px + Escape/点外关闭；step 13/16 header 36px + 264px 展开搜索无溢出；step 14 中间 50% 无效 toast 改为等待旧 toast 过期后再断言（去 flake）；step 15 无下拉 Escape/关闭按钮收起搜索行；step 16 footer/header 度量；step 17 深色 surfaces 对比度 13.3–17.4；`console/pageErrors=[]`；step 10 PASS 15.6s）；setup 18/18（`removed=0`、client build 176,007 bytes / sha `59f45afa…`）；`npm pack` 33 files / 113,452 bytes / sha256 `3625A5F2…`；`.spike-homes/qa-0.2.2-e2e-4` 保留，真实 home 零写入。
- 2026-10-28 21:50：**0.2.1 间距对齐 patch** —— `npm test` 183/183；E2E **16/16 PASS**（step 16 扩充间距断言：行 padding 8/8 + gap 6、tree/组体/组线 row-gap 2、组缩进 10/10、header 4/6/8/2 + row-gap 8 + 78px、搜索 6/10 + gap 8/2、264px header/tree 252/252 无溢出；`console/pageErrors=[]`；step 10 PASS 19.1s）；setup 18/18（`removed=0`、client sha `cef4fb47…`）；`npm pack` 32 files / 103,874 bytes / sha256 `4ED5DE48…`；`.spike-homes/qa-0.2.1-spacing` 保留。
- 2026-10-28 21:24：**0.2.1 排版对齐 patch** —— `npm test` 183/183；E2E **16/16 PASS**（新增 step 16：root 继承宿主 14px、组行 34/会话行 32、标题 14/20、workspace 徽标 12、搜索框 13/30、48 个图标全 16px；`console/pageErrors=[]`；step 10 PASS 17.2s）；setup 18/18（`removed=0`）；`npm pack` 32 files / 103,391 bytes；`.spike-homes/qa-0.2.1-final` 保留待最终清理。
- 2026-10-28 19:24：**final review fix wave** —— `npm test` 183/183、E2E 15/15 PASS（console/pageErrors 空；step 2 加 hydration wait；step 13 快速释放/800→1440 复位；step 14 真实 `+` 指针拖拽守卫、中间 50%、同位置 no-op、启用 move-up；step 15 嵌套祖先 reveal、only→all、键盘滚动 listbox）、audit commit 11/11 PASS（rev 31→32）、setup 18/18 PASS、`npm pack` 32 files；`.spike-homes/qa` 保留待最终清理。
- 2026-10-28 18:07：V1.1 QA 全绿（0.2.0）—— `npm test` 181/181、E2E 15/15 PASS（step 10 含 hydration wait）、audit commit 11/11 PASS（rev 29→30）、setup 18/18 PASS；`.spike-homes/qa` 按任务要求保留待最终清理；冷启动两次 step 2 失败证据见 §0C.2。
- 2026-10-19 02:51：V1 QA 终验全绿 —— `npm test` 151/151、E2E 12/12 PASS、audit load 10/10 + commit 11/11 PASS、setup 18/18 + teardown 6/6 PASS；真实 home 与 `.git` 零写入；`.spike-homes/qa` 已清理、4402 已释放。
- 2026-10-18 23:2x：初版（Host 集成 16/16、client-logic 18+1、E2E BLOCKED 等 client build）。
