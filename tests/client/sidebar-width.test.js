import test from 'node:test'
import assert from 'node:assert/strict'
import { clampSidebarWidth, readSidebarWidth, writeSidebarWidth, SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH_DEFAULT } from '../../src/client/sidebar-width.js'

test('clamp: min and 80%-of-viewport max', () => {
  assert.equal(clampSidebarWidth(263, 1440), 264)
  assert.equal(clampSidebarWidth(264, 1440), 264)
  assert.equal(clampSidebarWidth(760, 1440), 760)
  assert.equal(clampSidebarWidth(761, 1440), 761)
  assert.equal(clampSidebarWidth(800, 1200), 800)
  assert.equal(clampSidebarWidth(600, 700), 560) // 700 * 0.8
  assert.equal(clampSidebarWidth(600, 744), 595) // 744 * 0.8 floor
  assert.equal(clampSidebarWidth(2000, 1440), 1152) // 1440 * 0.8
  assert.equal(clampSidebarWidth(Number.NaN, 1440), SIDEBAR_WIDTH_DEFAULT)
})
test('storage: key, default, valid, invalid, throwing storage', () => {
  const map = new Map()
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) }
  assert.equal(readSidebarWidth(storage), 420)
  writeSidebarWidth(620, storage)
  assert.equal(map.get(SIDEBAR_WIDTH_KEY), '620')
  assert.equal(readSidebarWidth(storage), 620)
  map.set(SIDEBAR_WIDTH_KEY, 'nope')
  assert.equal(readSidebarWidth(storage), 420)
  assert.doesNotThrow(() => writeSidebarWidth(500, { setItem: () => { throw new Error('blocked') } }))
})
