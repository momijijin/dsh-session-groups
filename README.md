# dsh-session-groups

DSH Desktop 左侧栏的**全局会话分组**插件。它跨工作区组织会话，但只改变显示位置：

- 不修改会话标题
- 不移动会话日志
- 不修改官方工作区注册表
- 不写入 `workspace.json`

当前版本：**0.3.0-beta.14**  
测试基线：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2

## 功能

### 视图

- 自由分组视图与官方工作区视图切换
- 左侧栏宽度可拖动调整（264px 起，默认 420，最大为窗口宽度 80%）
- 双击宽度把手恢复默认宽度
- 视图模式、宽度、折叠状态、归档筛选、弹窗位置都会持久化

### 分组

- 新建根分组与子分组（最多 8 层）
- 重命名、更换图标、预设色板与自定义 `#RRGGBB`
- 分组拖拽排序、改父级、子树跟随
- 组菜单提供上移/下移兜底
- 折叠/展开
- 空叶分组直接删除
- 非空分组删除前选择直接会话与直接子组的目的地
- 分组内新建会话（需要时选择工作区）

### 会话

- 跨工作区把会话拖入分组
- 拖出分组进入未归组
- 打开、重命名、归档/取消归档、置顶/取消置顶、移动到分组
- 官方会话状态显示
- 未归组列表虚拟化

### 搜索与筛选

- 搜索会话标题、工作区、分组路径
- 选中后展开祖先、滚动并高亮
- 归档结果置灰不可打开
- 归档三态：隐藏 / 显示全部 / 仅归档

### 头部状态

只有三个统计按钮：

- **执行中**（spinner）
- **等待用户介入**（pause）
- **未读**（mail）

每个按钮的下拉按分组列出会话，点击打开。  
“执行中 / 待介入 / 未读”是互斥的主状态统计，不包含后台 job 统计。

### 弹窗

- 标题栏拖动、八方向缩放
- 点击背景不关闭，Cancel/Esc 关闭
- 紧凑尺寸和主题 token
- 5px 自绘可拖动细滚动条；无渐隐箭头

### 首次使用

首次进入自由分组视图会显示一次性说明卡：

- 分组只改变显示位置，不移动会话
- 如何新建分组、拖拽会话与组头

说明卡可 dismiss，状态写入 `localStorage`。  
没有分组且没有会话时会显示“新建第一个分组”的空状态入口。

### 视图选项

右上角“视图选项”包含：

- 归档三态
- **恢复默认布局**：恢复侧栏宽度、全部展开、清除弹窗位置尺寸；不动分组数据
- 版本与作用范围说明

## 安装

### DSH Desktop 插件管理器

设置 → 插件 → 添加插件 → 选择：

```text
dsh-session-groups-0.3.0-beta.14.tgz
```

启用后完整重启 DSH（或按宿主提示刷新）。

### 命令行安装

```powershell
$desktop = "$env:LOCALAPPDATA\Programs\DSH Desktop\DSH Desktop.exe"
$cli = "$env:LOCALAPPDATA\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
& $desktop --expose-internals $cli plugin --profile desktop add --force "file:C:\path\to\dsh-session-groups-0.3.0-beta.14.tgz"
```

安装后重启 DSH。安装命令会改 `desktop` profile，请先备份 `~/.dsh/profiles/desktop/package.json`。

## 数据

分组记录：

```text
<dshHome>/storages/dsh-session-groups.json
```

- 写入使用 revision 比较与串行队列
- 冲突时加载最新版本
- 损坏文件会保留原文件并降级为空分组
- 成功提交前保留单槽 `.bak` 备份
- 不写官方工作区与会话数据

本地 UI 偏好（localStorage）：

- `dsh-session-groups.view.v1`
- `dsh-session-groups.archive.v1`
- `dsh-session-groups.collapsed.v1`
- `dsh-session-groups.width.v1`
- `dsh-session-groups.onboarded.v1`
- `dsh-session-groups.dialog.geometry.v9`

卸载插件后官方工作区视图恢复；分组记录和本地偏好保留，重装可恢复。需要彻底清理时删除上述记录文件、`.bak` 与对应 localStorage 键。

## 配置

插件管理器提供两个开关，默认都关闭：

| 配置 | 默认 | 作用 |
|---|---|---|
| `diagnostics` | 关闭 | 拖拽 HUD 与本地 NDJSON trace |
| `debugProbe` | 关闭 | 临时弹窗布局探针与 `.debug.ndjson` 路由；生产使用不要开启 |

`debugProbe` 关闭时不会挂载 `/dsh-session-groups/debug` 路由，也不会写调试文件。  
后台任务监控已在 0.3.0-beta.1 回滚，不订阅 `ctx.jobs`、不额外开启 job 流。

诊断文件位置：

```text
<dshHome>/storages/dsh-session-groups.diagnostics.ndjson
```

仅在 `diagnostics` 开启时写入；内容为拖拽事件/ID/timing，不包含会话 transcript。文件不自动轮转，需要时可手工清理。

## 语言

- 只跟随主框架当前语言，不提供插件自己的语言切换入口。
- 当前注册 `zh` / `en`；其他语言的 JSON 只作为后续备用资源，不主动加入主框架语言目录。
- 只有主框架已实现的语言才会被启用；用户创建的分组名、会话名和工作区名不翻译。

## 已知限制

- 状态统计只覆盖分组文档中已归组或显式未归组的会话；自动派生的未归组会话不进入头部计数。
- 分组、折叠状态与弹窗位置是单窗口本地状态；多窗口冲突通过 409 提示，不做实时合并。
- 搜索最多返回 20 条，只匹配标题/工作区/组路径。
- 宽度覆盖依赖 DSH 左侧栏 DOM；宿主大改布局时 fail-soft，分组功能不受影响。
- 对话框拖动/缩放为指针操作；没有键盘移动/缩放。
- 当前发布验证以 335 项单元/契约测试和用户桌面回归为准；仓库保留 E2E 脚本，但尚未记录 0.3.0-beta.14 的完整 E2E 结果。

## 开发

```powershell
npm test
npm run build
node --check lib/client.js
npm pack
```

- `npm test`：335 项单元/契约测试
- 分层：`src/core` 纯函数核心，`src/adapters` 承载 DSH 版本适配；见 `docs/ARCHITECTURE.md`
- `npm run check:all`：全文件语法检查 + 测试
- `scripts/qa/clean-profile.ps1`：隔离 profile 安装/卸载验证，不碰真实 `~/.dsh`
- `scripts/qa/lifecycle-isolated.ps1`：隔离 install → uninstall → reinstall，校验分组记录 hash 不变
- `scripts/qa/start-isolated-web.ps1` + `npm run test:isolated`：A+ 隔离 Playwright 冒烟
  - 覆盖首次引导、搜索、归档筛选、拖拽自动展开、拖拽边缘、弹窗拖动/缩放、三状态按钮、移动到分组 head、收起/展开顺序、264px、英文/深色、宿主侧栏 Rail、亮色对比度
  - 必须先启动独立 web，取得 `web.json` 的 URL 和 testHome
  - Playwright 拒绝真实 43120 端口和真实 `~/.dsh`
- 构建产物：`lib/client.js`
- 发布包：`dsh-session-groups-0.3.0-beta.14.tgz`
- 详细发布步骤见 `docs/RELEASE.md`
- 测试摘要见 `docs/TEST-RESULTS.md`

## 许可

MIT，见 `LICENSE`。















