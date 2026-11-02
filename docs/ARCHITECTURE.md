# 架构：纯函数核心 + DSH 适配器

插件按洋葱圈分层，宿主升级时只改外圈。

## 图层

```text
src/core/        纯函数核心：无 React、无 DSH、无 DOM、无存储
src/adapters/    DSH 版本相关适配器：runtime 注入、locale、slot、storage
src/client/      DSH 客户端 UI 与交互编排
src/host/        DSH host 路由 / fence / store
src/index.js     Cordis host 入口
```

## 核心规则

- `src/core/**` 只能依赖自身、`src/shared/**` 中的纯常量/模型，以及标准 JavaScript。
- `src/core/**` 不允许 import：
  - `react` / `react-dom`
  - `@deepseek-ai/*`
  - `src/client/**`、`src/host/**`、`src/adapters/**`
  - `document`、`window`、`localStorage`、`globalThis` 等宿主全局
- 宿主 API 变化时优先改 `src/adapters/**` 或 `src/client/**`；只要插件功能不变，`src/core/**` 不改。
- 核心函数必须能直接用 Node 测试，不需要浏览器、DSH 窗口或真实 profile。

## 当前核心

- `src/core/session-row.js`
  - `sessionRowPropsEqual`：memo 行是否重绘
  - `statusLabel`：状态无障碍文案
- `src/core/layout.js`
  - `estimatedTreeHeight`：虚拟列表首帧估算
- `src/core/drag.js`
  - `hitTest` / `applyDrop` / sticky target / ungrouped target
  - `src/client/drag.js` 只保留兼容 re-export

## 当前适配器

- `src/adapters/client-runtime.js`
  - `installClientRuntime` / `clientRuntime`
  - 由 `plugin.js` 注入，React 组件只读取这个薄桥

## 已有纯模块

这些模块目前仍在原位置，但同样必须保持纯函数性质，后续可按同样方式迁入 `src/core`：

- `src/shared/model.js`
- `src/client/group-drag.js`
- `src/client/tree.js`
- `src/client/dialog-selection.js`
- `src/client/dialog-geometry.js`
- `src/client/filter.js`
- `src/client/search.js`
- `src/client/virtual-list.js`

## 测试边界

`tests/core/boundary.test.js` 会扫描 `src/core/**`，阻止 React/DSH/DOM 依赖倒灌进来。  
`tests/core/session-row.test.js` 直接测试纯比较与文案策略。


