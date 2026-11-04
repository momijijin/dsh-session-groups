import test from 'node:test'
import assert from 'node:assert/strict'
import {
  UI_SOFT_DEPTH,
  displayDepth,
  emptyGroups,
  expandAncestors,
  flattenTree,
  groupAncestors,
  groupPath,
  isExpanded,
  runningSubagentCount,
  runningSubagentCounts,
  runningSessionsByGroup,
  blockedSessionsByGroup,
  unreadSessionsByGroup,
  statusSectionsByGroup,
  sessionStatuses,
  siblingNeighbors,
  sessionContainer,
  sessionNeighbors,
} from '../../src/core/tree.js'
import { assignSession, createGroup, emptyDoc } from '../../src/shared/model.js'

const nestedDoc = () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'A' })
  const a = doc.groups[0].id
  doc = createGroup(doc, { name: 'A1', parentId: a })
  const a1 = doc.groups.find((group) => group.name === 'A1').id
  doc = createGroup(doc, { name: 'A2', parentId: a })
  doc = createGroup(doc, { name: 'B' })
  doc = assignSession(doc, 's1', a1)
  doc = assignSession(doc, 's2', a)
  return { doc, a, a1 }
}

const makeTree = () => ({
  groups: [
    {
      kind: 'group',
      group: { id: 'a', name: 'A', parentId: null, sessionIds: ['s2'] },
      visibleCount: 2,
      emptyVisible: false,
      children: [
        {
          kind: 'group',
          group: { id: 'a1', name: 'A1', parentId: 'a', sessionIds: ['s1'] },
          visibleCount: 1,
          emptyVisible: false,
          children: [{ kind: 'session', session: { id: 's1' }, archived: false }],
        },
        { kind: 'session', session: { id: 's2' }, archived: false },
      ],
    },
    { kind: 'group', group: { id: 'b', name: 'B', parentId: null, sessionIds: [] }, visibleCount: 0, emptyVisible: true, children: [] },
  ],
  ungrouped: [{ kind: 'session', session: { id: 'u1' }, archived: false }],
})

test('flattenTree keeps subgroups before sessions and appends ungrouped', () => {
  const rows = flattenTree(makeTree(), {})
  assert.deepEqual(
    rows.map((row) => (row.kind === 'group' ? `g:${row.node.group.id}` : `s:${row.node.session.id}`)),
    ['g:a', 'g:a1', 's:s1', 's:s2', 'g:b', 's:u1']
  )
  assert.equal(rows[1].depth, 1)
  assert.equal(rows[4].depth, 0)
})

test('flattenTree hides children of collapsed groups only', () => {
  const rows = flattenTree(makeTree(), { a1: true, b: true })
  assert.deepEqual(
    rows.map((row) => (row.kind === 'group' ? `g:${row.node.group.id}` : `s:${row.node.session.id}`)),
    ['g:a', 'g:a1', 's:s2', 'g:b', 's:u1']
  )
})

test('ancestors and expansion patches walk to the root', () => {
  const { doc, a, a1 } = nestedDoc()
  assert.deepEqual(groupAncestors(doc, a1), [a])
  assert.deepEqual(groupAncestors(doc, a), [])
  const collapsed = { [a]: true }
  assert.deepEqual(expandAncestors(collapsed, doc, a1), {})
  assert.equal(isExpanded(collapsed, a), false)
  assert.equal(isExpanded(collapsed, a1), true)
})

test('groupPath and displayDepth', () => {
  const { doc, a, a1 } = nestedDoc()
  assert.equal(groupPath(doc, a1), 'A / A1')
  assert.equal(groupPath(doc, a), 'A')
  assert.equal(displayDepth(0), 0)
  assert.equal(displayDepth(UI_SOFT_DEPTH + 3), UI_SOFT_DEPTH)
})

test('emptyGroups lists zero-visible groups', () => {
  const groups = emptyGroups(makeTree())
  assert.deepEqual(groups.map((node) => node.group.id), ['b'])
})

test('sessionStatuses follows the official priority and labels', () => {
  const shape = (list) => list.map((status) => [status.state, status.labelKey, status.compactKey ?? null, status.params?.n ?? null])

  assert.deepEqual(shape(sessionStatuses(null)), [['idle', 'status.idle', null, null]])
  assert.deepEqual(shape(sessionStatuses({ running: true })), [['ongoing', 'status.running', null, null]])
  assert.deepEqual(shape(sessionStatuses({ completionUnread: true })), [['done', 'status.completed', null, null]])
  assert.deepEqual(shape(sessionStatuses({ pendingInteraction: { kind: 'approval' } })), [
    ['warning', 'status.waitingApproval', 'status.compact.approval', null],
  ])
  assert.deepEqual(shape(sessionStatuses({ pendingInteraction: { kind: 'plan-review' } })), [
    ['warning', 'status.planReview', 'status.compact.planReview', null],
  ])
  assert.deepEqual(shape(sessionStatuses({ pendingInteraction: { kind: 'question' } })), [
    ['warning', 'status.waitingAnswer', 'status.compact.answer', null],
  ])

  // Pending outranks running and completion; running outranks completion.
  assert.equal(sessionStatuses({ running: true, completionUnread: true })[0].labelKey, 'status.running')
  assert.equal(
    sessionStatuses({ pendingInteraction: { kind: 'approval' }, running: true, completionUnread: true })[0].labelKey,
    'status.waitingApproval'
  )

  // Only official pending kinds are visible; unknown kinds fall through.
  assert.deepEqual(shape(sessionStatuses({ pendingInteraction: { kind: 'mystery' }, running: true })), [
    ['ongoing', 'status.running', null, null],
  ])
  assert.deepEqual(shape(sessionStatuses({ pendingInteraction: { kind: 'mystery' } })), [['idle', 'status.idle', null, null]])
})

test('subagentsRunning is an official secondary status, never a new primary', () => {
  const secondary = (list) => list[list.length - 1]
  const shape = (status) => [status.state, status.labelKey, status.params?.n ?? null]

  // Subagents coexist with pending/running as the second status.
  const pending = sessionStatuses({ pendingInteraction: { kind: 'question' } }, { runningSubagentCount: 2 })
  assert.equal(pending.length, 2)
  assert.equal(pending[0].labelKey, 'status.waitingAnswer')
  assert.deepEqual(shape(secondary(pending)), ['ongoing', 'status.subagentsRunning.other', 2])

  const running = sessionStatuses({ running: true }, { runningSubagentCount: 1 })
  assert.equal(running.length, 2)
  assert.equal(running[0].labelKey, 'status.running')
  assert.deepEqual(shape(secondary(running)), ['ongoing', 'status.subagentsRunning.one', 1])

  // Subagents-only outranks completion and uses the official ongoing renderer.
  const only = sessionStatuses({ completionUnread: true }, { runningSubagentCount: 3 })
  assert.deepEqual(shape(only[0]), ['ongoing', 'status.subagentsRunning.other', 3])

  // Invalid counts are ignored instead of inventing a status.
  for (const count of [0, -1, 1.5, '2', NaN, null, undefined]) {
    assert.deepEqual(shape(sessionStatuses(null, { runningSubagentCount: count })[0]), ['idle', 'status.idle', null])
  }
})

test('runningSubagentCount uses host projections with a session-row fallback', () => {
  const sessions = {
    ids: ['p', 'c1', 'c2', 'c3'],
    byId: {
      p: { id: 'p', running: true },
      c1: { id: 'c1', origin: 'subagent', parentId: 'p', running: true },
      c2: { id: 'c2', origin: 'subagent', parentId: 'p', running: false },
      c3: { id: 'c3', origin: 'subagent', parentId: 'p', running: true },
    },
    projectionsBySession: {
      p: { values: { subagentCatalog: [{ id: 'c1' }, { id: 'c2' }, { id: 'ext', mode: 'external' }] } },
    },
  }
  const statuses = new Map([
    ['c1', { running: true }],
    ['c2', { running: false }],
    ['ext', { running: true }],
  ])
  assert.equal(runningSubagentCount(sessions, 'p', statuses), 2, 'status running outranks row running, external catalog rows count too')
  assert.equal(runningSubagentCount(sessions, 'p', new Map()), 1, 'missing status falls back to byId.running')
  assert.equal(runningSubagentCount(sessions, 'missing', statuses), 0)
  assert.equal(runningSubagentCount(null, 'p', statuses), 0)

  const counts = runningSubagentCounts(sessions, statuses)
  assert.deepEqual([...counts], [['p', 2]])
  assert.equal(runningSubagentCounts({ projectionsBySession: { p: { values: {} } } }, statuses).size, 0)
  assert.equal(runningSubagentCounts(null, null).size, 0)
})

test('siblingNeighbors reports previous/next ids in display order', () => {
  const { doc, a } = nestedDoc()
  const rootIds = doc.groups.filter((group) => group.parentId === null).map((group) => group.id)
  const b = rootIds.find((id) => id !== a)
  assert.deepEqual(siblingNeighbors(doc, a), { previous: null, next: b })
  assert.deepEqual(siblingNeighbors(doc, b), { previous: a, next: null })
})

test('runningSessionsByGroup counts spinner sessions by direct parent group', () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'Alpha' })
  const alpha = doc.groups[0].id
  doc = createGroup(doc, { name: 'Beta' })
  const beta = doc.groups[1].id
  doc = assignSession(doc, 'a1', alpha)
  doc = assignSession(doc, 'a2', alpha)
  doc = assignSession(doc, 'b1', beta)
  doc = assignSession(doc, 'u1', null)
  doc = assignSession(doc, 'sub', alpha)
  const byId = {
    a1: { id: 'a1', origin: 'main', title: 'A1' },
    a2: { id: 'a2', origin: 'main', title: 'A2', running: true },
    b1: { id: 'b1', origin: 'main', title: 'B1' },
    u1: { id: 'u1', origin: 'main', title: 'U1' },
    sub: { id: 'sub', origin: 'subagent', title: 'Sub' },
  }
  const statuses = new Map([
    ['a1', { running: true }],
    ['b1', { running: true }],
    ['u1', { running: true }],
    ['sub', { running: true }],
  ])
  const result = runningSessionsByGroup(doc, byId, statuses, ['b1'], new Map())
  assert.equal(result.count, 3)
  assert.deepEqual(result.sections.map((section) => section.groupName), ['Alpha', 'Beta', ''])
  assert.deepEqual(result.sections[0].sessions, [{ sessionId: 'a1', archived: false }])
  assert.deepEqual(result.sections[1].sessions, [{ sessionId: 'b1', archived: true }])
  assert.deepEqual(result.sections[2].sessions, [{ sessionId: 'u1', archived: false }])
})

test('blocked and unread status projections use the same grouped shape', () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'Alpha' })
  const alpha = doc.groups[0].id
  doc = createGroup(doc, { name: 'Beta' })
  const beta = doc.groups[1].id
  doc = assignSession(doc, 'wait', alpha)
  doc = assignSession(doc, 'unread', beta)
  doc = assignSession(doc, 'running', beta)
  const byId = {
    wait: { id: 'wait', origin: 'main', title: 'Wait' },
    unread: { id: 'unread', origin: 'main', title: 'Unread' },
    running: { id: 'running', origin: 'main', title: 'Running' },
  }
  const statuses = new Map([
    ['wait', { pendingInteraction: { kind: 'question' } }],
    ['unread', { completionUnread: true }],
    ['running', { running: true, completionUnread: true }],
  ])
  const blocked = blockedSessionsByGroup(doc, byId, statuses, [], new Map())
  assert.equal(blocked.count, 1)
  assert.deepEqual(blocked.sections[0].sessions, [{ sessionId: 'wait', archived: false }])
  const unread = unreadSessionsByGroup(doc, byId, statuses, [], new Map())
  assert.equal(unread.count, 1, 'a running unread session stays in running, not unread')
  assert.deepEqual(unread.sections[0].sessions, [{ sessionId: 'unread', archived: false }])
  const all = statusSectionsByGroup(doc, byId, statuses, [], new Map())
  assert.equal(all.blocked.count, 1)
  assert.equal(all.unread.count, 1)
  assert.equal(all.running.count, 1)
})

test('session move neighbors follow the stored group or ungrouped order', () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'A' })
  const groupId = doc.groups[0].id
  doc = assignSession(doc, 's1', groupId)
  doc = assignSession(doc, 's2', groupId)
  doc = assignSession(doc, 's3', groupId)
  doc = assignSession(doc, 'u1', null)
  doc = assignSession(doc, 'u2', null)
  assert.deepEqual(sessionContainer(doc, 's2'), { groupId, ids: ['s1', 's2', 's3'] })
  assert.deepEqual(sessionNeighbors(doc, 's1'), { previous: null, next: 's2' })
  assert.deepEqual(sessionNeighbors(doc, 's2'), { previous: 's1', next: 's3' })
  assert.deepEqual(sessionNeighbors(doc, 's3'), { previous: 's2', next: null })
  assert.deepEqual(sessionContainer(doc, 'u2'), { groupId: null, ids: ['u1', 'u2'] })
  assert.deepEqual(sessionNeighbors(doc, 'u2'), { previous: 'u1', next: null })
  assert.deepEqual(sessionNeighbors(doc, 'derived'), { previous: null, next: null })
})
