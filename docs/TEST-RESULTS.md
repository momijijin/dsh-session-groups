# V1/V1.1 Test Results（QA 验证线）

> Owner：QA（task-6/7）。上游：`docs/TEST-PLAN.md`、`docs/CONTRACTS.md`（frozen）、`docs/V1-PLAN.md`、`docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md`。
> 环境：隔离 `DSH_HOME=<repo>\.spike-homes\qa` + profile `groups-spike` + 端口 **4402**；直调 Desktop runtime；
> 真实 `~/.dsh` **只读**（fixture 来源 + 前后 fingerprint），不复制 credentials；
> Host/Client 实现（`src/**`）不由 QA 修改；缺陷开给 owner。

## 0. V1.1 patch 0.2.1 最终结论（2026-10-28 21:24，排版对齐）

**V1.1 patch 0.2.1 QA 验证线全绿 PASS（隔离 home `.spike-homes/qa-0.2.1-final` + 4402）：**

| 层 | 结果 | 证据 |
|---|---|---|
| `npm test`（仓库全量） | **183/183 PASS**（0 fail / 0 skip，~3.8s） | 控制台输出 |
| E2E 16 步（`e2e/groups.spec.mjs`，零依赖 CDP） | **16/16 PASS**（~71.5s）；`consoleErrors=[]`、`pageErrors=[]` | `scripts/qa/evidence/e2e-20261028-212407.json` + 16 张截图 |
| step 10 重启 hydration | **PASS**（17.2s；groups=4、filter=hidden、`blankLifecycle.drift=false`） | 同上 step 10 detail |
| **step 16 排版（新增）** | **PASS**（256ms）：host/root font-size **14/14**、font-family 继承；组行 **34**、会话行 **32**；组名/会话标题 **14/20**；workspace 徽标 **12**；搜索框 **13/30**；group icon **16×16**、caret **16×16**、action glyph/button **16×16**；根内 **48** 个 `.dsg-glyph`/`.dsg-icon` 全 16px；`--dsg-font-14` 解析 **14px** | `e2e-20261028-212407.json` step 16 detail |
| setup（隔离 home 重建） | **PASS 18/18**；`HOME-0 removed=0`；真实 home 前后 fingerprint 一致；client build sha256 `711f57be…b36d9d5a` | `scripts/qa/evidence/setup-20261028-212010.json` |
| 打包 | `npm pack` → `dsh-session-groups-0.2.1.tgz`（**103,391 bytes**；32 files；sha256 `88DF099F449636F80CC0C7748BFFAE7EC382DA189EA997DE93E6EB3705952D8B`） | 本文件 §0.2 |
| 隔离状态 | `.spike-homes/qa-0.2.1-final` 保留待最终清理；4402 已释放；真实 home 零写入 | setup evidence |

### 0.1 0.2.1 排版修复明细

- **无插件字号设置**：`.dsg-root` 使用 `font-size: inherit; font-family: inherit; line-height: 1.4`；宿主侧栏基线（DSH Desktop 2.0.18 = 14px）为准，没有字号 config/setting、没有新增依赖。
- **官方 token**：固定字号统一经 `--dsg-font-14/13/12/11` → 官方 `--dsw-font-s-14-font-size` / `--dsw-font-xs-13-font-size` / `--dsw-font-xxs-12-font-size` / `--dsw-font-xxxs-11-font-size`（px fallback；10px 徽标无官方 token，固定 10px）。注：任务书写的 `--dsw-font-sm-14` 在 2.0.18 不存在，实测官方 token 为 `--dsw-font-s-14-font-size`（theme `lib/client.js`），按实际宿主 token 实现。
- **官方度量**：组行/未归组头 34px、会话行 32px、标题 14/20；组计数 12、workspace 徽标 12、归档徽标 10/16；搜索框 30/13、结果标题 14/20、meta 12/20、badge 10/16、空态 13；header 标题 14/20、文本按钮 28/13、图标按钮 28×28；菜单项 13/28、菜单 section 11；dialog 标题 14/正文 13/输入 13×32/按钮 13；toast 13、banner 12、rail label 11、floating label 12、group empty/empty/flat 13。
- **图标**：`renderGlyph` 默认 16；组 caret / 组图标 / IconButton / 组与会话操作按钮均 16px（操作按钮 16×16）；rail 保持 18px。
- **E2E**：step 16 在 step 15 后（分组视图仍激活）纯读 DOM 断言；无插件状态写入，不依赖截图（runner 仍按惯例保留截图）。

### 0.2 0.2.1 打包记录

- 命令：`npm pack`（工作树 = 0.2.1 发布文件；README 已定稿；`files` 只含发布文件）。
- 产物：`dsh-session-groups-0.2.1.tgz`；**103,391 bytes**；unpacked **406,821 bytes**；**32 files**。
- sha256：`88DF099F449636F80CC0C7748BFFAE7EC382DA189EA997DE93E6EB3705952D8B`；npm shasum `e897b33546173d53411d8746546bf30d218b0cd4`；integrity `sha512-QxIFgiz4Ctw5EFKZvAkO4LEfT59l5/4tPR5g6p+DX3Ec+WORCrs40QKEIRHBHpiBRJ1+RtEjfH2MErKhGZaBlw==`。
- 内容：`src/**`（25）、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`（共 32）。
- **不含**：`docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`、`pnpm-lock.yaml`、旧 `*.tgz`。

## 0B. V1.1（0.2.0）最终结论（2026-10-28 19:24，历史）

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

## 0C. V1 最终结论（2026-10-19 02:51，历史）

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

## 1. E2E 12 步明细（V1 终验，`e2e-20261019-025116.json`；V1.1 新增 13-16 见 §0/§0B.1）

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

# 一键 V1/V1.1 QA（setup → integration → build → start 4402 → smoke → E2E 16 步 → audit → teardown）
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

- 2026-10-28 21:24：**0.2.1 排版对齐 patch** —— `npm test` 183/183；E2E **16/16 PASS**（新增 step 16：root 继承宿主 14px、组行 34/会话行 32、标题 14/20、workspace 徽标 12、搜索框 13/30、48 个图标全 16px；`console/pageErrors=[]`；step 10 PASS 17.2s）；setup 18/18（`removed=0`）；`npm pack` 32 files / 103,391 bytes；`.spike-homes/qa-0.2.1-final` 保留待最终清理。
- 2026-10-28 19:24：**final review fix wave** —— `npm test` 183/183、E2E 15/15 PASS（console/pageErrors 空；step 2 加 hydration wait；step 13 快速释放/800→1440 复位；step 14 真实 `+` 指针拖拽守卫、中间 50%、同位置 no-op、启用 move-up；step 15 嵌套祖先 reveal、only→all、键盘滚动 listbox）、audit commit 11/11 PASS（rev 31→32）、setup 18/18 PASS、`npm pack` 32 files；`.spike-homes/qa` 保留待最终清理。
- 2026-10-28 18:07：V1.1 QA 全绿（0.2.0）—— `npm test` 181/181、E2E 15/15 PASS（step 10 含 hydration wait）、audit commit 11/11 PASS（rev 29→30）、setup 18/18 PASS；`.spike-homes/qa` 按任务要求保留待最终清理；冷启动两次 step 2 失败证据见 §0B.2。
- 2026-10-19 02:51：V1 QA 终验全绿 —— `npm test` 151/151、E2E 12/12 PASS、audit load 10/10 + commit 11/11 PASS、setup 18/18 + teardown 6/6 PASS；真实 home 与 `.git` 零写入；`.spike-homes/qa` 已清理、4402 已释放。
- 2026-10-18 23:2x：初版（Host 集成 16/16、client-logic 18+1、E2E BLOCKED 等 client build）。
