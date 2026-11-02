# 0.3.0-beta.3 测试结果

日期：2026-11-02  
版本：`0.3.0-beta.3`  
宿主基线：DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2

## 结论

- 单元/契约测试：**325/325 PASS**
- A+ 隔离 Playwright 冒烟：**PASS**（独立 `DSH_HOME` + `sg-e2e` + 4416）
  - 首次引导出现/关闭后刷新不重现
  - 三状态按钮存在，后台任务按钮不存在
  - 通过“移动到分组”移动分组后，目标组的第一个子分组就是被移动组
  - 通过“移动到分组”移动会话后，目标组 `sessionIds[0]` 是被移动会话
  - 目标组收起/展开后，会话 head 顺序保持不变
- 构建：`lib/client.js` 生成成功
- 语法检查：通过
- 桌面 E2E：完整 22 步尚未记录；本轮先完成隔离冒烟
- 真实 `~/.dsh`：隔离测试未写入真实分组记录

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
tests 325
pass 325
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

