/**
 * Pure windowing math for the virtualized ungrouped session list (0.2.3).
 *
 * The ungrouped section can hold the whole session store (1,500+ rows in the
 * large-list QA fixture). Rendering every row makes hover/drag feedback compete
 * with a ~1,500-row DOM, so the list renders only the rows intersecting the
 * `.dsg-tree` viewport plus a fixed overscan. Top/bottom spacer heights preserve
 * the exact scroll height of the full list; the grouping tree below it is not
 * virtualized.
 *
 * Layout contract (matches `src/client/css.js`):
 *   - session row: 32px
 *   - vertical gap between rows (`.dsg-group-line`): 2px
 *   - section header: 34px (offset comes from the DOM, not this module)
 *
 * Spacer arithmetic is exact for a `gap: 2px` flex column. With R rows the full
 * list height is `R * 34 - 2` (the last row has no trailing gap):
 *   - both spacers: topPad = start*step, bottomPad = tail*step - 2*gap
 *   - top only:     topPad = start*step - gap
 *   - bottom only:  bottomPad = tail*step - gap
 *   - no spacers:   rows already produce R*step - gap
 */

/** Session row height (px); keep in sync with `.dsg-session-row`. */
export const VIRTUAL_ROW_HEIGHT = 32

/** Vertical gap between session rows (px); keep in sync with `.dsg-group-line`. */
export const VIRTUAL_ROW_GAP = 2

/** Height of the ungrouped section header (px); informational / probes. */
export const VIRTUAL_HEADER_HEIGHT = 34

/** Rows rendered beyond each viewport edge to hide fast scroll gaps. */
export const VIRTUAL_OVERSCAN = 8

/** Distance between two row tops (row height + gap). */
export const VIRTUAL_STEP = VIRTUAL_ROW_HEIGHT + VIRTUAL_ROW_GAP

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback)
const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

/**
 * Compute the visible row window and spacer heights.
 *
 * @param {{
 *   scrollTop?: number,      // `.dsg-tree` scrollTop
 *   viewportHeight?: number, // `.dsg-tree` clientHeight
 *   listTop?: number,        // ungrouped body offset inside the scroll content
 *   rowCount?: number,       // logical ungrouped rows
 *   rowHeight?: number,
 *   gap?: number,
 *   overscan?: number,
 * }} [input]
 * @returns {{
 *   start: number, end: number, count: number,
 *   topPad: number, bottomPad: number, totalHeight: number, step: number,
 * }}
 */
export const computeVirtualWindow = (input = {}) => {
  const rowHeight = Math.max(1, finite(input.rowHeight, VIRTUAL_ROW_HEIGHT))
  const gap = Math.max(0, finite(input.gap, VIRTUAL_ROW_GAP))
  const step = rowHeight + gap
  const overscan = Math.max(0, Math.trunc(finite(input.overscan, VIRTUAL_OVERSCAN)))
  const total = Math.max(0, Math.trunc(finite(input.rowCount, 0)))
  const listTop = finite(input.listTop, 0)
  const scrollTop = Math.max(0, finite(input.scrollTop, 0))
  const viewportHeight = Math.max(0, finite(input.viewportHeight, 0))

  if (total === 0) {
    return { start: 0, end: 0, count: 0, topPad: 0, bottomPad: 0, totalHeight: 0, step }
  }

  const relative = scrollTop - listTop
  // Clamp the viewport edges to the logical list before adding overscan, so a
  // scroll position far past the last row still renders the trailing overscan
  // window instead of an empty list.
  const firstVisible = clamp(Math.floor(relative / step), 0, total)
  const lastVisible = clamp(Math.ceil((relative + viewportHeight) / step), 0, total)
  const start = clamp(firstVisible - overscan, 0, total)
  const end = clamp(lastVisible + overscan, start, total)

  const hasTop = start > 0
  const hasBottom = end < total
  const topPad = hasTop ? start * step - (hasBottom ? 0 : gap) : 0
  const bottomPad = hasBottom ? (total - end) * step - (hasTop ? gap * 2 : gap) : 0

  return {
    start,
    end,
    count: end - start,
    topPad: Math.max(0, topPad),
    bottomPad: Math.max(0, bottomPad),
    totalHeight: total * step - gap,
    step,
  }
}

/** Whether `index` is inside the rendered window (inclusive start, exclusive end). */
export const isVirtualIndexVisible = (window, index) =>
  Number.isInteger(index) && index >= window.start && index < window.end

/** Scroll offset that centres `index` at 30% of the viewport (clamped by the DOM). */
export const virtualScrollOffset = (index, { listTop = 0, viewportHeight = 0, rowCount = 0, rowHeight = VIRTUAL_ROW_HEIGHT, gap = VIRTUAL_ROW_GAP } = {}) => {
  if (!Number.isInteger(index) || index < 0) return 0
  const step = Math.max(1, rowHeight + gap)
  const total = Math.max(0, Math.trunc(rowCount))
  if (total === 0) return 0
  const maxScroll = Math.max(0, total * step - gap - Math.max(0, viewportHeight))
  const wanted = listTop + index * step - Math.max(0, viewportHeight) * 0.3
  return clamp(wanted, 0, maxScroll)
}
