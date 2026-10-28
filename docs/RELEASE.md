# V1.1 发布与安装说明（未安装到用户 desktop）

- 版本：`0.2.0`
- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 状态：**V1.1 QA 全绿（15/15 E2E、183/183 tests、audit PASS）**；等待用户验收后才安装到 desktop profile
- 范围：V1 全部能力 + 左栏宽度 264–760、分组拖拽排序/改父级、会话搜索下拉

## 1. 构建

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups
pnpm install          # 已安装过可跳过；本版未新增依赖
npm run build         # 生成 lib/client.js（157928 bytes）
npm test              # 183/183
node --check lib/client.js
```

## 2. 打包

```powershell
npm pack
# dsh-session-groups-0.2.0.tgz（102,152 bytes / 约 99.8 KB；tarball 内 32 files）
```

包内容固定为 `src/**`、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`。
包内**不包含** `docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`。

最终 tarball 记录（以实际产物为准）：

- 文件：`dsh-session-groups-0.2.0.tgz`
- 大小：**102,152 bytes**（unpacked 402,471 bytes；32 files）
- SHA256：`96BDBF5252B1BD785E63D6FF9DFDF5D1B92FDA4F0ECFE99D3BFFCBDABCE82C8A`

## 3. 安装

### Desktop（用户验收后）

设置 → 插件 → 添加插件 → 选择 `dsh-session-groups-0.2.0.tgz`（或本地目录），启用后重启/刷新。

不要用 `dsh plugin --profile desktop` 改 App 管理的 profile。

### 可丢弃 profile（验证用）

```powershell
$env:DSH_HOME = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\release"
$desktop = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe"
$cli = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
& $desktop --expose-internals $cli --profile groups-spike --from-default-profile web
& $desktop --expose-internals $cli plugin --profile groups-spike add "file:C:\...\dsh-session-groups-0.2.0.tgz"
& $desktop --expose-internals $cli --profile groups-spike --port 4405 --no-open
```

## 4. 数据与卸载

- 分组记录：`dshHomePath('storages')/dsh-session-groups.json`；`.bak` 为**单槽覆盖式**备份——每次成功 commit 前把上一版记录复制到 `dsh-session-groups.json.bak`，不保留多代历史、不参与读取/恢复（仅供人工排查；首次写入时没有 `.bak`）；不写 `workspace.json`/session 日志。
- 宽度偏好：localStorage `dsh-session-groups.width.v1`（数值 px，默认 420）；卸载后残留键无害。
- 卸载插件后官方工作区视图恢复；记录文件保留，重装可恢复分组。
- 分组删除非破坏性；本视图没有会话删除。

## 5. 已知限制

- 运行中会话归档确认框未 live 验证（隔离 home 无 running 会话）；真实 profile 手工补验（BLOCKED-ENV，沿用 V1）。E2E step 15 会归档一条**非运行**会话作为宿主侧副作用，分组记录不变。
- 宽度覆盖依赖宿主布局 DOM（DSH Desktop 2.0.18）：找不到 frame/sidebarRoot 时 fail-soft（把手隐藏）；宿主升级若改 DOM，加宽可能失效，但分组/搜索不受影响；视口 <744px 或余量不足时不覆盖。
- 搜索只匹配标题/工作区/组路径，最多 20 条；无全文搜索（P2）。
- 组拖到折叠组时不给子组落点（需先展开）；组拖不做悬停自动展开。
- P1 未实现：撤销上次移动、分组颜色、折叠全部、多窗口冲突提示、混合组常显工作区标签、批量移动、折叠组聚合计数。
- P2：全文搜索、虚拟化、跨设备同步、自定义图标上传、会话删除。
- 分组数据单窗口 V1；多窗口冲突通过 409 提示，不做实时合并。

## 6. 验证证据

- `docs/TEST-RESULTS.md`：V1.1（npm test 183/183、E2E 15/15、audit load/commit、打包 sha256）
- `scripts/qa/evidence/`：`e2e-20261028-192421.json` + 15 步截图、`audit-exercise-20261028-192609-commit.json`、`setup-20261028-192032.json`（本地，不随包发布）
