/**
 * Plugin stylesheet. Injected once into the host document when the groups view
 * mounts; removed by the plugin lifecycle (`ctx.effect` returns the disposer).
 * Uses DSH theme variables with light/dark-safe fallbacks.
 *
 * Typography + spacing contract (V1.1 patch 0.2.2): this plugin has **no
 * font-size setting and no typography config**. The host sidebar base is
 * authoritative: the official DSH 2.0.18 sidebar root sets `font-size: 14px`
 * and the official workspace rows inherit that font-family. `.dsg-root`
 * therefore inherits family/size and only pins the official metrics with the
 * theme tokens (verified in `dsh-client-ui-theme` 2.0.18:
 * `--dsw-font-s-14-font-size`, `--dsw-font-xs-13-font-size`,
 * `--dsw-font-xxs-12-font-size`, `--dsw-font-xxxs-11-font-size`) plus px
 * fallbacks for older hosts.
 *
 * Spacing follows the official `dsh-client-ui-workspace` 2.0.18 chrome: rows
 * are `height 34/32` with `padding: 0 8px` and `gap: 6px`; the section header
 * is a single 36px row (28px controls + official 36px rhythm) with an optional
 * 30px search row below it; tree rows breathe at a 2px vertical gap; group
 * guides sit at the parent caret tip (x=16) as a 2px line with 4px content
 * padding (still 20px of indent per level); menus/dialogs use 30px items /
 * 16px padding. 0.2.6 adds the six-color group palette and selection-dialog
 * footer styling.
 *
 * Surfaces are theme-aware (0.2.2): menus/dropdowns use the official menu
 * surface token (`--dsw-specific-menu`), dialogs use `--dsw-alias-bg-layer-2`,
 * inputs use `--dsw-alias-bg-layer-1`, and borders use the `--dsw-alias-border-l2/
 * l3/l4` hairlines. No surface hard-codes `#fff`, so `body[data-ds-dark-theme]`
 * keeps high-contrast text on dark surfaces.
 */

/** Style-element id used to keep exactly one copy per page. */
export const STYLE_ID = 'dsh-session-groups/css'

export const CSS = `
.dsg-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  /* No plugin font setting exists: consume the host's inherited font/size. */
  font-size: inherit;
  font-family: inherit;
  line-height: 1.4;
  color: var(--dsw-alias-label-primary, CanvasText);
  /* Fixed sizes below come from the official theme tokens (px fallback). */
  --dsg-font-14: var(--dsw-font-s-14-font-size, 14px);
  --dsg-font-13: var(--dsw-font-xs-13-font-size, 13px);
  --dsg-font-12: var(--dsw-font-xxs-12-font-size, 12px);
  --dsg-font-11: var(--dsw-font-xxxs-11-font-size, 11px);
  --dsg-font-10: 10px;
  /* 0.2.6 preset group palette: theme token first, readable hex fallback last. */
  --dsg-color-blue: var(--dsw-alias-state-business-primary, #4d6bfe);
  --dsg-color-green: var(--dsw-alias-state-success, #2da44e);
  --dsg-color-orange: var(--dsw-alias-state-warning, #d29922);
  --dsg-color-red: var(--dsw-alias-state-danger, #f85149);
  --dsg-color-purple: var(--dsw-alias-state-purple, #8250df);
  --dsg-color-gray: var(--dsw-alias-label-tertiary, #6e7781);
  --dsg-color-teal: #14b8a6;
  --dsg-color-pink: #ec4899;
  --dsg-color-brown: #8b5e34;
  --dsg-color-cyan: #0891b2;
  --dsg-color-navy: #1e40af;
  --dsg-color-magenta: #d946ef;
}
/* Form controls do not inherit the host font family by default. */
.dsg-root button, .dsg-root input { font-family: inherit; }
/* Watchdog for plugin-level (non-chrome) widgets. */
.dsg-root .dsg-header-search-row { min-width: 0; }
.dsg-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Official section-header rhythm: 28px controls inside a 36px row band
   * (4px top + 4px bottom); the optional search row adds 8px + 30px. */
  padding: 4px 8px;
  flex: none;
  min-width: 0;
}
.dsg-header-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 28px;
}
.dsg-header-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--dsg-font-14, 14px);
  line-height: 20px;
  /* Match the shipped workspace section label: neutral, no plugin accent. */
  font-weight: 400;
  color: var(--dsw-alias-label-secondary, CanvasText);
  white-space: nowrap;
}
.dsg-header-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsg-header-actions { display: inline-flex; align-items: center; gap: 4px; flex: none; }
/* Status counters sit left of the view controls, with one empty 28px button of
 * separation to prevent accidental view switches. */
.dsg-status-actions { display: inline-flex; align-items: center; gap: 2px; margin-right: 28px; flex: none; }
.dsg-status-action-wrap { position: relative; display: inline-flex; flex: none; }
.dsg-status-action {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  box-sizing: border-box;
  min-width: 28px;
  height: 28px;
  padding: 0 5px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, CanvasText);
  cursor: pointer;
  font: inherit;
}
.dsg-status-action:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 10%, transparent)); color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-status-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, CanvasText); outline-offset: -2px; }
.dsg-status-action[data-count="0"] { color: var(--dsw-alias-label-secondary, color-mix(in srgb, CanvasText 75%, transparent)); }
.dsg-status-action[data-count="0"] .dsg-status-action-count { color: var(--dsw-alias-label-caption, color-mix(in srgb, CanvasText 55%, transparent)); }
.dsg-status-action-icon { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.dsg-status-action-count { min-width: 8px; font-size: var(--dsg-font-11, 11px); line-height: 16px; text-align: center; font-variant-numeric: tabular-nums; }
/* 264px sidebar: remove the intentional blank separator and compact the
 * counters so the title and all view controls fit without horizontal scroll. */
.dsg-root[data-narrow="true"] .dsg-header-actions { gap: 2px; }
.dsg-root[data-narrow="true"] .dsg-status-actions { margin-right: 0; gap: 1px; }
.dsg-root[data-narrow="true"] .dsg-status-action { min-width: 26px; padding: 0 2px; gap: 1px; }
/* Optional second row: the existing SearchBox (30px) under the title row. */
.dsg-header-search-row { align-items: center; gap: 4px; height: 30px; }
.dsg-search { position: relative; display: flex; flex: 1 1 auto; min-width: 0; }
.dsg-search-input {
  width: 100%;
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  padding: 0 8px;
  font-size: var(--dsg-font-13, 13px);
  line-height: 18px;
  color: var(--dsw-alias-label-primary, CanvasText);
  background: var(--dsw-alias-bg-layer-1, Canvas);
  border: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, CanvasText 22%, transparent));
  border-radius: var(--dsw-radius-sm, 6px);
  outline: none;
}
.dsg-search-input::placeholder { color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-search-input:focus { border-color: var(--dsw-alias-state-business-primary, #4d6bfe); }
.dsg-search-results {
  position: absolute;
  z-index: 65;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: var(--dsw-radius-md, 8px);
  /* Official menu/popover material: theme-aware in light and dark. */
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, Canvas));
  color: var(--dsw-alias-label-primary, CanvasText);
  border: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 18%, transparent));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.18));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
}
.dsg-search-result { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 10px; border-radius: 5px; cursor: pointer; color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-search-result[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)); }
.dsg-search-result[data-archived="true"] { opacity: .55; cursor: not-allowed; }
.dsg-search-result-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-14, 14px); line-height: 20px; color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-search-result-meta { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-12, 12px); line-height: 20px; color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-search-result-badge { flex: none; font-size: var(--dsg-font-10, 10px); line-height: 16px; padding: 0 5px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)); color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-search-empty { padding: 8px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-label-secondary, CanvasText); text-align: center; }
.dsg-resize-handle {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 6px;
  z-index: 30;
  cursor: col-resize;
  touch-action: none;
  background: transparent;
  border: none;
  padding: 0;
  outline: none;
}
.dsg-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background .12s ease, opacity .12s ease;
}
.dsg-resize-handle:hover::after,
.dsg-resize-handle[data-dragging="true"]::after { background: var(--dsw-alias-state-business-primary, #4d6bfe); opacity: .6; }
.dsg-resize-handle:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); outline-offset: -2px; }
.dsg-icon-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, CanvasText);
  cursor: pointer;
  flex: none;
}
.dsg-icon-button:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 10%, transparent)); color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-icon-button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, CanvasText); outline-offset: -2px; }
.dsg-icon-button[aria-expanded="true"] { color: var(--dsw-alias-state-business-primary, CanvasText); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, CanvasText) 14%, transparent); }
.dsg-text-button {
  appearance: none;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));
  background: transparent;
  color: var(--dsw-alias-label-secondary, CanvasText);
  border-radius: var(--dsw-radius-sm, 6px);
  height: 28px;
  padding: 0 8px;
  font-size: var(--dsg-font-13, 13px);
  line-height: 20px;
  cursor: pointer;
  flex: none;
}
.dsg-text-button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
/* 0.2.13: match the official workspace top rhythm: a 36px section header,
 * 4px header bottom, and 6px before the first group row instead of 2px. */
/* 0.2.17: symmetric top-level inset so group/session rows never touch the
 * right frame (left and right both 8px; header matches). */
.dsg-tree { display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; overflow-y: auto; padding: 6px 8px 8px; /* Inserting the placeholder must push the following rows down instead of scroll-anchoring them back into place. */ overflow-anchor: none; }
.dsg-group-row, .dsg-session-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  cursor: pointer;
  user-select: none;
}
.dsg-group-row { height: 34px; padding: 0 8px; font-weight: 500; }
/* 0.2.6 palette: the chosen color lives on the row and colors the icon plus the
 * child guide line (accent marker); unknown/missing color falls back to blue. */
.dsg-group[data-color="blue"] { --dsg-group-color: var(--dsg-color-blue); }
.dsg-group[data-color="green"] { --dsg-group-color: var(--dsg-color-green); }
.dsg-group[data-color="orange"] { --dsg-group-color: var(--dsg-color-orange); }
.dsg-group[data-color="red"] { --dsg-group-color: var(--dsg-color-red); }
.dsg-group[data-color="purple"] { --dsg-group-color: var(--dsg-color-purple); }
.dsg-group[data-color="gray"] { --dsg-group-color: var(--dsg-color-gray); }
.dsg-group[data-color="teal"] { --dsg-group-color: var(--dsg-color-teal); }
.dsg-group[data-color="pink"] { --dsg-group-color: var(--dsg-color-pink); }
.dsg-group[data-color="brown"] { --dsg-group-color: var(--dsg-color-brown); }
.dsg-group[data-color="cyan"] { --dsg-group-color: var(--dsg-color-cyan); }
.dsg-group[data-color="navy"] { --dsg-group-color: var(--dsg-color-navy); }
.dsg-group[data-color="magenta"] { --dsg-group-color: var(--dsg-color-magenta); }
.dsg-group-row:hover, .dsg-session-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); }
.dsg-group-row[data-drop-active="true"] { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.14)); }
.dsg-group-row[draggable="true"] { cursor: grab; }
.dsg-group-row[data-dragging="true"] { opacity: .55; }
.dsg-group-row[data-drop-forbidden="true"] { background: var(--dsw-alias-state-danger-fade, rgba(248,81,73,.14)); cursor: no-drop; }
/* Child-group body slots: always n+1 per expanded group, never between sessions. */
.dsg-group-drop-slot {
  position: relative;
  flex: none;
  height: 6px;
  margin: 0 2px;
  border-radius: 3px;
  transition: background .1s ease, height .1s ease;
}
.dsg-group-drop-slot:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
/* Active child slot expands from the 6px hit area to a full 34px group-row
 * placeholder so the surrounding child groups physically separate. */
.dsg-group-drop-slot[data-drop-active="true"] {
  height: 34px;
  background: transparent;
  padding: 0;
}
.dsg-group-drop-slot[data-drop-forbidden="true"] { background: var(--dsw-alias-state-danger-fade, rgba(248,81,73,.2)); cursor: no-drop; }
.dsg-group-line[data-empty="true"] .dsg-group-drop-slot { height: 12px; }
.dsg-group-line[data-empty="true"] .dsg-group-drop-slot[data-drop-active="true"] { height: 34px; }
.dsg-group-caret { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary, CanvasText); flex: none; }
/* 0.2.7 color hierarchy: group icon 100%, caret 85%, child guide 60%. The
 * custom property is set inline by GroupNode (colorHex wins over palette). */
.dsg-group > .dsg-group-row .dsg-group-caret { color: var(--dsg-group-color, var(--dsw-alias-label-tertiary, CanvasText)); opacity: .85; }
.dsg-group-icon { color: var(--dsg-group-color, var(--dsw-alias-label-secondary, CanvasText)); display: inline-flex; flex: none; }
.dsg-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-14, 14px); line-height: 20px; }
/* Count is always visible at the far right: row padding-right (8px) is the
 * right edge. Tabular 12/16 keeps two- and three-digit counts stable. */
.dsg-group-count { flex: none; min-width: 16px; text-align: right; font-size: var(--dsg-font-12, 12px); line-height: 16px; color: var(--dsw-alias-label-tertiary, CanvasText); font-variant-numeric: tabular-nums; }
.dsg-group-actions, .dsg-session-actions { display: inline-flex; align-items: center; gap: 4px; flex: none; opacity: 0; pointer-events: none; transition: opacity .12s ease; }
.dsg-group-row:hover .dsg-group-actions, .dsg-group-row:focus-within .dsg-group-actions,
.dsg-session-row:hover .dsg-session-actions, .dsg-session-row:focus-within .dsg-session-actions { opacity: 1; pointer-events: auto; }
/* Keyboard focus ring on both row types (the row itself is tabbable). */
.dsg-group-row:focus-visible, .dsg-session-row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, CanvasText); outline-offset: -2px; }
/* 0.2.6: row actions match the 28x28 header buttons (16px glyph, 4px gap) so the
 * hover hit area is finger/mouse safe; row heights stay 34/32. */
.dsg-group-actions .dsg-icon-button, .dsg-session-actions .dsg-icon-button { width: 28px; height: 28px; }
.dsg-group-body { display: flex; flex-direction: column; gap: 2px; }
/* 0.2.7 unified indent guide (groups + ungrouped): content starts at 20px
 * (16px rail + 4px content padding), the 2px line is centered at x=16 and
 * inset 2px from the body's top/bottom. The group variant is color-mixed at
 * 60%; the ungrouped inbox uses label-tertiary at 45%. Pseudo-element means the
 * guide spans sessions, child groups, placeholders and virtual spacers without
 * consuming layout width; collapsed groups render no body and therefore no line. */
.dsg-group-line {
  position: relative;
  margin-left: 16px;
  padding-left: 4px;
  border-left: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 24px;
}
.dsg-group-line::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 2px;
  bottom: 2px;
  width: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-border-l2, rgba(128,128,128,.28));
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #6e7781) 45%, transparent);
}
.dsg-group > .dsg-group-body > .dsg-group-line::before {
  background: var(--dsg-group-color, var(--dsw-alias-border-l2, rgba(128,128,128,.28)));
  background: color-mix(in srgb, var(--dsg-group-color, var(--dsw-alias-label-tertiary, #6e7781)) 60%, transparent);
}
/* Windowed ungrouped rows: only the visible slice + overscan is in the DOM;
 * the 2px gaps stay identical to a full list (top/bottom spacers preserve the
 * exact scroll height, see virtual-list.js). */
.dsg-virtual-list { gap: 2px; }
.dsg-virtual-spacer { flex: none; width: 100%; pointer-events: none; }
.dsg-group-line[data-empty="true"] { min-height: 24px; }
/* 0.2.8 empty-group / empty-ungrouped drop box: the same 32px dashed surface
 * as DropPlaceholder, centered with a 14px plus glyph and a 12px label. The
 * surrounding body owns drop handlers; the box only reflects the drop state. */
.dsg-empty-dropbox {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  padding: 0 8px;
  border: 1px dashed var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 28%, transparent));
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, CanvasText) 6%, transparent);
  color: var(--dsw-alias-label-tertiary, CanvasText);
  font-size: var(--dsg-font-12, 12px);
  line-height: 16px;
  overflow: hidden;
}
.dsg-empty-dropbox[data-drop-active="true"] {
  border-color: var(--dsw-alias-state-business-primary, #4d6bfe);
  background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.16));
  color: var(--dsw-alias-state-business-primary, #4d6bfe);
}
.dsg-empty-dropbox-plus { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex: none; }
.dsg-empty-dropbox-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsg-session-row { height: 32px; padding: 0 8px; }
.dsg-session-row[data-current="true"] { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.16)); box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary, #4d6bfe); }
.dsg-session-row[data-current="true"] .dsg-session-title { color: var(--dsw-alias-state-business-primary, #4d6bfe); font-weight: 500; }
.dsg-session-row[data-archived="true"] { opacity: .62; }
/* Search reveal highlight (1.5 s, class removed by the component timer). */
.dsg-session-row.dsg-search-hit { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.3)); animation: dsg-search-hit 1.5s ease-out; }
@keyframes dsg-search-hit {
  0% { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.5)); }
  100% { background: transparent; }
}
/* 0.2.8 official session status cell: an always-present 16x20 leading slot.
 * Idle paints nothing (no transparent dot); ongoing is the official 14px
 * spinner; warning/done are 10px dots with a 6px currentColor core. */
.dsg-session-status {
  box-sizing: border-box;
  width: 16px;
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  color: var(--dsw-alias-label-tertiary, CanvasText);
}
.dsg-status-dot { position: relative; width: 10px; height: 10px; flex: none; }
.dsg-status-dot::after {
  content: '';
  position: absolute;
  inset: 20%;
  border-radius: 50%;
  background: currentColor;
}
.dsg-status-dot[data-state="warning"] { color: var(--dsw-alias-state-warn-primary, #d29922); }
.dsg-status-dot[data-state="done"] { color: var(--dsw-alias-state-success-primary, #2da44e); }
.dsg-status-spinner { flex: none; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-status-spinner-motion { transform-origin: center; animation: dsg-state-dot-spin 1.5s linear infinite; }
.dsg-status-spinner-track, .dsg-status-spinner-arc { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.dsg-status-spinner-track { opacity: .25; }
.dsg-status-spinner-arc { stroke-dasharray: 12 150; animation: dsg-state-dot-dash 1.5s ease-in-out infinite; }
@keyframes dsg-state-dot-spin { to { transform: rotate(360deg); } }
@keyframes dsg-state-dot-dash {
  0% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }
  50% { stroke-dasharray: 24 150; stroke-dashoffset: -6; }
  100% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .dsg-status-spinner-motion, .dsg-status-spinner-arc { animation: none; }
  .dsg-status-spinner-arc { stroke-dasharray: 18 150; stroke-dashoffset: -3; }
}
.dsg-visually-hidden { clip: rect(0 0 0 0); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden; }
.dsg-session-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-14, 14px); line-height: 20px; }
.dsg-session-badge { flex: none; font-size: var(--dsg-font-10, 10px); line-height: 16px; padding: 0 5px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-workspace-badge { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-12, 12px); color: var(--dsw-alias-label-tertiary, CanvasText); opacity: 0; transition: opacity .12s ease; }
.dsg-session-row:hover .dsg-workspace-badge, .dsg-session-row:focus-within .dsg-workspace-badge { opacity: 1; }
/* 0.2.8 far-right trailing cell: official 10/16 tabular time (40px minimum so
 * relative strings align); a pending primary status swaps the time for the
 * official compact label (待审批 / 计划待审 / 待回答). Omitted when the host
 * timestamp is missing/invalid and no compact label applies. */
.dsg-session-time { flex: none; min-width: 40px; text-align: right; font-size: var(--dsg-font-10, 10px); line-height: 16px; color: var(--dsw-alias-label-tertiary, CanvasText); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* At the 264px minimum the workspace badge yields its space to title/actions/
 * time. Gating on the applied sidebar width (not the viewport) avoids a
 * container-query containing block, which would trap fixed dialogs/backdrops
 * inside the sidebar. */
.dsg-root[data-narrow="true"] .dsg-workspace-badge { display: none; }
.dsg-ungrouped { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; border-radius: var(--dsw-radius-sm, 6px); }
.dsg-ungrouped-header { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px; color: var(--dsw-alias-label-secondary, CanvasText); font-size: var(--dsg-font-14, 14px); line-height: 20px; font-weight: 400; }
.dsg-ungrouped-header[data-drop-active="true"] { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.14)); }
.dsg-ungrouped-count { font-size: var(--dsg-font-12, 12px); font-weight: 400; color: var(--dsw-alias-label-tertiary, CanvasText); }
/* Drag insertion placeholder (0.2.4): a real row-height gap, not a 2px line.
 * The height follows the target row (32 session / 34 group) via the inline
 * --dsg-drop-height custom property; accent surface/border is theme-aware. */
.dsg-drop-placeholder {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  height: var(--dsg-drop-height, 32px);
  margin: 1px 0;
  border: 1px dashed var(--dsw-alias-state-business-primary, #4d6bfe);
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.16));
  color: var(--dsw-alias-state-business-primary, #4d6bfe);
  font-size: var(--dsg-font-12, 12px);
  line-height: 16px;
  font-weight: 500;
  overflow: hidden;
  pointer-events: auto;
  animation: dsg-drop-placeholder-in .12s ease-out;
}
.dsg-drop-placeholder-label {
  max-width: 100%;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsg-group-drop-slot .dsg-drop-placeholder { margin: 0; height: 34px; }
@keyframes dsg-drop-placeholder-in {
  from { opacity: 0; transform: scaleY(.65); }
  to { opacity: 1; transform: none; }
}
.dsg-floating-label { position: fixed; z-index: 60; pointer-events: none; transform: translate(12px, 10px); padding: 2px 8px; border-radius: 999px; font-size: var(--dsg-font-12, 12px); color: var(--dsw-alias-label-inverse, Canvas); background: var(--dsw-alias-state-business-primary, #4d6bfe); box-shadow: 0 2px 8px rgba(0,0,0,.18); }
.dsg-drag-ghost { opacity: .65; }
.dsg-empty { padding: 8px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-label-tertiary, CanvasText); text-align: center; }
.dsg-banner { margin: 6px 2px 8px; padding: 8px 10px; border-radius: 6px; font-size: var(--dsg-font-12, 12px); display: flex; gap: 6px; align-items: center; }
.dsg-banner[data-kind="warning"] { background: var(--dsw-alias-state-warning-fade, rgba(210,153,34,.14)); color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-banner[data-kind="error"] { background: var(--dsw-alias-state-danger-fade, rgba(248,81,73,.14)); color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-banner-text { flex: 1; min-width: 0; }
/* Menus/dropdowns share the official translucent menu surface token. */
.dsg-menu { position: fixed; z-index: 70; min-width: 160px; padding: 6px; border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, Canvas)); color: var(--dsw-alias-label-primary, CanvasText); border: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, CanvasText 18%, transparent)); box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.18)); backdrop-filter: var(--dsw-menu-backdrop-filter, none); display: flex; flex-direction: column; gap: 2px; max-height: 60vh; overflow-y: auto; }
.dsg-menu-item { appearance: none; border: none; background: transparent; text-align: left; font-size: var(--dsg-font-13, 13px); line-height: 20px; color: var(--dsw-alias-label-primary, CanvasText); height: 30px; padding: 0 10px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
.dsg-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)); }
.dsg-menu-item:disabled { opacity: .45; cursor: default; }
.dsg-menu-separator { height: 1px; margin: 3px 2px; background: var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 15%, transparent)); }
.dsg-menu-section { padding: 6px 10px 2px; font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-label-secondary, CanvasText); }
/* View-options popover: anchored under the 28px header icon button. */
.dsg-view-options { position: relative; display: inline-flex; flex: none; }
.dsg-view-options-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 72;
  min-width: 200px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, Canvas));
  color: var(--dsw-alias-label-primary, CanvasText);
  border: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 18%, transparent));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.18));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
}
.dsg-view-option { width: 100%; height: 30px; }
.dsg-view-option[data-active="true"] { color: var(--dsw-alias-label-primary, CanvasText); background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)); }
.dsg-view-option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsg-view-option-check { display: inline-flex; flex: none; width: 16px; height: 16px; align-items: center; justify-content: center; color: var(--dsw-alias-state-business-primary, CanvasText); }
.dsg-view-options-divider { height: 0; margin: 4px 6px; border-top: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 16%, transparent)); }
.dsg-view-options-about { display: flex; flex-direction: column; gap: 1px; padding: 5px 8px 2px; font-size: var(--dsg-font-11, 11px); line-height: 16px; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-view-options-version { color: var(--dsw-alias-label-secondary, CanvasText); font-variant-numeric: tabular-nums; }
.dsg-view-options-scope { overflow-wrap: anywhere; }
.dsg-onboarding {
  flex: none;
  margin: 4px 8px 8px;
  padding: 11px 12px;
  border: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, CanvasText 20%, transparent));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
}
.dsg-onboarding-title { font-size: var(--dsg-font-13, 13px); line-height: 18px; font-weight: 600; }
.dsg-onboarding-body { margin-top: 3px; font-size: var(--dsg-font-12, 12px); line-height: 17px; color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-onboarding-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; }
.dsg-empty-state { flex: none; margin: 12px 8px; padding: 12px; border: 0.5px dashed var(--dsw-alias-border-l3, color-mix(in srgb, CanvasText 20%, transparent)); border-radius: var(--dsw-radius-md, 8px); color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-empty-state-title { font-size: var(--dsg-font-13, 13px); line-height: 18px; color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-empty-state-body { margin: 3px 0 8px; font-size: var(--dsg-font-12, 12px); line-height: 17px; }

/* Running-sessions action: spinner + count as one 28px-high button. */
.dsg-running { position: relative; display: inline-flex; flex: none; }
.dsg-running-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, CanvasText);
  cursor: pointer;
  font: inherit;
}
.dsg-running-button:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 10%, transparent)); color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-running-button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, CanvasText); outline-offset: -2px; }
.dsg-running-button[data-count="0"] { color: var(--dsw-alias-label-caption, color-mix(in srgb, CanvasText 55%, transparent)); }
.dsg-running-spinner { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.dsg-running-count { min-width: 8px; font-size: var(--dsg-font-12, 12px); line-height: 16px; text-align: center; font-variant-numeric: tabular-nums; }
.dsg-running-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 72;
  width: 248px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-1, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  border: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 18%, transparent));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.18));
}
.dsg-running-section + .dsg-running-section { margin-top: 4px; border-top: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 15%, transparent)); padding-top: 4px; }
.dsg-running-group-label { padding: 6px 8px 3px; font-size: var(--dsg-font-11, 11px); line-height: 16px; color: var(--dsw-alias-label-tertiary, CanvasText); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsg-running-item { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 28px; padding: 3px 8px; border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-primary, CanvasText); text-align: left; cursor: pointer; font: inherit; }
.dsg-running-item:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)); }
.dsg-running-item-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-13, 13px); line-height: 18px; }
.dsg-running-item-archived { flex: none; font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-running-empty { padding: 10px 8px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-dialog-backdrop { position: fixed; inset: 0; z-index: 80; background: var(--dsw-alias-bg-mask-1, color-mix(in srgb, CanvasText 32%, transparent)); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.dsg-dialog {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  width: min(360px, calc(100vw - 32px));
  max-height: 85vh;
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-layer-2, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  border: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 18%, transparent));
  padding: 16px;
  box-shadow: var(--dsw-elevation-prominent, 0 16px 48px rgba(0,0,0,.28));
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}
.dsg-dialog[data-kind="icon"] { width: min(420px, calc(100vw - 32px)); }
.dsg-dialog[data-positioned="true"] { transform: none; max-width: none; max-height: none; }
.dsg-dialog-titlebar { flex: none; display: flex; align-items: center; min-height: 20px; cursor: move; user-select: none; touch-action: none; }
.dsg-dialog-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-14, 14px); line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary, CanvasText); pointer-events: none; }
.dsg-dialog-content { flex: 0 0 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 0; }
.dsg-dialog[data-positioned="true"] .dsg-dialog-content { flex: 1 1 auto; }
.dsg-dialog > .dsg-scroll-area { flex: 0 0 auto; }
.dsg-dialog[data-positioned="true"] > .dsg-scroll-area { flex: 1 1 auto; min-height: 0; }
.dsg-scroll-area { position: relative; display: flex; flex-direction: column; min-height: 0; isolation: isolate; }
.dsg-scroll-rail { position: absolute; top: 6px; right: 2px; bottom: 6px; width: 5px; z-index: 20; pointer-events: none; }
.dsg-scroll-thumb { position: absolute; left: 0; width: 5px; border-radius: 999px; background: var(--dsw-alias-scrollbar-bg-l2, color-mix(in srgb, CanvasText 22%, transparent)); opacity: .9; pointer-events: auto; cursor: default; touch-action: none; }
.dsg-scroll-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l2, color-mix(in srgb, CanvasText 32%, transparent)); opacity: 1; }
.dsg-dialog-content, .dsg-dialog-list, .dsg-icon-sections { scrollbar-width: none; -ms-overflow-style: none; }
.dsg-dialog-content::-webkit-scrollbar, .dsg-dialog-list::-webkit-scrollbar, .dsg-icon-sections::-webkit-scrollbar { width: 0; height: 0; display: none; }
.dsg-dialog-body { font-size: var(--dsg-font-13, 13px); line-height: 20px; color: var(--dsw-alias-label-secondary, CanvasText); white-space: pre-wrap; }
.dsg-dialog-input { flex: none; width: 100%; box-sizing: border-box; height: 32px; min-height: 32px; padding: 0 10px; font-size: var(--dsg-font-13, 13px); line-height: 18px; border-radius: 6px; border: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, CanvasText 22%, transparent)); background: var(--dsw-alias-bg-layer-1, Canvas); color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-dialog-input::placeholder { color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-dialog-input:focus { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe)); outline-offset: -1px; }
.dsg-dialog-error { font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-state-error-primary, #f85149); }
.dsg-dialog-actions { flex: none; display: flex; justify-content: flex-end; gap: 10px; padding: 0; }
.dsg-dialog-resizer { position: absolute; z-index: 3; touch-action: none; }
.dsg-dialog-resizer[data-dir="n"] { top: -3px; left: 12px; right: 12px; height: 8px; cursor: ns-resize; }
.dsg-dialog-resizer[data-dir="s"] { bottom: -3px; left: 12px; right: 12px; height: 8px; cursor: ns-resize; }
.dsg-dialog-resizer[data-dir="e"] { right: -3px; top: 12px; bottom: 12px; width: 8px; cursor: ew-resize; }
.dsg-dialog-resizer[data-dir="w"] { left: -3px; top: 12px; bottom: 12px; width: 8px; cursor: ew-resize; }
.dsg-dialog-resizer[data-dir="ne"] { right: -3px; top: -3px; width: 14px; height: 14px; cursor: nesw-resize; }
.dsg-dialog-resizer[data-dir="nw"] { left: -3px; top: -3px; width: 14px; height: 14px; cursor: nwse-resize; }
.dsg-dialog-resizer[data-dir="se"] { right: 0; bottom: 0; width: 20px; height: 20px; cursor: nwse-resize; }
.dsg-dialog-resizer[data-dir="se"]::after { content: ''; position: absolute; right: 7px; bottom: 7px; width: 7px; height: 7px; border-right: 1.5px solid var(--dsw-alias-label-tertiary, CanvasText); border-bottom: 1.5px solid var(--dsw-alias-label-tertiary, CanvasText); border-radius: 0 0 2px 0; opacity: .55; pointer-events: none; }
.dsg-dialog-resizer[data-dir="se"]:hover::after { opacity: .95; }
.dsg-dialog-resizer[data-dir="sw"] { left: -3px; bottom: -3px; width: 14px; height: 14px; cursor: nesw-resize; }
.dsg-dialog-confirm { appearance: none; border: none; height: 32px; padding: 0 16px; border-radius: 6px; font-size: var(--dsg-font-13, 13px); line-height: 20px; cursor: pointer; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-state-business-primary, #4d6bfe)); color: var(--dsw-alias-label-primary-foreground, Canvas); }
.dsg-dialog-confirm[data-variant="danger"] { background: var(--dsw-alias-state-error-primary, #f85149); }
.dsg-dialog-confirm:disabled { opacity: .4; cursor: not-allowed; }
.dsg-dialog-confirm:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, var(--dsw-alias-state-business-primary, #4d6bfe))); }
.dsg-dialog-confirm[data-variant="danger"]:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary, #f85149); }
.dsg-dialog-cancel { appearance: none; height: 32px; padding: 0 16px; border-radius: 6px; border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35)); background: transparent; color: var(--dsw-alias-label-primary, CanvasText); font-size: var(--dsg-font-13, 13px); line-height: 20px; cursor: pointer; }
.dsg-dialog-cancel:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)); }
.dsg-dialog-confirm:focus-visible, .dsg-dialog-cancel:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe)); outline-offset: 2px; }
/* 0.2.6 selection dialogs (icon / move-to / new-session / group-color): options
 * only highlight; the shared footer owns Confirm/Cancel. */
.dsg-dialog-list {
  position: static;
  /* .dsg-menu normally carries z-index:70 for fixed menus. As a flex item in
   * ScrollArea it would otherwise paint over the thin rail/thumb. */
  z-index: auto;
  max-height: 300px;
  padding: 8px;
  gap: 4px;
  box-shadow: none;
  background: var(--dsw-alias-bg-layer-1, Canvas);
}
.dsg-dialog-option { width: 100%; min-height: 36px; height: auto; padding: 6px 12px; gap: 8px; transition: background .12s ease, color .12s ease; }
.dsg-dialog-group-separator { flex: none; height: 0; margin: 6px 4px; border-top: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 18%, transparent)); }
.dsg-dialog-option:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)); }
.dsg-dialog-option[data-selected="true"],
.dsg-dialog-option[aria-selected="true"],
.dsg-dialog-option[aria-checked="true"] {
  background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)));
  color: var(--dsw-alias-label-primary, CanvasText);
}
.dsg-dialog-option[data-selected="true"]:hover,
.dsg-dialog-option[aria-selected="true"]:hover,
.dsg-dialog-option[aria-checked="true"]:hover {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent));
}
.dsg-dialog-option:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4d6bfe)); outline-offset: -1px; }
.dsg-dialog-option-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsg-dialog-option-check { display: inline-flex; flex: none; width: 16px; height: 16px; align-items: center; justify-content: center; color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-dialog-icon-grid {
  position: static;
  flex-direction: row;
  flex-wrap: wrap;
  box-shadow: none;
}
/* 0.2.12: more common glyphs; a slightly wider 4-column icon picker. */
.dsg-icon-option { width: auto; flex: 1 1 88px; min-height: 36px; }
.dsg-icon-sections { box-sizing: border-box; display: flex; flex-direction: column; gap: 0; max-height: min(56vh, 430px); overflow-y: auto; padding: 8px; border: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, CanvasText 18%, transparent)); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1, Canvas); }
.dsg-icon-section { padding: 0; }
.dsg-icon-section + .dsg-icon-section { border-top: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 18%, transparent)); margin-top: 8px; padding-top: 8px; }
.dsg-icon-section-title { padding: 2px 4px 4px; font-size: var(--dsg-font-11, 11px); line-height: 16px; font-weight: 500; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-icon-section .dsg-dialog-icon-grid { max-height: none; overflow: visible; padding: 0; border: 0; box-shadow: none; background: transparent; }
/* Official workspace-style overflow row: quiet left-aligned 12px text, no
 * background until hover, 28px row height. */
.dsg-session-overflow { box-sizing: border-box; width: 100%; height: 28px; padding: 0 12px 0 28px; border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-tertiary, CanvasText); font-family: inherit; font-size: var(--dsg-font-12, 12px); line-height: 16px; text-align: left; cursor: pointer; }
.dsg-session-overflow:hover { color: var(--dsw-alias-label-secondary, CanvasText); background: transparent; }
.dsg-session-overflow:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); outline-offset: -2px; }
/* 0.2.7 color dialog: six presets in a fixed 3x2 grid with 32px cells, plus a
 * custom native-swatch/hex row. Every cell reserves a 16px check slot (hidden,
 * not removed) so labels do not shift between selected/unselected states. */
.dsg-color-grid { box-sizing: border-box; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; padding: 8px; border: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, CanvasText 18%, transparent)); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1, Canvas); }
.dsg-color-option {
  appearance: none;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));
  background: transparent;
  color: var(--dsw-alias-label-primary, CanvasText);
  font-size: var(--dsg-font-13, 13px);
  line-height: 20px;
  cursor: pointer;
}
.dsg-color-option:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)); }
.dsg-color-option[data-selected="true"] {
  border-color: var(--dsw-alias-label-primary, CanvasText);
  background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)));
}
.dsg-color-option[data-selected="true"]:hover {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent));
}
.dsg-color-swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex: none;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, CanvasText 22%, transparent);
}
.dsg-color-custom-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));
}
.dsg-color-custom-row[data-selected="true"] {
  border-color: var(--dsw-alias-label-primary, CanvasText);
  background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 12%, transparent)));
}
.dsg-color-custom-label { flex: none; font-size: var(--dsg-font-12, 12px); color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-color-native {
  appearance: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  flex: none;
}
.dsg-color-native::-webkit-color-swatch-wrapper { padding: 2px; }
.dsg-color-native::-webkit-color-swatch { border: none; border-radius: 4px; }
.dsg-color-hex { flex: 1; min-width: 0; height: 28px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .02em; }
.dsg-color-hint { font-size: var(--dsg-font-11, 11px); line-height: 16px; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-color-hint[data-tone="error"] { color: var(--dsw-alias-state-danger, #f85149); }
.dsg-toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 90; padding: 6px 14px; border-radius: 999px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-toast-label, var(--dsw-alias-label-inverse, Canvas)); background: var(--dsw-alias-toast-bg, var(--dsw-alias-label-primary, CanvasText)); opacity: .94; box-shadow: 0 4px 16px rgba(0,0,0,.24); }
.dsg-rail { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 0; }
.dsg-rail-button { width: 36px; height: 36px; border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35)); background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); color: var(--dsw-alias-label-secondary, CanvasText); border-radius: var(--dsw-radius-md, 8px); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.dsg-rail-label { font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-skill-repair { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; padding: 12px 0 2px; border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); }
.dsg-config-list { display: flex; flex-direction: column; gap: 2px; padding: 4px 0 14px; }
.dsg-config-title { font-size: var(--dsg-font-14, 14px); line-height: 20px; color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-config-hint { margin: 2px 0 8px; font-size: var(--dsg-font-12, 12px); line-height: 18px; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-config-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
.dsg-config-item { display: flex; flex-direction: column; gap: 0; }
.dsg-config-confirm { margin: 0 0 6px; padding: 8px 10px; border: 0.5px solid var(--dsw-alias-state-danger, #f85149); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-module-platform, transparent); }
.dsg-config-confirm-body { margin-bottom: 6px; font-size: var(--dsg-font-12, 12px); line-height: 18px; color: var(--dsw-alias-state-danger, #f85149); }
.dsg-config-confirm-actions { display: flex; gap: 8px; }
.dsg-config-danger { border-color: var(--dsw-alias-state-danger, #f85149); color: var(--dsw-alias-state-danger, #f85149); }
.dsg-config-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.dsg-config-control { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.dsg-config-info { width: 24px; height: 24px; padding: 0; color: var(--dsw-alias-label-tertiary, CanvasText); background: transparent; border-color: transparent; box-shadow: none; }
.dsg-config-label { font-size: var(--dsg-font-13, 13px); line-height: 20px; color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-config-proof { font-size: var(--dsg-font-12, 12px); line-height: 18px; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-skill-repair-copy { flex: 1; min-width: 180px; }
.dsg-skill-repair-title { font-size: var(--dsg-font-14, 14px); line-height: 20px; color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-skill-repair-body { margin-top: 2px; font-size: var(--dsg-font-12, 12px); line-height: 18px; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-skill-repair-result { flex-basis: 100%; font-size: var(--dsg-font-12, 12px); line-height: 18px; color: var(--dsw-alias-state-success, #3fb950); }
.dsg-skill-repair-result[data-ok="false"] { color: var(--dsw-alias-state-danger, #f85149); }
.dsg-flat { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; flex: 1; padding: 2px 4px 8px 2px; }
.dsg-flat-workspace { padding: 6px 6px 2px; font-size: var(--dsg-font-13, 13px); font-weight: 600; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-nowrap { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Drag diagnostics HUD (0.2.5): fixed, pointer-events:none, plain DOM text
 * updated at <=4 Hz. It never participates in layout or drag hit testing. */
.dsg-diag-hud {
  position: fixed;
  right: 10px;
  bottom: 10px;
  z-index: 2147483000;
  pointer-events: none;
  user-select: none;
  box-sizing: border-box;
  max-width: 380px;
  padding: 5px 7px;
  border-radius: 6px;
  background: rgba(12, 14, 18, 0.74);
  color: #f4f6fa;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
}
`

/**
 * Ensure the stylesheet exists; returns a disposer that removes it when this
 * plugin lifecycle owns the tag.
 * @param {Document} documentRef
 */
export const installStyles = (documentRef = globalThis.document) => {
  if (!documentRef || typeof documentRef.createElement !== 'function') return () => {}
  const existing = documentRef.getElementById(STYLE_ID)
  if (existing) {
    existing.textContent = CSS
    return () => {}
  }
  const tag = documentRef.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = CSS
  documentRef.head?.appendChild(tag)
  return () => {
    tag.remove()
  }
}
