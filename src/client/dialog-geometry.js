/**
 * DSH client adapter for dialog geometry.
 *
 * Pure viewport math lives in src/core/dialog-geometry.js. This outer layer
 * owns only the localStorage persistence key and storage access.
 */
import { safeStorage } from './state.js'

export {
  centeredDialogRect,
  clampDialogRect,
  dragDialogRect,
  MIN_DIALOG_HEIGHT,
  MIN_DIALOG_WIDTH,
  resizeDialogRect,
} from '../core/dialog-geometry.js'

export const DIALOG_GEOMETRY_KEY = 'dsh-session-groups.dialog.geometry.v9'

export const readDialogGeometries = (storage = safeStorage()) => {
  try {
    const raw = storage?.getItem(DIALOG_GEOMETRY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result = {}
    for (const [kind, rect] of Object.entries(parsed)) {
      if (!kind || !rect || typeof rect !== 'object') continue
      if (['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]))) {
        result[kind] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
    }
    return result
  } catch {
    return {}
  }
}

export const saveDialogGeometry = (kind, rect, storage = safeStorage()) => {
  if (!kind || !rect) return
  try {
    const all = readDialogGeometries(storage)
    all[kind] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    storage?.setItem(DIALOG_GEOMETRY_KEY, JSON.stringify(all))
  } catch {
    /* blocked storage keeps the in-memory geometry */
  }
}

/** Clear all remembered dialog positions/sizes (used by Reset layout). */
export const clearDialogGeometries = (storage = safeStorage()) => {
  try {
    storage?.removeItem(DIALOG_GEOMETRY_KEY)
  } catch {
    /* ignore */
  }
}
