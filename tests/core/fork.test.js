import test from 'node:test'
import assert from 'node:assert/strict'

import { placeForkedSession } from '../../src/core/fork.js'
import { createGroup, assignSession, emptyDoc } from '../../src/shared/model.js'

test('fork child is inserted at the source group head', () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'G' })
  const groupId = doc.groups[0].id
  doc = assignSession(doc, 'source', groupId)
  doc = assignSession(doc, 'other', groupId)
  const next = placeForkedSession(doc, 'source', 'child')
  assert.deepEqual(next.groups[0].sessionIds, ['child', 'source', 'other'])
  assert.deepEqual(next.ungrouped, [])
})

test('source outside groups places the fork at the ungrouped head', () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'G' })
  const next = placeForkedSession(doc, 'derived-source', 'child')
  assert.deepEqual(next.ungrouped, ['child'])
})

test('fork placement is deterministic and does not mutate the input document', () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'G' })
  const groupId = doc.groups[0].id
  doc = assignSession(doc, 'source', groupId)
  const before = JSON.stringify(doc)
  const first = placeForkedSession(doc, 'source', 'child')
  const second = placeForkedSession(doc, 'source', 'child')
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(doc), before)
})
