/**
 * Plugin stylesheet. Injected once into the host document when the groups view
 * mounts; removed by the plugin lifecycle (`ctx.effect` returns the disposer).
 * Uses DSH theme variables with light/dark-safe fallbacks.
 *
 * Typography contract (V1.1 patch 0.2.1): this plugin has **no font-size
 * setting and no typography config**. The host sidebar base is authoritative:
 * the official DSH 2.0.18 sidebar root sets `font-size: 14px` and the official
 * workspace rows inherit that font-family. `.dsg-root` therefore inherits
 * family/size and only pins the official metrics with the theme tokens
 * (verified in `dsh-client-ui-theme` 2.0.18: `--dsw-font-s-14-font-size`,
 * `--dsw-font-xs-13-font-size`, `--dsw-font-xxs-12-font-size`,
 * `--dsw-font-xxxs-11-font-size`) plus px fallbacks for older hosts.
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
  color: var(--dsw-alias-label-primary, #1f2328);
  /* Fixed sizes below come from the official theme tokens (px fallback). */
  --dsg-font-14: var(--dsw-font-s-14-font-size, 14px);
  --dsg-font-13: var(--dsw-font-xs-13-font-size, 13px);
  --dsg-font-12: var(--dsw-font-xxs-12-font-size, 12px);
  --dsg-font-11: var(--dsw-font-xxxs-11-font-size, 11px);
  --dsg-font-10: 10px;
}
/* Form controls do not inherit the host font family by default. */
.dsg-root button, .dsg-root input { font-family: inherit; }
.dsg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 6px 2px;
  flex: none;
}
/* Two-row groups header (title row + room for the future search row); the flat
 * fallback keeps the plain single-row .dsg-header layout. */
.dsg-header-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
}
.dsg-header-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.dsg-header-title { font-size: var(--dsg-font-14, 14px); line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-secondary, #57606a); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Second header row: full-width search combobox (264px-safe, no overflow). */
.dsg-header-search-row { align-items: stretch; }
.dsg-search { position: relative; display: flex; flex: 1 1 auto; min-width: 0; }
.dsg-search-input {
  width: 100%;
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  padding: 0 8px;
  font-size: var(--dsg-font-13, 13px);
  line-height: 18px;
  color: inherit;
  background: var(--dsw-alias-interactive-bg, transparent);
  border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35));
  border-radius: var(--dsw-radius-sm, 6px);
  outline: none;
}
.dsg-search-input::placeholder { color: var(--dsw-alias-label-tertiary, #6a737d); }
.dsg-search-input:focus { border-color: var(--dsw-alias-state-business-primary, #4d6bfe); }
.dsg-search-results {
  position: absolute;
  z-index: 65;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-radius: 8px;
  background: var(--dsw-elevation-surface, #fff);
  color: var(--dsw-alias-label-primary, #1f2328);
  border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.3));
  box-shadow: 0 8px 24px rgba(0,0,0,.18);
}
.dsg-search-result { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px 8px; border-radius: 5px; cursor: pointer; }
.dsg-search-result[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); }
.dsg-search-result[data-archived="true"] { opacity: .55; cursor: not-allowed; }
.dsg-search-result-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-14, 14px); line-height: 20px; }
.dsg-search-result-meta { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-12, 12px); line-height: 20px; color: var(--dsw-alias-label-tertiary, #6a737d); }
.dsg-search-result-badge { flex: none; font-size: var(--dsg-font-10, 10px); line-height: 16px; padding: 0 5px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); color: var(--dsw-alias-label-secondary, #57606a); }
.dsg-search-empty { padding: 8px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-label-tertiary, #6a737d); text-align: center; }
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
  color: var(--dsw-alias-label-secondary, #57606a);
  cursor: pointer;
  flex: none;
}
.dsg-icon-button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.dsg-icon-button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); outline-offset: -2px; }
.dsg-text-button {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35));
  background: transparent;
  color: var(--dsw-alias-label-secondary, #57606a);
  border-radius: var(--dsw-radius-sm, 6px);
  height: 28px;
  padding: 0 8px;
  font-size: var(--dsg-font-13, 13px);
  line-height: 20px;
  cursor: pointer;
  flex: none;
}
.dsg-text-button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.dsg-filter[data-filter="only"], .dsg-filter[data-filter="all"] { color: var(--dsw-alias-state-business-primary, #4d6bfe); border-color: currentColor; }
.dsg-tree { display: flex; flex-direction: column; gap: 1px; flex: 1; min-height: 0; overflow-y: auto; padding: 2px 4px 8px 2px; }
.dsg-group-row, .dsg-session-row {
  display: flex;
  align-items: center;
  gap: 4px;
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
.dsg-group-caret { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary, #6a737d); flex: none; }
.dsg-group-icon { color: var(--dsw-alias-label-secondary, #57606a); display: inline-flex; flex: none; }
.dsg-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-14, 14px); line-height: 20px; }
.dsg-group-count { flex: none; font-size: var(--dsg-font-12, 12px); color: var(--dsw-alias-label-tertiary, #6a737d); font-variant-numeric: tabular-nums; }
.dsg-group-actions, .dsg-session-actions { display: inline-flex; align-items: center; gap: 1px; flex: none; opacity: 0; transition: opacity .12s ease; }
.dsg-group-row:hover .dsg-group-actions, .dsg-group-row:focus-within .dsg-group-actions,
.dsg-session-row:hover .dsg-session-actions, .dsg-session-row:focus-within .dsg-session-actions { opacity: 1; }
.dsg-group-actions .dsg-icon-button, .dsg-session-actions .dsg-icon-button { width: 16px; height: 16px; }
.dsg-group-body { display: flex; flex-direction: column; gap: 1px; }
.dsg-group-line { margin-left: 9px; padding-left: 8px; border-left: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.28)); display: flex; flex-direction: column; gap: 1px; min-height: 24px; }
.dsg-group-line[data-empty="true"] { min-height: 24px; }
.dsg-group-empty { padding: 3px 6px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-label-tertiary, #6a737d); font-style: italic; }
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
.dsg-session-badge { flex: none; font-size: var(--dsg-font-10, 10px); line-height: 16px; padding: 0 5px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); color: var(--dsw-alias-label-secondary, #57606a); }
.dsg-workspace-badge { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--dsg-font-12, 12px); color: var(--dsw-alias-label-tertiary, #6a737d); opacity: 0; transition: opacity .12s ease; }
.dsg-session-row:hover .dsg-workspace-badge, .dsg-session-row:focus-within .dsg-workspace-badge { opacity: 1; }
.dsg-ungrouped { display: flex; flex-direction: column; gap: 1px; margin-bottom: 4px; border-radius: var(--dsw-radius-sm, 6px); }
.dsg-ungrouped-header { display: flex; align-items: center; gap: 4px; height: 34px; padding: 0 8px; color: var(--dsw-alias-label-secondary, #57606a); font-size: var(--dsg-font-14, 14px); line-height: 20px; font-weight: 600; }
.dsg-ungrouped-header[data-drop-active="true"] { background: var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.14)); }
.dsg-ungrouped-count { font-size: var(--dsg-font-12, 12px); font-weight: 400; color: var(--dsw-alias-label-tertiary, #6a737d); }
.dsg-drop-indicator { height: 2px; margin: -1px 4px; border-radius: 2px; background: var(--dsw-alias-state-business-primary, #4d6bfe); box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary-fade, rgba(77,107,254,.2)); }
.dsg-insert-before { border-top: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); }
.dsg-insert-after { border-bottom: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); }
.dsg-floating-label { position: fixed; z-index: 60; pointer-events: none; transform: translate(12px, 10px); padding: 2px 8px; border-radius: 999px; font-size: var(--dsg-font-12, 12px); color: var(--dsw-alias-label-inverse, #fff); background: var(--dsw-alias-state-business-primary, #4d6bfe); box-shadow: 0 2px 8px rgba(0,0,0,.18); }
.dsg-drag-ghost { opacity: .65; }
.dsg-empty { padding: 8px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-label-tertiary, #6a737d); text-align: center; }
.dsg-banner { margin: 4px 2px 6px; padding: 6px 8px; border-radius: 6px; font-size: var(--dsg-font-12, 12px); display: flex; gap: 6px; align-items: center; }
.dsg-banner[data-kind="warning"] { background: var(--dsw-alias-state-warning-fade, rgba(210,153,34,.14)); color: var(--dsw-alias-label-primary, #1f2328); }
.dsg-banner[data-kind="error"] { background: var(--dsw-alias-state-danger-fade, rgba(248,81,73,.14)); color: var(--dsw-alias-label-primary, #1f2328); }
.dsg-banner-text { flex: 1; min-width: 0; }
.dsg-menu { position: fixed; z-index: 70; min-width: 160px; padding: 4px; border-radius: 8px; background: var(--dsw-elevation-surface, #fff); border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.3)); box-shadow: 0 8px 24px rgba(0,0,0,.18); display: flex; flex-direction: column; gap: 1px; max-height: 60vh; overflow-y: auto; }
.dsg-menu-item { appearance: none; border: none; background: transparent; text-align: left; font-size: var(--dsg-font-13, 13px); line-height: 20px; color: inherit; height: 28px; padding: 0 8px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
.dsg-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.dsg-menu-item:disabled { opacity: .45; cursor: default; }
.dsg-menu-separator { height: 1px; margin: 3px 2px; background: var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); }
.dsg-menu-section { padding: 4px 8px 2px; font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-label-tertiary, #6a737d); }
.dsg-dialog-backdrop { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,.32); display: flex; align-items: center; justify-content: center; }
.dsg-dialog { width: min(360px, calc(100vw - 32px)); border-radius: 10px; background: var(--dsw-elevation-surface, #fff); color: var(--dsw-alias-label-primary, #1f2328); padding: 14px; box-shadow: 0 16px 48px rgba(0,0,0,.28); display: flex; flex-direction: column; gap: 10px; }
.dsg-dialog-title { font-size: var(--dsg-font-14, 14px); line-height: 20px; font-weight: 600; }
.dsg-dialog-body { font-size: var(--dsg-font-13, 13px); line-height: 20px; color: var(--dsw-alias-label-secondary, #57606a); white-space: pre-wrap; }
.dsg-dialog-input { width: 100%; box-sizing: border-box; height: 32px; padding: 0 8px; font-size: var(--dsg-font-13, 13px); line-height: 18px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); background: var(--dsw-alias-interactive-bg, transparent); color: inherit; }
.dsg-dialog-input:focus { outline: 2px solid var(--dsw-alias-state-business-primary, #4d6bfe); outline-offset: -1px; }
.dsg-dialog-error { font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-state-danger, #f85149); }
.dsg-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dsg-dialog-confirm { appearance: none; border: none; height: 28px; padding: 0 12px; border-radius: 6px; font-size: var(--dsg-font-13, 13px); line-height: 20px; cursor: pointer; background: var(--dsw-alias-state-business-primary, #4d6bfe); color: #fff; }
.dsg-dialog-confirm[data-variant="danger"] { background: var(--dsw-alias-state-danger, #f85149); }
.dsg-dialog-confirm:disabled { opacity: .5; cursor: default; }
.dsg-dialog-cancel { appearance: none; height: 28px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); background: transparent; color: inherit; font-size: var(--dsg-font-13, 13px); line-height: 20px; cursor: pointer; }
.dsg-toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 90; padding: 6px 14px; border-radius: 999px; font-size: var(--dsg-font-13, 13px); color: var(--dsw-alias-label-inverse, #fff); background: var(--dsw-alias-label-primary, #1f2328); opacity: .94; box-shadow: 0 4px 16px rgba(0,0,0,.24); }
.dsg-rail { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 0; }
.dsg-rail-button { width: 36px; height: 36px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35)); background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); color: var(--dsw-alias-label-secondary, #57606a); border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.dsg-rail-label { font-size: var(--dsg-font-11, 11px); color: var(--dsw-alias-label-tertiary, #6a737d); }
.dsg-rocket-only { display: none; }
.dsg-flat { display: flex; flex-direction: column; gap: 1px; overflow-y: auto; min-height: 0; flex: 1; padding: 2px 4px 8px 2px; }
.dsg-flat-workspace { padding: 6px 6px 2px; font-size: var(--dsg-font-13, 13px); font-weight: 600; color: var(--dsw-alias-label-tertiary, #6a737d); }
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
