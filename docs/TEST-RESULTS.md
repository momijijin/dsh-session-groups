# 0.4.0-beta.2 测试结果

日期：2026-11-05  
版本：`0.4.0-beta.2`  
宿主基线：`@deepseek-ai/dsh` 0.2.1-rc.2（community）/ 0.2.1-rc.5（official）  
已验证壳：community DSH Desktop **Stable** 2.0.18（rc.2）；official DeepSeek Harness desktop 0.2.1.0（rc.5，隔离 A+ + 维护者桌面窗口验收）  
不官方支持：community DSH Desktop Beta、community DSH NEXT（`-next`）

## 结论

- 本地候选 0.4.0-beta.2：**479/479 PASS**（identity reset + i18n fallback + a11y + maintainability + perf + icon/title + session reorder + official rc.5 compatibility）
- 身份边界：package/manifest/bundle、host 路由、record/token/diagnostics/debug、client localStorage、skill/tool 名称全部为 grove；旧 `dsh-session-groups` 标识没有残留于 active source。
- i18n fallback：英文客户端在 Host locale handle 缺失时按 Host snapshot → `<html lang>` → navigator 解析；onboarding、settings、menu、dialog 英文断言已补入隔离 A+。
- 无自动迁移：旧 `dsh-session-groups` 记录/localStorage 被刻意忽略且不删除；手动迁移见 `docs/MIGRATION-0.4.md`。
- 包声明：`@deepseek-ai/schemastery` 从 `dependencies` 移到 `peerDependencies`，保留 `devDependencies` 供测试；隔离安装的插件包不再携带重复运行时副本。
- 控制面：只读 catalog、严格 icon/color/colorHex 校验均已覆盖边界测试。
- Node 内置 coverage：**93.67% lines / 82.42% branches / 88.94% functions**
- community A+ 隔离 Playwright（0.2.1-rc.2）：**PASS**
- official A+ 隔离 Playwright（0.2.1-rc.5，官方 bundle 的 DSH host/core + 独立 web profile）：**PASS**
- Core 纯函数测试：**29/29 PASS**
- 构建：`lib/client.js` 成功
- 语法检查：通过
- 真实 `~/.dsh`：隔离测试未写入真实分组记录
- 真实非空会话 Fork（隔离 DSH home + 临时独立 API key）：**PASS**，源会话 `Greeting` 生成子会话 `Greeting (1)`
- 损坏记录 + 有效 `.bak`：隔离坏文件并自动恢复上一 revision，warning `recovered-backup`
- 真实恢复演练（隔离实例）：主文件 rev15 损坏 → 自动恢复 `.bak` rev14，4 个分组保留，坏文件进入 `.corrupt-*`
- 损坏记录 + 无效 `.bak`：降级为空分组，保持两份原文件不删除
- 原生工具 `doctor` 只读兼容性报告（host capabilities/adapter/gates/storage-health/services/routes）：462 项套件覆盖
- 真实 CLI `doctor` 返回 storage.health.status=ok、revision、backup=true、quarantined=0
- doctor CLI compatibility gate：host compatibility 不支持时退出非零，JSON 报告保留
- 真实 CLI `doctor`（隔离实例，交换 DSH web launch cookie + 插件 bearer token）：**PASS**，返回 14 条路由与 host 服务状态
- 真实模型原生工具（隔离实例）：**PASS**，session log 记录 `tool/call` / `tool/result`，返回 `protocol: 1` 和成功 state
- 官方 rc.5 兼容：优先 `sessions.create`，会话创建不再复用已归入其他分组的 blank；社区 rc.2 fallback 保留并复跑

- 跨进程锁：两个独立 Node 进程竞争同一记录时一个成功、一个 conflict；过期锁自动回收；活跃锁超时返回 `store-busy`
- 包图标：`package.json` 根部 `icon` + `assets/icon-180.png` 打包，A+ 验证插件管理器实际渲染 data URL；英文标题统一为 Free Groups。
- 会话菜单：上移/下移与分组菜单对齐，边界禁用，覆盖 group 内与显式 ungrouped 顺序。
- A11y：对话框有 `aria-labelledby` 标题、初始/返回焦点、Tab 焦点陷阱、Escape；标题栏和右下 resizer 支持键盘移动/缩放；分组菜单支持 Arrow/Home/End。A+ 键盘路径 PASS
- 性能：spinner 只旋转外层 transform，弧线不再逐帧重绘；会话订阅先裁到主会话 + 当前 retained 子代理；未归组滚动只在挂载/resize 时读取布局。
- 维护性拆分：`components.js` 3051→1366 行；`routes.js` 1040→520 行；客户端模块、route-contract 和 control-routes 均有完整测试与 A+ 回归

## A+ 覆盖

A+ 使用独立 `DSH_HOME`、隔离端口和临时 profile（community `sg-e2e` / official `sg-official76`），覆盖：

- 首次引导出现/关闭后刷新不重现
- 三状态按钮存在，后台任务按钮不存在
- 分组移动/会话归入后的 head 顺序
- 收起/展开后的会话顺序
- 264px 窄侧栏、深色、宿主 Rail
- 搜索、归档 tri-state
- 拖拽自动展开、分组边缘占位、弹窗拖动/缩放
- 外部 commit 通过 SSE 触发刷新
- 同浏览器上下文两个页面均收到外部 commit 的 SSE 刷新
- 两页面在同一 baseRevision 上并发 commit：一个 200、一个 409，双方收敛到胜者
- EventSource 路由强制断开后恢复，onopen 触发强制 reload
- change stream adapter 单测：revision 回调、onopen 重连回调、关闭清理
- 中文 locale 隔离页面：插件设置/标题/选项文案为中文，未出现英文控件回退
- 切到官方工作区再切回自由分组后重新 load
- 快速连续 revision 收敛
- 会话菜单无 Pin；Copy Session ID 写入真实剪贴板并显示 toast
- hover archive 控件存在
- 第一层插件设置卡、本地化 `Free Groups` 标题
- 详情 Tooltip 打开
- 标准 Switch 交互；diagnostics 开关热启动/关闭 HUD
- `controlDestructive` 打开前出现确认，取消后仍保持关闭

## Fork 和核心策略

- `placeForkedSession` 纯函数：源分组组头、未归组头部、确定性、不修改输入文档
- 真实非空会话 Fork 成功路径仍需可控的非空 session fixture；当前未伪造该数据
- 组件拆分：`Toast`/`MenuPopover` -> `session-menu.js`，`ScrollArea` -> `scroll-area.js`，`GroupListPicker` -> `group-list-picker.js`，`DialogHost` -> `dialog-host.js`，session routes -> `host/session-routes.js`，DOM/test id 不变

## 原生工具和隔离控制

- `session_grove_control`：注册、state/resolve/plan/apply/CAS、session 动作、开关门禁
- 隔离 control E2E：state/resolve/plan/apply、icon/color、同名歧义、未知字段
- 隔离 session E2E：inspect / rename / archive / unarchive 实际 CLI 通过；HTTP/CLI 仍受 Host 浏览器 fence 限制，AI 使用原生工具
- 自动 skill 安装：`controlApi` 开启后写入 `<DSH_HOME>/skills/session-grove-control/SKILL.md`
- skill repair：managed skill 可修复；用户自有同名文件返回 `409 skill-user-owned`，不被覆盖

## 运行方式

```powershell
cd C:\Users\Momiji\Projects\dsh-session-grove
npm test
npm run check:core
npm run check:coverage
npm run build
npm run test:isolated   # 需先启动隔离 web
```

## 未决验证

- 真实桌面回归（首次引导、侧栏宽度、主题、中文视觉）
- 非空会话 Fork 成功路径已在隔离实例真实 E2E 验证（beta.53）
- 原生工具被真实模型发现并完成 state → plan → apply 的端到端链路
- SSE 断线重连和多窗口并发
- Windows 下 control token ACL 的实际审计

## 备注

- 当前默认自动门禁是 `e2e/isolated.spec.mjs`。
- `e2e/groups.spec.mjs` 是历史手工脚本，未纳入默认门禁。
- 发布包 SHA256 以最终 `npm pack` 输出为准。





