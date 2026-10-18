# V1 Test Results（QA 验证线）

> Owner：QA（task-6）。上游：`docs/TEST-PLAN.md`、`docs/CONTRACTS.md`（frozen）。
> 运行环境：隔离 DSH_HOME `<repo>\.spike-homes\qa` + profile `groups-spike` + 端口 **4402**；
> 真实 `~/.dsh` 只读（fixture 来源 + 前后 fingerprint），不复制 credentials；
> Host/Client 实现（`src/host/**`、`src/client/**`）**不由 QA 修改**，缺陷开给对应 owner。

## 1. 覆盖与当前状态（2026-10-18 23:2x）

| 层 | 文件 | 用例 | 状态 |
|---|---|---|---|
| Host 集成（独立验证） | `tests/integration/host-routes.test.js` | H1–H10 + 契约状态码（200/405+Allow/409/413/415/422/503、原子写、坏文件、版本过高、并发、围栏、只写记录文件） | ✅ **16/16 PASS**（真实 `src/host/**`，临时目录；`workspace.json`/session 哈希不变） |
| Host 入口/存储路径 | `tests/integration/host-entry.test.js`、`host-home.test.js` | apply() 返回 void + ctx.effect 注册/清理；无 webServer fail-soft；`dshHomePath('storages')`/fallback 且无硬编码真实 home | ✅ PASS |
| Client 逻辑（独立补强） | `tests/client-logic/shared-invariants.test.js` | CONTRACTS invariant 8（ungrouped 派生）、归档三态、subagent/fork/blank、孤儿、D6 推断、确定性/不可变、80/81 名边界、跨父级移动、index clamp、删除非破坏、校验/归一化 | ✅ PASS |
| Client 模块表面 | `tests/client-logic/client-surface.test.js` | state viewMode/filter 持久化；`buildVisibleTree` 三态；`hitTest`/`applyDrop`；`groupAncestors`/`groupPath`/`flattenTree`；bundle externals；CONTRACTS §4.1 testid | ✅ 18 PASS / 1 SKIP（`src/client/index.js` 尚未落盘时 skip，现已出现待复跑） |
| E2E 12 步 | `e2e/groups.spec.mjs`（零依赖 CDP） | 建组/嵌套/跨工作区拖 10 会话/排序/组内新建/归档三态/重命名/rail/重启/切回官方/审计 | ⏳ **BLOCKED**：`lib/client.js` 未构建（client task-5 进行中）；runner 以 exit 3 + 证据记录 BLOCKED |
| 数据审计（V1） | `scripts/qa/audit.ps1` | `.spike-homes/qa` 内 workspace.json + 3 sample session + 记录文件 + 真实 profile 指纹 | ⏳ 待 server + V1 安装后跑（`run-v1.ps1` 自动） |
| 全链路 | `scripts/qa/run-v1.ps1` | setup→integration→build→smoke→E2E→audit→teardown | ⏳ 待 client build；可先 `-SkipE2E` 跑其余阶段 |

参考（实现方自己的测试，非 QA 交付）：`tests/host/**` 当前 39/40（`home.test.js` 1 例 transient fail，随 Host 正在迭代）；`tests/unit/**` 14/14 PASS。

## 2. 命令

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups

# 只跑测试层（无需 server）
node --test "tests/integration/**/*.test.js" "tests/client-logic/**/*.test.js"

# 一键 V1 验证（隔离 home + 4402；client build 后 E2E 自动加入）
pwsh -NoProfile -File scripts/qa/run-v1.ps1
pwsh -NoProfile -File scripts/qa/run-v1.ps1 -SkipE2E        # client 还没 build 时的中间态

# 分步
pwsh -NoProfile -File scripts/qa/setup.ps1
pwsh -NoProfile -File scripts/qa/start-web.ps1
pwsh -NoProfile -File scripts/qa/audit.ps1 -CommitProbe
pwsh -NoProfile -File scripts/qa/teardown.ps1
```

## 3. 已知缺陷 / 待办

| ID | 层 | 描述 | Owner | 状态 |
|---|---|---|---|---|
| QA-V1-001 | E2E | `lib/client.js` 未生成，E2E preconditions 不满足（runner 明确 BLOCKED，非失败） | client-engineer（task-5 build） | OPEN（阻塞 E2E） |
| QA-OBS-001 | Host（实现方测试） | `tests/host/home.test.js` 1 例失败（QA 未介入实现测试；复跑确认后转 defect） | host-engineer | 观察 |

> 失败处置规则：QA 只提交 evidence + 复现命令，不直接改 `src/**`；缺陷记录在本表并 `send_message` 给 owner。

## 4. 证据

- 集成/逻辑：`node --test` 输出（本地）；CI 化后可落 `scripts/qa/evidence/`。
- E2E：`scripts/qa/evidence/e2e-<ts>.json` + `screenshots/e2e/<step>-*.png`（runner 产出）。
- 审计：`scripts/qa/evidence/audit-*.json`（`run-v1.ps1` 产出）。
- 全链路汇总：`scripts/qa/evidence/run-v1-<ts>.json`。

## 5. 更新记录

- 2026-10-18 23:2x：初版；Host 集成 16/16 PASS；client-logic 18 PASS + 1 SKIP；E2E BLOCKED（等待 client build）。
