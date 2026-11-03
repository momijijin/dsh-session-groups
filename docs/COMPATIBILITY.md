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

## 版本适配器选择器

已把多 release line 的扩展点独立出来：

```text
src/adapters/dsh-0.2.js      当前 release line 的适配器
src/adapters/dsh-selector.js 显式注册表 + 精确版本选择
tests/client/dsh-selector.test.js 版本矩阵
```

当前矩阵：

```text
dsh-0.2  >=0.2.0-rc.2 <0.3.0
```

选择规则：

- 宿主暴露 `dshVersion` / `runtimeVersion` 时，按精确版本选择；
- 版本存在但不在矩阵内：host 拒绝挂载，不猜测;
- 当前 DSH 未暴露稳定版本 service，因此正常路径回退到 capability detection；
- 未来新增 0.3 支持时，新增 `dsh-0.3.js` 并注册，不在主流程写 `if (version >= ...)`。

这不是假装已经支持 0.3：0.3 适配器和真实矩阵尚未存在，选择器会对它返回 unsupported。

## 为什么优先能力检测

- 没有真实的第二套宿主可以验证，写版本分支等于发布未测试代码。
- DSH 的扩展点本身是 service/slot 组合，能力检测比版本判断更精确。
- 插件管理器已经承担版本范围拒绝；插件内部重复版本判断会制造双重真相源。

真正需要平行支持时，才补对应版本的独立适配器实现和测试矩阵。

## 升级检查清单

1. 用目标 DSH 安装新包。
2. 打开 Plugins 详情，确认第一层设置卡出现。
3. 做一次分组拖动/commit。
4. 检查 `/load` 和 `/dsh-session-groups/events`。
5. 调用 `session_groups_control` action `doctor`，或运行 `node scripts/session-groups-control.mjs doctor`，核对 host capabilities、storage、gates 和 routes。
6. 开启 `controlApi` 后调用一次 `session_groups_control` state。
7. 运行 `npm test` 和 `npm run test:isolated`。

## 分发与更新

当前 beta 通过本地 tarball 分发；dshmarket 目录条目尚未发布。

更新责任属于 **dshmarket / 插件管理器**，不属于插件设置页：

- 插件不实现自更新，也不内置下一版本下载地址；
- dshmarket 从 `awesome-dsh-plugin` 精选目录获取条目；
- 目录条目发布后，用户通过 dshmarket 安装和更新；
- 不要混用本地 tarball 安装与市场更新：先通过市场重装一次，让安装来源绑定到市场。

提交目录条目的位置是 `awesome-dsh-plugin/awesome-dsh-plugin`，不是 `dshmarket` 应用仓库。
