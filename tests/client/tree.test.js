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
  siblingNeighbors,
  statusLabelKey,
  statusTone,
} from '../../src/client/tree.js'
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

test('status tone/label follow pending > running > completion > idle', () => {
  assert.equal(statusTone({ pendingInteraction: { kind: 'approval' } }), 'awaiting')
  assert.equal(statusLabelKey({ pendingInteraction: { kind: 'question' } }), 'status.waitingAnswer')
  assert.equal(statusTone({ running: true }), 'running')
  assert.equal(statusLabelKey({ running: true }), 'status.running')
  assert.equal(statusTone({ completionUnread: true }), 'done')
  assert.equal(statusLabelKey({ completionUnread: true }), 'status.completed')
  assert.equal(statusTone(null), 'idle')
  assert.equal(statusLabelKey(null), 'status.idle')
})

test('siblingNeighbors reports previous/next ids in display order', () => {
  const { doc, a } = nestedDoc()
  const rootIds = doc.groups.filter((group) => group.parentId === null).map((group) => group.id)
  const b = rootIds.find((id) => id !== a)
  assert.deepEqual(siblingNeighbors(doc, a), { previous: null, next: b })
  assert.deepEqual(siblingNeighbors(doc, b), { previous: a, next: null })
})
