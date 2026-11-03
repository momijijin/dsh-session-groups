# 0.3.0-beta.43 测试结果

日期：2026-11-03  
版本：`0.3.0-beta.43`  
宿主基线：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2

## 结论

- 单元/契约测试：**378/378 PASS**
- Core 纯函数测试：**22/22 PASS**
- Node 内置 coverage：**89.28% lines / 76.82% branches / 83.28% functions**
- A+ 隔离 Playwright：**PASS**
- 隔离生命周期 install → uninstall → reinstall：**PASS**
- 构建：`lib/client.js` 成功
- 语法检查：通过
- 真实 `~/.dsh`：隔离测试未写入真实分组记录

## A+ 覆盖

A+ 使用独立 `DSH_HOME`、`sg-e2e` profile 和隔离端口，覆盖：

- 首次引导出现/关闭后刷新不重现
- 三状态按钮存在，后台任务按钮不存在
- 移动分组/会话后的 head 顺序
- 收起/展开后的会话顺序
- 264px 窄侧栏、深色、宿主 Rail
- 搜索、归档 tri-state
- 拖拽自动展开、分组边缘占位、弹窗拖动/缩放
- 外部 commit 通过 SSE 触发刷新
- 切到官方工作区再切回自由分组后重新 load
- 快速连续 revision 收敛
- 会话菜单无 Pin；Copy Session ID 写入真实剪贴板并显示 toast
- hover archive 控件存在
- 第一层插件设置卡、本地化 `Free groups` 标题
- 详情 Tooltip 打开
- 标准 Switch 交互
- `controlDestructive` 打开前出现确认，取消后仍保持关闭

## 原生工具和隔离控制

- `session_groups_control`：注册、state/resolve/plan/apply/CAS、session 动作、开关门禁
- 隔离 control E2E：state/resolve/plan/apply、icon/color、同名歧义、未知字段
- 隔离 session E2E：inspect / rename / archive / unarchive 实际 CLI 通过；HTTP/CLI 仍受 Host 浏览器 fence 限制，AI 使用原生工具
- 自动 skill 安装：`controlApi` 开启后写入 `<DSH_HOME>/skills/session-groups-control/SKILL.md`
- skill repair：managed skill 可修复；用户自有同名文件返回 `409 skill-user-owned`，不被覆盖

## 运行方式

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups
npm test
npm run check:core
npm run check:coverage
npm run build
npm run test:isolated   # 需先启动隔离 web
```

## 未决验证

- 真实桌面回归（首次引导、侧栏宽度、主题、中文视觉）
- 非空/有 access 会话的 Fork 成功路径真实 E2E（当前由 action/source 测试和显示门禁覆盖）
- 原生工具被真实模型发现并完成 state → plan → apply 的端到端链路
- SSE 断线重连和多窗口并发
- Windows 下 control token ACL 的实际审计

## 备注

- 当前默认自动门禁是 `e2e/isolated.spec.mjs`。
- `e2e/groups.spec.mjs` 是历史手工脚本，未纳入默认门禁。
- 发布包 SHA256 以最终 `npm pack` 输出为准。

