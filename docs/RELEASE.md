# V1.1 发布与安装说明（未安装到用户 desktop）

- 版本：`0.2.4`（V1.1 optimistic drop commits + insertion placeholders + official header/footer copy）
- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 状态：**V1.1 QA 全绿（18/18 E2E、211/211 tests、step 12 audit PASS；large-list probe 沿用 0.2.3，虚拟化未改）**；等待用户验收后才安装到 desktop profile
- 范围：V1 全部能力 + 左栏宽度 264–760、分组拖拽排序/改父级、会话搜索下拉、官方侧栏排版/间距/图标对齐、footer 单按钮视图切换、header `搜索/视图选项/＋`、归档 popover、深色主题 surfaces、未归组列表虚拟化、**拖拽行高插入占位 + 乐观 drop 提交**

## 1. 构建

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups
pnpm install          # 已安装过可跳过；本版未新增依赖
npm run build         # 生成 lib/client.js（195,772 bytes）
npm test              # 211/211
node --check lib/client.js
```

## 2. 打包

```powershell
npm pack
# dsh-session-groups-0.2.4.tgz（大小以实际产物为准）
```

包内容固定为 `src/**`、`lib/client.js`、`locale/{zh,en}.json`、`package.json`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`。
包内**不包含** `docs/`、`tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`、`.superpowers/`。

最终 tarball 记录（以实际产物为准）：

- 文件：`dsh-session-groups-0.2.4.tgz`
- 大小：**128,218 bytes**（unpacked **500,532 bytes**；**35 files**）
- SHA256：`F519BFBD6B9F180BBCBA4E46CCC3DC46BBD0A92B2FA9D800422D9B97EA358C45`；npm shasum `5b6bd9b9f2060d3fee0c01974dbddcd64a3943e3`；integrity `sha512-18NYqmGqZiLeXlg64D1KeHKwZBAWNu/Nazr9dFWFpuxacDDqffwR391ZYmu1mEO35Al+vFaFKmdx490GGJhMQg==`。

## 3. 安装

### Desktop（用户验收后）

设置 → 插件 → 添加插件 → 选择 `dsh-session-groups-0.2.4.tgz`（或本地目录），启用后重启/刷新。

不要用 `dsh plugin --profile desktop` 改 App 管理的 profile。

### 可丢弃 profile（验证用）

```powershell
$env:DSH_HOME = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\release"
$desktop = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe"
$cli = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
& $desktop --expose-internals $cli --profile groups-spike --from-default-profile web
& $desktop --expose-internals $cli plugin --profile groups-spike add "file:C:\...\dsh-session-groups-0.2.4.tgz"
& $desktop --expose-internals $cli --profile groups-spike --port 4405 --no-open
```

## 4. 数据与卸载

- 分组记录：`dshHomePath('storages')/dsh-session-groups.json`；`.bak` 为**单槽覆盖式**备份——每次成功 commit 前把上一版记录复制到 `dsh-session-groups.json.bak`，不保留多代历史、不参与读取/恢复（仅供人工排查；首次写入时没有 `.bak`）；不写 `workspace.json`/session 日志。
- 宽度偏好：localStorage `dsh-session-groups.width.v1`（数值 px，默认 420）；卸载后残留键无害。
- 卸载插件后官方工作区视图恢复；记录文件保留，重装可恢复分组。
- 分组删除非破坏性；本视图没有会话删除。

## 5. 已知限制

- 运行中会话归档确认框未 live 验证（隔离 home 无 running 会话）；真实 profile 手工补验（BLOCKED-ENV，沿用 V1）。E2E step 15 会归档一条**非运行**会话作为宿主侧副作用，分组记录不变。
- 排版/间距无插件字号/字体设置：`.dsg-root` 继承宿主侧栏基线（DSH Desktop 2.0.18 为 14px），固定尺寸通过官方 `--dsw-font-*` token（px fallback）对齐工作区侧栏；行 padding 0 8px / gap 6、树 2px 纵距、header 4/4/4/2（收起 36px；展开搜索 74px）、菜单/对话框放大 padding；宿主升级改变基线时继承字号随动，行高/间距/图标仍按官方 2.0.18 度量（step 16 守护）。
- 主题 surfaces 依赖官方 2.0.18 token（`--dsw-specific-menu` / `--dsw-alias-bg-layer-1/2` / `--dsw-alias-border-l2/l3`）；宿主若重命名 token，CSS 的 `Canvas`/`CanvasText` 最后兜底保证可读但不再有官方材质。E2E step 17 用 `body[data-ds-dark-theme]` 断言深色对比度。
- 宽度覆盖依赖宿主布局 DOM（DSH Desktop 2.0.18）：找不到 frame/sidebarRoot 时 fail-soft（把手隐藏）；宿主升级若改 DOM，加宽可能失效，但分组/搜索不受影响；视口 <744px 或余量不足时不覆盖。
- 搜索只匹配标题/工作区/组路径，最多 20 条；无全文搜索（P2）。
- 组拖到折叠组时不给子组落点（需先展开）；组拖不做悬停自动展开。
- P1 未实现：撤销上次移动、分组颜色、折叠全部、多窗口冲突提示、混合组常显工作区标签、批量移动、折叠组聚合计数。
- P2：全文搜索、跨设备同步、自定义图标上传、会话删除。
- 未归组列表按 `.dsg-tree` 视口 + overscan=8 窗口化（行 32 / gap 2 / 段头 34）；组树完整渲染。真实 home 的 1,639 个 session 目录中 1,474 个是 subagent（UI 过滤），实际可见未归组约 10 行；1,500+ 行由 QA 大列表 fixture 验证。窗口化不改变逻辑顺序/搜索/拖拽/归档。
- 分组数据单窗口 V1；多窗口冲突通过 409 提示，不做实时合并。
- **乐观提交边界（0.2.4）**：drop 当帧即渲染，HTTP 在后台单写者队列合并/重试（无自动重试，失败即回滚 + toast）。若 pop 时恰好有另一窗口写入导致 409，本次及尚未发送的乐观移动会回滚到最近确认 doc（符合“失败回滚”契约，不做自动重放）。拖拽期间非乐观对话框写入会等乐观队列 flush 后再执行；严格写期间的 drop 会等该写入落定后按新 doc 计算。
- **占位边界**：占位只在有效落点渲染；悬停折叠组不自动展开（与 0.2.3 相同），group child 槽仅在展开组体出现。占位为 32/34px 行高 + 1px 虚线 accent 边框，深色主题随 `--dsw-alias-state-business-primary` / `-fade` 变化。

## 6. 验证证据

- `docs/TEST-RESULTS.md`：V1.1 0.2.4（npm test 211/211、E2E 18/18、E2E step 12 数据审计、step 10 虚拟化感知重启、step 18 占位/乐观提交、打包 sha256）
- `scripts/qa/evidence-perf/`：`024-final2/e2e-20261029-120454.json` + 18 步截图、`024-final2/setup-20261029-120032.json`、`024-final2/audit-*.json`、`large-before.json` / `large-after.json`（0.2.3 虚拟化基线）、`.superpowers/sdd/2026-10-28-session-groups-v1.1/optimistic-report.md`（本地，不随包发布）
