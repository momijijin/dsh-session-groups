# 0.4.0-beta.58 发布与安装说明

- 版本：`0.4.0-beta.58`
- 包名：`dsh-session-grove`
- 插件显示名：Free Groups / 自由分组
- DSH core：`@deepseek-ai/dsh` 0.2.1-rc.2（community）/ 0.2.1-rc.5（official）
- 已验证桌面壳：社区版 DSH Desktop **Stable** 2.0.18；官方 DeepSeek Harness 桌面版 0.2.1.0
- 状态：522/522 测试；community A+ `0.4.0-beta.58` / official A+ `0.4.0-beta.58` 实测证据（手工本地，非 CI 自动门禁）；official ja 语言包 A+ PASS；all-locales 23/23 PASS（含阿拉伯语 RTL）；完整语言/运行时矩阵见 [TEST-MATRIX.md](TEST-MATRIX.md)
- 发布包：`dsh-session-grove-0.4.0-beta.58.tgz`

## 本版重点

- **Cleanup**：移除 new-session 对话框与 workspace picker 兼容代码；组右键/加号直接使用推断工作区创建/复用 blank 会话并放到组首。
- **宿主边界**：工作区切换、新建工作区、blank 复用全部交给宿主；插件不再绘制目录选择 UI。
- **配套**：删除 6 个失效 locale key（286 total）；清理 action/bridge/dialog-selection/CSS/tests 残留。
- **记录**：522 unit/contract + 15 UI runtime cases；A+ 证据为 `.58`（community + official）。
- 本批未发布；没有版本 tag 或 GitHub Release。

## 安装方式

普通用户通过 **dshmarket** 安装；市场新条目发布后搜索 `dsh-session-grove`。

维护者/开发调试可使用本地 tarball：

```powershell
# 以本地 desktop profile 为例
DeepSeek Harness.exe --expose-internals `
  "C:\Users\<user>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add --force "file:<path>\dsh-session-grove-0.4.0-beta.58.tgz"
```

安装后必须重启对应桌面客户端。先卸载旧的 `dsh-session-groups`；不要在同一 profile 中并存两个身份。

## 发布流程

- release tag 只从 `main` 的版本边界创建。
- `.github/workflows/release.yml` 只在 tag push 时运行：校验 tag 可达 `main`，执行 `npm test` / `npm run build` / `npm run check:coverage` / `npm run check:ui` / `npm run check:release`，打包后生成 `SHA256SUMS`，把 tgz 与 `SHA256SUMS` 一起上传到 GitHub Release；只有 prerelease tag（如 `-beta`）才标记 prerelease，稳定版不标记。
- `npm run check:release` 断言 `GITHUB_REF_NAME` 恰好等于 `v<package.version>`（本地无该变量时只做结构校验）。
- 市场旧条目 `momijijin/dsh-session-groups` 需要替换为 `momijijin/dsh-session-grove`。
- 尚未创建 tag、GitHub Release 或市场 PR。

## 发布前本地门禁（必须）

除单元测试外，发布候选必须运行以下门禁并记录结果；任一失败不得进入 release：

```bash
npm run check:style
npm test
npm run build
npm run check:lib
node --check lib/client.js
npm run check:coverage
npm run check:ui
npm run check:release
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

## 自动化门禁与手工证据的边界

`.github/workflows/release.yml` 自动执行的结构门禁：

- `npm run check:style`、`npm test`、`npm run build`、`npm run check:lib`、`node --check lib/client.js`；
- `npm run check:coverage`；
- `npm run check:ui`（模块加载 smoke，不计入逻辑 coverage）；
- `npm run check:release`：`package.json` / `dsh.plugin.json` / `src/shared/constants.js` / `package-lock.json` 四处版本一致，tag 必须为 `v<package.version>`，当前版本的 release note 存在，`lib/client.js` 已打上当前版本戳，`package.json.files` 中的每个路径存在；
- 打包后生成 `SHA256SUMS`，并随 tgz 一起上传到 GitHub Release。

以下**不是** CI 自动门禁，必须由维护者在本地隔离实例手工执行，并把输出（日期、locale 数、PASS 数）写进发布说明：

- `npm run test:isolated`（A+ 隔离 Playwright）；
- `npm run test:ui-browser`（真实浏览器 UI runtime coverage；同一隔离宿主环境）；
- `npm run test:locale-pack` / `npm run test:all-locales`（第三方语言包与全语言切换）。

release workflow 不运行 Playwright、不启动隔离 DSH 实例，也不会自动生成 A+ / all-locales 证据；这两类结论只能来自人工执行与人工记录。

## 验证基线

完整覆盖矩阵见 [TEST-MATRIX.md](TEST-MATRIX.md)；本候选版本的可重复门禁为：

- 522/522 单元/契约测试。
- coverage：92.3% lines / 82.9% branches / 89.1% functions（Node coverage 合并存在 ±0.05 的重复运行抖动）。
- UI runtime：17/17 cases（`npm run check:ui`）。
- community A+：`0.4.0-beta.58` PASS（2026-11-06，隔离 community host）；official A+：`0.4.0-beta.58` PASS（2026-11-06，隔离 official host）；official locale-pack PASS；official all-locales 23/23 PASS（2026-11-06）；Arabic RTL 视觉验收：2026-11-05 PASS（独立 official isolated profile 注入 + 人工审阅截图）。

A+ / all-locales 结论均为手工本地证据（见上节），不是 CI 自动门禁的产物。
