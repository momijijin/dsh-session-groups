# dsh-session-groups 0.2.6 — 分组颜色 + 统一选择对话框交付报告

- 日期：2026-10-29
- 仓库/分支：`C:\Users\Momiji\Projects\dsh-session-groups` / `feature/v1.1-session-groups`
- 基线 HEAD：`0732f5c`（0.2.5）
- 结论：**PASS**——`npm test` **248/248**、`node --check` 全绿、fresh setup **18/18**、full E2E **19/19**（`consoleErrors=[]`/`pageErrors=[]`）、audit verify **7/7**、打包 `dsh-session-groups-0.2.6.tgz`；本地提交、未 push、未安装 desktop、未写真实 `~/.dsh`。
- 删除操作清单：**空**（本任务未删除任何文件；隔离 QA setup 的 `HOME-0 removed=0`，QA homes 保留原地；未清理 `node_modules`/`.spike-homes`/证据目录）。

## 1. 验证结果

| 检查 | 结果 | 证据 |
|---|---|---|
| `npm test` | **248/248 PASS**（0 fail / 0 skip） | 控制台输出 |
| `node --check` / `npm run check` | 源文件 + `lib/client.js` + `e2e/groups.spec.mjs` 全部 OK | 控制台输出 |
| Fresh setup | **18/18 PASS**，`HOME-0 removed=0`，真实 home fingerprint 前后一致；client 240,484 bytes / sha256 `5FF20C93…`；version 0.2.6 | `scripts/qa/evidence/setup-20261029-151303.json` |
| Full E2E（19 步） | **19/19 PASS**（94,440 ms；`consoleErrors=[]`/`pageErrors=[]`）；step 16 header title 为 primary accent（14/20/400）、行操作 28×28、引导线 x=16/2px；step 18 HUD `dsg 0.2.6`；step 19 颜色/对话框全绿 | `scripts/qa/evidence/e2e-20261029-151549.json` + 19 张截图 |
| 诊断持久化 | **PASS**：route 200 `{ok:true,appended:1}`；NDJSON **1,043 行 / 4 runs / 0 invalidLines**，native/handler/optimistic 齐全 | 同上 `diagnostics` + `.spike-homes/qa-0.2.6c/storages/dsh-session-groups.diagnostics.ndjson`（630 KB，本地保留） |
| 数据审计 | **PASS 7/7**（`-ExpectGroupFile change -AllowHostSessionChanges`）：只记录文件按预期变化（revision 34）；workspace.json 为宿主侧会话改动；3 sample sessions / desktop/web profile 不变；诊断 append-only | `audit-baseline-20261029-151409.json` / `audit-verify-20261029-151644.json` |
| 打包 | `dsh-session-groups-0.2.6.tgz`：**156,381 bytes**、unpacked **611,646**、**37 files**；sha256 `A4F5DC2DEB59551CA091CDEB6BE32FAD2F05D2E1C0B439B80C49EAD811597CFC`；shasum `1a91688e…` | `npm pack --json` + `tar -tzf`（无 docs/tests/e2e/scripts/.spike-homes） |

## 2. 用户反馈逐项落地

### 2.1 顶部标题“分组”改为蓝色（反馈 1）
- `.dsg-header-title` 与 `.dsg-header-accent` 统一 `var(--dsw-alias-state-business-primary, CanvasText)`；仍为 14px/20px/weight 400，官方图标与 search → view-options → plus 顺序不变。
- E2E step 16 断言 title color === accent token（实测 `rgb(65,118,230)`），accent 图标同 token。

### 2.2 行 hover 操作按钮 28×28（反馈 2）
- `.dsg-group-actions/.dsg-session-actions` gap 4px；内部 `.dsg-icon-button` 28×28（glyph 仍 16px）；行高保持 34/32，名称/计数继续 `min-width:0` + ellipsis。
- E2E step 16 断言 28×28/16px glyph；264px 无溢出断言保留并通过。

### 2.3 组引导线移到父级 caret 尖端（反馈 3）
- 仅组子体 `.dsg-group > .dsg-group-body > .dsg-group-line`：`margin-left:16px; padding-left:4px; border-left:0` + `::before` 2px 线（`left:-1px`），即线中心在父行 padding 8 + caret 16 的中心 x=16；子内容起点 20px，与旧 10/10 相同，每级缩进仍 20px（最大深度/264px 安全）。未归组列表保留旧 10/10/1px chrome。
- E2E step 16 实测 lineCenter=30、rowLeft=14、caretCenter=30（相对行首 16px）、宽 2px。

### 2.4 分组颜色（反馈 4）
- 模型：`Group.color` 可选；palette `blue/green/orange/red/purple/gray`；`DEFAULT_GROUP_COLOR='blue'`；`setGroupColor`、`normalizeColor`/`groupColor`/`isKnownColor`；`createGroup` 默认蓝；`validateDoc` 允许缺省、拒绝未知；`normalizeDoc` 归蓝；**`DOC_VERSION` 不升**。
- Host：`parseCommitBody` 先用 shared model 校验（未知 color → 422 `group-color:<id>`），再把缺省 color 归一化为 `blue` 后写入；round-trip 测试覆盖。
- UI：分组菜单新增「颜色」→ `group-color` 色板对话框（6 个 radio swatch）；组行 `data-color`，组图标与子组引导线使用对应色；旧记录无 color 显示蓝。
- 测试：model 调色板/校验/默认/归一化 3 条、host round-trip/422 2 条、dialog-selection 6 条、CSS/选择契约 3 条；E2E step 19 实测 blue→purple 且记录落盘。

### 2.5 选择对话框统一 footer（反馈 5）
- icon / move-session / move-group / new-session workspace / group-color：点击只更新高亮（`aria-selected` 或 `aria-checked`、`data-selected`），不关闭、不写 doc/host；footer 固定 Cancel/Confirm；Confirm 在无有效选择时 disabled；Cancel/Escape/backdrop 关闭不变。
- 预选：icon=当前图标、move-*=当前组/父级、new-session=inferred（无推断则 Confirm disabled，点选后启用）、group-color=当前色/蓝。
- 输入类（new/rename）与 delete/archive-running 对话框行为保持不变（Enter 确认 / danger Confirm）。
- 实现：纯函数 `src/client/dialog-selection.js`（初始选择/有效性/payload、move 选项排除自身+后代）+ `DialogHost` 只渲染；E2E step 6/19 分别验证 new-session 与 icon/move/color 的“只高亮→Confirm”。

### 2.6 保持既有能力
- 0.2.5 诊断默认开启/HUD/trace/分析器、0.2.4 乐观提交/行高占位、0.2.3 虚拟化、0.2.1/0.2.2 排版/主题均保留；HUD 文本/E2E 断言更新为 `dsg 0.2.6`。

## 3. 版本与文件

- `package.json` / `dsh.plugin.json` = `0.2.6`；`PLUGIN_VERSION='0.2.6'`。
- 主要源码：`src/shared/constants.js`、`src/shared/model.js`、`src/host/routes.js`、`src/client/dialog-selection.js`（新）、`src/client/components.js`、`src/client/css.js`、`src/client/locale.js`、`src/client/plugin.js`、`locale/{zh,en}.json`、`lib/client.js`（重建）。
- 测试：`tests/unit/model.test.js`、`tests/host/routes.test.js`、`tests/integration/helpers.js`、`tests/client/ui-layout.test.js`、`tests/client/diagnostics.test.js`、`tests/client/dialog-selection.test.js`（新）。
- E2E/QA：`e2e/groups.spec.mjs`（step 6 改造 + step 16 断言 + step 19 新增 + 19 步文案）、`scripts/qa/run-v1.ps1`（19-step）。
- 文档：`README.md`、`docs/CONTRACTS.md`、`docs/RELEASE.md`、`docs/TEST-PLAN.md`、`docs/TEST-RESULTS.md`、`docs/V1-PLAN.md`。

## 4. 关注点 / 边界

1. **未知 color 的加载策略**：`validateDoc` 拒绝未知 palette id，因此手工把记录改成未知 color 会按既有坏文件策略 quarantine（`invalid-file`）。这是“校验 palette”的直接结果；旧记录缺省 color 合法。若未来 palette 扩容，需先升 `DOC_VERSION` 或放宽为 opaque string。
2. **new-session 无推断值**：按“无有效选择 Confirm disabled”实现——没有 inferred workspace 时需先点选；E2E 对两种分支都做了兜底断言。
3. **未归组列表 chrome**：0.2.6 的新 2px guide 只作用于分组子体，未归组 inbox 保留原 10/10/1px（避免把分组缩进语义套到全局 inbox）。
4. **诊断文件增长**：0.2.6 E2E 19 步约 630 KB / 1,043 行；append-only，不自动轮转/删除。
5. **QA homes 保留**：`.spike-homes/qa-0.2.6`（首轮 E2E 失败）、`qa-0.2.6b`（step 19 首轮失败）、`qa-0.2.6c`（最终 PASS）均保留；端口 4404/4405/4406 已释放；未安装 desktop profile。
6. **真实桌面未验证**：本任务仅隔离 home QA；用户验收后安装再复现。

## 5. 证据索引

- E2E：`scripts/qa/evidence/e2e-20261029-151549.json`（19/19，94,440 ms）+ `screenshots/e2e/`
- Setup：`scripts/qa/evidence/setup-20261029-151303.json`（18/18，removed=0）
- Audit：`scripts/qa/evidence/audit-baseline-20261029-151409.json` / `audit-verify-20261029-151644.json`（7/7）
- 诊断 trace：`.spike-homes/qa-0.2.6c/storages/dsh-session-groups.diagnostics.ndjson`（1,043 行 / 4 runs，本地保留）
- 包：`dsh-session-groups-0.2.6.tgz`（gitignore，本地保留）
- 本报告：`.superpowers/sdd/2026-10-28-session-groups-v1.1/group-color-report.md`
