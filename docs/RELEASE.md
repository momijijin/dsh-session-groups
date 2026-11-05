# 0.4.0-beta.6 发布与安装说明

- 版本：`0.4.0-beta.6`
- 包名：`dsh-session-grove`
- 插件显示名：Free Groups / 自由分组
- DSH core：`@deepseek-ai/dsh` 0.2.1-rc.2（community）/ 0.2.1-rc.5（official）
- 已验证桌面壳：社区版 DSH Desktop **Stable** 2.0.18；官方 DeepSeek Harness 桌面版 0.2.1.0
- 状态：484/484 测试；等待最终发布授权
- 发布包：`dsh-session-grove-0.4.0-beta.6.tgz`

## 本版重点

- **CLDR 复数**：`Intl.PluralRules` + per-category JSON；`group.sessionCount`、`sessions.expand` 已迁移 one/other。
- **语言资源**：`en/zh/ja/ko/de/fr/es/pt` 八种 locale，每种 288 keys；Host 注册与 manifest 标题/描述同步。
- 地区变体解析到基础语言（`ja-JP` → `ja`、`ko-KR` → `ko`、`pt-BR` → `pt` 等）；未支持语言回退英文。
- **i18n 基础设施**：BCP 47 基础语言归一化、字典注册表、未知语言回退英文；不调用 `addLanguage`，语言目录仍由 Host/第三方语言包拥有。
- 保留 `0.4.0-beta.1` 身份重置与 `0.4.0-beta.2` 原生官方壳 locale fallback 修复。
- **不做自动迁移**：旧 `dsh-session-groups` 记录和浏览器键刻意忽略且不删除，避免误导入同名社区插件数据；手动迁移见 [MIGRATION-0.4.md](MIGRATION-0.4.md)。

## 安装方式

普通用户通过 **dshmarket** 安装；市场新条目发布后搜索 `dsh-session-grove`。

维护者/开发调试可使用本地 tarball：

```powershell
# 以本地 desktop profile 为例
DeepSeek Harness.exe --expose-internals `
  "C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add --force "file:<path>\dsh-session-grove-0.4.0-beta.6.tgz"
```

安装后必须重启对应桌面客户端。先卸载旧的 `dsh-session-groups`；不要在同一 profile 中并存两个身份。

## 发布流程

- release tag 只从 `main` 的版本边界创建。
- `.github/workflows/release.yml` 只在 tag push 时运行，校验 tag 可达 `main`，执行测试、构建、打包并创建 GitHub prerelease。
- 市场旧条目 `momijijin/dsh-session-groups` 需要替换为 `momijijin/dsh-session-grove`。
- 尚未创建 tag、GitHub Release 或市场 PR。

## 验证基线

- 479/479 单元/契约测试。
- coverage：93.67% lines / 82.42% branches / 88.94% functions。
- community DSH Desktop 2.0.18 / DSH 0.2.1-rc.2 A+：PASS。
- official DeepSeek Harness desktop 0.2.1.0 / DSH 0.2.1-rc.5 A+：PASS。
- 新增英文界面断言：onboarding、group menu、dialog title、settings copy。
