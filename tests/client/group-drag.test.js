import test from 'node:test'
import assert from 'node:assert/strict'
import { GROUP_DRAG_MIME, resolveGroupDrop } from '../../src/core/group-drag.js'
import { assignSession, childrenOf, createGroup, emptyDoc, findGroup, moveGroup } from '../../src/shared/model.js'

const idOf = (doc, name) => {
  const group = doc.groups.find((item) => item.name === name)
  assert.ok(group, `missing group ${name}`)
  return group.id
}

const namesOf = (groups) => groups.map((group) => group.name)

const makeDoc = (rootNames) => rootNames.reduce((doc, name) => createGroup(doc, { name }), emptyDoc())

const withChild = (doc, parentName, name) => createGroup(doc, { name, parentId: idOf(doc, parentName) })

const resolve = (doc, draggedId, target) => resolveGroupDrop({ doc, draggedId, target })

test('exports the group drag MIME type', () => {
  assert.equal(GROUP_DRAG_MIME, 'application/x-dsh-group-id')
})

test('before/after on root siblings resolves the post-removal index', () => {
  const doc = makeDoc(['A', 'B', 'C'])
  assert.deepEqual(resolve(doc, idOf(doc, 'A'), { kind: 'after', targetId: idOf(doc, 'B') }), { parentId: null, index: 1 })
  assert.deepEqual(resolve(doc, idOf(doc, 'C'), { kind: 'before', targetId: idOf(doc, 'B') }), { parentId: null, index: 1 })
})

test('before/after across parents keeps the dragged subtree and never mutates the doc', () => {
  let doc = makeDoc(['A', 'B'])
  doc = withChild(doc, 'A', 'A1')
  doc = withChild(doc, 'A1', 'A1a')
  const a1 = idOf(doc, 'A1')
  const a1a = idOf(doc, 'A1a')
  const snapshot = JSON.stringify(doc)

  const resolved = resolve(doc, a1, { kind: 'after', targetId: idOf(doc, 'B') })
  assert.deepEqual(resolved, { parentId: null, index: 2 })

  const moved = moveGroup(doc, a1, resolved.parentId, resolved.index)
  assert.equal(findGroup(moved, a1).parentId, null)
  assert.deepEqual(namesOf(childrenOf(moved, null)), ['A', 'B', 'A1'])
  assert.equal(findGroup(moved, a1a).parentId, a1)
  assert.equal(JSON.stringify(doc), snapshot)
})

test('before/after inside a nested parent reparents into that group', () => {
  let doc = makeDoc(['P', 'D'])
  doc = withChild(doc, 'P', 'B')
  doc = withChild(doc, 'P', 'C')
  const p = idOf(doc, 'P')
  const d = idOf(doc, 'D')

  const resolved = resolve(doc, d, { kind: 'before', targetId: idOf(doc, 'C') })
  assert.deepEqual(resolved, { parentId: p, index: 1 })

  const moved = moveGroup(doc, d, resolved.parentId, resolved.index)
  assert.deepEqual(namesOf(childrenOf(moved, p)), ['B', 'D', 'C'])
})

test('child target appends into a group with sessions and no child groups', () => {
  let doc = makeDoc(['A', 'B'])
  doc = assignSession(doc, 's1', idOf(doc, 'B'))
  doc = assignSession(doc, 's2', idOf(doc, 'B'))
  const a = idOf(doc, 'A')
  const b = idOf(doc, 'B')

  assert.deepEqual(resolve(doc, a, { kind: 'child', parentId: b, beforeGroupId: null }), { parentId: b, index: 0 })

  const moved = moveGroup(doc, a, b, 0)
  assert.deepEqual(namesOf(childrenOf(moved, b)), ['A'])
  assert.deepEqual(findGroup(moved, b).sessionIds, ['s1', 's2'])
})

test('empty group resolves to index 0 for the first child', () => {
  const doc = makeDoc(['A', 'E'])
  const a = idOf(doc, 'A')
  const e = idOf(doc, 'E')

  assert.deepEqual(resolve(doc, a, { kind: 'child', parentId: e, beforeGroupId: null }), { parentId: e, index: 0 })

  const moved = moveGroup(doc, a, e, 0)
  assert.equal(findGroup(moved, a).parentId, e)
  assert.deepEqual(namesOf(childrenOf(moved, e)), ['A'])
})

test('child slots resolve anchors against the latest children with same-parent correction', () => {
  let doc = makeDoc(['P'])
  doc = withChild(doc, 'P', 'B')
  doc = withChild(doc, 'P', 'A')
  doc = withChild(doc, 'P', 'C')
  const p = idOf(doc, 'P')
  const a = idOf(doc, 'A')
  assert.deepEqual(namesOf(childrenOf(doc, p)), ['B', 'A', 'C'])

  assert.deepEqual(resolve(doc, a, { kind: 'child', parentId: p, beforeGroupId: idOf(doc, 'B') }), { parentId: p, index: 0 })
  assert.deepEqual(resolve(doc, a, { kind: 'child', parentId: p, beforeGroupId: idOf(doc, 'C') }), { parentId: p, index: 1 })
  const atEnd = resolve(doc, a, { kind: 'child', parentId: p, beforeGroupId: null })
  assert.deepEqual(atEnd, { parentId: p, index: 2 })

  const moved = moveGroup(doc, a, atEnd.parentId, atEnd.index)
  assert.deepEqual(namesOf(childrenOf(moved, p)), ['B', 'C', 'A'])
})

test('rapid child-slot drags re-resolve the anchor instead of reusing a stale index', () => {
  let doc = makeDoc(['P', 'A', 'B'])
  doc = withChild(doc, 'P', 'X')
  const p = idOf(doc, 'P')
  const a = idOf(doc, 'A')
  const b = idOf(doc, 'B')
  const x = idOf(doc, 'X')

  const target = { kind: 'child', parentId: p, beforeGroupId: x }
  const first = resolve(doc, a, target)
  assert.deepEqual(first, { parentId: p, index: 0 })
  const afterFirst = moveGroup(doc, a, first.parentId, first.index)
  assert.deepEqual(namesOf(childrenOf(afterFirst, p)), ['A', 'X'])

  const second = resolve(afterFirst, b, target)
  assert.deepEqual(second, { parentId: p, index: 1 })
  const afterSecond = moveGroup(afterFirst, b, second.parentId, second.index)
  assert.deepEqual(namesOf(childrenOf(afterSecond, p)), ['A', 'B', 'X'])

  const endTarget = { kind: 'child', parentId: p, beforeGroupId: null }
  const firstEnd = resolve(doc, a, endTarget)
  assert.deepEqual(firstEnd, { parentId: p, index: 1 })
  const afterFirstEnd = moveGroup(doc, a, firstEnd.parentId, firstEnd.index)
  assert.deepEqual(namesOf(childrenOf(afterFirstEnd, p)), ['X', 'A'])
  assert.deepEqual(resolve(afterFirstEnd, b, endTarget), { parentId: p, index: 2 })
})

test('root-end resolves to the root count and appends after moveGroup', () => {
  let doc = makeDoc(['A', 'B', 'C'])
  doc = withChild(doc, 'A', 'A1')
  const a = idOf(doc, 'A')
  const a1 = idOf(doc, 'A1')

  assert.deepEqual(resolve(doc, a, { kind: 'root-end' }), { parentId: null, index: 3 })
  const moved = moveGroup(doc, a, null, 3)
  assert.deepEqual(namesOf(childrenOf(moved, null)), ['B', 'C', 'A'])
  assert.equal(findGroup(moved, a1).parentId, a)

  assert.deepEqual(resolve(moved, a1, { kind: 'root-end' }), { parentId: null, index: 3 })
  const movedChild = moveGroup(moved, a1, null, 3)
  assert.deepEqual(namesOf(childrenOf(movedChild, null)), ['B', 'C', 'A', 'A1'])
})

test('invalid drops are rejected with a reason and never mutate the doc', () => {
  let doc = makeDoc(['A', 'B'])
  doc = withChild(doc, 'A', 'A1')
  doc = withChild(doc, 'A1', 'A1a')
  const a = idOf(doc, 'A')
  const b = idOf(doc, 'B')
  const a1 = idOf(doc, 'A1')
  const a1a = idOf(doc, 'A1a')
  const snapshot = JSON.stringify(doc)

  const invalid = (draggedId, target) => {
    const result = resolveGroupDrop({ doc, draggedId, target })
    assert.equal(result.invalid, true)
    assert.equal(typeof result.reason, 'string')
    assert.ok(result.reason.length > 0)
  }

  invalid(a, { kind: 'before', targetId: a })
  invalid(a, { kind: 'after', targetId: a })
  invalid(a, { kind: 'child', parentId: a, beforeGroupId: null })
  invalid(a, { kind: 'child', parentId: a1, beforeGroupId: null })
  invalid(a, { kind: 'before', targetId: a1 })
  invalid(a, { kind: 'after', targetId: a1a })
  invalid('missing', { kind: 'before', targetId: b })
  invalid('', { kind: 'root-end' })
  invalid(a, { kind: 'before', targetId: 'missing' })
  invalid(a, { kind: 'child', parentId: 'missing', beforeGroupId: null })
  invalid(a, { kind: 'child', parentId: b, beforeGroupId: 'missing' })
  invalid(a, { kind: 'unknown' })
  invalid(a, null)
  assert.equal(JSON.stringify(doc), snapshot)
})

test('depth boundary: the resolver resolves the slot and moveGroup rejects the overflow', () => {
  let doc = emptyDoc()
  let parentId = null
  for (let depth = 0; depth < 8; depth += 1) {
    doc = createGroup(doc, { name: `L${depth}`, parentId })
    parentId = doc.groups[doc.groups.length - 1].id
  }
  doc = createGroup(doc, { name: 'R' })
  const r = idOf(doc, 'R')

  const atLimit = resolve(doc, r, { kind: 'child', parentId: idOf(doc, 'L6'), beforeGroupId: null })
  assert.deepEqual(atLimit, { parentId: idOf(doc, 'L6'), index: 1 })
  assert.doesNotThrow(() => moveGroup(doc, r, atLimit.parentId, atLimit.index))

  const overflow = resolve(doc, r, { kind: 'child', parentId: idOf(doc, 'L7'), beforeGroupId: null })
  assert.deepEqual(overflow, { parentId: idOf(doc, 'L7'), index: 0 })
  assert.throws(() => moveGroup(doc, r, overflow.parentId, overflow.index), /depth-exceeded/)
})
