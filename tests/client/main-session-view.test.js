import test from 'node:test'
import assert from 'node:assert/strict'

import { selectMainSessionView } from '../../src/client/main-session-view.js'
import { mainSessionIdOf } from '../../src/core/filter.js'

const snapshot = () => {
  const main = { id: 'main', origin: 'main', title: 'Main' }
  const plainSub = { id: 'sub', origin: 'subagent', parentSessionId: 'main' }
  const currentSub = { id: 'current-sub', origin: 'subagent', parentSessionId: 'main', retainedBy: { mainView: 1 } }
  const otherSub = { id: 'other-sub', origin: 'subagent', parentSessionId: 'main' }
  return {
    ids: ['main', 'sub', 'current-sub', 'other-sub'],
    byId: { main, sub: plainSub, 'current-sub': currentSub, 'other-sub': otherSub },
    projectionsBySession: {
      main: { values: { subagentCatalog: [] } },
      sub: { values: { subagentCatalog: [] } },
      'current-sub': { values: { subagentCatalog: [] } },
      'other-sub': { values: { subagentCatalog: [] } },
    },
    phase: 'ready',
  }
}

test('main session view keeps main rows and the currently open subagent only', () => {
  const source = snapshot()
  const view = selectMainSessionView(source)
  assert.deepEqual(view.ids, ['main', 'current-sub'])
  assert.equal(view.byId.main, source.byId.main)
  assert.equal(view.byId['current-sub'], source.byId['current-sub'])
  assert.equal(view.byId.sub, undefined)
  assert.deepEqual(Object.keys(view.projectionsBySession), ['main'])
  assert.equal(view.phase, 'ready')
  assert.deepEqual(source.ids, ['main', 'sub', 'current-sub', 'other-sub'])
  assert.equal(mainSessionIdOf(view), 'main')
})

test('main session view is a no-op for a null snapshot', () => {
  assert.equal(selectMainSessionView(null), null)
})
