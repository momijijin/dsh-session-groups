# 0.3.0-beta.62 发布与安装说明

- 版本：`0.3.0-beta.62`
- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 状态：单元/契约测试 441/441；A+ 隔离回归通过；本轮真实桌面回归由用户执行
- 范围：自由分组、跨工作区会话、分组拖拽、搜索、归档筛选、三状态统计、首次使用引导、恢复默认布局、Fork/Copy ID、第一层设置和配置安全
- 发布包：`dsh-session-groups-0.3.0-beta.62.tgz`

## 1. 本轮变化（beta.39–beta.43）

### 会话与设置

- 移除自由分组中的 Pin/Unpin 菜单项
- 会话菜单增加 Fork session（仅非空、access 允许时显示）和 Copy Session ID
- Fork 成功后把子会话放到源分组组头，源会话未归组时放到未分组顶部
- 行 hover 提供归档/取消归档，不再提供 hover 置顶
- 设置卡移到 `plugins.bundle.config` 第一层
- 使用标准 DSH Switch / Button / Tooltip，并补齐中英文和逐项安全详情

### 配置与安全

- `diagnostics` / `debugProbe` 开关改为请求时读取，切换后热生效
- `controlDestructive` 开启前显示危险确认
- skill repair 不再强制覆盖用户自有 `SKILL.md`；返回 `409 skill-user-owned`
- 新增 `npm run check:coverage`，当前基线约 93.49% lines / 81.99% branches / 88.40% functions

### 发布工程

- 补 README、ARCHITECTURE、RELEASE、TEST-RESULTS、CHANGELOG
- README 移除陈旧的 Pin/“不修改标题”/路由未挂载描述
- 记录 `e2e/groups.spec.mjs` 为历史手工脚本，默认自动门禁使用 `e2e/isolated.spec.mjs`

## 2. 构建与测试

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups
npm test
npm run build
node --check lib/client.js
npm pack
```

预期：

- `npm test`：441/441 PASS
- 构建：`lib/client.js`
- 包：`dsh-session-groups-0.3.0-beta.62.tgz`

### 发布包信息

- 文件：`dsh-session-groups-0.3.0-beta.62.tgz`
- 大小与 SHA256：以最终 `npm pack` 输出和桌面安装记录为准（不写进包内文档，避免自引用）

## 3. 安装

### DSH Desktop 插件管理器

设置 → 插件 → 添加插件 → 选择 `.tgz` → 启用 → 完整重启 DSH。

### 命令行

```powershell
$desktop = "$env:LOCALAPPDATA\Programs\DSH Desktop\DSH Desktop.exe"
$cli = "$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
& $desktop --expose-internals $cli plugin --profile desktop add --force "file:C:\Users\Momiji\Projects\dsh-session-groups\dsh-session-groups-0.3.0-beta.62.tgz"
```

安装前备份：

```text
~/.dsh/profiles/desktop/package.json
```

安装后完整重启；客户端 bundle 变更不能只靠 HMR 验证。

## 4. 数据

- 分组记录：`<dshHome>/storages/dsh-session-groups.json`
- 单槽备份：`<dshHome>/storages/dsh-session-groups.json.bak`
- 诊断（可选）：`<dshHome>/storages/dsh-session-groups.diagnostics.ndjson`
- 调试探针（默认关闭）：`<dshHome>/storages/dsh-session-groups.debug.ndjson`
- 本地 UI 偏好：
  - `dsh-session-groups.view.v1`
  - `dsh-session-groups.archive.v1`
  - `dsh-session-groups.collapsed.v1`
  - `dsh-session-groups.width.v1`
  - `dsh-session-groups.onboarded.v1`
  - `dsh-session-groups.dialog.geometry.v9`

卸载后记录和偏好保留；重装可恢复。彻底清理需手工删除上述文件与键。

## 5. 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `diagnostics` | false | 拖拽诊断 HUD + NDJSON trace |
| `debugProbe` | false | 临时弹窗布局探针；关闭时不挂载 debug 路由、不写文件 |

### 安全边界

- debug 路由仅在 `debugProbe: true` 时注册
- 客户端 POST 也仅在 `/load` 返回 `debugProbe: true` 时发送
- 两个开关默认关闭
- 诊断/调试文件不写会话 transcript

### 干净 profile 脚本

```powershell
pwsh -NoProfile -File .\scripts\qa\clean-profile.ps1 `
  -Tarball "C:\Users\Momiji\Projects\dsh-session-groups\dsh-session-groups-0.3.0-beta.62.tgz"
```

- 使用 `%TEMP%` 下的独立 `DSH_HOME`，不会读写真实 `~/.dsh`
- 自动拒绝指向真实 `.dsh` 的路径
- 不删除任何文件；测试结束后按输出的 `TEST_HOME` 手工清理

### 隔离 install → uninstall → reinstall

```powershell
pwsh -NoProfile -File .\scripts\qa\lifecycle-isolated.ps1 `
  -Tarball "C:\Users\Momiji\Projects\dsh-session-groups\dsh-session-groups-0.3.0-beta.62.tgz" `
  -Port 4417
```

- 独立 `DSH_HOME` + `sg-life` profile
- 预置 sentinel 分组记录
- 卸载后 bundle 移除、记录 hash 不变
- 重装后 bundle 恢复、记录 hash 仍不变
- 自动拒绝真实 `.dsh`

### A+ 隔离 Playwright 冒烟

```powershell
pwsh -NoProfile -File .\scripts\qa\start-isolated-web.ps1 `
  -Tarball "C:\Users\Momiji\Projects\dsh-session-groups\dsh-session-groups-0.3.0-beta.62.tgz" `
  -Port 4416

$env:DSH_TEST_URL = "<web.json 中的 url>"
$env:DSH_TEST_HOME = "<web.json 中的 testHome>"
npm run test:isolated
```

- 只访问独立端口和独立 `DSH_HOME`
- 测试脚本拒绝真实 43120 和真实 `~/.dsh`
- 当前冒烟覆盖首次引导、三状态按钮、移动到分组 head、收起/展开顺序、264px、英文、深色、宿主侧栏 Rail
- 不连接真实 DSH 窗口

## 6. 验证清单

发布前必须确认：

- [ ] `npm test` 441/441
- [ ] `npm run check:all`
- [ ] `node --check lib/client.js`
- [ ] `npm pack` 包含 README、LICENSE、CHANGELOG、locale
- [ ] 干净 profile 安装（可用 `scripts/qa/clean-profile.ps1 -Tarball <path>`）
- [ ] 首次进入显示引导；dismiss 后不再出现
- [ ] 空分组/空会话显示空状态入口
- [ ] 三个状态按钮顺序正确
- [ ] 状态下拉背景不透明，底层行不透出
- [ ] 视图选项“恢复默认布局”恢复宽度/展开/弹窗几何
- [ ] `debugProbe` 关闭时 `/dsh-session-groups/debug` 返回 404
- [ ] 分组数据、归档、搜索、拖拽回归
- [ ] 窄侧栏 264px / 深浅色 / 中英文
- [ ] 宿主 sidebar 收起进入 Rail，展开后分组视图恢复且无 React 错误

## 7. 已知限制

- 状态统计只覆盖分组文档中已归组或显式未归组的会话
- 自动派生的未归组会话不进入头部统计
- 单窗口数据模型；多窗口冲突仅提示
- 搜索最多 20 条
- 宽度覆盖依赖宿主侧栏 DOM，失败时 fail-soft
- 对话框拖动/缩放没有键盘操作
- 0.3.0-beta.62 的 A+ 隔离 Playwright 已通过；真实桌面回归仍需用户执行
- 完整历史 `groups.spec.mjs` 未纳入默认门禁，当前自动化入口是 `isolated.spec.mjs`

## 8. 后续

0.3.0-beta.62 用于验证会话菜单、第一层设置、配置热生效与危险操作保护。  
用户桌面回归通过后再考虑 0.3.0 正式版和插件市场发布。














































