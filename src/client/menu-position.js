/**
 * Viewport clamping for row context menus (0.2.7).
 *
 * A right-click or Shift+F10/ContextMenu anchors the same menu used by the
 * three-dot button. The first pass clamps against a conservative estimate; the
 * mounted menu measures itself and clamps again with its real rect, so a menu
 * that is ~275px tall never leaves the viewport. All functions are pure.
 */

export const MENU_VIEWPORT_PADDING = 8
/** Conservative pre-measure estimates (the mounted menu refines them). */
export const MENU_ESTIMATED_WIDTH = 220
export const MENU_ESTIMATED_HEIGHT = 320

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback)

/** Clamp a menu rect's top-left corner inside the viewport with 8px breathing room. */
export const clampMenuPosition = ({ x, y, width, height, viewportWidth, viewportHeight, padding = MENU_VIEWPORT_PADDING }) => {
  const vw = Math.max(0, finite(viewportWidth, 0))
  const vh = Math.max(0, finite(viewportHeight, 0))
  const boxW = Math.max(0, finite(width, 0))
  const boxH = Math.max(0, finite(height, 0))
  const maxX = Math.max(padding, vw - boxW - padding)
  const maxY = Math.max(padding, vh - boxH - padding)
  return {
    x: Math.min(Math.max(padding, finite(x, padding)), maxX),
    y: Math.min(Math.max(padding, finite(y, padding)), maxY),
  }
}

/** Anchor a context menu at the pointer, offset by +2px on both axes. */
export const menuAnchorFromEvent = (event, viewport = {}) => {
  const anchorX = finite(event?.clientX, 0) + 2
  const anchorY = finite(event?.clientY, 0) + 2
  return {
    ...clampMenuPosition({
      x: anchorX,
      y: anchorY,
      width: MENU_ESTIMATED_WIDTH,
      height: MENU_ESTIMATED_HEIGHT,
      viewportWidth: viewport.width ?? globalThis.innerWidth,
      viewportHeight: viewport.height ?? globalThis.innerHeight,
    }),
    // Keep the unclamped pointer anchor so the mounted menu can re-clamp with
    // its real height without being stuck at the conservative estimate.
    anchorX,
    anchorY,
  }
}

/** Keyboard anchor: row left edge, row bottom + 8px. */
export const menuAnchorFromRow = (row, viewport = {}) => {
  const rect = row?.getBoundingClientRect?.()
  const anchorX = rect ? rect.left : 0
  const anchorY = rect ? rect.bottom + 8 : 0
  return {
    ...clampMenuPosition({
      x: anchorX,
      y: anchorY,
      width: MENU_ESTIMATED_WIDTH,
      height: MENU_ESTIMATED_HEIGHT,
      viewportWidth: viewport.width ?? globalThis.innerWidth,
      viewportHeight: viewport.height ?? globalThis.innerHeight,
    }),
    anchorX,
    anchorY,
  }
}

/** Shift+F10 and the dedicated ContextMenu key both open the row menu. */
export const isMenuKey = (event) =>
  event?.key === 'ContextMenu' || (event?.key === 'F10' && event?.shiftKey === true)
