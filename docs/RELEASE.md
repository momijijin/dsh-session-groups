# 0.3.0-beta.76 发布与安装说明

- 版本：`0.3.0-beta.76`
- DSH core：`@deepseek-ai/dsh` 0.2.1-rc.2（community）/ 0.2.1-rc.5（official）
- 已验证桌面壳：社区版 DSH Desktop **Stable** 2.0.18；官方 DeepSeek Harness 桌面版 0.2.1.0（隔离 A+ + 维护者桌面窗口验收）
- 明确不支持：社区版 DSH Desktop Beta、社区版 DSH NEXT（`-next`）
- 状态：单元/契约测试 462/462；社区 A+ PASS；官方 A+ PASS；维护者桌面验收 PASS
- 发布包：`dsh-session-groups-0.3.0-beta.76.tgz`

## 本版重点

- 官方 DSH rc.5 会话创建兼容：优先 `sessions.create`，保留社区 rc.2 的 `startSession`/快照差分/`connectWorkspace` fallback。
- 会话右键菜单新增上移/下移，和分组菜单对齐。
- 英文标题统一为 Free Groups；补齐包图标，插件管理器可显示真实图标。
- GitHub Actions 升级到 Node 24 支持的 `checkout@v5` / `setup-node@v5`，Ubuntu runner 固定 `ubuntu-24.04`。
- 市场截图按用户决定不进入发布包。

## 安装方式

普通用户通过 **dshmarket** 安装；市场目录条目发布后搜索 `dsh-session-groups`。

维护者/开发调试可使用附带的本地 tarball：

```powershell
# 以本地 desktop profile 为例
DeepSeek Harness.exe --expose-internals `
  "C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add --force "file:<path>\dsh-session-groups-0.3.0-beta.76.tgz"
```

安装后必须重启对应桌面客户端。

## 发布流程

- release tag 只从 `main` 的版本边界创建，格式 `v0.3.0-beta.76`。
- `.github/workflows/release.yml` 只在 tag push 时运行，校验 tag 可达 `main`，然后执行测试、构建、打包并创建 GitHub prerelease。
- 市场目录条目由 `awesome-dsh-plugin` 维护；本版 YAML 已准备好，PR 在仓库 age gate 满足后提交。

## 验证基线

- community DSH Desktop 2.0.18 / DSH 0.2.1-rc.2 A+：PASS。
- official DeepSeek Harness desktop 0.2.1.0 / DSH 0.2.1-rc.5 A+：PASS。
- 维护者桌面窗口验收：PASS。
- coverage：93.64% lines / 82.29% branches / 88.78% functions。
