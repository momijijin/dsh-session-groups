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
 * guides indent 10/10; menus/dialogs use 30px items / 16px padding.
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
  padding: 4px 4px 4px 2px;
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
  font-weight: 600;
  /* Official section label: primary text, not the muted tertiary chrome. */
  color: var(--dsw-alias-label-primary, CanvasText);
  white-space: nowrap;
}
.dsg-header-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Primary-accent folder icon in front of the title (feedback item 4). */
.dsg-header-accent { display: inline-flex; flex: none; width: 16px; height: 16px; align-items: center; justify-content: center; color: var(--dsw-alias-state-business-primary, CanvasText); }
.dsg-header-actions { display: inline-flex; align-items: center; gap: 4px; flex: none; }
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
.dsg-tree { display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; overflow-y: auto; padding: 2px 4px 8px 2px; }
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
  transition: background .1s ease;
}
.dsg-group-drop-slot:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.dsg-group-drop-slot[data-drop-active="true"] { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.16)); }
.dsg-group-drop-slot[data-drop-active="true"]::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  border-radius: 2px;
  background: var(--dsw-alias-state-business-primary, #4d6bfe);
}
.dsg-group-drop-slot[data-drop-forbidden="true"] { background: var(--dsw-alias-state-danger-fade, rgba(248,81,73,.2)); cursor: no-drop; }
.dsg-group-line[data-empty="true"] .dsg-group-drop-slot { height: 12px; }
.dsg-group-caret { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary, CanvasText); flex: none; }
.dsg-group-icon { color: var(--dsw-alias-label-secondary, CanvasText); display: inline-flex; flex: none; }
.dsg-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-14, 14px); line-height: 20px; }
.dsg-group-count { flex: none; font-size: var(--dsg-font-12, 12px); color: var(--dsw-alias-label-tertiary, CanvasText); font-variant-numeric: tabular-nums; }
.dsg-group-actions, .dsg-session-actions { display: inline-flex; align-items: center; gap: 2px; flex: none; opacity: 0; transition: opacity .12s ease; }
.dsg-group-row:hover .dsg-group-actions, .dsg-group-row:focus-within .dsg-group-actions,
.dsg-session-row:hover .dsg-session-actions, .dsg-session-row:focus-within .dsg-session-actions { opacity: 1; }
.dsg-group-actions .dsg-icon-button, .dsg-session-actions .dsg-icon-button { width: 16px; height: 16px; }
.dsg-group-body { display: flex; flex-direction: column; gap: 2px; }
.dsg-group-line { margin-left: 10px; padding-left: 10px; border-left: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28)); display: flex; flex-direction: column; gap: 2px; min-height: 24px; }
.dsg-group-line[data-empty="true"] { min-height: 24px; }
.dsg-group-empty { padding: 4px 8px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-label-tertiary, CanvasText); font-style: italic; }
.dsg-session-row { height: 32px; padding: 0 8px; }
.dsg-session-row[data-current="true"] { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.16)); }
.dsg-session-row[data-archived="true"] { opacity: .62; }
/* Search reveal highlight (1.5 s, class removed by the component timer). */
.dsg-session-row.dsg-search-hit { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.3)); animation: dsg-search-hit 1.5s ease-out; }
@keyframes dsg-search-hit {
  0% { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.5)); }
  100% { background: transparent; }
}
.dsg-session-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: transparent; margin: 0 2px; }
.dsg-session-dot[data-tone="running"] { background: var(--dsw-alias-state-business-primary, #4d6bfe); }
.dsg-session-dot[data-tone="awaiting"] { background: var(--dsw-alias-state-warning, #d29922); }
.dsg-session-dot[data-tone="done"] { background: var(--dsw-alias-state-success, #2da44e); }
.dsg-session-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-14, 14px); line-height: 20px; }
.dsg-session-badge { flex: none; font-size: var(--dsg-font-10, 10px); line-height: 16px; padding: 0 5px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-workspace-badge { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-12, 12px); color: var(--dsw-alias-label-tertiary, CanvasText); opacity: 0; transition: opacity .12s ease; }
.dsg-session-row:hover .dsg-workspace-badge, .dsg-session-row:focus-within .dsg-workspace-badge { opacity: 1; }
.dsg-ungrouped { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; border-radius: var(--dsw-radius-sm, 6px); }
.dsg-ungrouped-header { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 8px; color: var(--dsw-alias-label-secondary, CanvasText); font-size: var(--dsg-font-14, 14px); line-height: 20px; font-weight: 600; }
.dsg-ungrouped-header[data-drop-active="true"] { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.14)); }
.dsg-ungrouped-count { font-size: var(--dsg-font-12, 12px); font-weight: 400; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-drop-indicator { height: 2px; margin: -1px 4px; border-radius: 2px; background: var(--dsw-alias-state-business-primary, #4d6bfe); box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.2)); }
.dsg-insert-before { border-top: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); }
.dsg-insert-after { border-bottom: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); }
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
.dsg-dialog-backdrop { position: fixed; inset: 0; z-index: 80; background: var(--dsw-alias-bg-mask-1, color-mix(in srgb, CanvasText 32%, transparent)); display: flex; align-items: center; justify-content: center; }
.dsg-dialog { width: min(360px, calc(100vw - 32px)); border-radius: var(--dsw-radius-md, 10px); background: var(--dsw-alias-bg-layer-2, Canvas); color: var(--dsw-alias-label-primary, CanvasText); border: 0.5px solid var(--dsw-alias-border-l2, color-mix(in srgb, CanvasText 18%, transparent)); padding: 16px; box-shadow: var(--dsw-elevation-prominent, 0 16px 48px rgba(0,0,0,.28)); display: flex; flex-direction: column; gap: 12px; }
.dsg-dialog-title { font-size: var(--dsg-font-14, 14px); line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-dialog-body { font-size: var(--dsg-font-13, 13px); line-height: 20px; color: var(--dsw-alias-label-secondary, CanvasText); white-space: pre-wrap; }
.dsg-dialog-input { width: 100%; box-sizing: border-box; height: 32px; padding: 0 10px; font-size: var(--dsg-font-13, 13px); line-height: 18px; border-radius: 6px; border: 0.5px solid var(--dsw-alias-border-l3, color-mix(in srgb, CanvasText 22%, transparent)); background: var(--dsw-alias-bg-layer-1, Canvas); color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-dialog-input::placeholder { color: var(--dsw-alias-label-secondary, CanvasText); }
.dsg-dialog-input:focus { outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); outline-offset: -1px; }
.dsg-dialog-error { font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-state-danger, #f85149); }
.dsg-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; }
.dsg-dialog-confirm { appearance: none; border: none; height: 28px; padding: 0 14px; border-radius: 6px; font-size: var(--dsg-font-13, 13px); line-height: 20px; cursor: pointer; background: var(--dsw-alias-state-business-primary, #4d6bfe); color: var(--dsw-alias-label-inverse, Canvas); }
.dsg-dialog-confirm[data-variant="danger"] { background: var(--dsw-alias-state-danger, #f85149); }
.dsg-dialog-confirm:disabled { opacity: .5; cursor: default; }
.dsg-dialog-cancel { appearance: none; height: 28px; padding: 0 14px; border-radius: 6px; border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35)); background: transparent; color: var(--dsw-alias-label-primary, CanvasText); font-size: var(--dsg-font-13, 13px); line-height: 20px; cursor: pointer; }
.dsg-toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 90; padding: 6px 14px; border-radius: 999px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-toast-label, var(--dsw-alias-label-inverse, Canvas)); background: var(--dsw-alias-toast-bg, var(--dsw-alias-label-primary, CanvasText)); opacity: .94; box-shadow: 0 4px 16px rgba(0,0,0,.24); }
.dsg-rail { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 0; }
.dsg-rail-button { width: 36px; height: 36px; border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35)); background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); color: var(--dsw-alias-label-secondary, CanvasText); border-radius: var(--dsw-radius-md, 8px); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.dsg-rail-label { font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-label-tertiary, CanvasText); }
/* Bottom two-segment view switch (feedback item 1). */
.dsg-footer-switch {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  height: 28px;
  padding: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 10%, transparent));
}
.dsg-footer-segment {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1 1 0;
  min-width: 0;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, CanvasText);
  font: inherit;
  font-size: var(--dsg-font-13, 13px);
  line-height: 20px;
  cursor: pointer;
}
.dsg-footer-segment:hover { color: var(--dsw-alias-label-primary, CanvasText); }
.dsg-footer-segment[aria-pressed="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, CanvasText) 14%, transparent);
  color: var(--dsw-alias-state-business-primary, CanvasText);
  font-weight: 500;
}
.dsg-footer-segment:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, CanvasText); outline-offset: -2px; }
.dsg-footer-segment-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Rail/no-wide fallback: icon-only 36px controls (stacked), still one switch. */
.dsg-footer-switch[data-wide="false"] {
  flex-direction: column;
  width: 36px;
  height: auto;
  padding: 0;
  background: transparent;
  gap: 6px;
}
.dsg-footer-switch[data-wide="false"] .dsg-footer-segment {
  width: 36px;
  height: 36px;
  flex: none;
  padding: 0;
  border-radius: var(--dsw-radius-md, 12px);
}
.dsg-footer-switch[data-wide="false"] .dsg-footer-segment-label { display: none; }
.dsg-footer-switch[data-wide="false"] .dsg-footer-segment:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, CanvasText 10%, transparent)); }
.dsg-flat { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; flex: 1; padding: 2px 4px 8px 2px; }
.dsg-flat-workspace { padding: 6px 6px 2px; font-size: var(--dsg-font-13, 13px); font-weight: 600; color: var(--dsw-alias-label-tertiary, CanvasText); }
.dsg-nowrap { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
