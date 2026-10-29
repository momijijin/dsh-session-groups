# 0.2.4 — optimistic drop commits + drag insertion placeholders (implementation report)

- Repo: `C:\Users\Momiji\Projects\dsh-session-groups`
- Branch: `feature/v1.1-session-groups`; HEAD before work: `c7ed326`
- Version: `0.2.4`; local commit only (no push, no install, no desktop/`~/.dsh` writes)
- Owner: single agent; no subagents; deletion list: **empty**

## 1. Optimistic commit queue

### 1.1 Files

- New: `src/client/optimistic.js` — single-writer queue (`commitOptimistic`, `commitStrict`, `flush`, `isPending`, `dispose`).
- `src/client/state.js` — new actions `optimistic-doc` / `optimistic-confirmed` / `optimistic-rollback`; snapshot flag `optimistic`.
- `src/client/plugin.js` — `commitDoc` now flushes the optimistic queue and runs `commitStrict`; `commitOptimistic` exposed on the runtime bridge.
- `src/client/actions.js` — `moveSession` / `createSessionInGroup` resolve updaters inside the strict lock.
- `src/client/components.js` — session/group drops and group menu move-up/down use `commitOptimistic`; persistence errors marked `reported` are not toasted twice.
- `src/client/components.js` — `.dsg-root` exposes `data-optimistic="true|false"` for E2E diagnostics.

### 1.2 Semantics

1. **Immediate dispatch.** `commitOptimistic(updater)` runs the updater synchronously against `store.doc` (the current *optimistic* document), dispatches `optimistic-doc` in the same tick, and only then queues the HTTP write. The store revision is untouched, so it always remains the last server-confirmed value and is the correct `baseRevision`.
2. **Coalescing.** A drain is scheduled on a microtask. Every additional optimistic commit before that microtask replaces `pendingDoc`, so N same-tick moves produce **one** request carrying the newest document (never an intermediate doc).
3. **Single writer / in-flight append.** While a request is in flight, new optimistic commits set `pendingDoc` again. On success the queue updates `lastConfirmed` + `revision`; if a newer pending doc exists it **keeps the optimistic doc** instead of clobbering it with the server echo, then sends exactly one follow-up request for the newest doc with the new revision.
4. **Success reconcile.** With no newer pending doc, `optimistic-confirmed` replaces the view with the server `doc`/`revision` and clears the optimistic flag.
5. **Failure / conflict rollback.** Any persistence error or 409 dispatches `optimistic-rollback`, restoring `lastConfirmed` doc and the confirmed revision, clears pending state, and surfaces the existing `toast.dropFailed` / `banner.conflict` toast. The rejected promise is marked `reported`, so call sites do not double-toast.
6. **Non-optimistic coordination.** `commitStrict(updater)` first `flush()`es the optimistic queue, then takes the single-writer gate and resolves the updater against the latest doc inside the lock (concrete documents are no longer captured from a pre-drop snapshot). Optimistic drops arriving during a strict write wait for the gate, then compute against the freshly confirmed doc — a stale doc can never overwrite newer state.
7. **One writer.** No separate parallel commit path remains: drags and dialogs share the queue; the plugin's `commitTail` only serializes dialog actions.

### 1.3 Timing

| Phase | Timing | Evidence |
|---|---|---|
| Optimistic dispatch (drop → store) | synchronous, same tick | unit tests assert `snapshot.doc === next` before the fake HTTP resolves |
| Decision/update → rendered row (E2E) | **296 ms** session / **14 ms** group (measured while the 1500 ms commit is held) | E2E step 18 `optimistic.session.optimisticMs` / `optimistic.group.optimisticMs` |
| Commit coalescing | same microtask; 2 drops → 1 request | `tests/client/optimistic.test.js` "rapid moves coalesce…" |
| Serial follow-up base revision | previous confirmed revision (`+1` per write) | unit test "a drop during an in-flight write…" |
| Rollback | immediate on failed result; revision never advanced | unit tests "failure rolls back…" / "conflict also rolls back…" |
| Strict flush | strict write starts only after optimistic drain settles | unit test "strict commit flushes pending writes…" |

### 1.4 Unit coverage (8 new tests, `tests/client/optimistic.test.js`)

- immediate dispatch keeps the confirmed revision;
- rapid same-tick drops coalesce into one request with the latest doc;
- a drop during an in-flight write is serialized next with the new base revision;
- failure rolls back to `lastConfirmed` + reports once;
- conflict rolls back + conflict toast;
- strict commit flushes, sees the reconciled doc, uses the new revision;
- strict writer defers a concurrent drop and the updater sees the confirmed doc;
- queue `isPending`/dispose paths (implicitly exercised).

`npm test`: **211/211 PASS**.

## 2. Drag insertion placeholder

- `DropPlaceholder` renders a real flex row, not a 2px line: height **32px** (session) / **34px** (group), theme-aware accent surface + dashed accent border + label.
- Labels: 「放到这里」/“Drop here” (session targets), `放入『X』前/后/内`, `放到『X』末尾` (append), `移到根级末尾` (root end), `移出分组，放到这里` (ungrouped).
- The gap participates in layout; `overflow-anchor: none` on `.dsg-tree` prevents browser scroll anchoring from cancelling the visual push.
- Cleared by `dragleave` (ignores entering a child or the placeholder itself), `drop`, `dragend`; the placeholder itself accepts dragover/drop so the pointer can rest in the gap.
- Covered insertion points: session-before/after, group-before/after, group child slot (6px → 34px when active), group-append expanded (end of group body), group-append collapsed (after the group row), ungrouped (under the section header), root-end (after the last root group). `group-head` also renders a session-height placeholder at the top of the session area.
- Stable test id `session-groups-drop-indicator` retained; added attributes `data-drop-height`, `data-drop-kind`, `data-drop-target`; `.dsg-tree` stays overflow-free at 264px.

### 2.1 E2E evidence (step 18, real isolated DSH web)

| Case | Height | Label | Gap/push | Clear |
|---|---|---|---|---|
| session-before | 32px | 放到这里 | target moved **36 px** | dragleave → none |
| session-after | 32px | 放到这里 | below target | dragleave → none |
| group-before | 34px | 放入『X』前 | target moved **36 px** | dragleave → none |
| group-after | 34px | 放入『X』后 | below target subtree | dragleave → none |
| group child slot | 34px | 放入『X』内 | slot 6→34px | dragleave → none |
| group-append (expanded) | 34px | 放到『X』末尾 | after last session | dragleave → none |
| group-append (collapsed) | 34px | 放到『X』末尾 | after collapsed row | dragleave → none |
| ungrouped | 32px | 移出分组，放到这里 | under section header | dragleave → none |
| root-end | 34px | 移到根级末尾 | after last root group | dragleave → none |

264px probe: `.dsg-tree` and the active placeholder had `scrollWidth <= clientWidth`; width restored afterwards.

## 3. Optimistic E2E proof (no page fetch wrapper)

E2E applies CDP `Network.emulateNetworkConditions({ latency: 1500 })` (browser-network latency, no page-level fetch wrapper) so the commit response is held while the DOM is read. For both a session reorder and a group move the step asserts:

1. DOM order already changed;
2. `.dsg-root[data-optimistic="true"]`;
3. record file `revision` still equals the pre-drop value (request held, not persisted);
4. after the delayed response lands, the record revision advances, `data-optimistic="false"`, DOM order unchanged.

| Move | Optimistic DOM time | Revision before → during → after | Result |
|---|---|---|---|
| session reorder | **296 ms** | 29 → 29 → 30 | PASS |
| group move | **14 ms** | 30 → 30 → 31 | PASS |

## 4. Other 0.2.4 changes

- `.dsg-header-title` font-weight **600 → 400** (official section label, 14/20 unchanged); `.dsg-ungrouped-header` 600 → 400.
- Footer exact copy: workspace mode → 「切换到自由分组视图」/“Switch to free grouping view”; groups mode → 「返回默认工作区视图」/“Back to default workspace view”. Single 28px button / 16px glyph / 13px text unchanged; rail icon-only unchanged.
- E2E step 1/2/16 now assert the exact strings; step 16 asserts header `font-weight: 400`.
- README/RELEASE/TEST-RESULTS/TEST-PLAN/CONTRACTS/V1-PLAN updated; version bump to 0.2.4; `lib/client.js` rebuilt; `npm pack` 0.2.4.

## 5. Verification summary

| Check | Result |
|---|---|
| `npm test` | **211/211 PASS** (0 fail / 0 skip) |
| `node --check` (src client/host, e2e) | **PASS** (`npm run check` + per-file `node --check`) |
| fresh setup (`qa-0.2.4-final4`, 18/18 checks) | **PASS**, `HOME-0 removed=0`, real-home fingerprint unchanged, client build 195,772 bytes / sha256 `1416bb40…` |
| full E2E 18/18 (`--qa-home .spike-homes/qa-0.2.4-final4`, port 4419) | **PASS**, 79,277 ms, `consoleErrors=[]` / `pageErrors=[]`, evidence `scripts/qa/evidence-perf/024-final2/e2e-20261029-120454.json`; step 10 virtualized restart PASS, step 18 placeholders + optimistic PASS |
| package `dsh-session-groups-0.2.4.tgz` | **128,218 bytes / 35 files / sha256 `F519BFBD6B9F180BBCBA4E46CCC3DC46BBD0A92B2FA9D800422D9B97EA358C45`** (unpacked 500,532; shasum `5b6bd9b9…`) |
| real `~/.dsh` writes | **none** (setup/audit fingerprint unchanged; no teardown, no desktop/`~/.dsh` writes) |

## 6. Concerns / boundaries

- **Optimistic rollback is whole-batch**: a 409 or I/O failure rolls the view back to the last confirmed doc, including any newer unpersisted drops; there is no automatic replay/retry. This matches the requested “failure/conflict → roll back + toast” behaviour and avoids writing a guessed merge.
- **Strict write + drop race**: while a dialog commit owns the writer, a drop waits for the lock (not WYSIWYG for that edge). The alternative (dispatch then merge) can silently drop the dialog change, so waiting was chosen; normal dialog workflows are modal and do not overlap drags.
- **E2E fixture note**: renaming the single “newest” copied real session (`session-14168603…`) blocks this host’s renderer for tens of seconds *even through the official workspace menu only* (verified without our group view mounted). Step 8 therefore renames the last real candidate in group A (older session), which exercises the identical host rename + snapshot sync path. This is a fixture/host projection issue, not a 0.2.4 regression; no product code was changed for it.
- Placeholder is visual-only; no document/session write happens on hover. It is removed on dragleave/drop/dragend; a drag that leaves the tree clears it via the row dragleave handler.
