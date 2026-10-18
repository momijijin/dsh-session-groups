# dsh-session-groups

DSH 左侧栏的全局会话分组视图：分组只服务显示层，跨工作区组织会话，不改标题、不搬日志、不动工作区注册表。

- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 工作名：`dsh-session-groups`（显示名：全局会话分组）
- 状态：**Gate 0（可丢弃 DSH_HOME spike）**，未发布

## 文档

- [V1 方案](docs/V1-PLAN.md) — 已与用户对齐的范围、交互、验收
- [契约](docs/CONTRACTS.md) — 数据模型、路由、API、生命周期
- [Gate 0 Spike](docs/SPIKE.md) — 隔离 home、端口、S1-S10、通过标准
- [测试计划](docs/TEST-PLAN.md) — 单测/宿主集成/E2E/数据审计
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

- 文档已落；Host/Client/QA 三条 Gate 0 线进行中。
- 未安装到用户 desktop profile；未发布。
