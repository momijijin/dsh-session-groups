import test from 'node:test'
import assert from 'node:assert/strict'
import { applyControlOperations, buildControlState, CONTROL_OPERATIONS, CONTROL_PROTOCOL } from '../../src/core/control.js'
import { assignSession, createGroup, emptyDoc, findGroup } from '../../src/shared/model.js'

const fixture = () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'A' })
  const a = doc.groups[0].id
  doc = createGroup(doc, { name: 'B' })
  const b = doc.groups[1].id
  doc = assignSession(doc, 's1', a, 0)
  doc = assignSession(doc, 's2', null, 0)
  return { doc, a, b }
}

test('control state exposes stable ids and operation vocabulary', () => {
  const { doc, a } = fixture()
  const state = buildControlState(doc, 7)
  assert.equal(state.protocol, CONTROL_PROTOCOL)
  assert.equal(state.revision, 7)
  assert.deepEqual(state.groups[0].sessionIds, ['s1'])
  assert.deepEqual(state.ungrouped, ['s2'])
  assert.deepEqual(CONTROL_OPERATIONS, [
    'group.create',
    'group.rename',
    'group.update',
    'group.move',
    'group.delete',
    'session.assign',
  ])
  assert.equal(findGroup(doc, a).name, 'A')
})

test('control creates, renames, updates, moves and assigns without mutating input', () => {
  const { doc, b } = fixture()
  const before = JSON.stringify(doc)
  const result = applyControlOperations(doc, [
    { op: 'group.create', name: 'C', parentId: null, index: 0 },
    { op: 'group.rename', groupId: b, name: 'B2' },
    { op: 'group.update', groupId: b, icon: 'star', color: 'green' },
    { op: 'group.move', groupId: b, parentId: null, index: 0 },
    { op: 'session.assign', sessionId: 's2', groupId: b, index: 0 },
  ])
  assert.equal(result.ok, true)
  assert.equal(JSON.stringify(doc), before)
  assert.equal(result.doc.groups.some((group) => group.name === 'C'), true)
  const updated = findGroup(result.doc, b)
  assert.equal(updated.name, 'B2')
  assert.equal(updated.icon, 'star')
  assert.equal(updated.color, 'green')
  assert.deepEqual(updated.sessionIds, ['s2'])
  assert.equal(result.changes.length, 5)
})

test('control requires explicit destructive opt-in and validates the result', () => {
  const { doc, a } = fixture()
  const denied = applyControlOperations(doc, [{ op: 'group.delete', groupId: a }])
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'operation-failed')
  assert.equal(denied.message, 'destructive-disabled')

  const allowed = applyControlOperations(doc, [{ op: 'group.delete', groupId: a, destinationId: null }], {
    allowDestructive: true,
  })
  assert.equal(allowed.ok, true)
  assert.equal(findGroup(allowed.doc, a), null)
  assert.deepEqual(allowed.doc.ungrouped.sort(), ['s1', 's2'].sort())
})

test('control rejects empty, unknown, oversized and invalid operations', () => {
  const { doc, a } = fixture()
  assert.equal(applyControlOperations(doc, []).code, 'operations-required')
  assert.equal(applyControlOperations(doc, [{ op: 'raw.commit' }]).code, 'operation-failed')
  assert.equal(
    applyControlOperations(doc, Array.from({ length: 65 }, () => ({ op: 'group.rename', groupId: a, name: 'A' }))).code,
    'too-many-operations',
  )
  assert.equal(
    applyControlOperations(doc, [{ op: 'group.rename', groupId: a, name: '' }]).code,
    'operation-failed',
  )
  assert.equal(
    applyControlOperations(doc, [{ op: 'group.update', groupId: a }]).code,
    'operation-failed',
  )
})
