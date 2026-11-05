# 0.4.0-beta.44 发布与安装说明

- 版本：`0.4.0-beta.44`
- 包名：`dsh-session-grove`
- 插件显示名：Free Groups / 自由分组
- DSH core：`@deepseek-ai/dsh` 0.2.1-rc.2（community）/ 0.2.1-rc.5（official）
- 已验证桌面壳：社区版 DSH Desktop **Stable** 2.0.18；官方 DeepSeek Harness 桌面版 0.2.1.0
- 状态：514/514 测试；A+ 为 `0.4.0-beta.42` 实测证据；第三方 ja 语言包 A+ PASS；23 例全语言注入切换 PASS（含阿拉伯语 RTL）；完整语言/运行时矩阵见 [TEST-MATRIX.md](TEST-MATRIX.md)
- 发布包：`dsh-session-grove-0.4.0-beta.44.tgz`

## 本版重点

- **安全修复**：session rename/archive 现在严格受 `controlSessions` 控制；关闭时在 token/body 检查前返回 404 `session-controls-disabled`，并补了 gate 顺序与零 mutation 测试。
- **文档 truth pass**：README/CHANGELOG/RELEASE/TEST-MATRIX/I18N/ARCHITECTURE/COMPATIBILITY 统一到当前事实（514 tests、A+ 0.4.0-beta.42、RTL 0.4.0-beta.39、19×288 locale keys）。
- **版本**：五处版本一致为 `0.4.0-beta.44`；主 bundle 与 17 个 lazy locale chunk 已重建。
- 本批未发布；没有版本 tag 或 GitHub Release。

## 安装方式

普通用户通过 **dshmarket** 安装；市场新条目发布后搜索 `dsh-session-grove`。

维护者/开发调试可使用本地 tarball：

```powershell
# 以本地 desktop profile 为例
DeepSeek Harness.exe --expose-internals `
  "C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add --force "file:<path>\dsh-session-grove-0.4.0-beta.44.tgz"
```

安装后必须重启对应桌面客户端。先卸载旧的 `dsh-session-groups`；不要在同一 profile 中并存两个身份。

## 发布流程

- release tag 只从 `main` 的版本边界创建。
- `.github/workflows/release.yml` 只在 tag push 时运行，校验 tag 可达 `main`，执行测试、构建、打包并创建 GitHub prerelease。
- 市场旧条目 `momijijin/dsh-session-groups` 需要替换为 `momijijin/dsh-session-grove`。
- 尚未创建 tag、GitHub Release 或市场 PR。

## 发布前本地门禁（必须）

除单元测试外，发布候选必须记录以下运行时证据；任一失败不得进入 release：

```bash
npm test
npm run build
node --check lib/client.js
npm run check:coverage
npm run test:isolated
```

全语言和第三方语言包需要隔离实例：

```powershell
pwsh -File .\scripts\qa\start-isolated-web.ps1 `
  -Tarball .\dsh-session-grove-<version>.tgz `
  -LocalePack .\e2e\fixtures\ja-locale-pack
```

在该实例的 `web.json` 上设置 `DSH_TEST_URL` / `DSH_TEST_HOME`，然后运行：

```bash
npm run test:locale-pack
npm run test:all-locales
```

`test:all-locales` 覆盖 19 种语言 + 别名（23 例），并断言 header、新建分组弹窗、组菜单和阿拉伯语 RTL 根方向。发布说明必须附上这两条输出（日期、locale 数、PASS 数）。

## 验证基线

完整覆盖矩阵见 [TEST-MATRIX.md](TEST-MATRIX.md)；本候选版本的可重复门禁为：

- 514/514 单元/契约测试。
- coverage：92.45% lines / 82.44% branches / 88.73% functions。
- community A+：`0.4.0-beta.42` PASS；official A+：`0.4.0-beta.42` PASS（隔离 official host）；official all-locales 23/23 PASS；Arabic RTL 视觉验收：2026-11-05 PASS（独立 official isolated profile 注入 + 人工审阅截图）。
