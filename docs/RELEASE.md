# V1.1 发布与安装说明（未安装到用户 desktop）

- 版本：`0.2.8`（V1.1 official status + empty drop box + drag label patch）
- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 状态：**V1.1 QA 全绿（21/21 E2E（诊断默认开启）、275/275 tests、step 12 audit PASS、diagnostics NDJSON PASS；large-list probe 沿用 0.2.3，虚拟化未改）**；等待用户验收后才安装到 desktop profile
- 范围：V1 全部能力 + 左栏宽度 264–760、分组拖拽排序/改父级、会话搜索下拉、官方侧栏排版/间距/图标对齐、footer 单按钮视图切换、header `搜索/视图选项/＋`（0.2.5 起为官方 artwork）、归档 popover、深色主题 surfaces、未归组列表虚拟化、拖拽行高插入占位 + 乐观 drop 提交、拖拽诊断 trace/HUD/分析器、分组颜色 + 五类统一选择对话框、行 meta（计数/更新时间）、自定义 hex 颜色、右键/键盘菜单、**官方会话状态（含 subagents 次要状态）/空组 drop box/单实例拖拽浮层**

## 1. 构建

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups
pnpm install          # 已安装过可跳过；本版未新增依赖
npm run build         # 生成 lib/client.js（大小以实际产物为准）
npm test              # 275/275
node --check lib/client.js
```

## 2. 打包

```powershell
npm pack
# dsh-session-groups-0.2.8.tgz（大小以实际产物为准）
```

包内容固定为 `src/**`、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`。
包内**不包含** `docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`。

最终 tarball 记录（以实际产物为准）：

- 文件：`dsh-session-groups-0.2.8.tgz`
- 大小：**178,895 bytes**（unpacked **694,099 bytes**；**40 files**）
- SHA256：`304D6C8EB883C89BE85181D6FD41088E3D5F36A532AA8725FBFD33EDE04E3C3D`；npm shasum `0960e20563c7916ed57f2f06011b87a86668b1eb`；integrity `sha512-bXeYwcpmeV9E/CYK5G1aVWu7zIGYxkBaDlj1ML4+PMhnqyZq4NXaMr9HGX1wx/SZ5XYLGawmDjKqqpE7g+DG7Q==`。

## 3. 安装

### Desktop（用户验收后）

设置 → 插件 → 添加插件 → 选择 `dsh-session-groups-0.2.8.tgz`（或本地目录），启用后重启/刷新。

不要用 `dsh plugin --profile desktop` 改 App 管理的 profile。

### 可丢弃 profile（验证用）

```powershell
$env:DSH_HOME = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\release"
$desktop = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe"
$cli = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
& $desktop --expose-internals $cli --profile groups-spike --from-default-profile web
& $desktop --expose-internals $cli plugin --profile groups-spike add "file:C:\...\dsh-session-groups-0.2.8.tgz"
& $desktop --expose-internals $cli --profile groups-spike --port 4405 --no-open
```

## 4. 数据与卸载

- 分组记录：`dshHomePath('storages')/dsh-session-groups.json`；`.bak` 为**单槽覆盖式**备份——每次成功 commit 前把上一版记录复制到 `dsh-session-groups.json.bak`，不保留多代历史、不参与读取/恢复（仅供人工排查；首次写入时没有 `.bak`）；不写 `workspace.json`/session 日志。
- 拖拽诊断（0.2.5）：`dshHomePath('storages')/dsh-session-groups.diagnostics.ndjson`，append-only；只含 runId/ID/testid/分组名/翻译后的拖拽 label 与 timing，**不含会话标题或 transcript**。默认开启；`localStorage['dsh-session-groups.diagnostics']='0'` 关闭（无需重建）。分析：`node scripts/qa/analyze-drag-trace.mjs <file> [--json] [--run <runId>]`。文件会随拖拽增长（0.2.8 E2E 21 步约 1.1k 行），不需要时可手工清理（插件不自动删除）。
- 分组颜色（0.2.6/0.2.7）：`color` 为可选 palette；`colorHex` 为可选自定义色（canonical lowercase `#rrggbb`，无 alpha），显示优先级 `colorHex > color`。旧记录/缺省按 `blue` 显示，下一次成功 commit 时 host 归一化为 `blue` 写入；合法但非 canonical 的 `colorHex`（短/大写）在 load/commit 时归一化，alpha/非法值仍按 `invalid-file` quarantine。`DOC_VERSION` 保持 1，无迁移步骤。
- 宽度偏好：localStorage `dsh-session-groups.width.v1`（数值 px，默认 420）；卸载后残留键无害。
- 卸载插件后官方工作区视图恢复；记录文件保留，重装可恢复分组。
- 分组删除非破坏性；本视图没有会话删除。

## 5. 已知限制

- 运行中会话归档确认框未 live 验证（隔离 home 无 running 会话）；真实 profile 手工补验（BLOCKED-ENV，沿用 V1）。E2E step 15 会归档一条**非运行**会话作为宿主侧副作用，分组记录不变。
- 排版/间距无插件字号/字体设置：`.dsg-root` 继承宿主侧栏基线（DSH Desktop 2.0.18 为 14px），固定尺寸通过官方 `--dsw-font-*` token（px fallback）对齐工作区侧栏；行 padding 0 8px / gap 6、树 2px 纵距、header 4/4/4/2（收起 36px；展开搜索 74px）、菜单/对话框放大 padding；宿主升级改变基线时继承字号随动，行高/间距/图标仍按官方 2.0.18 度量（step 16 守护）。
- 主题 surfaces 依赖官方 2.0.18 token（`--dsw-specific-menu` / `--dsw-alias-bg-layer-1/2` / `--dsw-alias-border-l2/l3`）；宿主若重命名 token，CSS 的 `Canvas`/`CanvasText` 最后兜底保证可读但不再有官方材质。E2E step 17 用 `body[data-ds-dark-theme]` 断言深色对比度。
- 宽度覆盖依赖宿主布局 DOM（DSH Desktop 2.0.18）：找不到 frame/sidebarRoot 时 fail-soft（把手隐藏）；宿主升级若改 DOM，加宽可能失效，但分组/搜索不受影响；视口 <744px 或余量不足时不覆盖。
- 搜索只匹配标题/工作区/组路径，最多 20 条；无全文搜索（P2）。
- 组拖到折叠组时不给子组落点（需先展开）；组拖不做悬停自动展开。
- P1 未实现：撤销上次移动、折叠全部、多窗口冲突提示、混合组常显工作区标签、批量移动、折叠组聚合计数。
- P2：全文搜索、跨设备同步、自定义图标上传、会话删除。
- 未归组列表按 `.dsg-tree` 视口 + overscan=8 窗口化（行 32 / gap 2 / 段头 34）；组树完整渲染。真实 home 的 1,639 个 session 目录中 1,474 个是 subagent（UI 过滤），实际可见未归组约 10 行；1,500+ 行由 QA 大列表 fixture 验证。窗口化不改变逻辑顺序/搜索/拖拽/归档。
- 分组数据单窗口 V1；多窗口冲突通过 409 提示，不做实时合并。
- **乐观提交边界（0.2.4）**：drop 当帧即渲染，HTTP 在后台单写者队列合并/重试（无自动重试，失败即回滚 + toast）。若 pop 时恰好有另一窗口写入导致 409，本次及尚未发送的乐观移动会回滚到最近确认 doc（符合“失败回滚”契约，不做自动重放）。拖拽期间非乐观对话框写入会等乐观队列 flush 后再执行；严格写期间的 drop 会等该写入落定后按新 doc 计算。
- **占位边界**：占位只在有效落点渲染；悬停折叠组不自动展开（与 0.2.3 相同），group child 槽仅在展开组体出现。占位为 32/34px 行高 + 1px 虚线 accent 边框，深色主题随 `--dsw-alias-state-business-primary` / `-fade` 变化。
- **诊断边界（0.2.5）**：HUD/事件环默认开启；性能开销为 trace 4.41µs/事件（ring 4000）/1.46µs（ring 500）、HUD 0.24µs/250ms、关闭路径 1M no-op 1.6ms（Node 微基准；60Hz dragover ≈ 0.26ms/s CPU）。长任务（longtask）会记录应用启动/宿主渲染造成的 >50ms 任务，分析器将其列为疑似 stall 需结合时间判断；E2E 的合成 DragEvent `isTrusted=false`，真实桌面拖拽应为 trusted=true。诊断关闭后不挂 HUD、不发请求、不装 native 监听。
- **选择对话框边界（0.2.6）**：icon / move-session / move-group / new-session / group-color 五类对话框点击只高亮，Confirm 才写入；无有效选择时 Confirm disabled（new-session 无 inferred 时需先点选）；Cancel/Escape/backdrop 关闭不改变任何状态。输入/删除/运行中归档对话框保持原行为（Enter 确认 / danger Confirm）。
- **颜色边界（0.2.7）**：palette 固定 6 色；自定义色只接受 `#RGB`/`RGB`/`#RRGGBB`/`RRGGBB`（展开/小写化），拒绝 alpha/命名色/非法串。手工改文件里的非法值加载时按 `invalid-file` quarantine（与既有坏文件策略一致）；合法非 canonical 值会归一化。`colorHex` 与 `color` 可并存，显示以 `colorHex` 为准；选择预设会清除 `colorHex`。
- **状态边界（0.2.8）**：状态只消费宿主 `useSessionStatus`（`running` / `pendingInteraction.kind` / `completionUnread`）与 `useSessions().projectionsBySession.subagentCatalog`；宿主不提供投影时省略 subagents 次级标记，不推断、不新增 completed-read/error/paused 状态。未知 pending kind 按官方忽略；pending 的 compact 尾格与 visually-hidden 文本走 zh/en locale。
- **空组 drop box（0.2.8）**：盒是提示而非独立 drop target，落点仍由组 body/section 处理；append/head/child 体占位存在时盒不渲染，group-before/after 边界占位时盒保留并切 accent。
- **拖拽 label（0.2.8）**：复用页面已有 `session-groups-floating-label`；重复节点只 `display:none`（DOM-only，不删文件/不写记录），dispose 只移除当前持有节点；rAF 不可用时退化为同步写。

## 6. 验证证据

- `docs/TEST-RESULTS.md`：V1.1 0.2.8（npm test 275/275、E2E 21/21 默认诊断、diagnostics NDJSON 1,104 行/5 runIds、audit 11/11、打包 sha256）
- `scripts/qa/evidence/028-final6/`：`e2e-20261029-184857.json`（21/21）+ `screenshots/e2e/`、`setup-20261029-184633.json`、`smoke-20261029-184714.json`、`audit-exercise-20261029-185026-commit.json`；真实 trace 在 `.spike-homes/qa-0.2.8-final6/storages/dsh-session-groups.diagnostics.ndjson`（隔离 home，本地保留；该目录被 gitignore，不随包发布）
- `e2e-20261029-184857.json`：`consoleErrors=[]`、`pageErrors=[]`、step 合计 96,769 ms。
- 历史：`scripts/qa/evidence-perf/024-final2/…`、`large-before.json` / `large-after.json`（0.2.3 虚拟化基线）、`.superpowers/sdd/2026-10-28-session-groups-v1.1/diagnostics-report.md`（本地，不随包发布）
