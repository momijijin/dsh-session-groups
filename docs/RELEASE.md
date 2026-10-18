# V1 发布与安装说明（未安装到用户 desktop）

- 版本：`0.1.0`
- 宿主：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- 状态：**V1 QA 全绿（12/12 E2E、151/151 tests、audit PASS）**；等待用户验收后才安装到 desktop profile

## 1. 构建

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups
pnpm install          # 已安装过可跳过
npm run build         # 生成 lib/client.js
npm test              # 151/151
```

## 2. 打包

```powershell
npm pack
# dsh-session-groups-0.1.0.tgz（约 72KB；29 files：src/lib/locale/README/manifest）
```

包内**不包含** `tests/`、`e2e/`、`scripts/`、`spike/`、`node_modules/`、`.spike-homes/`。

## 3. 安装

### Desktop（用户验收后）

设置 → 插件 → 添加插件 → 选择 `dsh-session-groups-0.1.0.tgz`（或本地目录），启用后重启/刷新。

不要用 `dsh plugin --profile desktop` 改 App 管理的 profile。

### 可丢弃 profile（验证用）

```powershell
$env:DSH_HOME = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\release"
$desktop = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe"
$cli = "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js"
& $desktop --expose-internals $cli --profile groups-spike --from-default-profile web
& $desktop --expose-internals $cli plugin --profile groups-spike add "file:C:\...\dsh-session-groups-0.1.0.tgz"
& $desktop --expose-internals $cli --profile groups-spike --port 4405 --no-open
```

## 4. 数据与卸载

- 分组记录：`dshHomePath('storages')/dsh-session-groups.json`；`.bak` 备份；不写 `workspace.json`/session 日志。
- 卸载插件后官方工作区视图恢复；记录文件保留，重装可恢复分组。
- 分组删除非破坏性；本视图没有会话删除。

## 5. 已知限制

- 运行中会话归档确认框未 live 验证（隔离 home 无 running 会话）；真实 profile 手工补验。
- P1 未实现：拖组改父级、撤销、标题搜索、置顶徽标、折叠组聚合计数。
- 分组颜色/自定义图标上传 = P2。
- 56px rail 下只显示展开按钮（已验证）。
- 分组数据单窗口 V1；多窗口冲突通过 409 提示，不做实时合并。

## 6. 验证证据

- `docs/GATE0-SUMMARY.md`：Gate 0（Host 78/78、Client 101/58、QA 28s）
- `docs/TEST-RESULTS.md`：V1（npm test 151/151、E2E 12/12、audit 10/10+11/11、setup/teardown PASS）
- `scripts/qa/evidence/`：E2E JSON + 20 张截图、audit、setup/teardown（本地，不随包发布）
