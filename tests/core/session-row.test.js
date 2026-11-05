import test from 'node:test'
import assert from 'node:assert/strict'
import { estimatedTreeHeight } from '../../src/core/layout.js'
import { sessionRowPropsEqual, statusLabel } from '../../src/core/session-row.js'

const node = (overrides = {}) => ({
  session: {
    id: 's1',
    title: 'Title',
    displayTitle: 'Title',
    updatedAt: 100,
    blank: false,
    ...overrides.session,
  },
  archived: false,
  runningSubagentCount: 0,
  workspace: { workspaceId: 'w1', title: 'Workspace', path: '/w1' },
  status: null,
  ...overrides,
})

const props = (nodeValue, overrides = {}) => ({
  sessionNode: nodeValue,
  depth: 0,
  groupId: 'g1',
  ungrouped: false,
  store: { currentSessionId: null },
  ...overrides,
})

test('statusLabel translates one descriptor and tolerates missing input', () => {
  const calls = []
  const t = (key, params) => {
    calls.push([key, params])
    return `label:${key}`
  }
  assert.equal(statusLabel({ labelKey: 'status.running', params: { n: 2 } }, t), 'label:status.running')
  assert.deepEqual(calls, [['status.running', { n: 2 }]])
  assert.equal(statusLabel(null, t), '')
  assert.equal(statusLabel({ labelKey: 'status.idle' }, null), 'status.idle')
})

test('sessionRowPropsEqual accepts identical display data', () => {
  assert.equal(sessionRowPropsEqual(props(node()), props(node())), true)
})

test('sessionRowPropsEqual rejects identity and structural changes', () => {
  const base = props(node())
  assert.equal(sessionRowPropsEqual(base, props(node({ session: { id: 's2' } }))), false)
  assert.equal(sessionRowPropsEqual(base, props(node(), { depth: 1 })), false)
  assert.equal(sessionRowPropsEqual(base, props(node(), { groupId: 'g2' })), false)
  assert.equal(sessionRowPropsEqual(base, props(node(), { ungrouped: true })), false)
  assert.equal(sessionRowPropsEqual(base, props(node({ archived: true }))), false)
  assert.equal(sessionRowPropsEqual(base, props(node({ runningSubagentCount: 1 }))), false)
  assert.equal(sessionRowPropsEqual(base, props(node({ session: { title: 'Edited' } }))), false)
  assert.equal(sessionRowPropsEqual(base, props(node({ session: { updatedAt: 101 } }))), false)
  assert.equal(sessionRowPropsEqual(base, props(node({ session: { blank: true } }))), false)
  assert.equal(sessionRowPropsEqual(base, props(node({ workspace: { workspaceId: 'w2' } }))), false)
})

test('sessionRowPropsEqual tracks active-session and status changes', () => {
  const base = props(node())
  assert.equal(sessionRowPropsEqual(base, props(node(), { store: { currentSessionId: 's1' } })), false)
  assert.equal(sessionRowPropsEqual(base, props(node(), { store: { currentSessionId: null, localeRevision: 1 } })), false)
  assert.equal(
    sessionRowPropsEqual(base, props(node({ status: { running: false, completionUnread: false, pendingInteraction: null } }))),
    false,
  )
  const running = node({ status: { running: true, completionUnread: false, pendingInteraction: null } })
  const unread = node({ status: { running: true, completionUnread: true, pendingInteraction: null } })
  assert.equal(sessionRowPropsEqual(props(running), props(unread)), false)
  assert.equal(sessionRowPropsEqual(props(running), props(node({ status: running.status }))), true)
})

test('estimatedTreeHeight is pure viewport arithmetic', () => {
  assert.equal(estimatedTreeHeight(900), 680)
  assert.equal(estimatedTreeHeight(300), 240)
  assert.equal(estimatedTreeHeight(0), 700)
  assert.equal(estimatedTreeHeight(Number.NaN), 700)
  assert.equal(estimatedTreeHeight(undefined), 700)
})
