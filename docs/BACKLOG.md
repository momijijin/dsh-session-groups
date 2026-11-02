# Deferred backlog

## Render architecture (deferred, not implemented in 0.3.0-beta.1)

### R1 — Truly lazy collapsed groups

Current state:

- `GroupNode` does not mount a collapsed group's body DOM (`expanded ? body : null`).
- But the full tree is still built by `buildRenderTree`, and child `GroupNode`/`SessionRow` elements and drop slots are constructed before the `expanded` branch.

Desired:

- Collapsed groups keep only their header, visible count, status/color/collapse state and boundary drop metadata.
- Child rows are constructed only when expanded.
- Expanding a group builds that subtree on demand.

Acceptance:

- 10,000 collapsed descendants produce no child row DOM or child React elements.
- Group counts remain correct while collapsed.
- Collapse/expand preserves scroll and focus.

### R2 — Flattened virtual tree with a viewport cap

Desired:

- Replace the nested grouped-tree DOM with one flat visible-row list (group headers, sessions, overflow rows, empty rows, drop slots).
- Virtualize that list in the single `.dsg-tree` scroller.
- Render at most visible rows + 3× viewport rows above + 3× viewport rows below, i.e. up to `7N` rows.
- Collapsed groups contribute no child rows.

Must preserve:

- Drag/drop including edge auto-scroll and group slots.
- Search reveal to rows outside the window.
- Keyboard focus/navigation across window changes.
- Session watermark/"show more" state.
- ARIA tree semantics.
- Scroll position stability when rows mount/unmount.

Acceptance:

- 10,000 expanded rows: DOM row count ≤ `7N`.
- Top/bottom spacers keep scroll height stable.
- Drag/search/keyboard tests pass with a far-away target.
- Performance measured, not asserted.

Status: deferred after 0.3.0-beta.1; do not implement without a dedicated render-architecture pass.
