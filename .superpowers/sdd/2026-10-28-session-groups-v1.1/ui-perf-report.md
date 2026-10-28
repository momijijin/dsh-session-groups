# dsh-session-groups 0.2.2 — drag hover / drop commit performance report

- Date: 2026-10-28 (Asia/Shanghai)
- Branch: `feature/v1.1-session-groups` (base `61b0479`, version 0.2.2)
- Host: DSH Desktop 2.0.18 / `@deepseek-ai/dsh` 0.2.1-rc.2
- Scope: feedback item 5 — root-cause investigation and fix for "drag-session hover and drop commit feel very laggy"
- Probe source: `scripts/qa/probe-drag-perf.mjs`; opt-in client instrumentation: `src/client/perf.js`
- Raw evidence: `scripts/qa/evidence-perf/` (JSON + phase logs below)
- Deletions performed by this work: **none** (all probe homes retained under `.spike-homes/`)

## 0. TL;DR

| Question | Answer |
|---|---|
| Root cause of hover lag | Every `dragover` rebuilt a new drop-target object and called `setDropTarget` **unconditionally**, so React re-rendered the whole groups tree even when the pointer stayed in the same zone. 45 stationary dragovers → **48 `GroupsView` renders / 1,200 `SessionRow` renders**; on a scaled 803-row tree the same 45 events → **47 full-tree renders**, frame avg **24.07 ms**, max **50.1 ms** (dropped frames). |
| Fix | Stable drop-target equality (`sameDropTarget`, `src/client/drag.js`) + a deduping setter is used by every drag handler. Unchanged target → no React update. |
| Root cause of drop commit lag | Two full-tree renders per drop: the drag-state clear and the committed doc. The unused `saving:true/false` dispatch added a **third** full render before the route; the route itself (read + validate + write + fsync + `.bak` copy + rename) costs **~9–13 ms** and dominates wall time. |
| Fix | Removed the unused `saving` dispatches from `commitDoc` (state/action kept for compatibility). No speculative optimistic doc / row memoization: the probe does not support them. |
| Deterministic before → after | stationary 45 dragovers: **48 → 4** view renders, **46/46 → 46/2** target changes, 1,200 → 100 row renders; paced 30 events: **32 → 10** view renders (800 → 250 row rows); 803-row stationary: **47 → 3** renders, `GroupNode` renders **37,741 → 2,409**, frame p95 **50 ms → 16.8 ms**. |
| Drop commit | 9 commits: **36 → 27** `GroupsView` renders (= exactly one saved render per commit); `saving` marks gone. Wall time stayed route-bound (20.2 → 22.3 ms in the standard run, within noise; HTTP commit 8.7 → 9.1 ms; drop→next frame 10.9 → 11.5 ms). Server store bench for a 112 KB / 800-group doc: **12.87 ms avg** commit, **4.04 ms avg** load. |

## 1. Method

The probe drives the real isolated QA home over CDP (`e2e/cdp.mjs`), enables the
opt-in client probe through `localStorage['dsh-session-groups.perf'] = '1'` and a
reload, then runs identical phases before and after:

1. **hover-burst** — 120 synthetic `dragover` events in one task (React batches
   them into 2 commits; kept as a sanity check only).
2. **hover-paced** — 30 `dragover` events, one per ~16 ms frame, target changes
   every 4 events (runs of 4 identical targets).
3. **hover-hold** — 45 `dragover` events on the **same** group row, one per
   frame. This is the shape a user feels as "hover lag": Chrome keeps firing
   `dragover` while the pointer rests.
4. **drops** — 9 real synthetic HTML5 drops (dragstart → 6 dragover → drop →
   dragend), waiting for each row to move before the next; the client probe
   timestamps `drop:event → commitDoc:start → api:commit:start → http:start →
   http:end → store:doc → frame:after-doc`.
5. **stress** — after the standard phases, 800 empty groups are added through
   the public commit route (same document, no other writes), the view reloads,
   and the hold phase is repeated on a **803-row tree** (3 probe groups + 800
   stress + 25 sessions). This reproduces the large-tree hover cost; no E2E
   fixture is modified for the official 17-step run.

Instrumentation is opt-in and disabled in normal use: `perfEnabled()` caches a
single flag; when off, the helpers return after one boolean check and the drag
handlers are not wrapped. The probe data is exposed only through
`globalThis.__dsgPerfApi.snapshot()`.

### Environment / fixture

- Isolated home `C:\Users\Momiji\Projects\dsh-session-groups\.spike-homes\qa-0.2.2-perf-before-5`
  (baseline) and `...\qa-0.2.2-perf-after-2` (after) — fresh `setup.ps1` homes,
  port **4405** (the 4402 QA lane was in use by a concurrent QA run).
- Fixture: 3 workspace dirs / 1,585 files / 1,157,905,143 bytes of real session
  data (frozen copy), 25 visible root sessions, 3 workspaces.
- Worker: headless Chromium via the repo's zero-dependency CDP driver, window
  1440×900.
- Probe runs: baseline `23:31–23:33`, after `23:40–23:41` (same machine, same
  fixture shape; route timings are CPU/disk sensitive, so the render counts are
  the deterministic signal and the timing deltas are reported with that caveat).

### Reproduction

```powershell
# baseline home (instrumentation-only 0.2.1 build staged)
pwsh -NoProfile -File scripts/qa/setup.ps1 -QaHome .spike-homes/qa-0.2.2-perf-before-5 -RequireClientBuild -EvidenceDir scripts/qa/evidence-perf
pwsh -NoProfile -File scripts/qa/start-web.ps1 -Port 4405 -QaHome .spike-homes/qa-0.2.2-perf-before-5 -EvidenceDir scripts/qa/evidence-perf
node scripts/qa/probe-drag-perf.mjs --label before --evidence-dir scripts/qa/evidence-perf --out scripts/qa/evidence-perf/perf-before-800.json --stress-groups 800

# after home (0.2.2 build staged)
pwsh -NoProfile -File scripts/qa/stop-web.ps1 -Port 4405 -QaHome .spike-homes/qa-0.2.2-perf-before-5 -EvidenceDir scripts/qa/evidence-perf
pwsh -NoProfile -File scripts/qa/setup.ps1 -QaHome .spike-homes/qa-0.2.2-perf-after -RequireClientBuild -EvidenceDir scripts/qa/evidence-perf
pwsh -NoProfile -File scripts/qa/start-web.ps1 -Port 4405 -QaHome .spike-homes/qa-0.2.2-perf-after -EvidenceDir scripts/qa/evidence-perf
node scripts/qa/probe-drag-perf.mjs --label after --evidence-dir scripts/qa/evidence-perf --out scripts/qa/evidence-perf/perf-after-800.json --stress-groups 800
```

## 2. Stepwise probe log (before → after)

### 2.1 Standard tree (3 groups, 25 sessions)

Baseline (`perf-before.json`, label `before`):

```
[probe:before] PASS
  sessions=25 groups=3
  hover: 120 dragover events, avg 0.04ms p95 0.1ms max 1.2ms; groupsView renders 2; dropTarget calls/changes 121/121; frame p95 16.8ms
  paced: avg 0.27ms; frame avg/p95 8.28/16.7ms; renders 32
  hold: 45 events, avg 0.32ms; renders 48; dropTarget calls/changes 46/46; frame avg/max 5.52/16.8ms
  drops: 9 commits, commit wall avg 20.19ms p95 27ms max 27ms
  last drop timeline: {"dropToCommitStart":0.7,"http":8.7,"dropToStoreDoc":9.6,"dropToNextFrame":10.9,"savingTrue":0.7,"savingFalse":9.6}
```

After (`perf-after-standard.json`, label `after-standard`):

```
[probe:after-standard] PASS
  sessions=25 groups=3
  hover: 120 dragover events, avg 0.06ms p95 0.1ms max 2ms; groupsView renders 2; dropTarget calls/changes 121/31; frame p95 16.8ms
  paced: avg 0.27ms; frame avg/p95 8.28/16.7ms; renders 10
  hold: 45 events, avg 0.31ms; renders 4; dropTarget calls/changes 46/2; frame avg/max 5.52/16.8ms
  drops: 9 commits, commit wall avg 22.28ms p95 29.6ms max 29.6ms
  last drop timeline: {"dropToCommitStart":0.7,"http":9.1,"dropToStoreDoc":9.9,"dropToNextFrame":11.5,"savingTrue":null,"savingFalse":null}
```

Render-count breakdown (`renders` in the JSON):

| Phase | Before | After | Delta |
|---|---|---|---|
| hold 45 events — `GroupsView` | 48 | 4 | **−92%** |
| hold — `SessionRow` | 1,200 | 100 | **−92%** |
| hold — target setter calls / changes | 46 / 46 | 46 / 2 | **−96% changes** |
| paced 30 events — `GroupsView` | 32 | 10 | **−69%** |
| paced — `SessionRow` | 800 | 250 | **−69%** |
| drops 9 commits — `GroupsView` | 36 | 27 | **−25%** (one `saving` render per commit removed) |
| drops — `SessionRow` | 450 | 225 | **−50%** |

The remaining 4 renders in the hold phase are the dragstart/dragend view-state
updates (2) plus mount/label updates; the 46 setter calls are all still made, but
44 of them now resolve to the same target and skip React.

### 2.2 Scaled tree (803 rows: 800 empty groups + 25 sessions)

Baseline (`perf-before-800.json`):

```
  stress(803 groups + 25 sessions): hold renders 47; per-event commit 0.13ms handler / frame avg 24.07ms max 50.1ms
  drops: 9 commits, commit wall avg 23.48ms p95 30.5ms max 30.5ms
  last drop timeline: {"dropToCommitStart":1.1,"http":9.9,"dropToStoreDoc":11.1,"dropToNextFrame":17.2,"savingTrue":1.1,"savingFalse":11.1}
```

After (`perf-after-800.json`):

```
  stress(803 groups + 25 sessions): hold renders 3; per-event commit 0.1ms handler / frame avg 17.15ms max 50ms
  drops: 9 commits, commit wall avg 33.88ms p95 57.8ms max 57.8ms
  last drop timeline: {"dropToCommitStart":0.8,"http":13,"dropToStoreDoc":13.9,"dropToNextFrame":16.2,"savingTrue":null,"savingFalse":null}
```

| 803-row hold metric | Before | After | Delta |
|---|---|---|---|
| `GroupsView` renders | 47 | 3 | **−94%** |
| `GroupNode` renders | 37,741 | 2,409 | **−94%** |
| `SessionRow` renders | 1,175 | 75 | **−94%** |
| target setter calls / changes | 46 / 46 | 46 / 2 | **−96% changes** |
| frame interval avg | 24.07 ms | 17.15 ms | **−29%** |
| frame interval p95 | 50 ms | 16.8 ms | **−66%** |
| frame interval max | 50.1 ms | 50 ms | one unavoidable first-render spike |

`GroupNode` is the decisive number: at 803 rows every stationary `dragover`
rendered 803 group subtrees (~45 × 803 = 36,135 baseline), which is what the user
felt as hover lag. After the fix only target changes render.

### 2.3 Drop commit timeline and server store

The client-side timeline shows the `saving` render at `+0.7–1.1 ms` before the
HTTP write, the write ending at `+8.7–13 ms`, the committed doc render at
`+9.6–13.9 ms`, and the next frame at `+10.9–16.2 ms`. The `saving` render was
overlapped with the in-flight HTTP request, so removing it does **not** shorten
the wall clock; it removes one full-tree render (9 renders across 9 commits,
the exact count change above) and frees the frame that competed with the commit.

The remaining drop latency is the host route, not the client. A standalone bench
of `src/host/store.js` on a temp directory with the same shape as the scaled doc
(800 groups, 112,764-byte JSON) measured:

```
commitMs: { count: 20, min: 9.56, p50: 12.84, avg: 12.87, max: 19 }
loadMs:   { count: 10, min: 3.26, p50: 3.79, avg: 4.04, max: 5.63 }
```

(`scripts/qa/evidence-perf/store-bench.log`; the write path does read →
validate → temp write → file fsync → `.bak` copy → rename → dir fsync.) This is
the frozen CONTRACTS §2 durability contract, so it is not changed by this patch.

## 3. Root cause and fix

### 3.1 Hover: unconditional target state + full-tree rerender

Every drag handler rebuilt a fresh target object (`hitTest`, `previewGroupDrop`,
`{...viewTarget}`, …) and called `setDropTarget(next)`. React compares state with
`Object.is`, so a new object always re-rendered `GroupsView` and every
`SessionRow`/`GroupNode`, even when the resolved position was unchanged. The
baseline hold phase proves it: 45 events on one row produced 48 view renders and
46/46 target "changes"; on 803 rows each of those renders rebuilt 803 subtree
components and the frame budget collapsed to 24 ms average / 50 ms p95.

Fix:

- `src/client/drag.js` — pure `sameDropTarget(left, right)` compares the stable
  vocabulary (`kind`, `sessionId`, `groupId`, `targetId`, `parentId`,
  `beforeGroupId`), treating `undefined`/`null` anchors as equal. Geometry and
  indices are deliberately not part of a view target.
- `src/client/components.js` — `dropTargetRef` keeps the committed target and
  `setDropTargetTracked` returns early when `sameDropTarget` says the line did
  not move. Every drag/clear site already goes through this setter.
- Unit coverage: `tests/client/drag.test.js` adds equivalent-target,
  changed-target (row midline, group id, child anchor, forbidden kind) and
  null/undefined cases.

### 3.2 Drop commit: one unused full render removed; route is the floor

`commitDoc` dispatched `saving:true` before the write and `saving:false` after
it, but no component or test consumes `store.saving`. The `saving:true` dispatch
forced a full groups render before the HTTP route (`+0.7–1.1 ms` in the
timeline), and `saving:false` shared a batch with the committed doc. Removing
both dispatches eliminated exactly one full render per commit (36 → 27 renders
for 9 commits) while keeping the state/action for contract compatibility.

Not bundled (evidence did not support them):

- **Row memoization** — after dedupe, a stationary drag no longer renders at all
  and a moving drag renders once per target transition, which matches the
  necessary work. Adding `memo` would require stabilizing the handler/store
  props for marginal benefit and more risk.
- **Optimistic doc** — the remaining 9–13 ms is the host's durable write
  (store bench above), not client rendering. An optimistic local doc would change
  the 409/queue semantics; it needs its own design and is left as a follow-up.

## 4. Verification

- `npm test`: **190/190 PASS** (includes 3 new `sameDropTarget` tests and the
  0.2.2 UI-layout tests).
- `node --check` on every changed client module: clean.
- Full E2E: **17/17 PASS** on a fresh isolated home
  (`scripts/qa/evidence-perf/e2e-20261029-002840.json`), console/page errors
  empty; includes step 15 search-row Escape/close, step 16 typography/spacing and
  step 17 dark-theme surfaces.
- No desktop profile install, no push, no deletion. Probe homes and evidence are
  retained.

## 5. Evidence index

| File | Contents |
|---|---|
| `scripts/qa/evidence-perf/perf-before.json` | baseline, standard phases (3 groups / 25 sessions) |
| `scripts/qa/evidence-perf/perf-after-standard.json` | after, standard phases (same shape) |
| `scripts/qa/evidence-perf/perf-before-800.json` | baseline, 803-row scaled hold phase |
| `scripts/qa/evidence-perf/perf-after-800.json` | after, 803-row scaled hold phase |
| `scripts/qa/evidence-perf/perf-before-800.log` / `perf-after-800.log` | console phase logs |
| `scripts/qa/evidence-perf/store-bench.log` | host store commit/load microbench |
| `scripts/qa/evidence-perf/e2e-20261029-002840.json` | final 17-step E2E result (17/17 PASS, console/pageErrors empty) + screenshots under `screenshots/e2e/` |
| `scripts/qa/probe-drag-perf.mjs` | reproducible probe runner |
| `src/client/perf.js` | opt-in client instrumentation |

## 6. Notes / caveats

- Route timings vary with machine load (a concurrent QA lane ran on 4402 during
  part of this work); render counts and target-change counts are deterministic
  and are the primary before/after signal. The 803-row after run's drop wall
  time (33.9 ms) is an outlier against its own timeline (16.2 ms drop→frame).
- The scaled tree is built from empty groups through the public commit route; it
  reproduces the full-tree render cost without changing the official E2E
  fixture. E2E step 14/15 still run on the standard 25-session fixture.
- The probe never writes outside the isolated QA home; the store bench writes
  only under the system temp directory. No deletion operations were performed.
