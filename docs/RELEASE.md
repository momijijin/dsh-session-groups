# 0.4.0-beta.24 发布与安装说明

- 版本：`0.4.0-beta.24`
- 包名：`dsh-session-grove`
- 插件显示名：Free Groups / 自由分组
- DSH core：`@deepseek-ai/dsh` 0.2.1-rc.2（community）/ 0.2.1-rc.5（official）
- 已验证桌面壳：社区版 DSH Desktop **Stable** 2.0.18；官方 DeepSeek Harness 桌面版 0.2.1.0
- 状态：493/493 测试；第三方 ja 语言包 A+ PASS；23 例全语言注入切换 PASS（含阿拉伯语 RTL）；完整语言/运行时矩阵见 [TEST-MATRIX.md](TEST-MATRIX.md)
- 发布包：`dsh-session-grove-0.4.0-beta.24.tgz`

## 本版重点

- **全语言注入 smoke**：test-only locale pack 注入 19 种语言及 zh-TW/zh-HK/zh-CN/pt-BR 别名，`test:all-locales` 共 23 例断言 header + 新建分组弹窗 + 组菜单 + settings/config + 阿拉伯语 RTL 根方向。
- **阿拉伯语 + RTL 审计**：`ar` 资源、`dir` 根方向、核心列表/header/弹窗 RTL；新增菜单/弹窗 viewport bounds、设置面板 `dir` 与 RTL 截图。
- **i18n 分层**：`locale.js` 拆为 resources / locale-id / message-format / translator；facade 仅 re-export，UI 仍只消费 `t`。
- **双计数文案**：删除分组改为 `group.sessionCount` + `group.subgroupCount` 两条独立复数 + 静态指令，不再依赖双计数单串。
- **CLDR 复数**：`Intl.PluralRules` + per-category JSON；`group.sessionCount`、`group.subgroupCount`、`sessions.expand`、`time.*` 已迁移。
- **第三方语言包 A+**：test-only ja locale bundle 调用 `addLanguage` + `setLocale`，隔离 A+ 断言日文 onboarding/弹窗。
- **繁体中文**：新增 `zh-Hant` 资源与 script-aware resolver（`zh-TW/zh-HK` → `zh-Hant`，`zh-CN/zh-Hans` → `zh`）。
- **语言资源**：`en/zh/zh-Hant/ja/ko/de/fr/es/pt/it/nl/pl/tr/vi/th/id/ru/hi/ar` 十九种 locale，每种 288 keys；Host 注册与 manifest 标题/描述同步。
- **长文案视觉**：ru/hi/ar 在 264px 最小侧栏（内容 252px）截图无根节点横向溢出；session row 在 locale 切换时按 `localeRevision` 重绘。
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
  plugin --profile desktop add --force "file:<path>\dsh-session-grove-0.4.0-beta.24.tgz"
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

- 493/493 单元/契约测试。
- coverage：93.70% lines / 82.36% branches / 89.10% functions。
- community A+：最近一次记录为 `0.4.0-beta.20` PASS；official A+ 为历史记录，`0.4.0-beta.24` 尚未重跑。
