# Changelog

## 0.3.0-beta.73 (2026-11-04)

- Performance: rotate only the spinner wrapper so the static SVG arc stays compositor-friendly; narrow the session subscription to main rows plus the retained current subagent; cache the ungrouped list offset on mount/resize instead of reading layout during every scroll frame.
- Verification: 459 unit/contract tests and isolated A+ pass. Stable beta selected for release.

## 0.3.0-beta.72 (local batch, no release tag)

- Maintainability: split `components.js` (3051→1366 lines) into primitives, rows, ungrouped, resize-handle, search-box and header modules; split `routes.js` (1040→520 lines) into route-contract and control-routes modules.
- Behavior-neutral: DOM, testids, styles, routes, storage and wire contracts are unchanged. 456 tests and isolated A+ pass. No tag or Release.

## 0.3.0-beta.71 (local batch, no release tag)

- Accessibility: dialogs now expose an accessible title, focus the first useful control, restore opener focus, trap Tab/Shift+Tab and close on Escape. The titlebar and bottom-right resizer support keyboard movement/resizing; the group menu supports ArrowUp/ArrowDown/Home/End roving focus.
- Verification: 456 unit/contract tests plus the isolated A+ keyboard path pass. No tag or Release.

## 0.3.0-beta.70 (local batch, no release tag)

- Group context menu: add “New session” as the first action, above “New subgroup”; it reuses the group row’s first `+` action and the existing workspace-choice dialog.
- Locales: add `group.newSession` for English and Chinese while keeping the explanatory `group.addSession` tooltip.
- Tests: add a source contract for menu order/wiring and an isolated A+ assertion that the first menu item opens the new-session dialog.

## 0.3.0-beta.69 (local batch, no release tag)

- Copy: split the shared move dialog title into `dialog.moveGroup` and `dialog.moveSession`; describe grouping as a plugin-owned layer that leaves official workspace membership and logs unchanged.
- AI docs: add copy-paste prompts for batch project/group creation and rename-then-assign.
- CI: track `package-lock.json`, use `npm ci`, and add Windows/macOS/Linux Node 24 checks with coverage on Ubuntu only.
- Data: validate the backup record read-only (`backupStatus`/`backupRevision`/`backupError`).
- Settings: make `controlSessions` depend on `controlApi` and visually nest it under the API switch.
- Market: add a 180×180 icon and validated storefront YAML. No release tag; Release stays deferred until a stable beta is chosen.

## 0.3.0-beta.68 (2026-11-03)

- Fix the AI/HTTP external-revision refresh so the ready tree is not replaced with a loading placeholder.
- Make the settings info icon transparent.
- Add English README default, Chinese `README.zh.md`, platform verification matrix, isolated A+ evidence, and tag-only release workflow. 446 tests; A+ pass; release published.

## 0.3.0-beta.65 (local candidate, not tagged)

- Fix sidebar flash when an external revision (native tool / HTTP control) moves a session: a background refresh no longer dispatches `load-start` while a ready tree exists. The current tree stays mounted until the new document arrives; a background failure keeps the tree and reports a banner instead of replacing it with the error state.
- Add `shouldShowLoading` regression coverage. 446 tests pass locally; local user/A+ verification pending. No tag or push yet.

## 0.3.0-beta.64 (2026-11-03)

- Documentation: English README is the public default and Chinese lives in `README.zh.md`. Local tarball/CLI instructions moved out of the user install path; dshmarket is the intended user entry.
- Documentation: add an explicit platform verification matrix. Runtime is platform-neutral JavaScript with no PowerShell dependency; Windows has local UI verification, Linux has Node/CI verification, macOS is not verified. The Ubuntu CI is not presented as cross-platform UI certification.
- CI: add a single Ubuntu Node 24 check for install, syntax, 442 tests, coverage gate, client build and `npm pack --dry-run`; it never publishes, tags or bumps versions.
- Test: make the DSH_HOME path assertion platform-neutral so the suite can run on Linux.
- No runtime feature or data-format changes.

## 0.3.0-beta.63 (2026-11-03)

- Doctor CLI now acts as a compatibility gate: a 200 report with `host.compatibility.supported === false` exits non-zero while preserving the JSON report for post-upgrade scripts. A+ now also exercises two-window concurrent CAS (one 200, one 409, convergence). 442 tests; A+ passes.

## 0.3.0-beta.62 (2026-11-03)

- Recover a valid `.bak` automatically when the live record is corrupt/invalid: quarantine the bad file, restore the previous revision atomically, and surface `recovered-backup` (localized). If no valid backup exists, keep the existing empty-document fallback. 441 tests; 93.49% lines / 81.99% branches / 88.40% functions; A+ and lifecycle pass.

## 0.3.0-beta.61 (2026-11-03)

- Doctor now includes a read-only storage health report (`ok`/`missing`/`corrupt`/`unsupported-version`/`invalid`/`unreadable`, revision, `.bak`, quarantine count) without triggering the store’s quarantine or writing a new record. 439 tests; 93.61% lines / 82.05% branches / 88.36% functions; A+ and lifecycle pass.

## 0.3.0-beta.60 (2026-11-03)

- Expose doctor through `GET /dsh-session-groups/control/doctor` and `scripts/session-groups-control.mjs doctor`; it is fenced but available while controlApi is off. The CLI exchanges the DSH web launch-token cookie before sending the plugin bearer token. Doctor now reports live capabilities plus startup capabilities. Tighten coverage accounting to `src/**` only (tests/scripts excluded). 437 tests; 93.73% lines / 82.23% branches / 88.25% functions; A+ and lifecycle pass.

## 0.3.0-beta.59 (2026-11-03)

- Add a read-only `session_groups_control` action `doctor`: live host capability/compatibility, adapter/range, control gates, storage paths, service presence and mounted routes. It is available even when controlApi is off so a broken upgrade can be diagnosed before enabling writes. 434 tests; A+ pass.

## 0.3.0-beta.58 (2026-11-03)

- Final meaningful coverage round: control HTTP request matrix now covers unsupported media, oversized bodies, invalid JSON/body shapes, invalid revisions, missing/stale plan hashes, idempotency-key reuse and unsupported/IO document states. 432 tests; coverage 93.69% lines / 81.19% branches / 87.52% functions.

## 0.3.0-beta.57 (2026-11-03)

- Coverage hardening: add boundary tests for control result validation, session routes, native tool session actions, optimistic failures/dispose, state storage/no-op/subscriber boundaries, perf instrumentation, and sidebar width DOM ownership. 429 tests; coverage 93.38% lines / 80.65% branches / 87.52% functions. Add a 92/80/85 coverage gate.

## 0.3.0-beta.56 (2026-11-03)

- Split session-control HTTP routes into host/session-routes.js with an exact block-preserving extraction. Route ordering, status matrix, control gates and test paths are unchanged.

## 0.3.0-beta.55 (2026-11-03)

- Continue the component split: extract DialogHost into dialog-host.js; keep dialog DOM, geometry and test ids unchanged. Update source-contract tests to include the new module.

## 0.3.0-beta.54 (2026-11-03)

- Continue the component split: extract ScrollArea and GroupListPicker from components.js; update source layout tests. Behavior and DOM/test ids are unchanged.

## 0.3.0-beta.53 (2026-11-03)

- Fix Fork access truthiness and host-derived ungrouped placement discovered by a real isolated model turn; record real Fork and native-tool E2E evidence. Split Toast/MenuPopover into session-menu.js.

## 0.3.0-beta.52 (2026-11-03)

- Begin the large-file split: extract Toast and MenuPopover from components.js into session-menu.js with unchanged DOM/test ids and behavior. Update source-level layout tests to read the extracted module.

## 0.3.0-beta.51 (2026-11-03)

- Fix forked-child placement for host-derived ungrouped sources: leave the child outside the group document so buildRenderTree orders it first by recency, rather than assigning it to doc.ungrouped where it would render after derived sessions.

## 0.3.0-beta.50 (2026-11-03)

- Fix the Fork menu access check: `remoteAccess.source` is truthy for allowed access, not necessarily the boolean `true`. Use Boolean coercion so the menu matches the official useSessionAccess semantics.

## 0.3.0-beta.49 (2026-11-03)

- Extract fork placement into a pure core policy and test group-head, ungrouped-head, deterministic and non-mutating cases. Host-side real nonblank fork remains dependent on a deterministic fixture.

## 0.3.0-beta.48 (2026-11-03)

- Add a forced EventSource disconnect/reconnect A+ check: the second page blocks the events route, an external commit lands while SSE is down, the route is restored, and onopen reloads the title.

## 0.3.0-beta.47 (2026-11-03)

- Extract the EventSource revision stream into an injectable adapter and add reconnect/cleanup tests. No transport behavior change; reconnect onopen still forces a refresh.

## 0.3.0-beta.46 (2026-11-03)

- Add an explicit versioned DSH adapter selector: dsh-0.2 adapter, exact-version selection, optional host version resolution, and a 0.2/0.3 test matrix. No version conditional is added to client/host business flow.

## 0.3.0-beta.45 (2026-11-03)

- Add a two-page SSE convergence regression: an external commit must refresh both windows in the same browser context. Update the A+ coverage and release notes.

## 0.3.0-beta.44 (2026-11-03)

- Add explicit DSH capability preflight and document the compatibility truth: package range + runtime capability detection, not per-version compiled switches. Required host/client capabilities are logged; optional services degrade.

## 0.3.0-beta.43 (2026-11-03)

- Synchronize README, architecture, release and test-result docs with the current beta: first-layer settings, live config, Fork/Copy/archive actions, 378 tests, coverage baseline and the legacy groups.spec status.

## 0.3.0-beta.42 (2026-11-03)

- Add `npm run check:coverage` using Node's built-in test coverage; current report is 89.28% lines, 76.82% branches and 83.28% functions (378 tests).

## 0.3.0-beta.41 (2026-11-03)

- Add real-browser coverage for Copy Session ID (clipboard + toast) and destructive-setting cancellation; preserve upstream archive/rename access semantics.

## 0.3.0-beta.40 (2026-11-03)

- Harden destructive settings and skill repair: controlDestructive requires an inline explicit confirmation, and the repair route refuses to overwrite a user-owned SKILL.md (409 skill-user-owned).

## 0.3.0-beta.39 (2026-11-03)

- Make diagnostics and debugProbe settings live: host route flags are read per request, the debug route is always registered but gated, and the client starts/stops diagnostics after a settings change.

## 0.3.0-beta.38 (2026-11-03)

- Make Fork session behavior visible and complete: access/blank gating, child insertion at the source group head, and explicit success/placement/failure feedback.

## 0.3.0-beta.37 (2026-11-03)

- Publish locale meta.title/meta.description so the plugin-manager row and package page use localized display text.

## 0.3.0-beta.36 (2026-11-03)

- Export locale JSON so the Plugins page resolves the localized plugin title/description from locale dictionaries.

## 0.3.0-beta.35 (2026-11-03)

- Finalize the session-menu alignment (fork/copy ID, archive hover, no pin), complete locale coverage and localized metadata, and move standard-control settings with detailed option tooltips to the package detail page.

## 0.3.0-beta.34 (2026-11-03)

- Move plugin settings to the package-level bundle slot, replace bespoke controls with DSH Switch/Button/Tooltip, and add detailed per-option security/usage tooltips.

## 0.3.0-beta.33 (2026-11-03)

- Clarify reset-display copy, replace the search X with a neutral collapse chevron, and close the refresh convergence races: latest-revision tracking, deferred refresh during loads/optimistic writes, and forced reload on workspace return.

## 0.3.0-beta.32 (2026-11-02)

- Add the Host SSE revision stream: native-tool and HTTP commits publish the new revision; browser clients refetch and reconcile. Switching back to the groups workspace now always reloads the Host snapshot.

## 0.3.0-beta.31 (2026-11-02)

- Fix the native tool parameter schema: DSH tools support only a JSON-Schema subset without minimum; validate the schema against dsh-tools before packaging.

## 0.3.0-beta.30 (2026-11-02)

- Add the native session_groups_control Host tool and make it the AI path; HTTP/CLI remains browser-only because the Host browser-session fence rejects plugin bearer tokens.

## 0.3.0-beta.29 (2026-11-02)

- Lock the restored settings-page switches and live controlApi gate with contract tests; all five fields must be volatile and default off.

## 0.3.0-beta.28 (2026-11-02)

- Follow the univer plugin pattern: keep all config fields volatile, mount control routes persistently, gate them on live config refs, and always create the per-run token so toggling controlApi works without restarting DSH.

## 0.3.0-beta.27 (2026-11-02)

- Mark the five plugin Config fields volatile so the host config form is served, restoring the settings switches alongside the skill repair card.

## 0.3.0-beta.26 (2026-11-02)

- Restore the five config switches on the Plugins row page and keep the skill repair card below them; bind switches through the host config form.

## 0.3.0-beta.25 (2026-11-02)

- Load the plugin-manager client package so the Plugins-page skill repair slot can register; auto-install the managed skill on controlApi enable.

## 0.3.0-beta.24 (2026-11-02)

- Auto-install the managed control skill into <DSH_HOME>/skills when controlApi is enabled; add a fenced repair route and Plugins-page repair/verify button with managed-file safety.

## 0.3.0-beta.23 (2026-11-02)

- Fix host sidebar collapse: detect data-sidebar-collapsed, release the managed width override, suppress retries while in rail mode, and assert the rail is <=64px in A+.

## 0.3.0-beta.22 (2026-11-02)

- Add opt-in session inspect/rename/archive control endpoints with live-session and expected-state preconditions, CLI commands, and skill sequence guidance.

## 0.3.0-beta.21 (2026-11-02)

- Harden the plan/apply contract: group.create plan changes no longer expose a random id that apply would regenerate; callers read state after apply.

## 0.3.0-beta.20 (2026-11-02)

- Add strict root-to-leaf path resolution for AI control, reject control characters in group names, return 404/409/422 for missing/ambiguous/malformed paths, and keep writes ID-only.

## 0.3.0-beta.19 (2026-11-02)

- Harden control inputs: strict operation schemas, unknown-field rejection, typed index/parent/id checks, top-level field rejection, idempotencyKey type validation; no silent coercion or partial writes.

## 0.3.0-beta.18 (2026-11-02)

- Added a per-run local bearer token for the control API, a state/plan/apply CLI, and the bundled session-groups-control skill.

## 0.3.0-beta.17 (2026-11-02)

- Wired the opt-in AI control host adapter: state/plan/apply routes, revision CAS, planHash, idempotency keys, destructive second switch and audit logging.

## 0.3.0-beta.16 (2026-11-02)

- Moved menu anchor/clamp math and group-color CSS policy into src/core; viewport is injected so core has no globalThis dependency.

## 0.3.0-beta.15 (2026-11-02)

- Moved no-op group-position detection and group-header edge-zone geometry into src/core/group-drag.js; direct core tests now cover both.

## 0.3.0-beta.14 (2026-11-02)

- Split pure dialog rectangle math into src/core/dialog-geometry.js; the client keeps localStorage persistence and re-exports the math.
- Added direct core geometry boundary tests (334 total).

## 0.3.0-beta.13 (2026-11-02)

- Moved group drop resolution and dialog selection policy into src/core; client paths remain compatibility re-exports.

## 0.3.0-beta.12 (2026-11-02)

- Moved search index/reveal and virtual-list windowing into src/core; client modules remain compatibility re-exports.

## 0.3.0-beta.11 (2026-11-02)

- Moved visibility/archive/title policy into src/core/filter.js; src/client/filter.js is a compatibility re-export.

## 0.3.0-beta.10 (2026-11-02)

- Moved tree/status aggregation into src/core/tree.js; src/client/tree.js is a compatibility re-export.
- Tightened the core boundary scanner to ignore comments.

## 0.3.0-beta.9 (2026-11-02)

- Moved drag-and-drop policy into src/core/drag.js; the client path remains a one-line compatibility re-export.

## 0.3.0-beta.8 (2026-11-02)

- Extracted a pure core layer (session-row policy, layout arithmetic) with boundary tests, and moved the DSH runtime bridge into src/adapters.

## 0.3.0-beta.7 (2026-11-02)

- Raised light-theme contrast for the groups header and zero-count status buttons; added A+ contrast gates.

## 0.3.0-beta.6 (2026-11-02)

- Locale JSON files are now the packaged source of truth; the client bundle imports them instead of duplicating a 500-line JS dictionary.
- Locale host resolution, subscription and active-locale handling remain covered by the isolated A+ smoke.

## 0.3.0-beta.5 (2026-11-02)

- Fixed the React #300 crash when collapsing the host sidebar: stable handler hooks now run before the rail/error early returns.
- Fixed the undefined targetSessionId drag-over reference and localized drag labels.
- Fixed host locale resolution by reading snapshot.active, using the host translator, and subscribing to locale changes.

## 0.3.0-beta.4 (2026-11-02)

- Fixed 264px sidebar horizontal overflow by compacting the header status/action spacing at the existing data-narrow breakpoint.
- A+ smoke now includes the 264px overflow gate and passes with three status buttons.


## 0.3.0-beta.3 (2026-11-02)

- Dialog move-to-group now inserts sessions and groups at the target parent head instead of the tail; this keeps moved items visible above the session watermark.
- Added model and wiring regressions for the head insertion behavior.
- Added the A+ isolated web + Playwright smoke path; it refuses the real DSH home/port.
- Test suite: 325/325.

## 0.3.0-beta.2 (2026-11-02)

Hardening beta.

- Localized the remaining drag floating labels; English UI no longer shows Chinese “放入『…』/移出分组”.
- Added `npm run check:all` for all-file syntax checking plus the test suite.
- Added `scripts/qa/clean-profile.ps1`, which refuses the real `~/.dsh` and never deletes files.
- Updated docs and test counts (323 tests).

## 0.3.0-beta.1 (2026-11-02)

First public beta cut.

- Removed the background-job status button and its `ctx.jobs` watchers; the header is back to Running, Waiting for you and Unread only.
- Made the three status dropdowns use the opaque layer-1 surface used by the search field, so underlying rows no longer show through.
- Isolated the dialog layout probe behind the plugin-manager `debugProbe` switch and only mounted its route when enabled; it is off by default.
- Added a one-time first-run card explaining that groups only change display placement.
- Added an empty-state card with a direct “create first group” action.
- Added About/version scope text and Reset layout in view options; reset restores width, expansion and dialog geometry without touching group data.
- Added package author/keywords metadata, LICENSE and this changelog.
- Refreshed README, release notes and test summary.

## 0.2.55

- Added and then rolled back the experimental background-job status button and per-session `ctx.jobs` watchers.

## 0.2.54

- Stabilized ungrouped drag targets: invalid/self rows no longer bubble to the section top; body gaps resolve against visible row midpoints; body drops commit the resolved target.

## 0.2.53

- Fixed the React maximum-update-depth crash caused by scroll-probe dependencies.

## 0.2.52

- Decoupled the 5px thumb from the sidebar quiet-bar tokens so it no longer turns transparent after scrolling.

## 0.2.50

- Added the draggable 5px scrollbar to all dialog scroll surfaces.

## 0.2.49

- Fixed the menu stacking context that painted over dialog scrollbar overlays.

## 0.2.30

- Restored the compact pre-drag dialog geometry and sizing.














































