import test from 'node:test'
import assert from 'node:assert/strict'

import { dialogKeyboardDelta, dialogKeyboardStep } from '../../src/client/dialog-keyboard.js'

test('dialog keyboard movement uses a 10px step and 1px with Shift', () => {
  assert.equal(dialogKeyboardStep(false), 10)
  assert.equal(dialogKeyboardStep(true), 1)
  assert.deepEqual(dialogKeyboardDelta('ArrowRight', false), { dx: 10, dy: 0 })
  assert.deepEqual(dialogKeyboardDelta('ArrowLeft', false), { dx: -10, dy: 0 })
  assert.deepEqual(dialogKeyboardDelta('ArrowUp', false), { dx: 0, dy: -10 })
  assert.deepEqual(dialogKeyboardDelta('ArrowDown', true), { dx: 0, dy: 1 })
  assert.deepEqual(dialogKeyboardDelta('Escape', false), { dx: 0, dy: 0 })
  assert.deepEqual(dialogKeyboardDelta('Home', false), { dx: 0, dy: 0 })
})
