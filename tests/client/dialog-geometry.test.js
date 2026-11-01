import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIALOG_GEOMETRY_KEY,
  clampDialogRect,
  centeredDialogRect,
  clearDialogGeometries,
  dragDialogRect,
  readDialogGeometries,
  resizeDialogRect,
  saveDialogGeometry,
} from '../../src/client/dialog-geometry.js'

test('dialog geometry clamps size and keeps the title bar reachable', () => {
  const rect = clampDialogRect({ x: -100, y: -100, width: 100, height: 100 }, 1200, 800)
  assert.equal(rect.x, 8)
  assert.equal(rect.y, 8)
  assert.equal(rect.width, 320)
  assert.equal(rect.height, 120)
  const huge = clampDialogRect({ x: 2000, y: 2000, width: 2000, height: 2000 }, 1200, 800)
  assert.equal(huge.width, 1080) // 90vw
  assert.equal(huge.height, 680) // 85vh
  assert.equal(huge.x, 112)
  assert.equal(huge.y, 756)
})

test('centered, drag and edge resize stay inside the viewport', () => {
  const centered = centeredDialogRect(360, 300, 1200, 800)
  assert.equal(centered.x, 420)
  assert.equal(centered.y, 250)
  const dragged = dragDialogRect(centered, 5000, -5000, 1200, 800)
  assert.equal(dragged.x, 832)
  assert.equal(dragged.y, 8)
  const grown = resizeDialogRect(centered, 'se', 100, 50, 1200, 800)
  assert.deepEqual(grown, { x: 420, y: 250, width: 460, height: 350 })
  const shrunk = resizeDialogRect(centered, 'nw', 100, 50, 1200, 800)
  assert.equal(shrunk.width, 320)
  assert.equal(shrunk.height, 250)
  assert.equal(shrunk.x, 460)
  assert.equal(shrunk.y, 300)
})

test('dialog geometry persists per kind without touching other storage', () => {
  const map = new Map()
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) }
  saveDialogGeometry('new-group', { x: 20, y: 30, width: 400, height: 260 }, storage)
  saveDialogGeometry('icon', { x: 50, y: 60, width: 500, height: 350 }, storage)
  assert.deepEqual(readDialogGeometries(storage), {
    'new-group': { x: 20, y: 30, width: 400, height: 260 },
    icon: { x: 50, y: 60, width: 500, height: 350 },
  })
  assert.ok(map.has(DIALOG_GEOMETRY_KEY))
  map.set(DIALOG_GEOMETRY_KEY, '{broken')
  assert.deepEqual(readDialogGeometries(storage), {})
})

test('clearDialogGeometries removes only the geometry key', () => {
  const map = new Map([
    [DIALOG_GEOMETRY_KEY, JSON.stringify({ icon: { x: 1, y: 2, width: 420, height: 300 } })],
    ['unrelated', 'keep'],
  ])
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
  clearDialogGeometries(storage)
  assert.equal(map.has(DIALOG_GEOMETRY_KEY), false)
  assert.equal(map.get('unrelated'), 'keep')
})
