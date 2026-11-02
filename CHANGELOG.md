# Changelog

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













