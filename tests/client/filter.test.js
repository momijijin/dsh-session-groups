import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVisibleTree,
  countTreeSessions,
  currentSessionIdOf,
  isArchived,
  isSubagent,
  nextArchiveFilter,
  sessionTitle,
} from '../../src/client/filter.js'
import { assignSession, createGroup, emptyDoc } from '../../src/shared/model.js'

const sessionsById = {
  s1: { id: 's1', displayTitle: 'alpha', blank: false, origin: undefined },
  s2: { id: 's2', title: 'beta', blank: false },
  s3: { id: 's3', blank: true },
  s4: { id: 's4', displayTitle: 'sub', origin: 'subagent', parentId: 's1' },
  s5: { id: 's5', displayTitle: 'archived', blank: false },
  s6: { id: 's6', displayTitle: 'current blank', blank: true },
}

const docWithGroups = () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'A' })
  const groupId = doc.groups[0].id
  doc = createGroup(doc, { name: 'B' })
  doc = assignSession(doc, 's1', groupId)
  doc = assignSession(doc, 's2', groupId)
  doc = assignSession(doc, 's5', groupId)
  return { doc, groupId }
}

test('sessionTitle follows blank/displayTitle/title rules', () => {
  assert.equal(sessionTitle(sessionsById.s1), 'alpha')
  assert.equal(sessionTitle(sessionsById.s2), 'beta')
  assert.equal(sessionTitle(sessionsById.s3, { blankLabel: '新会话' }), '新会话')
  assert.equal(sessionTitle({ id: 'x', blank: true, title: '改名后的空会话' }, { blankLabel: '新会话' }), '改名后的空会话')
  assert.equal(sessionTitle({ id: 'x' }, { untitledLabel: '未命名' }), '未命名')
  assert.equal(sessionTitle(null), '未命名')
})

test('subagent detection uses origin only and tolerates missing fields', () => {
  assert.equal(isSubagent(sessionsById.s4), true)
  assert.equal(isSubagent(sessionsById.s1), false)
  assert.equal(isSubagent({ id: 'fork', parentId: 's1' }), false)
  assert.equal(isSubagent(undefined), false)
})

test('current session derives from retainedBy.mainView > 0', () => {
  const snapshot = {
    ids: ['a', 'b'],
    byId: { a: { retainedBy: {} }, b: { retainedBy: { mainView: 1, sidebarView: 1 } } },
  }
  assert.equal(currentSessionIdOf(snapshot), 'b')
  assert.equal(currentSessionIdOf({ ids: [], byId: {} }), null)
})

test('archive tri-state includes/excludes rows and keeps groups', () => {
  const { doc } = docWithGroups()
  const hidden = buildVisibleTree(doc, sessionsById, [], { archivedSessionIds: ['s5'], filter: 'hidden' })
  assert.equal(countTreeSessions(hidden), 2)
  const all = buildVisibleTree(doc, sessionsById, [], { archivedSessionIds: ['s5'], filter: 'all' })
  assert.equal(countTreeSessions(all), 3)
  const only = buildVisibleTree(doc, sessionsById, [], { archivedSessionIds: ['s5'], filter: 'only' })
  assert.equal(countTreeSessions(only), 1)
  // Groups never disappear: empty group is still returned with emptyVisible true.
  assert.equal(only.groups.length, 2)
  const groupWithNoVisible = only.groups.find((node) => node.group.name === 'A')
  assert.equal(groupWithNoVisible.emptyVisible, false)
})

test('buildVisibleTree forwards host subagent counts without inventing them', () => {
  const { doc, groupId } = docWithGroups()
  const tree = buildVisibleTree(doc, sessionsById, [], {
    filter: 'all',
    subagentCounts: new Map([[ 's1', 3 ]]),
  })
  const node = tree.groups.find((group) => group.group.id === groupId).children.find((child) => child.session.id === 's1')
  assert.equal(node.runningSubagentCount, 3)
  const sibling = tree.groups.find((group) => group.group.id === groupId).children.find((child) => child.session.id === 's2')
  assert.equal(sibling.runningSubagentCount, 0)
})

test('subagent and non-current blank rows are excluded from the tree', () => {
  const { doc } = docWithGroups()
  const tree = buildVisibleTree(doc, sessionsById, [], { filter: 'all', currentSessionId: null })
  const ids = JSON.stringify(tree)
  assert.equal(ids.includes('"s4"'), false)
  assert.equal(ids.includes('"s3"'), false)
  const withCurrent = buildVisibleTree(doc, sessionsById, [], { filter: 'all', currentSessionId: 's3' })
  assert.equal(JSON.stringify(withCurrent).includes('"s3"'), true)
})

test('ungrouped derives unassigned sessions newest-first', () => {
  const { doc } = docWithGroups()
  const rows = {
    ...sessionsById,
    u1: { id: 'u1', displayTitle: 'older', updatedAt: 10 },
    u2: { id: 'u2', displayTitle: 'newer', updatedAt: 20 },
  }
  const tree = buildVisibleTree(doc, rows, [], { filter: 'all' })
  assert.deepEqual(tree.ungrouped.map((node) => node.session.id), ['u2', 'u1'])
})

test('archive filter cycles and isArchived uses the host array', () => {
  assert.equal(nextArchiveFilter('hidden'), 'all')
  assert.equal(nextArchiveFilter('all'), 'only')
  assert.equal(nextArchiveFilter('only'), 'hidden')
  assert.equal(isArchived(['a'], 'a'), true)
  assert.equal(isArchived(['a'], 'b'), false)
  assert.equal(isArchived('a', 'a'), false)
})
