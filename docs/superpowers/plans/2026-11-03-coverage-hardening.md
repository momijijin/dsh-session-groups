# Unit Coverage and Boundary Hardening Plan

> **For agentic workers:** Steps use checkbox syntax. Execute task-by-task; each task ends with a focused test run and a small commit.

**Goal:** 提高业务代码的**真实边界覆盖**，不是用 mock/弱断言把覆盖率刷绿。核心纯模块争取 100% 行覆盖和 ≥95% 分支覆盖；Host 控制面与客户端纯逻辑争取 ≥90% 行、≥80% 分支。

**Baseline:** `npm run check:coverage` on 0.3.0-beta.56:

```text
392 tests
89.48% lines / 77.02% branches / 83.78% functions (all loaded source)
```

**Architecture:** 不改业务行为，只增加针对真实输入/失败路径的测试；必要时把测试夹具抽到独立 helper，不修改生产接口。UI/Cordis 组件由 A+ 隔离回归覆盖，不以虚假的浅层 render 测试刷 100%。

**Tech Stack:** Node 24 built-in test + `--experimental-test-coverage`, existing fake DOM/transport/clock helpers, Playwright A+ for UI.

## Global Constraints

- 不为了覆盖率删除或弱化现有断言。
- 不把错误分支改成恒真/恒假。
- 新增测试必须断言输出、错误 code、状态变化或最终 document，不得只调用函数。
- 每个测试必须有明确的 arrange / act / assert 语义。
- 不新增依赖。
- 核心测试不加载 React/Cordis/DSH。
- 每批只处理一个模块组，运行 `npm test` 和 `npm run check:coverage`。

## Review Focus

- 真实失败返回是否被断言，而非只断言 `ok === false`。
- 边界输入：空、超长、负 index、未知枚举、服务缺失、权限关闭、revision/planHash 冲突。
- 状态机分支：pending、conflict、unsupported、retry、abort。
- 测试是否因为只覆盖 happy path 而遗漏错误 code / message。
- UI 与纯逻辑分层：不把 A+ 的覆盖伪装成 unit coverage。

---

### Task 1: Core/shared boundary tests

**Files:**
- Modify: `tests/core/control.test.js`
- Modify: `tests/core/dialog-geometry.test.js`
- Modify: `tests/unit/model.test.js`
- Add/modify: `tests/core/fork.test.js`, `tests/core/tree.test.js`, `tests/core/group-position.test.js`
- Add: `tests/core/menu-position.test.js` if absent.

- [ ] Add tests for `applyControlOperations`: unknown op, invalid index, destructive disabled, no-change, invalid-result, operation-failed.
- [ ] Add tests for `dialogConfirmPayload` default branches (`null`, `undefined` selection, unknown dialog kind).
- [ ] Add tests for `flattenRenderTree` nested ordering and `newGroupId` fallback with `crypto.randomUUID` absent.
- [ ] Add missing `menu-position` clamp/anchor branches and tree branch cases.
- [ ] Run `npm test` and `npm run check:coverage`; target core/shared line 100%, branch ≥95%.

### Task 2: Host route/tool boundary tests

**Files:**
- Modify: `tests/host/routes.test.js`
- Add: `tests/host/session-routes.test.js`
- Modify: `tests/host/tool.test.js`
- Modify: `tests/host/store.test.js` if storage paths remain uncovered.

- [ ] Session routes: invalid body/JSON/content type, control-disabled, missing session, title conflict, archive conflict, stopActivity, service unavailable, operation failure.
- [ ] HTTP routes: body limit, malformed JSON, method mismatch, fence status, revision conflict, unsupported version, idempotency, diagnostics/debug/skill boundaries.
- [ ] Native tool: invalid action, control-disabled, invalid session/title/archived, expected* mismatch, no-op success, archive running refusal, service unavailable.
- [ ] Run focused host suite; target host critical modules ≥90% line / ≥80% branch.

### Task 3: Client pure-logic boundary tests

**Files:**
- Modify: `tests/client/actions.test.js`
- Modify: `tests/client/optimistic.test.js`
- Modify: `tests/client/state.test.js`
- Modify: `tests/client/diagnostics.test.js`
- Modify: `tests/client/sidebar-width.test.js`
- Modify: `tests/client/session-equality.test.js`

- [ ] Actions: missing services, failed rename, archive refusal, create session failure, copy failure, optimistic conflict.
- [ ] Optimistic: rollback on failed write, abort/retry, concurrent flush, error propagation.
- [ ] State: malformed persisted JSON, storage write failure, corrupt doc, action immutability.
- [ ] Diagnostics: disabled/enable transition, flush failure/retry, HUD edge cases, malformed payload.
- [ ] Sidebar width: min/max clamp, missing layout, resize observer absence, reset, narrow mode.
- [ ] Run client suite; target pure client modules ≥90% line / ≥80% branch.

### Task 4: Coverage gate/report

- [ ] Add `check:coverage` documentation and baseline section.
- [ ] Decide whether to enforce per-module thresholds (not a single overall 100%); do not claim UI 100%.
- [ ] Publish final per-module table and explain remaining uncovered defensive/OS-specific branches.
- [ ] Commit small versions per task; update `docs/TEST-RESULTS.md`.

## Self-Review

- Coverage target is behavior-based; no tests simply call functions.
- Host/UI failures are asserted by code/status, not only thrown.
- Pure modules and Cordis/UI remain separate.
- 100% overall is explicitly not a goal; core line 100% is.

## Progress Log

- Baseline: 392 tests, 89.48% lines / 77.03% branches / 83.78% functions.
- beta.57: 429 tests, 93.38% lines / 80.65% branches / 87.52% functions; core 29/29; coverage gate 92/80/85. A+ pass; beta.57 installed with lifecycle PASS.
