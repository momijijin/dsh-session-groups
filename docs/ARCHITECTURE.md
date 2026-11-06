# 架构：纯函数核心 + DSH 适配器

当前实现：**0.4.0-beta.53**  
支持宿主：`@deepseek-ai/dsh` 0.2.1-rc.2 / 0.2.1-rc.5  
已验证壳：社区版 DSH Desktop **Stable** 2.0.18（rc.2）；官方 DeepSeek Harness 桌面版 0.2.1.0（rc.5，隔离 A+ + 桌面窗口验收）  
明确不支持：社区版 DSH Desktop Beta、社区版 DSH NEXT（`-next`）  
分发状态：dshmarket 目录条目发布前，使用本地 beta tarball。

插件按洋葱圈分层，宿主升级时只改外圈。

## 图层

```text
src/core/        纯函数核心：无 React、无 DSH、无 DOM、无存储
src/shared/      共享领域内核：GroupDoc 模型、常量（host/client 都可依赖）
src/adapters/    DSH 版本相关适配器：runtime 注入、locale、slot、storage
src/client/      DSH 客户端 UI 与交互编排
src/host/        DSH host 路由 / fence / store
src/index.js     Cordis host 入口
```

## 核心规则

- `src/core/**` 只能依赖自身、`src/shared/**` 中的纯常量/模型，以及标准 JavaScript。
- `src/shared/**` 是共享领域内核，必须保持纯函数、无 React/DSH/DOM/存储依赖；host 和 client 都允许依赖它。唯一平台能力是 `globalThis.crypto` 用于生成 UUID。
- 目前不把 `src/shared/model.js` 物理迁入 `src/core`：它是 host/client 共同消费的稳定领域层，迁移只会制造 22 处 import churn，不增加隔离价值。边界测试直接覆盖 `src/shared`。
- `src/core/**` 不允许 import：
  - `react` / `react-dom`
  - `@deepseek-ai/*`
  - `src/client/**`、`src/host/**`、`src/adapters/**`
  - `document`、`window`、`localStorage`、`globalThis` 等宿主全局
- 宿主 API 变化时优先改 `src/adapters/**` 或 `src/client/**`；只要插件功能不变，`src/core/**` 不改。
- 核心函数必须能直接用 Node 测试，不需要浏览器、DSH 窗口或真实 profile。
- 依赖方向由 `tests/core/dependency-direction.test.js` 强制：
  - `shared` 只能依赖自己
  - `core` 只能依赖 `core` / `shared`
  - `adapters` 只能依赖 `adapters` / `core` / `shared`
  - `client` 只能依赖 `client` / `core` / `shared` / `adapters`
  - `host` 只能依赖 `host` / `core` / `shared`
  - `src/index.js` 是 composition root，可依赖 `host` / `core` / `shared` / `adapters`；`adapters` 只承载 DSH 版本相关能力检测，不向上依赖 client/host。
- `npm run check:core` 独立加载全部核心模块，不启动 DSH。

## 客户端 i18n 分层

`src/client/locale.js` 只是兼容 facade。运行时 i18n 拆为六个模块，另有 1 个 build-only chunk 加载器：

- `src/client/i18n/resources.js`：唯一 import `locale/*.json` 的模块，导出字典注册表与 `FALLBACK_LANGUAGE`
- `src/client/i18n/locale-id.js`：基础语言归一化、Host snapshot / `<html lang>` / navigator 解析
- `src/client/i18n/message-format.js`：CLDR 类别选择、`{placeholder}` 插值、英文兜底
- `src/client/i18n/translator.js`：字典选择与 `createTranslator`
- `src/client/i18n/direction.js`：RTL 检测（基础语言 + `Intl.Locale` textInfo）
- `src/client/i18n/date-format.js`：`Intl.DateTimeFormat` 绝对时间格式化（UI 通过 runtime bridge 调用）
- `src/client/i18n/resources-lazy.js`（build-only，不计入上述六个运行时模块）：构建期 en/zh 子集与 17 个字典 chunk 加载器

以下其余客户端模块不属于 i18n 分层：

- `src/client/groups-view-width.js`：`GroupsView` 的 sidebar width controller hook（持久化/视口 clamp/host DOM 生命周期）
- `src/client/groups-view-state.js`：framework session/workspace/status hooks 与可见树（纯数据适配）
- `src/client/groups-view-search.js`：搜索 reveal/highlight 的 DOM 控制器与 timer 生命周期
- `src/client/command-runtime.js`：非 React 命令/Toast bridge（dispatch 与 toast）
- `scripts/build-client.mjs`：主 bundle + `lib/client.locale-*.js` 懒加载 chunk 生成
- `src/client/groups-view-menu-handlers.js`：菜单锚点/上下文菜单/导航命令
- `src/client/groups-view-dialog-handlers.js`：新建/重命名/移动/删除/归档/fork 等 dialog 命令
- `src/client/plugin-locale.js`：locale service 注册/订阅、translator/direction/time 运行时
- `src/client/plugin-settings.js`：`plugins.bundle.config` slot 注册与 config form
- `src/client/plugin-workspace-chrome.js`：workspace overlay toggle + width retry 生命周期

边界规则：

- UI 组件只调用 `t(key, params)`；不 import 语言 JSON，不判断语言，不直接调用 `Intl.PluralRules`
- `src/core` 不依赖 locale 字典或格式化；`statusLabel` 只接收注入的 translator
- 新语言只增加资源、registry、manifest 和测试，不把分支写进组件
- 架构测试 `tests/client/i18n-architecture.test.js` 校验以上边界

## 当前核心

- `src/core/session-row.js`
  - `sessionRowPropsEqual`：memo 行是否重绘
  - `statusLabel`：状态无障碍文案
- `src/core/layout.js`
  - `estimatedTreeHeight`：虚拟列表首帧估算
- `src/core/drag.js`
  - `hitTest` / `applyDrop` / sticky target / ungrouped target
- `src/core/tree.js`
  - 状态聚合、树扁平化、祖先展开、分组路径
- `src/core/filter.js`
  - 可见树、归档过滤、标题/子代理判定
- `src/core/search.js`
  - 搜索索引、匹配与 reveal 折叠补丁
- `src/core/virtual-list.js`
  - 虚拟列表窗口与 spacer 算术
- `src/core/group-drag.js`
  - 分组拖拽目标解析与稳定 anchor
- `src/core/dialog-selection.js`
  - 选择弹窗初始值、合法性与 Confirm payload
- `src/core/dialog-geometry.js`
  - 矩形 viewport clamp、居中、拖动、八方向缩放
  - `src/client/dialog-geometry.js` 保留 localStorage 持久化并 re-export 纯数学
- `src/core/group-drag.js` 补充
  - `isCurrentGroupPosition`：当前兄弟位置 no-op 判定
  - `groupHeaderZoneFromRect`：上/下 25% 边缘 zone
- `src/core/menu-position.js`
  - 菜单 anchor/clamp 纯数学；viewport 由调用方注入
- `src/core/control.js`
  - `resolveGroupPath`：完整根路径 → 唯一 ID；不存在/同名歧义/控制字符均结构化失败
  - AI 控制协议：catalog（共享图标/色板词表）、state、结构化 operation、plan/apply 候选 doc
  - 无 HTTP、无设置、无 revision/CAS、无审计；这些在 `src/host/routes.js` 与 `src/index.js`
  - 删除操作必须显式 `allowDestructive`，无 raw-doc 写入
  - 严格 operation schema：未知字段、错误类型、负数/非整数 index、未知 icon/color、非法 colorHex、color+colorHex 并用一律结构化拒绝，不做静默降级
  - `group.create` 的 plan 不返回随机 ID；apply 后通过 state 读取
- `src/core/color.js`
  - `groupColorCss` 自定义 hex 优先、palette token 回退

## 当前适配器

- `src/adapters/client-runtime.js`
  - `installClientRuntime` / `clientRuntime`
  - 由 `plugin.js` 注入，React 组件只读取这个薄桥
- `src/client/dialog-geometry.js`
  - 只保留 geometry key、read/save/clear 与 localStorage 适配
- `src/host/routes.js` + `src/index.js`
  - 路由始终注册；`controlApi` / `debugProbe` / `diagnostics` 在请求时读取配置门禁，关闭时分别返回 404/403，而不是依赖 apply 时快照
  - 本地 bearer token（0600）+ host fence；token 目前会预生成，合法 token 在插件内部放行 control 路由，但不绕过 Host 外层浏览器 fence
  - revision CAS、planHash、idempotency、审计日志
  - `change-hub` 在每次 commit 后广播 revision；浏览器通过 `/events` SSE 重新 load
  - 0.3.0-beta.79 拆分：`routes.js` 只保留注册编排；纯响应/解析在 `route-contract.js`，控制路由在 `control-routes.js`
- `src/client/components.js` + `components-*.js`
  - `components.js` 只保留 GroupsView 编排；primitives、rows、ungrouped、resize-handle、search-box、header 分模块
  - DOM、testid、CSS 类与 props 契约不变
- `src/host/storage-health.js`
  - doctor 的只读存储健康检查；不使用 store.load，不触发 quarantine 或写入
- `src/host/tool.js`
  - 原生 `session_grove_control`；Host 进程内执行，不经过 HTTP fence
  - action 门禁：`controlApi` / `controlSessions` / `controlDestructive`；`doctor` 只读且不受 write gates 阻挡
  - 分组写走同一套 core control + CAS；session 动作走 Host registry
- `src/client/skill-repair.js`
  - `plugins.bundle.config` 第一层设置卡
  - 标准 `Switch` / `Button` / `Tooltip`；destructive 有二次确认
- `src/host/skill-install.js`
  - managed skill 安装/校验；用户自有同名文件不覆盖
- `scripts/session-grove-control.mjs`
  - 本地 CLI；只调用 state/plan/apply，不直接写 JSON
  - 读取 DSH_HOME 下的 control token；受 Host 浏览器 fence 限制
- `skills/session-grove-control/SKILL.md`
  - 模型侧操作流程与安全约束

## 已有纯模块

这些模块目前仍在原位置，但同样必须保持纯函数性质，后续可按同样方式迁入 `src/core`：

- `src/shared/model.js`

## 测试边界

`tests/core/boundary.test.js` 会扫描 `src/core/**`，阻止 React/DSH/DOM 依赖倒灌进来。  
`tests/core/shared-boundary.test.js` 对共享领域内核施加同样的约束。  
`tests/core/session-row.test.js` 直接测试纯比较与文案策略。
































