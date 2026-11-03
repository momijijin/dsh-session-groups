import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assignSession,
  buildRenderTree,
  createGroup,
  emptyDoc,
  flattenRenderTree,
  newGroupId,
} from '../../src/shared/model.js'

test('flattenRenderTree keeps depth-first group/session order', () => {
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'Root' })
  const root = doc.groups[0].id
  doc = createGroup(doc, { name: 'Child', parentId: root })
  const child = doc.groups.find((group) => group.name === 'Child').id
  doc = assignSession(doc, 's1', root)
  doc = assignSession(doc, 's2', child)
  const tree = buildRenderTree(
    doc,
    {
      s1: { id: 's1', updatedAt: 1 },
      s2: { id: 's2', updatedAt: 2 },
    },
    [],
    {},
  )
  const flat = flattenRenderTree(tree)
  assert.deepEqual(flat.map((node) => node.kind === 'group' ? `group:${node.group.name}` : `session:${node.session.id}`), [
    'group:Root',
    'group:Child',
    'session:s2',
    'session:s1',
  ])
  assert.deepEqual(flat.map((node) => node.depth), [0, 1, 2, 1])
})

test('newGroupId falls back to a stable-shaped random id when crypto.randomUUID is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  if (!descriptor?.configurable) return
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
  try {
    const first = newGroupId()
    const second = newGroupId()
    assert.match(first, /^g-[0-9a-f]{12}$/)
    assert.match(second, /^g-[0-9a-f]{12}$/)
    assert.notEqual(first, second)
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor)
  }
})
