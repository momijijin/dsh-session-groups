import test from 'node:test'
import assert from 'node:assert/strict'
import { createGroup, emptyDoc } from '../../src/shared/model.js'
import { groupHeaderZoneFromRect, isCurrentGroupPosition } from '../../src/core/group-drag.js'

const fixture = () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'A' })
  doc = createGroup(doc, { name: 'B' })
  doc = createGroup(doc, { name: 'C' })
  return doc
}

test('groupHeaderZoneFromRect maps top/bottom quarters and rejects the middle', () => {
  const rect = { top: 100, height: 40 }
  assert.equal(groupHeaderZoneFromRect(rect, 101), 'before')
  assert.equal(groupHeaderZoneFromRect(rect, 109), 'before')
  assert.equal(groupHeaderZoneFromRect(rect, 120), null)
  assert.equal(groupHeaderZoneFromRect(rect, 131), 'after')
  assert.equal(groupHeaderZoneFromRect(rect, 139), 'after')
  assert.equal(groupHeaderZoneFromRect(null, 120), null)
  assert.equal(groupHeaderZoneFromRect({ top: 100, height: 0 }, 120), null)
})

test('isCurrentGroupPosition recognizes a no-op sibling position', () => {
  const doc = fixture()
  const ids = doc.groups.map((group) => group.id)
  assert.equal(isCurrentGroupPosition(doc, ids[1], { parentId: null, index: 1 }, { kind: 'group' }), true)
  assert.equal(isCurrentGroupPosition(doc, ids[1], { parentId: null, index: 0 }, { kind: 'group' }), false)
  assert.equal(isCurrentGroupPosition(doc, ids[1], { parentId: 'other', index: 1 }, { kind: 'group' }), false)
  assert.equal(isCurrentGroupPosition(doc, ids[2], { parentId: null, index: 2 }, { kind: 'root-end' }), true)
})
