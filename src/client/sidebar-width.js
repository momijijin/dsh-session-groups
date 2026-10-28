/**
 * Sidebar width math and persistence for the resizable global session groups
 * sidebar.
 *
 * Pure, DOM-free module: the width policy lives here so it can be unit tested
 * and reused by the client components. The sidebar may only grow while the main
 * conversation area keeps at least `mainMin` pixels, and it never exceeds
 * {@link SIDEBAR_WIDTH_MAX}; when the viewport cannot host a wider-than-minimum
 * sidebar the clamp reports `null` so callers skip the resize entirely.
 */
import { safeStorage } from './state.js'

/** localStorage key for the user-chosen sidebar width. */
export const SIDEBAR_WIDTH_KEY = 'dsh-session-groups.width.v1'

/** Smallest width the resize handle may produce. */
export const SIDEBAR_WIDTH_MIN = 264

/** Largest width the sidebar may take on a wide viewport. */
export const SIDEBAR_WIDTH_MAX = 760

/** Width used when nothing valid has been persisted yet. */
export const SIDEBAR_WIDTH_DEFAULT = 420

/** Main area width that must remain visible next to the sidebar. */
const MAIN_MIN_DEFAULT = 480

/**
 * Clamp a requested sidebar width to the viewport-aware range.
 *
 * @param {number} px requested width
 * @param {number} viewportWidth current viewport width
 * @param {{ mainMin?: number }} [options]
 * @returns {number | null} clamped width, or `null` when no wider range exists
 */
export const clampSidebarWidth = (px, viewportWidth, { mainMin = MAIN_MIN_DEFAULT } = {}) => {
  const reserve = Number.isFinite(mainMin) ? mainMin : MAIN_MIN_DEFAULT
  const viewport = Number(viewportWidth)
  const max = Math.min(SIDEBAR_WIDTH_MAX, viewport - reserve)
  if (!(max > SIDEBAR_WIDTH_MIN)) return null
  const width = Number.isFinite(px) ? px : SIDEBAR_WIDTH_DEFAULT
  return Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, width))
}

/**
 * Read the persisted sidebar width.
 *
 * @param {Storage | null} [storage]
 * @returns {number} persisted width, or {@link SIDEBAR_WIDTH_DEFAULT}
 */
export const readSidebarWidth = (storage = safeStorage()) => {
  try {
    const raw = storage?.getItem(SIDEBAR_WIDTH_KEY)
    if (raw == null || raw === '') return SIDEBAR_WIDTH_DEFAULT
    const px = Number(raw)
    return Number.isFinite(px) ? px : SIDEBAR_WIDTH_DEFAULT
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

/**
 * Persist the sidebar width (best effort: blocked storage keeps session state only).
 *
 * @param {number} px
 * @param {Storage | null} [storage]
 * @returns {void}
 */
export const writeSidebarWidth = (px, storage = safeStorage()) => {
  try {
    storage?.setItem(SIDEBAR_WIDTH_KEY, String(px))
  } catch {
    /* ignore */
  }
}
