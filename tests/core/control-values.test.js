import test from 'node:test'
import assert from 'node:assert/strict'
import { applyControlOperations } from '../../src/core/control.js'
import { assignSession, createGroup, emptyDoc } from '../../src/shared/model.js'

const fixture = () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'A', icon: 'folder', color: 'blue' })
  doc = createGroup(doc, { name: 'B', icon: 'star', color: 'green' })
  doc = assignSession(doc, 's1', doc.groups[0].id)
  return { doc, a: doc.groups[0].id, b: doc.groups[1].id }
}

const applyOne = (doc, operation) => applyControlOperations(doc, [operation])

test('control rejects an unknown icon instead of silently falling back to folder', () => {
  const { doc, a } = fixture()
  const update = applyOne(doc, { op: 'group.update', groupId: a, icon: 'not-a-real-icon' })
  assert.equal(update.ok, false)
  assert.equal(update.code, 'invalid-icon')
  assert.equal(update.field, 'icon')
  assert.equal(update.operationIndex, 0)
  assert.ok(update.allowed.includes('folder'))

  const create = applyOne(doc, { op: 'group.create', name: 'C', icon: 'future-icon' })
  assert.equal(create.ok, false)
  assert.equal(create.code, 'invalid-icon')
  assert.equal(create.field, 'icon')
})

test('control rejects an unknown palette color instead of silently falling back to blue', () => {
  const { doc, a } = fixture()
  const update = applyOne(doc, { op: 'group.update', groupId: a, color: 'chartreuse' })
  assert.equal(update.ok, false)
  assert.equal(update.code, 'invalid-color')
  assert.equal(update.field, 'color')
  assert.ok(update.allowed.includes('blue'))

  const create = applyOne(doc, { op: 'group.create', name: 'C', color: 'not-a-color' })
  assert.equal(create.ok, false)
  assert.equal(create.code, 'invalid-color')
  assert.equal(create.field, 'color')
})

test('control rejects invalid colorHex consistently in create and update', () => {
  const { doc, a } = fixture()
  const update = applyOne(doc, { op: 'group.update', groupId: a, colorHex: '#abcd' })
  assert.equal(update.ok, false)
  assert.equal(update.code, 'invalid-color')
  assert.equal(update.field, 'colorHex')
  assert.equal(update.canonical, '#rrggbb')

  const create = applyOne(doc, { op: 'group.create', name: 'C', colorHex: 'red' })
  assert.equal(create.ok, false)
  assert.equal(create.code, 'invalid-color')
  assert.equal(create.field, 'colorHex')
})

test('control rejects color and colorHex together and preserves the valid single format', () => {
  const { doc, a } = fixture()
  const both = applyOne(doc, { op: 'group.update', groupId: a, color: 'red', colorHex: '#abc' })
  assert.equal(both.ok, false)
  assert.equal(both.code, 'invalid-operation')
  assert.equal(both.field, 'color|colorHex')

  const validCreate = applyOne(doc, { op: 'group.create', name: 'C', colorHex: '#abc' })
  assert.equal(validCreate.ok, true)
  assert.equal(validCreate.doc.groups.at(-1).colorHex, '#aabbcc')

  const validUpdate = applyOne(doc, { op: 'group.update', groupId: a, icon: 'rocket', color: 'purple' })
  assert.equal(validUpdate.ok, true)
  assert.equal(validUpdate.doc.groups.find((group) => group.id === a).icon, 'rocket')
  assert.equal(validUpdate.doc.groups.find((group) => group.id === a).color, 'purple')
})
