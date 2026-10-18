# Gate 0 — 可丢弃 DSH_HOME Spike（修订稿）

- 目的：在不碰真实 `~/.dsh` 的前提下验证 V1 依赖的宿主能力
- 关键修订：**profile 不隔离数据**；必须用独立 `DSH_HOME`，且 `dsh.cmd` 会硬编码 `DSH_HOME`，不能直接用 PATH 上的 wrapper
- 产出：各 spike 的 `REPORT.md` + 证据 + 本文件的 Gate 结论

## 0. 数据隔离（架构评审 M0，必须遵守）

`~/.dsh/profiles/<name>` 只隔离配置；`sessions/`、`storages/`、`attachments/` 都在 `DSH_HOME` 根下共享。只建 `groups-spike` profile 仍会写真实会话。

Gate 0 规则：

- 每个 agent 一个独立 home：`.spike-homes/host`、`.spike-homes/client`、`.spike-homes/qa`。
- 绝不使用真实 `C:\Users\Momiji\.dsh` 作为 `DSH_HOME`。
- 真实 home 里已有的 spike 痕迹（`storages/dsh-session-groups.json`、真实 `groups-spike` profile）由 QA 在 Gate 0 结束后统一清理；清理前先确认路径。
- 任何新建/重命名/归档只发生在自己的 `.spike-homes/<agent>` 内。
- S2 需要真实形状：从真实 home **只读复制** `sessions/**`、`storages/workspace.json`、`storages/session_projcache/**`（如存在）到自己的 home；不复制凭据、不写回。

## 1. 启动方式（PATH wrapper 不可用于隔离）

PATH 上的 `dsh.cmd` 内容（实测）：

```bat
set "ELECTRON_RUN_AS_NODE=1"
set "DSH_DESKTOP_DEFAULT_PROFILE=desktop"
set "DSH_HOME=C:\Users\Momiji\.dsh"
"C:\...\DSH Desktop.exe" --expose-internals "C:\...\resources\app\lib\desktop-cli.js" %*
```

它在启动前无条件覆盖 `DSH_HOME`，所以 `$env:DSH_HOME=...; dsh ...` 无效。必须直接调 runtime：

```powershell
$desktop = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe"
$cli     = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
$home    = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\client"

$env:DSH_HOME = $home
$env:ELECTRON_RUN_AS_NODE = "1"
Remove-Item Env:DSH_PROFILE, Env:DSH_PROFILE_DIR, Env:DSH_SESSION_ID, Env:DSH_WEB_URL, Env:DSH_SHELL -ErrorAction SilentlyContinue

& $desktop --expose-internals $cli --version
```

预期：`0.2.1-rc.2`（与 Desktop 一致）。

初始化 profile（首次）：

```powershell
& $desktop --expose-internals $cli --profile groups-spike --from-default-profile web
```

安装 spike 插件：

```powershell
& $desktop --expose-internals $cli plugin --profile groups-spike add "link:C:\Users\Momiji\Projects\dsh-session-groups\spike\client-plugin"
```

启动（注意：rc.2 不接受 `web` 子命令；端口/`--no-open` 直接给 profile）：

```powershell
& $desktop --expose-internals $cli --profile groups-spike --port 4401 --no-open
# host: 4400 / client: 4401 / qa: 4402
```

> 之前的 `dsh --profile groups-spike web --port 4399` 会报 `too many arguments ... got 1: web`；已作废。

## 2. 端口与 home 分配

| Agent | DSH_HOME | Profile | Port |
|---|---|---|---|
| host-engineer | `.spike-homes/host` | groups-spike | 4400 |
| client-engineer | `.spike-homes/client` | groups-spike | 4401 |
| qa-engineer | `.spike-homes/qa` | groups-spike | 4402 |

同一时间一个 home 只跑一个 server；需要并行就各用各的 home/端口。QA 的 setup 脚本按此约定生成/清理。

## 3. 实验清单

### S1. 槽位接管与切回
- 注册 `sidebar.workspaces`，`priority:-1`，渲染占位视图 + 「返回工作区」。
- dispose → 官方回来；footer action 重新注册。
- 10 次切换；故意让分组组件抛错，观察 slot abdication 是否让官方自动回来。

PASS：10/10 无重复行/未捕获错误；官方搜索、添加工作区恢复；rail 可展开；记录官方展开/滚动状态是否丢失。

### S2. 全局 hooks 与真实形状
- `useSessions()`：覆盖 3 个工作区；记录 id 数。
- `useWorkspaces()`：3 个；`workspaceDisplayTitle`。
- `archivedSessionIds`：**数组**，`.length` 应为 2（真实 home 当前值；以实测为准）。
- `useSessionStatus()`：**Map**，字段 `running`/`pendingInteraction.kind`/`completionUnread`。
- 抽样真实样本：普通、fork（parentId 有值但 origin 不是 subagent）、subagent（origin==='subagent'）、blank、归档、当前会话（retainedBy.mainView）。

PASS：形状与上述一致；subagent 用 origin 判定；fork 不被误藏；blank 规则与官方一致。

### S3. 新建会话
- `uiWorkspace.connectWorkspace(workspaceId)`：返回 session id？是否导航？
- `uiWorkspace.startSession(workspaceId)`：返回什么？
- 新会话出现在 `workspace.sessionIds` 的时机。

PASS：connect 返回 id 且不导航；start 返回 void；能 openSession(newId)。

### S3b. 宿主 hero 切换工作区
- 在 blank 会话的 hero 里切换工作区，记录旧 id / 新 id / 旧 blank 是否复用/残留。

PASS：有明确结论；据此确认组内 `+` 必须用我们自己的预创建菜单，不走 hero。

### S4. rename / archive / unarchive / pin
- 对 spike home 的测试会话执行；记录精确调用形状与返回值。
- 运行中会话归档：记录 `workspace/session-active` 错误与 `details.activity`。
- `archiveSession(id,{stopActivity:true})` 是否成功。

PASS：形状记录完整；运行中归档可确认后强制；取消不动。

### S5. 路由 + 存储
- `ctx.webServer.register` 两个路由；`ctx.connection.requestRejection` 围栏（无 cookie 401、坏 Host 403、跨站 Origin 403、同源+cookie 200）。
- 记录文件落在 `$DSH_HOME/storages/dsh-session-groups.json`；temp+rename+.bak；409/422/413/415；坏文件隔离；版本过高 409 不覆盖。
- 重启读回；4 次写中 kill；10/10 重启。
- 探测 `ctx.connection.fetch.register` 是否存在（备选，不替换 requestRejection）。

PASS：上述全过；真实 home 零写入；`workspace.json`/session 日志 hash 不变。

### S6. 客户端 bundle
- `window.__ModuleLoader__.load({id, factory})`；externals `react`/`react/jsx-runtime`；无第二份 React。
- 禁用/启用 bundle 后 slot 与 footer 干净挂载/卸载；无 `dsh-client-runtime` 依赖。

PASS：无模块解析错误/Invalid hook call；卸载无残留。

### S7. 记录文件生命周期
- 10 次重启；写中 kill；坏 JSON；卸载重装。
- 卸载后记录文件保留，重装可恢复。

PASS：10/10 读回；kill 不截断；坏文件隔离；卸载保留。

### S8. 共存与优先级冲突
- 另一个 `priority:-1` 的 `sidebar.workspaces` 占用者存在时注册。
- 记录错误文本；我们的插件是否 fail-soft 到 footer-only，官方视图是否不受影响。

PASS：不崩、不抢官方、有可读提示；优先级可配置或文档写明冲突。

### S9. 组头 `+` 端到端
- 预创建工作区菜单（推断默认 + 全部工作区）→ connectWorkspace → openSession → 落组首。
- 混合组切换工作区；空组/无工作区提示。

PASS：组首只有一条；工作区正确；无孤儿 blank；无工作区时给明确提示。

### S10. 运行中归档动线
- 归档运行中会话 → 拒绝 → 确认框列出活动族 → stopActivity 强制 → 成功。
- 取消 → 会话继续运行，无状态变化。

PASS：动线可用；取消无副作用；文案不误导。

## 4. 结果记录模板

```
### Sx — PASS / FAIL / PARTIAL
- Agent / DSH_HOME / profile / port / dsh 版本
- 命令：
- 观察：
- 证据：截图/日志/JSON 路径
- 结论：V1 可用 / 需替代 / 阻塞
- 对 CONTRACTS 的修正：
```

## 5. 失败退路

| 失败项 | 退路 |
|---|---|
| 槽位无法稳定 dispose/重注册 | 回退 B（主区面板），或重启应用切换 |
| `connectWorkspace` 无 id | 快照 diff 捕获新 blank；或预创建后按 `workspace.sessionIds` diff 认领 |
| 运行中归档无法强制 | V1 只 toast 拒绝，不提供强制（缩小范围） |
| 路由/围栏不可用 | 改用 `connection.fetch.register`；再不行降级 localStorage 并明确标注 |
| 存储文件不可写 | 改用 storageDomain 或 profile 内文件，并记录降级 |
| rail 无法展开 | rail 下禁用分组视图，给出返回工作区按钮 |
| 第二占用者冲突 | 优先级可配置 + 错误提示；官方视图优先 |

## 6. 退出条件

- S1–S7 PASS，S3b/S4b/S8/S9/S10 有明确答案；每个 FAIL 有书面降级方案并被用户接受。
- 架构评审签字；QA 确认审计与 E2E 可搭；才冻结 CONTRACTS 进入实现。
