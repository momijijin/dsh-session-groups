import test from 'node:test'
import assert from 'node:assert/strict'

import { clampMenuPosition, isMenuKey, menuAnchorFromEvent, menuAnchorFromRow } from '../../src/client/menu-position.js'

const viewport = { width: 500, height: 400 }
const row = { getBoundingClientRect: () => ({ left: 30, bottom: 90 }) }

test('clampMenuPosition keeps the menu inside an 8px viewport inset', () => {
  assert.deepEqual(clampMenuPosition({ x: 100, y: 120, width: 200, height: 250, viewportWidth: 500, viewportHeight: 400 }), { x: 100, y: 120 })
  assert.deepEqual(clampMenuPosition({ x: -20, y: -20, width: 200, height: 250, viewportWidth: 500, viewportHeight: 400 }), { x: 8, y: 8 })
  assert.deepEqual(clampMenuPosition({ x: 480, y: 380, width: 200, height: 250, viewportWidth: 500, viewportHeight: 400 }), { x: 292, y: 142 })
  // A menu taller than the viewport still pins to the padding row.
  assert.deepEqual(clampMenuPosition({ x: 100, y: 100, width: 200, height: 900, viewportWidth: 500, viewportHeight: 400 }), { x: 100, y: 8 })
})

test('context-menu pointer anchor offsets +2px and clamps at the edges', () => {
  assert.deepEqual(menuAnchorFromEvent({ clientX: 100, clientY: 50 }, viewport), { x: 102, y: 52, anchorX: 102, anchorY: 52 })
  assert.deepEqual(menuAnchorFromEvent({ clientX: 700, clientY: 390 }, viewport), { x: 272, y: 72, anchorX: 702, anchorY: 392 })
})

test('keyboard anchor uses row left and row bottom + 8px', () => {
  assert.deepEqual(menuAnchorFromRow(row, { width: 500, height: 800 }), { x: 30, y: 98, anchorX: 30, anchorY: 98 })
})

test('Shift+F10 and ContextMenu are the only keyboard menu keys', () => {
  assert.equal(isMenuKey({ key: 'F10', shiftKey: true }), true)
  assert.equal(isMenuKey({ key: 'ContextMenu' }), true)
  assert.equal(isMenuKey({ key: 'F10' }), false)
  assert.equal(isMenuKey({ key: 'Enter' }), false)
})
