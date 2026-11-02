import test from 'node:test'
import assert from 'node:assert/strict'
import {
  centeredDialogRect,
  clampDialogRect,
  dragDialogRect,
  MIN_DIALOG_HEIGHT,
  MIN_DIALOG_WIDTH,
  resizeDialogRect,
} from '../../src/core/dialog-geometry.js'

test('dialog rect is clamped to the viewport and minimum size', () => {
  assert.deepEqual(clampDialogRect({ x: -100, y: -100, width: 100, height: 50 }, 1280, 900), {
    x: 8,
    y: 8,
    width: MIN_DIALOG_WIDTH,
    height: MIN_DIALOG_HEIGHT,
  })
  const rect = clampDialogRect({ x: 5000, y: 5000, width: 5000, height: 5000 }, 800, 600)
  assert.equal(rect.x, 800 - rect.width - 8)
  assert.equal(rect.y, 600 - 44)
})

test('centered and dragged rectangles stay inside the viewport', () => {
  const centered = centeredDialogRect(360, 160, 1280, 900)
  assert.equal(centered.x, 460)
  assert.equal(centered.y, 370)
  const dragged = dragDialogRect(centered, -10000, -10000, 1280, 900)
  assert.equal(dragged.x, 8)
  assert.equal(dragged.y, 8)
})

test('resize honors all eight directions and minimum dimensions', () => {
  const start = { x: 100, y: 100, width: 400, height: 300 }
  const se = resizeDialogRect(start, 'se', 50, 40, 1280, 900)
  assert.deepEqual(se, { x: 100, y: 100, width: 450, height: 300 + 40 })
  const nw = resizeDialogRect(start, 'nw', -50, -40, 1280, 900)
  assert.deepEqual(nw, { x: 50, y: 60, width: 450, height: 340 })
  const min = resizeDialogRect(start, 'se', -1000, -1000, 1280, 900)
  assert.equal(min.width, MIN_DIALOG_WIDTH)
  assert.equal(min.height, MIN_DIALOG_HEIGHT)
})
