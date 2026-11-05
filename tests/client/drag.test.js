import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDrop, hitTest, sameDropTarget, sessionLocation, stickyDropTarget, ungroupedBodyTarget } from '../../src/core/drag.js'
import { isCurrentGroupPosition, resolveGroupDrop } from '../../src/core/group-drag.js'
import { assignSession, createGroup, emptyDoc, findGroup } from '../../src/shared/model.js'

const docWithTwoGroups = () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'A' })
  const a = doc.groups[0].id
  doc = createGroup(doc, { name: 'B' })
  const b = doc.groups[1].id
  doc = assignSession(doc, 's1', a)
  doc = assignSession(doc, 's2', a)
  doc = assignSession(doc, 's3', b)
  return { doc, a, b }
}

test('hitTest splits session rows into before/after halves', () => {
  const source = { kind: 'session', sessionId: 's1' }
  const top = hitTest({ source, rowKind: 'session', pointerY: 10, rowTop: 0, rowHeight: 20, targetGroupId: 'g', targetSessionId: 's2' })
  assert.deepEqual(top, { kind: 'session-before', groupId: 'g', sessionId: 's2' })
  const bottom = hitTest({ source, rowKind: 'session', pointerY: 18, rowTop: 0, rowHeight: 20, targetGroupId: 'g', targetSessionId: 's2' })
  assert.deepEqual(bottom, { kind: 'session-after', groupId: 'g', sessionId: 's2' })
})

test('hitTest maps group rows, ungrouped and invalid targets', () => {
  const source = { kind: 'session', sessionId: 's1' }
  assert.deepEqual(hitTest({ source, rowKind: 'group', pointerY: 5, rowTop: 0, rowHeight: 20, targetGroupId: 'g1' }), { kind: 'group-append', groupId: 'g1' })
  assert.deepEqual(hitTest({ source, rowKind: 'group-head', pointerY: 5, rowTop: 0, rowHeight: 20, targetGroupId: 'g1' }), { kind: 'group-head', groupId: 'g1' })
  assert.deepEqual(hitTest({ source, rowKind: 'ungrouped', pointerY: 0, rowTop: 0, rowHeight: 10 }), { kind: 'ungrouped' })
  assert.deepEqual(hitTest({ source, rowKind: 'session', pointerY: 5, rowTop: 0, rowHeight: 20, targetSessionId: 's1' }), { kind: 'invalid' })
  assert.deepEqual(hitTest({ source: null, rowKind: 'group', pointerY: 5, rowTop: 0, rowHeight: 20, targetGroupId: 'g1' }), { kind: 'invalid' })
})

test('applyDrop moves a session between groups without duplicates', () => {
  const { doc, a, b } = docWithTwoGroups()
  const result = applyDrop(doc, { kind: 'session', sessionId: 's1' }, { kind: 'group-append', groupId: b })
  assert.equal(result.applied, true)
  assert.deepEqual(findGroup(result.doc, b).sessionIds, ['s3', 's1'])
  assert.deepEqual(findGroup(result.doc, a).sessionIds, ['s2'])
  const all = result.doc.groups.flatMap((group) => group.sessionIds)
  assert.equal(new Set(all).size, all.length)
})

test('applyDrop reorders inside the same group with anchor shift', () => {
  const { doc, a } = docWithTwoGroups()
  const moved = applyDrop(doc, { kind: 'session', sessionId: 's1' }, { kind: 'session-after', groupId: a, sessionId: 's2' })
  assert.equal(moved.applied, true)
  assert.deepEqual(findGroup(moved.doc, a).sessionIds, ['s2', 's1'])
  const noop = applyDrop(moved.doc, { kind: 'session', sessionId: 's1' }, { kind: 'session-after', groupId: a, sessionId: 's2' })
  assert.equal(noop.applied, false)
})

test('applyDrop group-append and group-head place the session', () => {
  const { doc, a, b } = docWithTwoGroups()
  const head = applyDrop(doc, { kind: 'session', sessionId: 's3' }, { kind: 'group-head', groupId: a })
  assert.deepEqual(findGroup(head.doc, a).sessionIds, ['s3', 's1', 's2'])
  const append = applyDrop(head.doc, { kind: 'session', sessionId: 's3' }, { kind: 'group-append', groupId: b })
  assert.deepEqual(findGroup(append.doc, b).sessionIds, ['s3'])
})

test('applyDrop ungrouped removes the session from its group', () => {
  const { doc, a } = docWithTwoGroups()
  const result = applyDrop(doc, { kind: 'session', sessionId: 's1' }, { kind: 'ungrouped' })
  assert.equal(result.applied, true)
  assert.deepEqual(findGroup(result.doc, a).sessionIds, ['s2'])
  assert.deepEqual(result.doc.ungrouped, ['s1'])
})

test('applyDrop ungrouped reorder writes the full visible order once', () => {
  const { doc } = docWithTwoGroups()
  const withUngrouped = assignSession(doc, 'u1', null)
  const visible = ['u2', 'u1']
  const result = applyDrop(withUngrouped, { kind: 'session', sessionId: 'u1' }, { kind: 'ungrouped' }, visible)
  assert.equal(result.applied, true)
  assert.deepEqual(result.doc.ungrouped, ['u1', 'u2'])
})

test('applyDrop unknown target kinds are inert and preserve document identity', () => {
  const { doc } = docWithTwoGroups()
  const result = applyDrop(doc, { kind: 'session', sessionId: 's1' }, { kind: 'unknown-target' })
  assert.equal(result.applied, false)
  assert.equal(result.doc, doc)
})

test('applyDrop invalid target returns the original doc', () => {
  const { doc } = docWithTwoGroups()
  const result = applyDrop(doc, { kind: 'session', sessionId: 's1' }, { kind: 'invalid' })
  assert.equal(result.applied, false)
  assert.equal(result.doc, doc)
})

test('sessionLocation finds group and index', () => {
  const { doc, a, b } = docWithTwoGroups()
  assert.deepEqual(sessionLocation(doc, 's2'), { groupId: a, index: 1 })
  assert.deepEqual(sessionLocation(doc, 's3'), { groupId: b, index: 0 })
  assert.deepEqual(sessionLocation(doc, 'missing'), { groupId: null, index: -1 })
})

test('group drop resolution rejects cycles and treats the current slot as a no-op', () => {
  const { doc, a } = docWithTwoGroups()
  const withChild = createGroup(doc, { name: 'child', parentId: a })
  const child = withChild.groups.find((group) => group.name === 'child')
  const withGrand = createGroup(withChild, { name: 'grand', parentId: child.id })

  // A parent cannot move below its own descendant, nor a group onto itself.
  assert.deepEqual(
    resolveGroupDrop({ doc: withGrand, draggedId: a, target: { kind: 'child', parentId: child.id } }),
    { invalid: true, reason: 'descendant' },
  )
  assert.deepEqual(
    resolveGroupDrop({ doc: withGrand, draggedId: child.id, target: { kind: 'child', parentId: child.id } }),
    { invalid: true, reason: 'self' },
  )

  // The child's current slot resolves, but the client skips the no-op move.
  const target = { kind: 'child', parentId: a, beforeGroupId: null }
  const resolved = resolveGroupDrop({ doc: withGrand, draggedId: child.id, target })
  assert.deepEqual(resolved, { parentId: a, index: 0 })
  assert.equal(isCurrentGroupPosition(withGrand, child.id, resolved, target), true)
})

test('sameDropTarget treats equivalent dragover targets as equal (0.2.2 hover dedupe)', () => {
  // The same row/zone rebuilt as a new object must be a no-op, otherwise every
  // resting dragover re-renders the whole tree.
  assert.equal(sameDropTarget(null, null), true)
  assert.equal(sameDropTarget(undefined, null), true)
  assert.equal(sameDropTarget({ kind: 'group-append', groupId: 'g1' }, { kind: 'group-append', groupId: 'g1' }), true)
  assert.equal(sameDropTarget({ kind: 'ungrouped' }, { kind: 'ungrouped' }), true)
  assert.equal(
    sameDropTarget({ kind: 'session-before', groupId: 'g1', sessionId: 's2' }, { kind: 'session-before', groupId: 'g1', sessionId: 's2' }),
    true
  )
  // undefined/null anchors are equivalent for child slots.
  assert.equal(
    sameDropTarget({ kind: 'group-child', parentId: 'g1', beforeGroupId: null }, { kind: 'group-child', parentId: 'g1' }),
    true
  )
  assert.equal(sameDropTarget({ kind: 'group-before', targetId: 'g1' }, { kind: 'group-before', targetId: 'g2' }), false)
})

test('sameDropTarget distinguishes every semantic target change', () => {
  assert.equal(sameDropTarget({ kind: 'group-append', groupId: 'g1' }, { kind: 'group-append', groupId: 'g2' }), false)
  // Crossing a row's midline must move the insertion line.
  assert.equal(
    sameDropTarget({ kind: 'session-before', groupId: 'g1', sessionId: 's2' }, { kind: 'session-after', groupId: 'g1', sessionId: 's2' }),
    false
  )
  assert.equal(
    sameDropTarget({ kind: 'group-child', parentId: 'g1', beforeGroupId: null }, { kind: 'group-child', parentId: 'g1', beforeGroupId: 'g2' }),
    false
  )
  assert.equal(sameDropTarget({ kind: 'group-before', targetId: 'g1' }, { kind: 'group-forbidden', targetId: 'g1' }), false)
  assert.equal(sameDropTarget({ kind: 'group-append', groupId: 'g1' }, null), false)
  // No target -> a target is always a change; the ref starts at null.
  assert.equal(sameDropTarget(null, { kind: 'ungrouped' }), false)
})

test('0.2.21 sticky target holds while the pointer rests inside the radius', () => {
  const target = { kind: 'session-before', sessionId: 's1' }
  const lock = { x: 100, y: 200, target }
  assert.equal(stickyDropTarget(lock, 100, 200), target)
  assert.equal(stickyDropTarget(lock, 103, 201), target)
  assert.equal(stickyDropTarget(lock, 105, 200), null)
  assert.equal(stickyDropTarget(lock, Number.NaN, 200), null)
  assert.equal(stickyDropTarget(null, 100, 200), null)
})

test('0.2.54 ungrouped body fallback follows visible rows, not the section top', () => {
  const rows = [
    { sessionId: 's1', top: 100, height: 32 },
    { sessionId: 's2', top: 134, height: 32 },
    { sessionId: 's3', top: 168, height: 32 },
  ]
  assert.deepEqual(ungroupedBodyTarget(rows, 90), { kind: 'session-before', groupId: null, sessionId: 's1' })
  assert.deepEqual(ungroupedBodyTarget(rows, 110), { kind: 'session-before', groupId: null, sessionId: 's1' })
  assert.deepEqual(ungroupedBodyTarget(rows, 130), { kind: 'session-before', groupId: null, sessionId: 's2' })
  assert.deepEqual(ungroupedBodyTarget(rows, 165), { kind: 'session-before', groupId: null, sessionId: 's3' })
  assert.deepEqual(ungroupedBodyTarget(rows, 200), { kind: 'session-after', groupId: null, sessionId: 's3' })
  assert.deepEqual(ungroupedBodyTarget([], 200), { kind: 'ungrouped' })
  assert.deepEqual(ungroupedBodyTarget(null, 200), { kind: 'ungrouped' })
  assert.deepEqual(ungroupedBodyTarget(rows, Number.NaN), { kind: 'ungrouped' })
})
