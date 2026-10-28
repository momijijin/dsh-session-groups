# dsh-session-groups

DSH 左侧栏的全局会话分组视图：分组只服务显示层，跨工作区组织会话，不改标题、不搬日志、不动工作区注册表。

- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 工作名：`dsh-session-groups`（显示名：全局会话分组）
- 版本：`0.2.0`（V1.1）
- 状态：**V1.1 QA 全绿（15/15 E2E、183/183 tests、audit PASS）**，待用户验收；未安装到 desktop profile

## V1.1 新增（0.2.0）

- **左栏宽度**：分组视图内可拖 264–760px（主内容至少 480px），默认 420，双击把手复位；只覆盖分组视图，切回官方/rail 恢复官方宽度，宽度持久化。
- **分组拖拽**：组头拖拽同级排序/改父级，子树跟随，禁止移入自身/后代；组体子组缝隙（n+1 槽）可落为子组；组菜单新增「上移/下移」兜底。
- **会话搜索**：视图头第二行搜索框，匹配标题/工作区/组路径；选中普通会话即打开、展开所在组及全部祖先、滚动并高亮；归档结果列出但置灰不可打开；搜索只读，不写分组记录。

V1 能力（建组/嵌套/跨工作区拖会话/归档三态/组内新建/重命名/rail/失败降级）保持。

## 安装

```powershell
npm pack
# 产物：dsh-session-groups-0.2.0.tgz
```

DSH Desktop：设置 → 插件 → 添加插件 → 选择该 `.tgz`（或本地目录），启用后重启/刷新。
不要用 `dsh plugin --profile desktop` 修改 App 管理的 profile；隔离 profile 的验证步骤见 `docs/RELEASE.md` §3。

## 文档

- [V1/V1.1 方案](docs/V1-PLAN.md) — 范围、交互、验收
- [V1.1 设计 spec](docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md) — 宽度/组拖/搜索契约
- [V1.1 实施计划](docs/superpowers/plans/2026-10-28-session-groups-v1.1.md)
- [契约](docs/CONTRACTS.md) — 数据模型、路由、API、testid、生命周期
- [Gate 0 Spike](docs/SPIKE.md) / [Gate 0 结论](docs/GATE0-SUMMARY.md)
- [测试计划](docs/TEST-PLAN.md) — 单测/宿主集成/15 步 E2E/数据审计
- [V1/V1.1 测试结果](docs/TEST-RESULTS.md) — 15/15 E2E、183/183、审计与打包证据
- [发布说明](docs/RELEASE.md) — 构建/打包/安装/卸载/已知限制
- [ADR-001 左栏模式切换](docs/adr/0001-sidebar-mode-switch.md) / [ADR-002 分组存储](docs/adr/0002-group-storage.md) / [ADR-003 路由围栏](docs/adr/0003-route-fence.md)

## 关键约束

- 分组只写 `dshHomePath('storages')/dsh-session-groups.json`；不写 `workspace.json`、session 日志、`cordis.patch.yml`。
- 重命名/归档/新建全部走宿主服务；运行中归档需确认后 `stopActivity:true`。
- 组内新建用插件自己的预创建工作区菜单，不依赖宿主 hero 切换。
- 宽度覆盖依赖宿主布局 DOM，找不到 frame/sidebarRoot 时 fail-soft（只隐藏把手，分组/搜索正常）。
- Gate 0/测试必须使用独立 `DSH_HOME`（`.spike-homes/<agent>`）；`dsh.cmd` 硬编码真实 home，不能直接用。

## 当前阶段

- V1 实现完成；V1.1（0.2.0）完成左栏宽度、分组拖拽排序/改父级、会话搜索。
- 验证：`npm test` 183/183；官方 E2E 15/15（含 step 10 重启 hydration wait）；数据审计只写记录文件；真实 `~/.dsh` 零写入。
- **尚未安装到用户 desktop profile**；等待用户验收后再安装。
- 已知限制见 `docs/RELEASE.md` §5（运行中归档 BLOCKED-ENV、宽度 DOM 依赖、搜索范围、P1/P2 未实现项）。
