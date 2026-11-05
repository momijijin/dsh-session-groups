import test from 'node:test'
import assert from 'node:assert/strict'
import { applyControlOperations, buildControlState, CONTROL_OPERATIONS, CONTROL_PROTOCOL, resolveGroupPath } from '../../src/core/control.js'
import { assignSession, createGroup, emptyDoc, findGroup, validateDoc } from '../../src/shared/model.js'

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

test('control resolves full paths and rejects missing, ambiguous and control-character paths', () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'Work' })
  const work = doc.groups[0].id
  doc = createGroup(doc, { name: 'Front', parentId: work })
  doc = createGroup(doc, { name: 'Duplicate' })
  doc = createGroup(doc, { name: 'Duplicate' })
  const front = doc.groups.find((group) => group.name === 'Front')
  assert.deepEqual(buildControlState(doc, 1).groups.find((group) => group.id === front.id).path, ['Work', 'Front'])
  assert.equal(resolveGroupPath(doc, ['Work', 'Front']).groupId, front.id)
  assert.equal(resolveGroupPath(doc, ['Work', 'missing']).code, 'group-not-found')
  assert.equal(resolveGroupPath(doc, ['Duplicate']).code, 'ambiguous-path')
  assert.equal(resolveGroupPath(doc, ['Duplicate']).candidates.length, 2)
  assert.equal(resolveGroupPath(doc, ['Work\nFront']).code, 'invalid-path')
  assert.equal(resolveGroupPath(doc, []).code, 'invalid-path')
  assert.equal(resolveGroupPath(doc, ['Work', 1]).code, 'invalid-path')
})

test('group names reject control characters both on input and at validation', () => {
  assert.throws(() => createGroup(emptyDoc(), { name: 'bad\nname' }), /name-control-chars/)
  const verdict = validateDoc({
    version: 1,
    revision: 0,
    groups: [{ id: 'g-x', name: 'bad\nname', icon: 'folder', parentId: null, sessionIds: [] }],
    ungrouped: [],
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.errors.join(';'), /group-name:g-x/)
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
  assert.equal(result.changes[0].created, true)
  assert.equal('groupId' in result.changes[0], false)
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

test('control rejects extra and mistyped fields instead of silently coercing them', () => {
  const { doc, a } = fixture()
  const extra = applyControlOperations(doc, [
    { op: 'group.rename', groupId: a, name: 'A2', surprise: true },
  ])
  assert.equal(extra.ok, false)
  assert.equal(extra.code, 'invalid-operation')
  assert.equal(extra.operationIndex, 0)
  assert.equal(extra.field, 'surprise')

  const badIndex = applyControlOperations(doc, [
    { op: 'group.move', groupId: a, parentId: null, index: '0' },
  ])
  assert.equal(badIndex.code, 'invalid-operation')
  assert.equal(badIndex.field, 'index')
  assert.equal(badIndex.expected, 'non-negative integer')

  const badParent = applyControlOperations(doc, [
    { op: 'group.create', name: 'C', parentId: 123 },
  ])
  assert.equal(badParent.code, 'invalid-operation')
  assert.equal(badParent.field, 'parentId')

  const noUpdate = applyControlOperations(doc, [{ op: 'group.update', groupId: a }])
  assert.equal(noUpdate.code, 'invalid-operation')
  assert.equal(noUpdate.field, 'icon|color|colorHex')

  const nullOperation = applyControlOperations(doc, [null])
  assert.equal(nullOperation.code, 'invalid-operation')
  assert.equal(nullOperation.operationIndex, 0)
})

test('control rejects empty, unknown, oversized and invalid operations', () => {
  const { doc, a } = fixture()
  assert.equal(applyControlOperations(doc, []).code, 'operations-required')
  assert.equal(applyControlOperations(doc, [{ op: 'raw.commit' }]).code, 'unknown-operation')
  assert.equal(
    applyControlOperations(doc, Array.from({ length: 65 }, () => ({ op: 'group.rename', groupId: a, name: 'A' }))).code,
    'too-many-operations',
  )
  assert.equal(
    applyControlOperations(doc, [{ op: 'group.rename', groupId: a, name: '' }]).code,
    'invalid-operation',
  )
  assert.equal(
    applyControlOperations(doc, [{ op: 'group.update', groupId: a }]).code,
    'invalid-operation',
  )
})

test('control planning refuses an invalid candidate document instead of returning a plan', () => {
  const planned = applyControlOperations(emptyDoc(), [{ op: 'group.create', name: 'A', parentId: null }])
  assert.equal(planned.ok, true)

  const invalid = { version: 99, revision: 0, groups: [], ungrouped: [] }
  const result = applyControlOperations(invalid, [{ op: 'group.create', name: 'A', parentId: null }])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'invalid-result')
  assert.match(result.message, /version/)
})

test('applyControlOperations validates the final document even when the operation itself is valid', () => {
  const doc = {
    version: 1,
    revision: 0,
    groups: [
      { id: 'g-valid', name: 'Valid', icon: 'folder', parentId: null, sessionIds: [] },
      { id: 'g-invalid', name: '', icon: 'folder', parentId: null, sessionIds: [] },
    ],
    ungrouped: [],
  }
  const result = applyControlOperations(doc, [{ op: 'group.rename', groupId: 'g-valid', name: 'Renamed' }])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'invalid-result')
  assert.match(result.message, /group-name:g-invalid/)
})
