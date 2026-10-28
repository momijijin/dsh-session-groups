import test from 'node:test'
import assert from 'node:assert/strict'
import { clampSidebarWidth, readSidebarWidth, writeSidebarWidth, SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH_DEFAULT } from '../../src/client/sidebar-width.js'

test('clamp: min-1/min/max/max+1 and viewport cap', () => {
  assert.equal(clampSidebarWidth(263, 1440), 264)
  assert.equal(clampSidebarWidth(264, 1440), 264)
  assert.equal(clampSidebarWidth(760, 1440), 760)
  assert.equal(clampSidebarWidth(761, 1440), 760)
  assert.equal(clampSidebarWidth(800, 1200), 720) // 1200-480
  assert.equal(clampSidebarWidth(600, 700), null) // max<=min -> no override
  assert.equal(clampSidebarWidth(600, 744), null) // max=264 == min -> no wider range
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
