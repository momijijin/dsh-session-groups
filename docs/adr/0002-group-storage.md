# ADR-002：V1 使用自带原子写 JSON，不用 storageDomain

- 状态：Accepted（2026-10-18）
- 背景：分组记录必须独立、可读、可备份；Host spike 已实测 `~/.dsh/storages` 下的 temp+rename+`.bak`、revision 409、坏文件隔离、10/10 重启读回。
- 决策：V1 使用 `dshHomePath('storages')/dsh-session-groups.json`，自带：
  - 进程内 promise tail 串行；
  - temp + rename + `.bak`；
  - revision 与 409；
  - 坏文件 `.corrupt-*` 隔离；
  - 版本过高不覆盖。
- 拒绝 storageDomain（V1）的原因：JSON single 布局是 `{unit, global, tables}` 信封，不是原样 `GroupDoc`；`.bak`/恢复要另做；当前自定义存储已被 Host spike 证明可用。
- 后果：跨进程写锁仍需单窗口假设；P1 可评估 storageDomain 或锁文件。
