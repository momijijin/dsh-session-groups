# V1 Test Results（QA 验证线）

> Owner：QA（task-6）。上游：`docs/TEST-PLAN.md`、`docs/CONTRACTS.md`（frozen）、`docs/V1-PLAN.md`。
> 环境：隔离 `DSH_HOME=<repo>\.spike-homes\qa` + profile `groups-spike` + 端口 **4402**；直调 Desktop runtime；
> 真实 `~/.dsh` **只读**（fixture 来源 + 前后 fingerprint），不复制 credentials；
> Host/Client 实现（`src/**`）不由 QA 修改；缺陷开给 owner。

## 0. 最终结论（2026-10-19 02:51）

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

## 1. E2E 12 步明细（最终 run，`e2e-20261019-025116.json`）

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
| P2 记录 | 范围 | 拖组改父级 / 撤销 / 标题搜索 / 置顶徽标 / 折叠组聚合计数 = P1 未实现；颜色等 P2 | Client | 记录 |
| P2 记录 | 宿主 | `--from-default-profile` 在 Windows 偶发 staging 目录 EPERM/ENOTEMPTY（残留目录，不影响功能；teardown 整删 home） | 宿主 | 记录 |

## 6. 复现命令

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups

# 仓库全量测试（含 QA 独立线）
npm test

# 一键 V1 QA（setup → integration → build → start 4402 → smoke → E2E 12 步 → audit → teardown）
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

- 2026-10-19 02:51：V1 QA 终验全绿 —— `npm test` 151/151、E2E 12/12 PASS、audit load 10/10 + commit 11/11 PASS、setup 18/18 + teardown 6/6 PASS；真实 home 与 `.git` 零写入；`.spike-homes/qa` 已清理、4402 已释放。
- 2026-10-18 23:2x：初版（Host 集成 16/16、client-logic 18+1、E2E BLOCKED 等 client build）。
