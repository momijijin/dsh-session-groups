# Gate 0 结论（2026-10-18）

## 判定

**PASS（带 2 个已接受的缺口）**，契约冻结，允许进入 V1 实现。

- 所有数据写入都在独立 `DSH_HOME`（`.spike-homes/host|client|qa`）内完成。
- 真实 `~/.dsh` 已复核：无 `dsh-session-groups*` 残留、无 `groups-spike` profile、`workspace.json` 指纹未因 spike 改变。
- 真实 home 的会话/归档数量在 spike 窗口内有自然变化（3 工作区、34–36 个 session 条目、归档从 2 变 3），来源是宿主/用户活动，不是 spike 写入；V1 一律按运行时快照计数，不写死数字。

## 三条线结果

| 线 | 结果 | 证据 |
|---|---|---|
| Host（S5/S7） | **PASS 78/78 live + 47/47 unit** | `spike/host-plugin/REPORT.md`、`evidence/10-summary.json` |
| Client（S1/S2/S3/S4/S6） | **PASS 101/58 断言，0 FAIL**；S4 运行中归档 **BLOCKED-ENV**；S3b 不采用 | `spike/client-plugin/REPORT.md`、`evidence/run-final-20261018/results.json` |
| QA（S1–S10 harness/审计/smoke） | **PASS 6/6 步、28s 一键流水线** | `spike/qa/RESULTS.md`、`evidence/run-gate0-20261018-222227.json` |

## 关键实测结论

1. `sidebar.workspaces` single + priority -1 接管、dispose 切回、10/10 次切换稳定；故意 render crash 时 slot abdication 让官方视图自动恢复，app 不白屏。
2. 全局 hooks：3 工作区；session 条目覆盖全部工作区；`archivedSessionIds` 是**数组**；`useSessionStatus` 是 **Map**（`running`/`pendingInteraction.kind`/`completionUnread`）；普通 SessionListEntry **没有** `origin`/`parentId` 键，只有 subagent 行有，读取必须容错。
3. `uiWorkspace.connectWorkspace(workspaceId)` 返回 `Promise<SessionId>`、**不导航**、**可能复用已有 blank**；V1 不能假设返回 id 一定是新建。
4. rename 形状：`sessions.using(id,{source:'workspaceOperation'}, ref=>ref.binding.session.rename(title))`；archive/unarchive/pin 均已实测并回读。
5. 路由/存储：`connection.requestRejection` 401/403 生效；`dshHomePath('storages')` 来源正确；temp+fsync+rename+`.bak`、409/422/413/415/405、坏文件隔离、10/10 重启、4/4 写中 kill 全过；`connection.fetch.register` 存在但仅 P1 评估。
6. bundle：`window.__ModuleLoader__.load({id,factory})` + `react`/`react/jsx-runtime` externals；无 `dsh-client-runtime`；卸载/重载干净。
7. CLI：`dsh.cmd` 硬编码真实 `DSH_HOME`，隔离必须直调 Desktop runtime；rc.2 启动是 `--profile <p> --port <p> --no-open`，不能带 `web`。

## 已接受的缺口

| 缺口 | 处理 |
|---|---|
| 运行中会话归档（`workspace/session-active` + `stopActivity:true`）无法在隔离 fixture 复现（无模型凭据） | **BLOCKED-ENV**；V1 在真实 profile 手工验收时补跑；源码形状已核对，契约保留该动线 |
| 第二个 `priority:-1` 占用者冲突（S8）未测 | V1 用 try/catch + fail-soft footer-only + toast；Gate 1 代码审查覆盖 |
| 宿主 hero 切换工作区（S3b） | 不采用；V1 用自己的预创建工作区菜单 |
| 官方视图展开/滚动状态切回可能重置 | 接受；验收记录，不阻塞 V1 |

## 数据/接口约束（写入 CONTRACTS）

- `workspaceDisplayTitle` 未暴露；V1 自实现 `workspaceLabel(title/path basename/id)`。
- 分组只写 `dshHomePath('storages')/dsh-session-groups.json`；V1 自带 JSON，storageDomain P1。
- 围栏只走 `requestRejection`；缺失时 503 `fence-unavailable`，弱 fallback 不进生产路径。
- Cordis `apply` 必须返回 void；注册一律 `ctx.effect`；linked 插件依赖 `@deepseek-ai/dsh-home-paths` 必须进 peerDependencies。

## 下一步

1. 冻结 `docs/CONTRACTS.md` 为 V1 契约（Gate 0 修订稿）。
2. 创建 V1 实现任务：Host（store/routes/entry）、Client（shell/tree/drag/actions）、QA（unit/integration/E2E/audit）。
3. 先合入 shared model（已实现 + 14 项单测）与仓库骨架，再并行 Host/Client。
