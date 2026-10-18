# dsh-session-groups

DSH 左侧栏的全局会话分组视图：分组只服务显示层，跨工作区组织会话，不改标题、不搬日志、不动工作区注册表。

- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 工作名：`dsh-session-groups`（显示名：全局会话分组）
- 状态：**V1 QA 全绿（12/12 E2E、151/151 tests、audit PASS）**，待用户验收；未安装到 desktop profile

## 文档

- [V1 方案](docs/V1-PLAN.md) — 已与用户对齐的范围、交互、验收
- [契约](docs/CONTRACTS.md) — 数据模型、路由、API、生命周期
- [Gate 0 Spike](docs/SPIKE.md) — 隔离 home、端口、S1-S10、通过标准
- [Gate 0 结论](docs/GATE0-SUMMARY.md) — 三条线结果与已接受缺口
- [测试计划](docs/TEST-PLAN.md) — 单测/宿主集成/E2E/数据审计
- [V1 测试结果](docs/TEST-RESULTS.md) — 12/12 E2E、151/151、审计证据
- [发布说明](docs/RELEASE.md) — 构建/打包/安装/卸载/已知限制
- [实施计划](docs/superpowers/plans/2026-10-18-global-session-groups.md) — TDD 任务拆分
- [ADR-001 左栏模式切换](docs/adr/0001-sidebar-mode-switch.md)
- [ADR-002 分组存储](docs/adr/0002-group-storage.md)
- [ADR-003 路由围栏](docs/adr/0003-route-fence.md)

## 关键约束

- 分组只写 `dshHomePath('storages')/dsh-session-groups.json`；不写 `workspace.json`、session 日志、`cordis.patch.yml`。
- 重命名/归档/新建全部走宿主服务；运行中归档需确认后 `stopActivity:true`。
- 组内新建用插件自己的预创建工作区菜单，不依赖宿主 hero 切换。
- Gate 0/测试必须使用独立 `DSH_HOME`（`.spike-homes/<agent>`）；`dsh.cmd` 硬编码真实 home，不能直接用。

## 当前阶段

- V1 实现完成：Host 存储/路由/围栏、Client 左栏分组视图、跨工作区拖拽、归档三态、组内新建、rename 同步。
- 验证：`npm test` 151/151；E2E 12/12；数据审计只写记录文件；真实 `~/.dsh` 零写入。
- **尚未安装到用户 desktop profile**；等待用户验收后再安装。
- 已知限制见 `docs/RELEASE.md` §5（运行中归档 BLOCKED-ENV、P1/P2 未实现项）。
