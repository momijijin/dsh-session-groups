# 0.3.0-beta.73 发布与安装说明

- 版本：`0.3.0-beta.73`
- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 状态：单元/契约测试 459/459；A+ 隔离回归通过；真实桌面回归通过（含 7–8 个 running 会话滚动/性能验收）
- 范围：自由分组、跨工作区分组、分组拖拽、搜索、归档筛选、三状态统计、首次使用引导、恢复默认布局、Fork/Copy ID、第一层设置和配置安全、键盘可达性、主会话视图收窄
- 发布包：`dsh-session-groups-0.3.0-beta.73.tgz`

## 0. 本版新增（beta.69–beta.73）

- 分组右键菜单第一项“新建会话”，复用分组右侧 `+` 的新建会话动作。
- 对话框和分组菜单的键盘可达性：可访问名称、焦点陷阱、Escape、焦点返回、移动/缩放、roving focus。
- 短事务跨进程锁 + 自动回收过期锁。
- `controlSessions` 依赖 `controlApi`，设置页显示依赖态。
- `components.js` 和 `routes.js` 维护性拆分。
- spinner 合成器动画、主会话视图收窄、滚动布局缓存；本地实测 GPU 约 −49%，主线程约 −29 个点。
- 市场截图按用户决定取消，不进入发布包。

## 1. 发布重点（beta.60–beta.64）

### 兼容性与诊断

- 原生工具增加只读 `doctor`：host capabilities、版本适配器、gates、storage health、services、routes。
- 新增 `GET /dsh-session-groups/control/doctor`；受 fence 保护，`controlApi` 关闭时仍可用于诊断。
- CLI `doctor` 交换 DSH web launch cookie 后读取诊断；compatibility 不支持时返回非零退出码。
- doctor 同时报告 live 与 startup 能力快照，避免服务注入时序误报。

### 数据安全

- 主记录损坏时先 quarantine；有有效 `.bak` 时自动恢复上一 revision。
- 无有效 `.bak` 时保持空分组启动，原文件不删除。
- 新增只读 storage health：`ok/missing/corrupt/unsupported-version/invalid/unreadable`、revision、backupStatus/backupRevision/backupError、quarantine 数量。
- 增加双窗口同 `baseRevision` 并发 CAS 的 A+ 场景：一个 200、一个 409，双方收敛。

### 文档与发布

- README 默认英文，中文移至 `README.zh.md`。
- README、ARCHITECTURE、COMPATIBILITY、RELEASE、TEST-RESULTS 与 0.3.0-beta.68 对齐。
- 历史 V1/V1.1 的 CONTRACTS、TEST-PLAN、V1-PLAN、GATE0-SUMMARY、SPIKE 已加历史声明，避免被误读为当前状态。
- 当前发布验证：450/450 单元/契约；A+ 隔离回归通过；真实桌面回归待用户执行。
- 当前 beta 通过本地 tarball 分发；dshmarket 目录条目尚未发布。

## 2. 构建与测试

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups
npm test
npm run build
node --check lib/client.js
npm pack
```

预期：

- `npm test`：450/450 PASS
- 构建：`lib/client.js`
- 包：`dsh-session-groups-0.3.0-beta.68.tgz`

### 发布包信息

- 文件：`dsh-session-groups-0.3.0-beta.68.tgz`
- 大小与 SHA256：以最终 `npm pack` 输出和桌面安装记录为准（不写进包内文档，避免自引用）

## 3. 安装

### 普通用户：dshmarket

在 **dshmarket** 中搜索并安装：

```text
dsh-session-groups
```

目录条目上架后，更新也由 dshmarket 完成。普通用户不需要本地 tarball 或命令行。

### 维护者/开发者：本地 tarball（普通用户跳过）

设置 → 插件 → 添加插件 → 选择 `.tgz` → 启用 → 完整重启 DSH。

### 命令行

```powershell
$desktop = "$env:LOCALAPPDATA\Programs\DSH Desktop\DSH Desktop.exe"
$cli = "$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
& $desktop --expose-internals $cli plugin --profile desktop add --force "file:C:\Users\Momiji\Projects\dsh-session-groups\dsh-session-groups-0.3.0-beta.68.tgz"
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
  -Tarball "C:\Users\Momiji\Projects\dsh-session-groups\dsh-session-groups-0.3.0-beta.68.tgz"
```

- 使用 `%TEMP%` 下的独立 `DSH_HOME`，不会读写真实 `~/.dsh`
- 自动拒绝指向真实 `.dsh` 的路径
- 不删除任何文件；测试结束后按输出的 `TEST_HOME` 手工清理

### 隔离 install → uninstall → reinstall

```powershell
pwsh -NoProfile -File .\scripts\qa\lifecycle-isolated.ps1 `
  -Tarball "C:\Users\Momiji\Projects\dsh-session-groups\dsh-session-groups-0.3.0-beta.68.tgz" `
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
  -Tarball "C:\Users\Momiji\Projects\dsh-session-groups\dsh-session-groups-0.3.0-beta.68.tgz" `
  -Port 4416

$env:DSH_TEST_URL = "<web.json 中的 url>"
$env:DSH_TEST_HOME = "<web.json 中的 testHome>"
npm run test:isolated
```

- 只访问独立端口和独立 `DSH_HOME`
- 测试脚本拒绝真实 43120 和真实 `~/.dsh`
- 当前冒烟覆盖首次引导、三状态按钮、归入分组 head、收起/展开顺序、264px、英文、深色、宿主侧栏 Rail
- 不连接真实 DSH 窗口

## 6. 验证清单

发布前必须确认：

- [ ] `npm test` 450/450
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
- 写入使用进程内队列 + 短生命周期锁文件；持有者 PID 消失或锁超过 30 秒会自动回收
- 搜索最多 20 条
- 宽度覆盖依赖宿主侧栏 DOM，失败时 fail-soft
- 对话框拖动/缩放没有键盘操作
- 0.3.0-beta.68 为本地候选；A+ 隔离回归通过；真实桌面回归待用户执行
- 完整历史 `groups.spec.mjs` 未纳入默认门禁，当前自动化入口是 `isolated.spec.mjs`
- dshmarket 目录条目尚未发布，当前 beta 使用本地 tarball 或 GitHub Release

## 8. 后续：dshmarket 发布

不要求在插件设置页实现自更新。更新由 dshmarket / 插件管理器负责。

1. 创建公开 GitHub 仓库并推送 `dev`、`main` 与 `v0.3.0-beta.68` tag；
2. 创建 GitHub Release，上传 `npm pack` 生成的 tarball；
3. 可选：发布 npm beta，优先使用带版本的 npm 源；
4. 向 `awesome-dsh-plugin` 提交一个插件条目 PR（不是向 `dshmarket` 应用仓库提交）；
5. 在隔离 DSH 中用 dshmarket 安装；
6. 发布下一版并验证市场 Update；
7. 真实桌面回归通过后再考虑稳定版。














































