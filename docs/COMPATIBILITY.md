# DSH 版本兼容策略

## 结论

这个插件**没有按 DSH 版本编译多套代码，也没有启动时 `switch (version)`**。

当前策略是三层：

```text
1. package.json engines.dsh / peerDependencies
   → 插件管理器在安装/加载阶段拒绝明显不兼容的 DSH

2. src/adapters/dsh-capabilities.js
   → 启动时检测本轮真正依赖的 service/slot 签名

3. 业务代码的 feature detection / fail-soft
   → 可选服务缺失时降级，不把整个分组数据拖垮
```

DSH 的 plugin client 是 **单个客户端 bundle**，没有为插件准备 `#if DSH_VERSION` 之类的预编译指令。`esbuild` 的 define 是构建期常量，不会随宿主版本自动切换；用版本号写死分支反而容易把未测试路径带进发布包。

## 当前支持线

```text
DSH Desktop 2.0.18
@deepseek-ai/dsh 0.2.1-rc.2
插件 engines.dsh: >=0.2.0-rc.2 <0.3.0
```

包级声明是 `package.json` 的 `engines.dsh`；插件管理器使用同一 DSH 兼容性检查。

## 运行时检测

`src/adapters/dsh-capabilities.js` 只报告能力，不猜版本：

```text
host required:
  webServer.register

host optional:
  tools.register
  ctx.inject
  sessions / workspaces / workspaceRegistry / sessionTitle

client required:
  slots.register
  sessions service

client optional:
  slots.inject
  workspaces / uiWorkspace
  locale service
  configForms
```

- 缺少 **required**：插件记录 `missing ... capabilities`，不会假装正常。
- 缺少 **optional**：相应功能隐藏或返回明确失败，分组文件仍保留。
- 不把“版本号相同”误当成“API 相同”。

## 破坏性升级会发生什么

不会保证“零修改继续运行”。如果未来 DSH 改动：

- `webServer.register` 签名；
- slot 名称或注册方式；
- `sessions` / `uiWorkspace` 的公开方法；
- 原生工具 service 形状；
- 宿主客户端 bundle 加载协议；

则可能出现：

```text
侧栏不注册 / 设置卡不出现 / 原生工具不可用
```

但不会主动删除 `dsh-session-groups.json`；分组数据文件仍可作为恢复源。最坏情况下需要安装更新版本的插件或回滚 DSH。

## 为什么不做多版本 switch

- 没有真实的第二套宿主可以验证，写版本分支等于发布未测试代码。
- DSH 的扩展点本身是 service/slot 组合，能力检测比版本判断更精确。
- 插件管理器已经承担版本范围拒绝；插件内部重复版本判断会制造双重真相源。

如果未来确实需要平行支持两个 DSH release line，应该在 `adapters/` 下建立**按版本命名的适配器实现**，再由能力探测选择，而不是在主流程塞 `if (version >= ...)`。

## 升级检查清单

1. 用目标 DSH 安装新包。
2. 打开 Plugins 详情，确认第一层设置卡出现。
3. 做一次分组拖动/commit。
4. 检查 `/load` 和 `/dsh-session-groups/events`。
5. 开启 `controlApi` 后调用一次 `session_groups_control` state。
6. 运行 `npm test` 和 `npm run test:isolated`。
