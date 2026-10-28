# V1/V1.1 Test Results（QA 验证线）

> Owner：QA（task-6/7）。上游：`docs/TEST-PLAN.md`、`docs/CONTRACTS.md`（frozen）、`docs/V1-PLAN.md`、`docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md`。
> 环境：隔离 `DSH_HOME=<repo>\.spike-homes\qa` + profile `groups-spike` + 端口 **4402**；直调 Desktop runtime；
> 真实 `~/.dsh` **只读**（fixture 来源 + 前后 fingerprint），不复制 credentials；
> Host/Client 实现（`src/**`）不由 QA 修改；缺陷开给 owner。

## 0. V1.1 最终结论（2026-10-28 18:07）

**V1.1 QA 验证线全绿 PASS（0.2.0，隔离 home `.spike-homes/qa` + 4402）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **181/181 PASS**（0 fail / 0 skip，~3.8s） | 控制台输出 |
| E2E 15 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **15/15 PASS**（~58s）；`consoleErrors=[]`、`pageErrors=[]` | `scripts/qa/evidence/e2e-20261028-180738.json` + 15 张截图 |
| step 10 重启 hydration | **PASS**（19.0s；等待组数/行数/已知会话就绪；`blankLifecycle.drift=false`） | 同上 step 10 detail |
| 数据审计 commit probe | **PASS 11/11**：revision **29→30**；仅 `dsh-session-groups.json` 变化；`workspace.json` + 3 sample session + desktop/web profile 指纹不变 | `scripts/qa/evidence/audit-exercise-20261028-180915-commit.json` |
| setup（隔离 home 重建） | **PASS 18/18**；真实 home 前后 fingerprint 一致；client build sha256 匹配 | `scripts/qa/evidence/setup-20261028-175133.json` |
| 打包 | `npm pack` → `dsh-session-groups-0.2.0.tgz`（100,054 bytes；32 files；sha256 `D1B9AD0F98997BF6F7BE7E3045718E1ECB378D01960E54CE486124307B036160`） | 本文件 §0.3 |
| 隔离状态 | `.spike-homes/qa` **保留**待最终清理；4402 已释放；真实 home 零写入 | setup/audit evidence |

### 0.1 V1.1 新增三步明细

- **step 13 宽度**：官方宽度 280 → 1024px 挂载 clamp 544 → 1440px 恢复 620 → 拖到 760/620 → reload 620 → 700px rail 不覆盖（无把手，官方 280）→ 1440px 恢复 620 → 双击 420 → 拖到 264 且 header `scrollWidth 252 ≤ clientWidth 252` → 折叠/展开保持 264 → 官方宽度 280、官方把手恢复。
- **step 14 组拖**：c→b 组体槽（b 有会话 0 子组，index 0）→ c 拖回根 → a（带子组）→ 空组 e（子树跟随）→ c→未归组头（根末尾）→ a→b 上缘；快速双拖根/child 锚点均按最新 doc 重算；自身/末位 no-op 不涨 revision；菜单上移/下移首尾禁用；全树 `n+1` 槽（3/1/1/2…）且无槽渲染在会话行后；b 的会话数始终 3。
- **step 15 搜索**：分组 a 折叠后搜唯一标题 `E2E-搜索-aoc5` → ArrowDown/Enter → 组展开、行 `dsg-search-hit`、树滚动 `0→595`；归档会话 `session-14168603…` 结果 `data-archived=true`/`aria-disabled=true`，Enter 不切当前会话；无结果空态、Esc/点外关闭；`groups`/`ungrouped` 前后一致（rev 29，记录不变）。

### 0.2 冷启动观察（harness 时序，不阻断）

- 本次最终验证前有两次冷启动尝试：`e2e-20261028-175738.json`、`e2e-20261028-180003.json` 均在 **step 2** 报 `groups view rendered zero session rows`（宿主 session 快照尚未 hydrate，官方视图仅 3 个 workspace 标题）。
- 预热一次页面（等待 24 条未归组行出现）后，同一隔离 home/服务上官方全量 **15/15 PASS**。该现象与 Task 6 记录一致（fresh server 的 session snapshot 首载慢）；`scripts/qa/run-v1.ps1` 的 smoke 阶段即承担此 warm-up，不是产品缺陷，也不改 E2E 步骤。
- 因此本次 V1.1 结论以 `e2e-20261028-180738.json` 为准；前两次失败证据保留可追溯。

### 0.3 0.2.0 打包记录

- 命令：`npm pack`（工作树 = commit `a3705cd` + 本文档改动；`files` 只含发布文件）。
- 产物：`dsh-session-groups-0.2.0.tgz`；**100,054 bytes**（97.7 KiB）；unpacked 394,816 bytes；**32 files**。
- sha256：`D1B9AD0F98997BF6F7BE7E3045718E1ECB378D01960E54CE486124307B036160`；npm shasum `fd14934eed0eb4c2228225a0680bb84cb20c4d8b`；integrity `sha512-oZr3Zx3M3hNo2A3WoEhpmylWdbhgeVTulxdoYdJBkYwO+g4v4lIWwG8NzuPr8pWIcD40O854I9a7bTYaKpvJTA==`。
- 内容：`src/**`（25）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

## 0. V1 最终结论（2026-10-19 02:51）

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

## 1. E2E 12 步明细（V1 终验，`e2e-20261019-025116.json`；V1.1 新增 13-15 见 §0.1）

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

# 一键 V1/V1.1 QA（setup → integration → build → start 4402 → smoke → E2E 15 步 → audit → teardown）
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

- 2026-10-28 18:07：V1.1 QA 全绿（0.2.0）—— `npm test` 181/181、E2E 15/15 PASS（step 10 含 hydration wait）、audit commit 11/11 PASS（rev 29→30）、setup 18/18 PASS；`.spike-homes/qa` 按任务要求保留待最终清理；冷启动两次 step 2 失败证据见 §0.2。
- 2026-10-19 02:51：V1 QA 终验全绿 —— `npm test` 151/151、E2E 12/12 PASS、audit load 10/10 + commit 11/11 PASS、setup 18/18 + teardown 6/6 PASS；真实 home 与 `.git` 零写入；`.spike-homes/qa` 已清理、4402 已释放。
- 2026-10-18 23:2x：初版（Host 集成 16/16、client-logic 18+1、E2E BLOCKED 等 client build）。
