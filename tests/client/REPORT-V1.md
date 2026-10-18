# V1 E2E 诊断报告 — step 8 / step 10（client-engineer，2026-10-19）

## 结论（先看这里）

1. **step 8 `rename-syncs-with-official-sidebar`：PASS，不是产品 bug。**
   - QA 自己的运行证据 `scripts/qa/evidence/e2e-20261019-020908.json` 中 step 8 已是 `PASS`（`session-a6cc8450…` 改名为 `E2E-重命名-wjwq`，官方侧栏经 `reveal` + `search` 找到）。
   - 我的独立复现（隔离 home + 4403，复制插件包，不改仓库）：菜单→重命名→dialog 关闭 **883ms** → 组内行显示新标题 → 切回官方 `bodyText` **立即包含新标题**。证据：`tests/client/evidence/qa-diag/rename-diag.json`。
   - 结论：`sessions.using(id, {source:'workspaceOperation'}, ref=>ref.binding.session.rename(title))` 正常写 host title 并被官方侧栏消费，标题单源。
2. **step 10 `restart-preserves-structure` FAIL 的根因：宿主 blank 会话的“临时 id / 当前可见性”漂移，非分组顺序丢失。**
   - 失败前后 order（QA JSON）：
     - before：`[a6cc, 91a72, 563f, b24f]`
     - after：`[a1d6, a6cc, 563f, b24f]`
     - **非 blank 交集顺序稳定**：`[a6cc, 563f, b24f]`（前后一致）。
   - `a1d6` 是 step 6「组内新建」当场创建的 **blank**（JSON step6 `created: session-a1d6f5f2…` 且落在组首）；`91a72` 是更早 boot 产生的另一个 **blank**。两个 blank 在 doc 里都可能在组 A，但 blank 行**只有作为 current session 时才渲染**；重启后 current blank 从 `91a72` 变为 `a1d6`，于是渲染集合里 blank 行互换——非 blank 手动顺序没有变化。
   - 我的受控重启验证（`.spike-homes/client-diag` + 4403，复制插件包，真实 fixture 只读复制）：组 A 内 **non-blank 顺序重启前后稳定（TRUE）**，renamed 标题保留。证据：`tests/client/evidence/qa-diag/scenario-restart.json`。
3. **按 Lead 裁决：不为 blank 持久化改产品。** blank 重启被宿主丢弃/重建属于宿主临时语义；旧 id 成孤儿隐藏（CONTRACTS §1 invariant 7），新 blank 按 D7 进未归组顶部，不自动塞回旧组。

## 关于「E2E 卡在 step 8」的旁证

- QA `e2e-20261019-020908.json`：step 8 PASS、**step 10 `ms: 308424`（≈308s）** 才出错。我的 `run-v1.ps1 -KeepProfile -RequireE2E` 复跑时 e2e 进程同样长时间无输出；原因是 **node 子进程 stdout 重定向到文件时的块缓冲（<4KB 不 flush）**，所以日志停留在 step 7，实际时间花在 step 10 的 `restartServer()`（stop-web/start-web 串行重启 + 等待）上。**不是 step 8 挂死。**
- 另外 `scripts/qa/evidence/logs/run-v1-20261019-021047.log` 显示 setup/smoke 阶段 PASS，e2e 日志文件仅 516 bytes 即被中断，符合块缓冲解释。

## QA 建议（测试侧修复，不需要改 src/client）

1. step 10 比较组顺序时**排除 blank 行**：`ui.sessionIdsInGroup()` 返回值过滤 `text` 含 `新会话`/`New Session` 的 id，或直接比较组 doc 的 `sessionIds` 去掉“当前不存在于 session snapshot 的 orphan/blank”后的投影顺序。blank 的 id 与 current 可见性都是宿主临时状态。
2. 如需更强断言：重启后只比较「非 blank 且 id 在 host snapshot 中存在」的顺序；对 blank 单独断言“旧 blank id 成为孤儿隐藏 / 新 blank 出现在未归组顶部（不进旧组）”。
3. step 8 无需再改（be3171f 后已 PASS）；若偶发失败，优先看 `revealOfficialSession` 扩展官方 workspace 行 + `searchOfficialSidebar` 的后备路径。

## 补充（02:41/02:44 QA run 复核，Lead 提供的最新证据）

- **02:41 run step 8 FAIL = fixture 目标选择问题，不是产品 bug**：该 run 的 step 8 目标虽在 `workspace.json` 注册，但**没有真实 session 目录/日志**（合成 `session-00000000-…` 夹具），宿主无法 rename/搜索（官方 search 返回 “No matching sessions”）。我的手动复现用的是真实会话，PASS。
  - 建议（QA 工作区已实现）：step 8/7 选目标时用 `hostSessionIds()`（扫描 `.spike-homes/qa/sessions/<workspace>/<sessionId>/` 真实目录）过滤，**不要**把合成夹具当作官方可见会话；同时排除 `state.createdSession` 与 archived id。
- **02:44 run step 8 已 PASS**（`e2e-20261019-024406.json`，hostIds 过滤已生效），step 10 的报错来自旧版断言；QA 当前工作区 step-10 的最新逻辑已与契约对齐：
  - 非 blank 顺序比较（`realOrder` 过滤 blank 行）；
  - blank 仅在**发生 drift**（旧 id 未被宿主保留）时要求“旧 id 不得重新出现在组里、新 blank 不得自动进组”；id 稳定（宿主保留同一 current blank）时允许连续性。
  - 该逻辑与 `docs/CONTRACTS.md` §1 invariant 7 / §4 blank 语义一致；**client 无需改产品代码**（我们的实现不会复活/自动分配：缺失 id 由 shared model 当孤儿隐藏，新 blank 走未归组 derivation）。
- **step 10 之前 308s 卡的根因**：`spawnSync` 让 spawn 的 start-web 子进程继承 stdio 管道，父进程等 EOF 直到服务器退出 → 180s 超时；QA 已用 `spawnPwshQuiet`（`stdio: 'ignore'`）修复。这也解释了“e2e 日志停在 step 7 但进程悬着”的现象（Node 子进程 stdout 重定向块缓冲 + step 10 重启等待），不是 step 8 挂死。


- `tests/client/evidence/qa-diag/rename-diag.json` + `diag-01..05*.png`：step 8 独立复现（rename 883ms、组内标题、官方 bodyText、reveal/search）。
- `tests/client/evidence/qa-diag/scenario-restart.json` + `scenario-01-before-restart.png` / `02-after-restart.png`：受控重启，non-blank order stable=TRUE、renamed 保留。
- `scripts/qa/evidence/e2e-20261019-020908.json`（QA 侧）：step 8 PASS、step 10 FAIL 明细（非 blank 顺序稳定、blank id 互换）。
- 诊断用隔离 home `.spike-homes/client-diag` 已按 Lead 要求删除；未触碰 `.spike-homes/qa` / 4402；4403 已停。
