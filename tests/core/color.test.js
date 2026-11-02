import test from 'node:test'
import assert from 'node:assert/strict'
import { groupColorCss } from '../../src/core/color.js'

test('groupColorCss prefers a valid custom hex and falls back to the palette token', () => {
  assert.equal(groupColorCss({ colorHex: '#aabbcc', color: 'blue' }), '#aabbcc')
  assert.equal(groupColorCss({ color: 'green' }), 'var(--dsg-color-green)')
  assert.equal(groupColorCss({ color: 'unknown' }), 'var(--dsg-color-blue)')
  assert.equal(groupColorCss(null), 'var(--dsg-color-blue)')
})

