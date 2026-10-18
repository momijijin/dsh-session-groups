import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyArchiveError,
  createActions,
  formatActivity,
  workspaceChoices,
  workspaceLabel,
} from '../../src/client/actions.js'
import { emptyDoc, createGroup, assignSession, findGroup } from '../../src/shared/model.js'

test('classifyArchiveError only matches WorkspaceArchiveError/session-active', () => {
  const error = {
    name: 'WorkspaceArchiveError',
    rpcError: { code: 'workspace/session-active', details: { activity: ['turn', 'job'] } },
  }
  assert.deepEqual(classifyArchiveError(error), { activity: ['turn', 'job'] })
  assert.equal(classifyArchiveError({ name: 'Error', rpcError: { code: 'workspace/session-active' } }), null)
  assert.equal(classifyArchiveError({ name: 'WorkspaceArchiveError', rpcError: { code: 'other' } }), null)
  assert.equal(classifyArchiveError(null), null)
})

test('formatActivity renders the known families', () => {
  assert.equal(formatActivity(['turn', 'subagent']), 'turn, subagent')
  assert.equal(formatActivity([]), '')
  assert.equal(formatActivity(undefined), '')
})

test('workspaceLabel prefers title, then path basename, then id', () => {
  assert.equal(workspaceLabel({ title: ' Projects ', path: 'C:\\x\\y' }), 'Projects')
  assert.equal(workspaceLabel({ title: '', path: 'C:\\Users\\Momiji\\Projects\\' }), 'Projects')
  assert.equal(workspaceLabel({ title: '', path: '', workspaceId: 'ws-1' }), 'ws-1')
  assert.equal(workspaceLabel(null), '')
})

test('workspaceChoices puts the inferred workspace first', () => {
  const workspaces = [
    { workspaceId: 'w1', title: 'A', path: 'C:\\A', sessionIds: ['s1'] },
    { workspaceId: 'w2', title: 'B', path: 'C:\\B', sessionIds: ['s2'] },
    { workspaceId: 'w3', title: 'C', path: 'C:\\C', sessionIds: [] },
  ]
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'G' })
  const groupId = doc.groups[0].id
  doc = assignSession(doc, 's2', groupId)
  const sessionsById = { s1: { id: 's1' }, s2: { id: 's2' } }
  const result = workspaceChoices(doc, groupId, sessionsById, workspaces, null)
  assert.equal(result.inferred, 'w2')
  assert.deepEqual(result.choices.map((workspace) => workspace.workspaceId), ['w2', 'w1', 'w3'])
})

const makeActions = (overrides = {}) => {
  const calls = { commits: [], opens: [], renames: [], archives: [], pins: [] }
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'G' })
  const groupId = doc.groups[0].id
  doc = assignSession(doc, 'existing', groupId)
  const services = {
    sessions: {
      using: async (id, options, fn) => {
        const reference = { binding: { session: { rename: async (title) => { calls.renames.push({ id, title, source: options.source }); return { ok: true } } } } }
        return fn(reference)
      },
      list: { getSnapshot: () => ({ byId: { fresh: { id: 'fresh', blank: true } } }) },
    },
    uiWorkspace: {
      connectWorkspace: async (workspaceId) => {
        calls.connected = workspaceId
        return overrides.connectReturns ?? 'fresh'
      },
      openSession: (id) => calls.opens.push(id),
      archiveSession: async (id, options) => {
        calls.archives.push({ id, options })
        if (overrides.archiveError) throw overrides.archiveError
      },
      unarchiveSession: async (id) => calls.unarchived.push?.(id),
      pinSession: async (id) => calls.pins.push({ id, pinned: true }),
      unpinSession: async (id) => calls.pins.push({ id, pinned: false }),
    },
  }
  const actions = createActions({
    getServices: () => services,
    getDoc: () => doc,
    commitDoc: async (nextDoc) => {
      calls.commits.push(nextDoc)
      doc = nextDoc
      return nextDoc
    },
    notify: (toast) => calls.toasts?.push?.(toast),
    t: (key) => key,
  })
  return { actions, calls, getDoc: () => doc, groupId, services }
}

test('renameSession uses the exact sessions.using(workspaceOperation) shape', async () => {
  const { actions, calls } = makeActions()
  await actions.renameSession('s1', '  new title  ')
  assert.deepEqual(calls.renames, [{ id: 's1', title: 'new title', source: 'workspaceOperation' }])
  await assert.rejects(() => actions.renameSession('s1', '   '), /title-required/)
})

test('openSession prefers uiWorkspace.openSession over retain fallback', () => {
  const { actions, calls } = makeActions()
  assert.equal(actions.openSession('s9'), true)
  assert.deepEqual(calls.opens, ['s9'])
})

test('archiveSession returns the refusal without throwing', async () => {
  const error = { name: 'WorkspaceArchiveError', rpcError: { code: 'workspace/session-active', details: { activity: ['turn'] } } }
  const { actions, calls } = makeActions({ archiveError: error })
  const result = await actions.archiveSession('s1')
  assert.equal(result.ok, false)
  assert.deepEqual(result.refusal, { activity: ['turn'] })
  assert.deepEqual(calls.archives, [{ id: 's1', options: undefined }])
})

test('archiveSession passes stopActivity:true when requested', async () => {
  const { actions, calls } = makeActions()
  const result = await actions.archiveSession('s1', { stopActivity: true })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls.archives, [{ id: 's1', options: { stopActivity: true } }])
})

test('pin/unpin use uiWorkspace feature-detected methods', async () => {
  const { actions, calls } = makeActions()
  assert.equal(await actions.pinSession('s1', true), true)
  assert.equal(await actions.pinSession('s1', false), true)
  assert.deepEqual(calls.pins, [{ id: 's1', pinned: true }, { id: 's1', pinned: false }])
})

test('createSessionInGroup dedupes a reused blank and moves it to the group head', async () => {
  const { actions, calls, groupId, getDoc } = makeActions({ connectReturns: 'existing' })
  const result = await actions.createSessionInGroup({ groupId, workspaceId: 'w1' })
  assert.equal(result.sessionId, 'existing')
  const group = findGroup(getDoc(), groupId)
  assert.deepEqual(group.sessionIds, ['existing'])
  assert.equal(calls.commits.length, 1)
  assert.deepEqual(calls.opens, ['existing'])
})

test('createSessionInGroup inserts a newly created id at the group head', async () => {
  const { actions, calls, groupId, getDoc } = makeActions({ connectReturns: 'fresh' })
  await actions.createSessionInGroup({ groupId, workspaceId: 'w2' })
  const group = findGroup(getDoc(), groupId)
  assert.deepEqual(group.sessionIds, ['fresh', 'existing'])
  assert.equal(calls.connected, 'w2')
})

test('moveSession to ungrouped removes the session from its group', async () => {
  const { actions, getDoc } = makeActions()
  await actions.moveSession('existing', null)
  const doc = getDoc()
  assert.deepEqual(doc.ungrouped, ['existing'])
  assert.equal(doc.groups[0].sessionIds.length, 0)
})
