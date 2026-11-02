/**
 * Pure dialog rectangle math: viewport clamping, centering, dragging and
 * eight-direction resizing. localStorage persistence lives in the client
 * adapter at src/client/dialog-geometry.js.
 */

export const MIN_DIALOG_WIDTH = 320
export const MIN_DIALOG_HEIGHT = 120
const EDGE_PAD = 8
const TITLE_VISIBLE = 44

const num = (value, fallback) => (Number.isFinite(value) ? value : fallback)

export const clampDialogRect = (rect, viewportWidth, viewportHeight) => {
  const vw = Math.max(1, num(viewportWidth, 1024))
  const vh = Math.max(1, num(viewportHeight, 768))
  const maxW = Math.max(160, Math.min(vw - 2 * EDGE_PAD, Math.floor(vw * 0.9)))
  const maxH = Math.max(140, Math.min(vh - 2 * EDGE_PAD, Math.floor(vh * 0.85)))
  const minW = Math.min(MIN_DIALOG_WIDTH, maxW)
  const minH = Math.min(MIN_DIALOG_HEIGHT, maxH)
  const width = Math.min(maxW, Math.max(minW, num(rect?.width, minW)))
  const height = Math.min(maxH, Math.max(minH, num(rect?.height, minH)))
  const x = Math.min(vw - width - EDGE_PAD, Math.max(EDGE_PAD, num(rect?.x, EDGE_PAD)))
  const y = Math.min(vh - TITLE_VISIBLE, Math.max(EDGE_PAD, num(rect?.y, EDGE_PAD)))
  return { x, y, width, height }
}

export const centeredDialogRect = (width, height, viewportWidth, viewportHeight) => {
  const vw = Math.max(1, num(viewportWidth, 1024))
  const vh = Math.max(1, num(viewportHeight, 768))
  return clampDialogRect(
    { x: (vw - width) / 2, y: (vh - height) / 2, width, height },
    vw,
    vh
  )
}

export const dragDialogRect = (start, dx, dy, viewportWidth, viewportHeight) =>
  clampDialogRect(
    {
      x: num(start.x, 0) + num(dx, 0),
      y: num(start.y, 0) + num(dy, 0),
      width: start.width,
      height: start.height,
    },
    viewportWidth,
    viewportHeight
  )

/**
 * Resize a rectangle from one of n/s/e/w/ne/nw/se/sw.
 * Returns a viewport-clamped rectangle.
 */
export const resizeDialogRect = (start, dir, dx, dy, viewportWidth, viewportHeight) => {
  const vw = Math.max(1, num(viewportWidth, 1024))
  const vh = Math.max(1, num(viewportHeight, 768))
  const maxW = Math.max(160, Math.min(vw - 2 * EDGE_PAD, Math.floor(vw * 0.9)))
  const maxH = Math.max(140, Math.min(vh - 2 * EDGE_PAD, Math.floor(vh * 0.85)))
  const minW = Math.min(MIN_DIALOG_WIDTH, maxW)
  const minH = Math.min(MIN_DIALOG_HEIGHT, maxH)
  let x = num(start.x, 0)
  let y = num(start.y, 0)
  let width = num(start.width, minW)
  let height = num(start.height, minH)
  const west = dir.includes('w')
  const east = dir.includes('e')
  const north = dir.includes('n')
  const south = dir.includes('s')

  if (east) width = Math.min(maxW, Math.max(minW, width + dx))
  if (south) height = Math.min(maxH, Math.max(minH, height + dy))
  if (west) {
    const right = x + width
    width = Math.min(maxW, Math.max(minW, width - dx))
    x = right - width
  }
  if (north) {
    const bottom = y + height
    height = Math.min(maxH, Math.max(minH, height - dy))
    y = bottom - height
  }
  return clampDialogRect({ x, y, width, height }, vw, vh)
}
