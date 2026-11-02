// tests/client/virtual-list.test.js
//
// Pure windowing math for the 0.2.3 virtualized ungrouped list. These tests pin
// the exact spacer arithmetic (scroll height must not jump) and the DOM bound
// used by the large-list probe (<80 ungrouped rows for 1,500 logical rows).

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeVirtualWindow,
  isVirtualIndexVisible,
  virtualScrollOffset,
  VIRTUAL_HEADER_HEIGHT,
  VIRTUAL_OVERSCAN,
  VIRTUAL_ROW_GAP,
  VIRTUAL_ROW_HEIGHT,
  VIRTUAL_STEP,
} from '../../src/core/virtual-list.js'

const heightOf = (win, total, { rowHeight = VIRTUAL_ROW_HEIGHT, gap = VIRTUAL_ROW_GAP } = {}) => {
  if (total === 0) return 0
  const count = win.count
  const children = count + (win.topPad > 0 ? 1 : 0) + (win.bottomPad > 0 ? 1 : 0)
  const gaps = Math.max(0, children - 1)
  return win.topPad + count * rowHeight + gaps * gap + win.bottomPad
}

const fullHeight = (total, { rowHeight = VIRTUAL_ROW_HEIGHT, gap = VIRTUAL_ROW_GAP } = {}) => total * (rowHeight + gap) - gap

test('constants match the CSS layout contract', () => {
  assert.equal(VIRTUAL_ROW_HEIGHT, 32)
  assert.equal(VIRTUAL_ROW_GAP, 2)
  assert.equal(VIRTUAL_STEP, 34)
  assert.equal(VIRTUAL_HEADER_HEIGHT, 34)
  assert.equal(VIRTUAL_OVERSCAN, 8)
})

test('empty list yields an empty window with no spacers', () => {
  const win = computeVirtualWindow({ rowCount: 0, scrollTop: 0, viewportHeight: 700, listTop: 38 })
  assert.deepEqual(win, { start: 0, end: 0, count: 0, topPad: 0, bottomPad: 0, totalHeight: 0, step: 34 })
})

test('top window renders a bounded first page and one bottom spacer', () => {
  const win = computeVirtualWindow({ rowCount: 1500, scrollTop: 0, viewportHeight: 432, listTop: 38 })
  assert.equal(win.start, 0)
  assert.ok(win.end > 0 && win.end < 80, `window must stay bounded, got end=${win.end}`)
  assert.equal(win.count, win.end)
  assert.equal(win.topPad, 0)
  assert.ok(win.bottomPad > 0)
  assert.equal(heightOf(win, 1500), fullHeight(1500), 'spacers must preserve the full scroll height')
  assert.equal(win.totalHeight, fullHeight(1500))
})

test('middle window has both spacers and preserves the exact scroll height', () => {
  const win = computeVirtualWindow({ rowCount: 1500, scrollTop: 25592, viewportHeight: 432, listTop: 38 })
  assert.ok(win.start > 0)
  assert.ok(win.end < 1500)
  assert.ok(win.count < 80)
  assert.ok(win.topPad > 0 && win.bottomPad > 0)
  assert.equal(heightOf(win, 1500), fullHeight(1500))
})

test('bottom window has only a top spacer and reaches the last row', () => {
  const win = computeVirtualWindow({ rowCount: 1500, scrollTop: 1_000_000, viewportHeight: 432, listTop: 38 })
  assert.equal(win.end, 1500)
  assert.ok(win.start < 1500)
  assert.ok(win.topPad > 0)
  assert.equal(win.bottomPad, 0)
  assert.equal(win.count, 1500 - win.start)
  assert.equal(heightOf(win, 1500), fullHeight(1500))
})

test('small lists render their full logical length without spacers', () => {
  const win = computeVirtualWindow({ rowCount: 10, scrollTop: 0, viewportHeight: 432, listTop: 38 })
  assert.deepEqual({ start: win.start, end: win.end, count: win.count, topPad: win.topPad, bottomPad: win.bottomPad }, {
    start: 0,
    end: 10,
    count: 10,
    topPad: 0,
    bottomPad: 0,
  })
  assert.equal(win.totalHeight, fullHeight(10))
})

test('the normal QA fixture (25 rows) still stays inside the window + overscan', () => {
  const win = computeVirtualWindow({ rowCount: 25, scrollTop: 0, viewportHeight: 432, listTop: 38 })
  assert.equal(win.start, 0)
  assert.equal(win.end, 20)
  assert.ok(win.bottomPad > 0)
  assert.equal(heightOf(win, 25), fullHeight(25))
})

test('overscan is configurable and clamped to the list bounds', () => {
  const defaultWindow = computeVirtualWindow({ rowCount: 1500, scrollTop: 25592, viewportHeight: 432, listTop: 38 })
  const tight = computeVirtualWindow({ rowCount: 1500, scrollTop: 25592, viewportHeight: 432, listTop: 38, overscan: 0 })
  assert.ok(tight.count < defaultWindow.count)
  assert.ok(tight.count >= 11, 'a 432px viewport still needs its visible rows')
  const top = computeVirtualWindow({ rowCount: 5, scrollTop: 0, viewportHeight: 100, listTop: 0, overscan: 50 })
  assert.equal(top.start, 0)
  assert.equal(top.end, 5)
})

test('row height/gap overrides keep the spacer sum exact', () => {
  const win = computeVirtualWindow({ rowCount: 300, scrollTop: 5000, viewportHeight: 300, listTop: 10, rowHeight: 20, gap: 4, overscan: 2 })
  assert.equal(heightOf(win, 300, { rowHeight: 20, gap: 4 }), fullHeight(300, { rowHeight: 20, gap: 4 }))
  assert.equal(win.step, 24)
})

test('malformed input is treated as zero/empty instead of NaN', () => {
  const win = computeVirtualWindow({ rowCount: Number.NaN, scrollTop: Number.NaN, viewportHeight: Number.NaN, listTop: Number.NaN })
  assert.deepEqual(win, { start: 0, end: 0, count: 0, topPad: 0, bottomPad: 0, totalHeight: 0, step: 34 })
  const negative = computeVirtualWindow({ rowCount: -10, scrollTop: -1, viewportHeight: -1, listTop: -1 })
  assert.equal(negative.end, 0)
  assert.equal(negative.count, 0)
})

test('isVirtualIndexVisible is inclusive-start / exclusive-end', () => {
  const win = { start: 10, end: 20 }
  assert.equal(isVirtualIndexVisible(win, 9), false)
  assert.equal(isVirtualIndexVisible(win, 10), true)
  assert.equal(isVirtualIndexVisible(win, 19), true)
  assert.equal(isVirtualIndexVisible(win, 20), false)
  assert.equal(isVirtualIndexVisible(win, 1.5), false)
})

test('virtualScrollOffset centres a far index and stays inside the scroll range', () => {
  const options = { listTop: 38, viewportHeight: 432, rowCount: 1500 }
  const first = virtualScrollOffset(0, options)
  assert.equal(first, 0)
  const middle = virtualScrollOffset(750, options)
  assert.ok(middle > 0 && middle < 1500 * 34)
  const last = virtualScrollOffset(1499, options)
  const maxScroll = 1500 * 34 - 2 - 432
  assert.equal(last, maxScroll)
  assert.ok(last <= maxScroll)
})
