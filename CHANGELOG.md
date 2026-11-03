# Changelog

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































