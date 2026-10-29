# dsh-session-groups 0.2.5 — 官方 header 图标 + 拖拽诊断交付报告

- 日期：2026-10-29
- 分支：`feature/v1.1-session-groups`；基线 HEAD `5ec3a4b`（0.2.4）
- 工作目录：`C:\Users\Momiji\Projects\dsh-session-groups`
- 结论：**PASS**——tests 234/234、E2E 18/18（默认诊断开启，console/pageErrors 空）、diagnostics route + 隔离 home NDJSON 写入 PASS、audit PASS、0.2.5 打包完成；本地提交、未 push、未安装 desktop。
- 删除操作清单：**手动删除：空**（本任务未删除任何文件）；QA setup 在隔离 home 重置 2 个 record-family 文件（`HOME-0 removed=2`，harness 自动行为），仓库/真实 home 无删除。
- 真实 `~/.dsh`：只读；setup/audit 前后 desktop/web profile 与 sample sessions fingerprint 均不变。

## 1. A. 官方 header 图标（DSH Desktop 2.0.18 primitives）

来源：`@deepseek-ai/dsh-client-ui-primitives/lib/index.js`（2.0.18）实际 artwork；插件仍自带 inline SVG（CONTRACTS §0 不依赖宿主图标集），但几何逐字节复制。

| Header 按钮（testid，顺序不变） | 官方 artwork | 渲染 |
|---|---|---|
| `session-groups-search-toggle`（搜索） | `IconSearchOutlineRegular`：`M6.58727 11.8586…`（圆）+ `M10.2991 10.3933L14.7783 14.8725`（柄） | 16px、viewBox 0 0 16 16、stroke 1、currentColor；搜索行展开时仍是同一 16px 图标（官方为 14/11，但本项目按钮 28px，任务书允许 16） |
| `session-groups-view-options`（视图选项） | `IconSlidersTwoOutlineRegular`：`M2.3 5h5.85M12.05 5h1.65`、`M2.3 11h1.65M7.85 11h5.85` + circles `(9.95,5,1.45)`、`(5.75,11,1.45)` | 16px、stroke 1、stroke-linecap round |
| `session-groups-new-group`（新建分组） | `IconProjectAddOutlineRegular`：填充项目轮廓 `M5.54492 2.06738…Z` + `M9.75977 4.50208H14.5509` + `M12.1492 6.89758L12.1492 2.10642` | 16px、轮廓 fill=currentColor、plus stroke 1 |

实现：`src/client/icons.js` 新增 `HEADER_ICON_ARTWORK` / `HEADER_ICON_NAMES` / `renderHeaderIcon`；`components.js` 的 `IconButton` 支持 `icon` 并优先渲染官方 artwork。顺序保持 0.2.3/0.2.4 的 search → view-options → plus；其它 glyph（close/check/folderAdjust 等）与分组图标集不变。单测 `tests/client/icons.test.js` 逐字节锁定几何与 16px/1px 契约，`ui-layout.test.js` 锁定 header 映射与顺序。

## 2. B. 拖拽诊断

### 2.1 客户端 trace（`src/client/diagnostics.js`）

- 默认**开启**（0.2.5 build）；`localStorage['dsh-session-groups.diagnostics'] = '0'` 关闭（无需重建）；`globalThis.__DSG_DIAGNOSTICS__ = false` 仅测试 seam。
- 环上限 4000（内部 512 slack 批量裁剪；snapshot 仍严格 ≤4000）；发送队列上限 800（溢出计 `dropped`）。
- 批量：≥20 事件或 500ms 触发；单请求 ≤120 事件；`fetch` 失败保留队列并重试（≤2 次，1s 后），之后丢弃并计 `flushFailures`；dragend / visibility hidden / pagehide 用 `sendBeacon`（48KB 分片）。
- native 监听：`dragstart/dragenter/dragover/dragleave/drop/dragend` 在 `document` capture + bubble 两相（bubble 可能被插件 `stopPropagation` 截断，capture 始终有记录）。
- 计时：每个拖拽 handler ms、rAF frame gap（≥100ms 记 `perf.frame-gap`）、`PerformanceObserver('longtask')`、四组件 render 计数、revision/optimistic、tree counts（groups/ungrouped/visibleSessions）、viewport/sidebarWidth、build/version、mode/theme。
- HUD：`session-groups-diagnostics-hud`，fixed 右下、`pointer-events:none`、纯 DOM 文本、250ms（≤4Hz）更新；不经 React、不随事件 render。字段：runId、native dragover 数、target changes、renders、last handler ms、last frame gap、last label、drop/optimistic 状态、revision、pending queue。
- 隐私：不记录会话标题/transcript；只含 ID、testid、分组名与翻译后的拖拽提示（本地文件）。

### 2.2 事件 schema（`schemaVersion = 1`）

文件每行 envelope：

```json
{ "receivedAt": "2026-10-29T05:19:37.628Z", "runId": "dsg-mvt3g7tn-75ij50", "schemaVersion": 1,
  "event": { "v": 1, "runId": "dsg-…", "seq": 1, "t": 546.3, "ts": 1793251177116, "type": "native.dragover",
             "ctx": { "build": "0.2.5", "runtime": "web", "mode": "groups", "theme": "light",
                      "revision": 12, "optimistic": false, "groups": 3, "ungrouped": 10,
                      "visibleSessions": 21, "viewport": 1424, "sidebarWidth": 420,
                      "renders": { "GroupsView": 12, "Header": 11, "GroupNode": 30, "SessionRow": 120 },
                      "dragActive": true },
             "event": "dragover", "phase": "capture",
             "target": { "tag": "div", "testid": "session-groups-session", "sessionId": "s-1", "groupId": null, "ungrouped": null,
                          "rect": { "x": 120, "y": 340, "w": 300, "h": 32 } },
             "x": 120, "y": 340, "prevented": false, "trusted": true } }
```

事件类型（首个实现版本）：

- native：`native.dragstart|dragenter|dragover|dragleave|drop|dragend`，字段 `event/phase/target{x,y,w,h}/x/y/prevented/trusted`；`defaultPrevented` 在 capture 记 before、bubble 记 after，插件 handler 的 `handler` 事件也带 `prevented` after。
- plugin handler：`handler`（`handler/ms/x/y/target/prevented/dragKind`），覆盖 `onDragStart / onGroupDragStart / onDragEnd / onDragLeave / onDragOver* / onDrop* / onGroupDragStart / onPlaceholderDragOver / onPlaceholderDrop`。
- 生命周期：`drag.start`（session/group + 安全 id）、`drag.end`、`drop.accept` / `drop.reject` / `drop.state`、`dropTarget.change`（from/to 稳定字段）、`placeholder.insert|remove`、`label.change`（text，可空）、`autoexpand.schedule|fire|cancel`、`mode.change`、`run.start`。
- optimistic/HTTP：`optimistic.enqueue`（coalesced/revision/waiters）、`optimistic.dispatch`、`optimistic.defer`、`optimistic.reject`、`queue.send`、`queue.reconcile`、`queue.rollback`、`queue.strict.start|end`、`http.start`（path/method）、`http.end`（status/ok/ms/error）。
- timing：`perf.frame-gap`（gap）、`perf.longtask`（duration/start/name）。

### 2.3 Host 落盘路由

- `POST /dsh-session-groups/diagnostics`（`src/host/routes.js`）：
  - 与 `load`/`commit` 相同 `connection.requestRejection` fence；JSON only；body ≤256 KiB；events 数组 1..500 且每项为对象。
  - 状态：200 `{ok:true, appended:N}` / 405+Allow / 413 / 415 / 422 / 503 fence-unavailable|io。
  - append-only：逐行写 `{receivedAt, runId, schemaVersion, event}` 到 `<dshHomePath('storages')>/dsh-session-groups.diagnostics.ndjson`；目录不存在递归创建；不 fsync、不写 `.bak`、绝不读取/修改 `dsh-session-groups.json`、`workspace.json`、session 数据。
  - 路径推导用 `dirname(record.filePath)`：生产即 storages；测试覆盖 `filePath` 时不会指向真实 home（修复了初版用 `storageDir` 导致测试 seam 计算真实 home 的问题）。
- `scripts/qa/audit.ps1`：诊断文件纳入允许的 append-only 文件，新增 AUD-5（长度只增不减），不计入插件对官方数据的写入。
- 单测：`tests/host/routes.test.js` 新增 3 条（追加/只创建诊断文件、405/415/422/413/fence 矩阵、parse）；`tests/host/entry.test.js` 更新为 3 路由并断言 diagnostics 路径。

### 2.4 分析器 `scripts/qa/analyze-drag-trace.mjs`

```powershell
node scripts/qa/analyze-drag-trace.mjs <ndjson> [--run <runId>] [--json]
```

输出每个 run：事件/类型/handler 计数、target-change timeline、label 序列、>100ms gaps（含 dragActive）、native vs synthetic（trusted 统计）、autoexpand、placeholder、optimistic/HTTP 相位与耗时、frame gap/longtask、最后指针移动（dragover/dragenter/dragleave/drop，排除 dragstart/dragend）到 dragend 的 burst 检测（≥25 事件或 ≥750ms 且 ≥5 事件）、疑似 stalls（frame-gap / longtask / slow-handler≥50ms / slow-http≥500ms / burst / unsettled optimistic / drop 无 queue send / dragActive 内 ≥2s freeze）。纯函数 `parseTrace/groupByRun/summarizeRun/summarizeTrace/renderSummary` 由 `tests/qa/analyze-drag-trace.test.js`（4 条）覆盖。

### 2.5 真实 trace（E2E 18 步，默认开启）

- 文件：`.spike-homes/qa-0.2.5/storages/dsh-session-groups.diagnostics.ndjson`（隔离 home，本地保留；1,878,640 bytes）
- 记录：**3,091 行（E2E 记录时；当前文件 3,093 行）/ 12 runs（11 个页面 run + 1 个 probe）/ 0 parseErrors**
- 合计：native 933（capture+bubble）、handler 462、placeholder insert 114 / remove 114、queue 72 send / 72 reconcile / 0 rollback、autoexpand schedule/cancel 命中、label 序列正确（如 `放入『施工中』` → 空）
- 慢 handler（≥50ms）：**0**；longtask 仅启动/宿主渲染；拖拽 gesture 内无 >2s freeze（手势边界已排除）；burst 窗口 15 事件/1ms（未超阈值）
- 分析器：`node scripts/qa/analyze-drag-trace.mjs .spike-homes/qa-0.2.5/storages/dsh-session-groups.diagnostics.ndjson --json`（12 runs / 0 parseErrors）

### 2.6 开销（Node 微基准 + E2E 对照）

微基准（20,000 trace 事件，fake transport；脚本临时文件在系统 temp，未入库）：

| 指标 | 数值 |
|---|---|
| trace 平均（ring 4000，生产配置） | **4.41 µs/事件**（20k 事件 88ms；≈226,831 ev/s） |
| trace 平均（ring 500） | 1.46 µs/事件 |
| 60Hz dragover 折算 | **≈0.26 ms/s（0.03% 单核）**；native capture 单相含 target rect **5.31 µs/事件 → 0.32 ms/s（60Hz）**，capture+bubble 约 0.64 ms/s |
| 20k 批量 flush | ≈4 ms |
| HUD 刷新（250ms 一次） | **0.24 µs/次** |
| 关闭路径 | 1,000,000 次 no-op trace **1.6 ms**（单次布尔判断） |

E2E step 耗时对照（0.2.4 / 0.2.5，同 18 步）：

| step | 0.2.4 ms | 0.2.5 ms | 变化 |
|---|---|---|---|
| 4 drag-ten-cross-workspace | 3,694 | 3,396 | −8.1% |
| 14 groups reorder/reparent | 10,096 | 10,154 | +0.6% |
| 18 placeholders + optimistic | 8,161 | 7,999 | −2.0% |
| 全 18 步合计 | 79,277 | 83,956 | +5.9%* |

\* 总时长差异集中在宿主侧（step 8 rename、step 10 restart hydration、step 12 audit 等）；拖拽相关 step 在噪声内。结论：诊断对拖拽路径无可测退化，主要成本是本地 append 文件体积（约 1.8 MB / 3,091 行）。

## 3. C. 测试 / E2E / 打包

- `npm test`：**234/234 PASS**（0 fail / 0 skip；新增 diagnostics 11、analyzer 4、icons 5、host diagnostics route 3，更新 route/entry 数量断言）。
- `node --check`：`src/**` 变更文件、analyzer、e2e、新增 tests、`lib/client.js` 共 18 个文件全部 OK；`npm run check` OK。
- Fresh setup：`.spike-homes/qa-0.2.5`（隔离 home，setup 端口 4402 / E2E 端口 4403，`HOME-0 removed=2`），setup 18/18；真实 home fingerprint 不变；client bundle 227,938 bytes / sha256 `93614e9a96e693e376754c57bbd66bf0d11e0bb95a189d706df8f5aecc4d4492`。
- E2E：**18/18 PASS**（18 步合计 83,956 ms，`scripts/qa/evidence/e2e-20261029-134445.json`），`consoleErrors=[]`、`pageErrors=[]`；HUD 存在且 `pointer-events:none`、`n=28/chg=54/rend=5312`；step 18 乐观会话 304ms / 分组 12ms；runner 额外验证 diagnostics route `{ok:true,appended:1}` 与隔离 home NDJSON（3,091 行、12 runs、native/handler/optimistic 齐全、0 parseErrors）。
- 审计：verify 7/7 PASS（`scripts/qa/evidence/audit-verify-20261029-134354.json`）；只 `dsh-session-groups.json` 变更（revision 16）；workspace.json 由宿主会话操作改动（`-AllowHostSessionChanges` 放行）；3 sample sessions/desktop/web profile 指纹不变；诊断文件 append-only 放行（AUD-5）。
- 打包：`dsh-session-groups-0.2.5.tgz`，**148,971 bytes**，unpacked **580,470 bytes**，**36 files**；sha256 `2D564CDBAD7CE24B17C1DF43561759834FC213F4387F1F6EC13A9C1694C08D91`；npm shasum `abb115943333270120d87a7be8429e79c916b2d9`；integrity `sha512-kRuTlW7Cizlp9KMPHI4Hw0e86kHYBmL58rosIx0mbH07wDMmzOuxfFq/8gHRuHmatfikNro4j/g94ABjxt0ePQ==`（完整值见 `docs/TEST-RESULTS.md §0.2`）。

## 4. 证据路径

- E2E：`scripts/qa/evidence/e2e-20261029-134445.json` + `scripts/qa/evidence/screenshots/e2e/` 18 张
- Setup：`scripts/qa/evidence/setup-20261029-133829.json`
- 审计：`scripts/qa/evidence/audit-baseline-20261029-134315.json` / `audit-verify-20261029-134354.json`
- 分析器：见 §2.5 命令（同一 trace，12 runs / 0 parseErrors）
- 真实 trace：`.spike-homes/qa-0.2.5/storages/dsh-session-groups.diagnostics.ndjson`（本地保留，不入包/不入库）
- 本报告：`.superpowers/sdd/2026-10-28-session-groups-v1.1/diagnostics-report.md`

## 5. 已知边界 / 关注点

1. **HUD 默认可见**：0.2.5 按任务要求默认开启；桌面用户会看到右下角小 HUD。可用 localStorage `'0'` 关闭；若产品不希望默认显示，后续只需改一个默认值（不影响 trace 能力）。
2. **诊断文件增长**：append-only，不自动轮转/删除；E2E 18 步约 1.8 MB（3,091 行）。真实高频拖拽会持续增长，需要时可手工清理（release 文档已注明）。
3. **E2E 为合成 DragEvent**：`isTrusted=false`；真实桌面拖拽应为 `trusted=true`，分析器已分别统计。真实桌面复现时请用 `analyze-drag-trace.mjs` 看 native trusted 记录。
4. **longtask 噪声**：应用启动/宿主渲染也会产生 >50ms longtask，分析器列为“疑似 stall”需结合时间线判断；拖拽内 slow handler（≥50ms）本次为 0。
5. **burst 启发式**：以最后指针移动 → dragend 为窗口，阈值 25 事件/750ms；极端缓慢拖拽可能被判 burst，属“疑似”不是失败。
6. **审计**：`audit.ps1` 新增 AUD-5 允许诊断文件 append-only；若未来把 diagnostics 文件名改掉，需要同步 common/audit。
7. **未安装 desktop**：按任务仅本地打包；Lead 安装后可在真实 home 复现并用同一脚本分析 `<home>/storages/dsh-session-groups.diagnostics.ndjson`。
