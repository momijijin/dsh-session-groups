# Changelog

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
