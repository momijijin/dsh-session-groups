# 0.3.0-beta.1 测试结果

日期：2026-11-02  
版本：`0.3.0-beta.1`  
宿主基线：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2

## 结论

- 单元/契约测试：**323/323 PASS**
- 构建：`lib/client.js` 生成成功
- 语法检查：通过
- 桌面 E2E：本轮未记录完整结果；保留在用户桌面回归阶段
- 真实 `~/.dsh`：本轮只读检查分组文档与会话缓存，不修改

## 本轮覆盖

### 回滚

- 移除 background jobs 状态桶
- 移除 `ctx.jobs` 订阅与 `watchRows`
- 三个状态按钮顺序恢复
- 状态弹层背景改为 layer-1，与搜索框一致
- 移除对应 locale 键和测试

### 调试隔离

- `Config.debugProbe` 默认 false
- `debugProbe` 关闭时 debug 路由不挂载
- `/load` 返回 `debugProbe` 能力标记
- 客户端探针仅在 `rt().debugProbe === true` 时发送
- 默认 `/load` 返回 `debugProbe: false`

### 引导与重置

- 首次引导卡可见且可 dismiss
- `onboarding` localStorage 持久化
- 空状态“新建第一个分组”入口
- `reset-collapsed` action
- `clearDialogGeometries`
- 视图选项中的恢复默认布局
- About/version/scope 文案

### 回归

- 分组、会话、拖拽、未归组目标、搜索、归档、弹窗、滚动条测试继续通过
- locale 源字典与 JSON 镜像一致

## 运行方式

```powershell
cd C:\Users\Momiji\Projects\dsh-session-groups
npm test
```

最近一次结果：

```text
tests 323
pass 323
fail 0
```

## 未决验证

以下项目需要桌面环境人工确认：

- 首次引导在真实侧栏宽度下的排版
- 状态下拉背景不透明度的实际观感
- 恢复默认布局后的宽度/展开/弹窗几何
- 264px 窄侧栏、深浅色、中英文
- 干净 desktop profile 安装与卸载
- 插件升级覆盖安装

## 备注

- 0.3.0-beta.1 不再包含后台任务状态监控，因此本次没有 `ctx.jobs` 流相关性能验证项。
- 发布包 SHA256 以构建后的 `npm pack` 输出为准。
