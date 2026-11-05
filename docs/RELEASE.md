# 0.4.0-beta.1 发布与安装说明

- 版本：`0.4.0-beta.1`
- 包名：`dsh-session-grove`
- 插件显示名：Free Groups / 自由分组
- DSH core：`@deepseek-ai/dsh` 0.2.1-rc.2（community）/ 0.2.1-rc.5（official）
- 已验证桌面壳：社区版 DSH Desktop **Stable** 2.0.18；官方 DeepSeek Harness 桌面版 0.2.1.0
- 状态：476/476 测试；社区/官方隔离 A+ PASS；等待最终发布授权
- 发布包：`dsh-session-grove-0.4.0-beta.1.tgz`

## 本版重点

- 完整身份重置：package、plugin/bundle id、host 路由、存储/token/diagnostics/debug 文件、client localStorage 命名空间全部改为 `dsh-session-grove`。
- AI tool 改为 `session_grove_control`，skill/CLI 改为 `session-grove-control`。
- **不做自动迁移**：旧 `dsh-session-groups` 记录和浏览器键刻意忽略且不删除，避免把同名社区插件的数据误导入。
- 手动迁移见 [MIGRATION-0.4.md](MIGRATION-0.4.md)。

## 安装方式

普通用户通过 **dshmarket** 安装；市场新条目发布后搜索 `dsh-session-grove`。

维护者/开发调试可使用本地 tarball：

```powershell
# 以本地 desktop profile 为例
DeepSeek Harness.exe --expose-internals `
  "C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add --force "file:<path>\dsh-session-grove-0.4.0-beta.1.tgz"
```

安装后必须重启对应桌面客户端。先卸载旧的 `dsh-session-groups`；不要在同一 profile 中并存两个身份。

## 发布流程

- release tag 只从 `main` 的版本边界创建。
- `.github/workflows/release.yml` 只在 tag push 时运行，校验 tag 可达 `main`，执行测试、构建、打包并创建 GitHub prerelease。
- 市场旧条目 `momijijin/dsh-session-groups` 需要替换为 `momijijin/dsh-session-grove`；新条目 YAML/tarball 在发布前准备。
- 尚未创建 tag、GitHub Release 或市场 PR。

## 验证基线

- 476/476 单元/契约测试。
- coverage：93.71% lines / 82.36% branches / 88.91% functions。
- community DSH Desktop 2.0.18 / DSH 0.2.1-rc.2 A+：PASS。
- official DeepSeek Harness desktop 0.2.1.0 / DSH 0.2.1-rc.5 A+：PASS。
- 身份边界测试：新 package/路由/存储/skill/tool 名称；旧数据无自动迁移。
