# ADR-001：左栏采用 A 模式（接管 + 模式切换）

- 状态：Accepted（2026-10-18，用户已确认 A）
- 背景：DSH 0.2.1-rc.2 的 `sidebar.workspaces` 是 single slot；没有 additive 的第二左栏列表槽位。官方工作区浏览器占用该槽位，组件未导出。
- 决策：分组视图激活时以 `priority:-1` 接管 `sidebar.workspaces`；切回时 dispose，让官方浏览器立即回来。默认模式为 `workspace`；footer action 常驻切换；视图内提供「返回工作区」。
- 后果：
  - 分组视图激活时官方工作区的搜索/添加/重命名/删除/视图选项不可见；切回即可用。
  - 不重实现官方浏览器；不尝试同屏双列表。
  - 需要 `ctx.effect` 管理注册生命周期，捕获同 priority 冲突并 fail-soft。
- 备选：B 主区面板（零回归但不是左栏）；未采纳，因为用户明确要求左栏。
