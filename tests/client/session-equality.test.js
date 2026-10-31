import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionViewEqual, statusMapEqual, workspaceViewEqual } from '../../src/client/session-equality.js'

test('sessionViewEqual ignores new snapshot containers with the same visible fields', () => {
  const row = { id: 's1', title: 'One', displayTitle: 'One', updatedAt: 1, blank: false, origin: 'main', running: false, pinned: false, retainedBy: { mainView: 1 } }
  const a = { ids: ['s1'], byId: { s1: row }, projectionsBySession: {} }
  const b = { ids: ['s1'], byId: { s1: { ...row, retainedBy: { mainView: 1 } } }, projectionsBySession: {} }
  assert.equal(sessionViewEqual(a, b), true)
  assert.equal(sessionViewEqual(a, { ...b, byId: { s1: { ...row, title: 'Changed' } } }), false)
  assert.equal(sessionViewEqual(a, { ...b, ids: ['s1', 's2'] }), false)
  assert.equal(sessionViewEqual(a, { ...b, projectionsBySession: { s1: {} } }), false)
})

test('statusMapEqual compares only the state fields the cells paint', () => {
  const a = new Map([['s1', { running: true, completionUnread: false, pendingInteraction: { kind: 'approval' } }]])
  const b = new Map([['s1', { running: true, completionUnread: false, pendingInteraction: { kind: 'approval' }, extra: 1 }]])
  assert.equal(statusMapEqual(a, b), true)
  assert.equal(statusMapEqual(a, new Map([['s1', { running: false }]])), false)
  assert.equal(statusMapEqual(a, new Map([['s1', { running: true, pendingInteraction: { kind: 'question' } }]])), false)
  assert.equal(statusMapEqual(new Map(), new Map()), true)
})

test('workspaceViewEqual preserves badges and archived ids', () => {
  const a = { items: [{ workspaceId: 'w1', title: 'Workspace', path: 'C:\\w1', sessionIds: ['s1'] }], archivedSessionIds: ['s2'] }
  const b = { items: [{ workspaceId: 'w1', title: 'Workspace', path: 'C:\\w1', sessionIds: ['s1'] }], archivedSessionIds: ['s2'] }
  assert.equal(workspaceViewEqual(a, b), true)
  assert.equal(workspaceViewEqual(a, { ...b, archivedSessionIds: [] }), false)
  assert.equal(workspaceViewEqual(a, { ...b, items: [{ ...b.items[0], title: 'Other' }] }), false)
})
