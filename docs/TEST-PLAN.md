# V1 测试计划

- 目标：证明“分组只改视图、不改宿主数据”，同时证明拖拽/嵌套/筛选/新建在真实 DSH 中可用
- 负责人：QA（计划、证据、验收结论）；Host/Client 各写自己模块的测试；Lead 做最终审计
- 环境：先用独立 `DSH_HOME`（`.spike-homes/qa`）+ `groups-spike` profile，再 desktop profile 人工验收；profile 不隔离 `sessions/`/`storages/`，禁止用真实 `~/.dsh` 跑 E2E
- 关联：`docs/V1-PLAN.md`、`docs/CONTRACTS.md`、`docs/SPIKE.md`

## 1. 测试分层

| 层 | 工具 | 范围 | 归属 | 运行频率 |
|---|---|---|---|---|
| 单元 | Node `node --test` | `src/shared/model.js` 纯函数 | Host/Client 写，QA 审 | 每次提交 |
| Host 集成 | Node `node --test` + 临时目录 | 存储、原子写、revision、路由围栏 | Host | 每次提交 |
| Client 逻辑 | Node `node --test` | 可见性、筛选、工作区映射、拖拽 hit-test | Client | 每次提交 |
| E2E | Playwright（Chromium） | 真实 DSH web profile：建组/拖拽/归档/新建/重启 | QA | 每日/合并前 |
| 人工验收 | 清单 + 截图 | desktop profile 9 步 | QA + 用户 | 发布前 |
| 回归审计 | 脚本 + hash | 只写记录文件 | QA | 每次 E2E |
| 性能 | 合成数据/手工 | 200/1000 会话 | QA | P1 |

## 2. 单元测试矩阵（shared model）

文件：`tests/unit/model.*.test.js`

| ID | 用例 | 断言 |
|---|---|---|
| U1 | `createGroup` 根组/子组 | 新 id、parentId、顺序正确 |
| U2 | `renameGroup` trim/空名/80 字符 | 空名拒绝；超长截断或拒绝（契约定） |
| U3 | `deleteGroup` 有子组/有会话 | 子组提升；会话移到父组头/未归组头；无删除 |
| U4 | `moveGroup` 同级前/后、跨父级 | 顺序正确；子树跟随 |
| U5 | `moveGroup` 移入自身/后代 | 返回错误或原 doc；无环 |
| U6 | `assignSession` 从组 A 到组 B | 旧组移除；新组指定 index；不重复 |
| U7 | `assignSession` 到未归组 | 从所有组移除；ungrouped 插入 |
| U8 | `removeSession` 不存在 | 幂等，不抛 |
| U9 | `validateDoc` 重复 session、环、坏 parentId、坏 icon | 每条返回明确错误 |
| U10 | 孤儿 session id | 保留在 doc；`buildRenderTree` 不渲染 |
| U11 | 归档三态 | hidden/all/only 的可见集合正确 |
| U12 | 空组/全归档组 | 组仍渲染；`emptyVisible` 为 true |
| U13 | `inferWorkspaceId` 同质/混合/空组/无当前会话 | 返回规则符合 D6 |
| U14 | 工作区映射 | 每个 session 映射到 workspace；无归属返回 null |
| U15 | 顺序稳定性 | 同 doc 重复构建，输出一致 |

## 3. Host 集成

文件：`tests/host/*.test.js`

| ID | 用例 | 断言 |
|---|---|---|
| H1 | 首次 load 无文件 | 返回空 doc revision 0 |
| H2 | commit 写入 | 文件存在；revision+1；内容一致 |
| H3 | 旧 baseRevision | 409；返回当前 doc；不覆盖 |
| H4 | 非法 doc | 422；文件不变 |
| H5 | 原子写 | 临时文件不残留；`.bak` 存在 |
| H6 | 坏 JSON | 隔离为 `.corrupt-*`；返回空 doc + warning；不崩 |
| H7 | 版本过高 | `unsupported-version`；不覆盖 |
| H8 | 并发 commit 串行化 | 第二个拿到新 revision 或 409 |
| H9 | 路由围栏 | 非 loopback/坏 Origin 拒绝 |
| H10 | 只写记录文件 | `workspace.json`/session 日志 hash 不变 |

## 4. Client 逻辑

文件：`tests/client/*.test.js`

| ID | 用例 | 断言 |
|---|---|---|
| C1 | 过滤 subagent/blank | 默认树不含；当前/新建 blank 例外 |
| C2 | 归档筛选 + 组空态 | 组不消失；空态行出现 |
| C3 | 拖拽 hit-test：上/下半、组头、未归组、空白 | 返回正确 drop target |
| C4 | 拖拽非法目标：自身/后代/只读 | `not-allowed` |
| C5 | 折叠组悬停展开 | 500ms 后展开；离开取消 |
| C6 | 当前会话自动展开 | 打开视图时祖先组展开 |
| C7 | 未归组新 id 前插 | 最新在前；不重复 |
| C8 | 新建推断工作区 | 同质/混合/空组符合 D6 |
| C9 | 工作区标签 | 正确标题/路径；无归属显示“无工作区” |
| C10 | 失败降级 | load 失败渲染扁平列表 + banner |

## 5. E2E（Playwright）

环境：

```powershell
$env:DSH_HOME = "C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\qa"
& "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe" --expose-internals `
  "C:\Users\Momiji\AppData\Local\Programs\DSH Desktop\resources\app\lib\desktop-cli.js" `
  --profile groups-spike --port 4402 --no-open
```

说明：PATH 上的 `dsh.cmd` 会硬编码 `DSH_HOME`，不能用于隔离；`web` 子命令在 rc.2 会报 too many arguments。

用例：

1. 打开 4402，侧栏默认官方工作区视图；用只读夹具复制真实 `sessions/` + `storages/workspace.json`，得到 3 工作区/约 30 会话/2 归档。
2. 点底部「分组视图」，出现分组视图。
3. 新建 3 组（1 个二级嵌套），刷新后仍在。
4. 从 3 个不同工作区拖 10 个会话进组；每次检查插入线/高亮/浮动标签。
5. 组内/跨组拖拽排序；刷新后顺序保持。
6. 组头 `+` 打开预创建工作区菜单：默认推断正确；切换工作区后 `connectWorkspace` 创建；落在组第一行且无孤儿 blank。
7. 归档一个普通会话 → 隐藏；切「全部」可见；切「仅已归档」只显示它；取消归档回原组。再归档一个**运行中**会话 → 拒绝 → 确认框列出活动 → stopActivity 强制；取消路径不动。
8. 重命名 → 官方侧栏同步；本视图无删除入口。
9. 收起侧栏 → rail 展开按钮可用。
10. 重启 profile → 结构/顺序/筛选保持。
11. 切回工作区视图 → 官方浏览器原样；搜索/添加工作区可用。
12. 数据审计：`workspace.json` 与一个 sample session 目录 hash 不变；只新增/修改 `dsh-session-groups.json`。

Playwright 拖拽注意：

- 用 `page.mouse.move/down/up` 分步移动，不要只 `dragTo`；中间停 100ms 触发 `dragover`。
- 每次拖拽后断言 DOM 行顺序 + 记录文件内容。
- 失败时保存 trace/video/screenshot。

## 6. 人工验收（desktop profile）

在真实 desktop profile 上重复 E2E 的 9 步；重点：

- 官方视图/插件市场/设置不受影响；
- 主题深色、280px、150% 缩放；
- 中文文案；
- 现有 25 个会话不丢、不重复；
- 卸载/禁用插件后官方视图恢复，记录文件保留。

## 7. 回归审计脚本

`scripts/audit-no-host-writes.ps1`：

1. 记录**隔离 home** `.spike-homes/qa/storages/workspace.json` 的 SHA256（不要用真实 `~/.dsh`）；
2. 抽样 3 个 session 目录的 `*.jsonl`/`*.zstd` mtime + hash；
3. 执行分组操作（建组/拖拽/改名组/删组）；
4. 再算 hash；
5. 断言只有 `dsh-session-groups.json` 变化；输出 PASS/FAIL。

注意：重命名/归档/新建是用户主动的宿主动作，允许改变 session 数据；审计只针对**分组操作**。

## 8. 性能

- 合成 doc：3 工作区、200/1000 sessions、30 组、4 层。
- 指标：打开视图 <200ms；拖拽反馈 <100ms；筛选 <100ms；无长任务 >50ms。
- 超过 200 会话若卡顿，记录并转 P2 虚拟化，不阻塞 V1。

## 9. 缺陷与门禁

- P0 缺陷：丢会话/重复行/写坏宿主数据/白屏/官方视图回不来/分组记录丢失 → 阻断发布。
- P1：拖拽误放、空态、图标缺失、文案 → 修复后发布。
- P2：颜色/搜索/折叠全部 → 记录。
- 每次修复必须补一条回归测试；QA 签字才算关闭。

## 10. 证据清单

- 单测/集成输出（TAP/日志）
- E2E trace/video（失败必存）
- 截图：分组视图、拖拽插入线、组内新建、归档三态、rail、切回官方
- 数据审计输出
- 手工验收签字
- 已知问题清单（含 P2）
