/** Keyboard moves are 10px by default and 1px with Shift. */
export const dialogKeyboardStep = (shiftKey = false) => (shiftKey ? 1 : 10)

/** Translate one arrow key into a clamped-safe move/resize delta. */
export const dialogKeyboardDelta = (key, shiftKey = false) => {
  const step = dialogKeyboardStep(shiftKey)
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 }
    case 'ArrowRight':
      return { dx: step, dy: 0 }
    case 'ArrowUp':
      return { dx: 0, dy: -step }
    case 'ArrowDown':
      return { dx: 0, dy: step }
    default:
      return { dx: 0, dy: 0 }
  }
}
