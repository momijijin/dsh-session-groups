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
  const calls = { commits: [], opens: [], renames: [], archives: [], forks: [], copies: [] }
  let doc = emptyDoc()
  doc = createGroup(doc, { name: 'G' })
  const groupId = doc.groups[0].id
  doc = assignSession(doc, 'existing', groupId)
  const snapshot = { ids: ['existing'], byId: { existing: { id: 'existing' } } }
  const services = {
    sessions: {
      using: async (id, options, fn) => {
        const reference = { binding: { session: { rename: async (title) => { calls.renames.push({ id, title, source: options.source }); return { ok: true } } } } }
        return fn(reference)
      },
      list: { getSnapshot: () => snapshot },
    },
    uiWorkspace: {
      startSession: (workspaceId) => {
        calls.started = workspaceId
        if (overrides.startReturns !== null) {
          const created = overrides.startReturns ?? 'fresh'
          snapshot.ids.push(created)
          snapshot.byId[created] = { id: created, blank: true }
        }
      },
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
      forkSession: async (id, onCreated, options) => {
        calls.forks.push({ id, onCreated, options })
        onCreated?.('child')
      },
    },
  }
  const actions = createActions({
    getServices: () => services,
    getDoc: () => doc,
    commitDoc: async (nextDocOrUpdater) => {
      const nextDoc = typeof nextDocOrUpdater === 'function' ? nextDocOrUpdater(doc) : nextDocOrUpdater
      calls.commits.push(nextDoc)
      doc = nextDoc
      return nextDoc
    },
    notify: (toast) => calls.toasts?.push?.(toast),
    t: (key) => key,
    clipboard: overrides.clipboard ?? (async (text) => { calls.copies.push(text); return true }),
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

test('forkSession forwards the host child callback and returns its id', async () => {
  const { actions, calls } = makeActions()
  assert.equal(await actions.forkSession('s1'), 'child')
  assert.equal(calls.forks.length, 1)
  assert.equal(calls.forks[0].id, 's1')
  assert.equal(typeof calls.forks[0].onCreated, 'function')
  assert.deepEqual(calls.forks[0].options, { allowMigration: false })
  await assert.rejects(() => {
    const missing = makeActions()
    missing.services.uiWorkspace.forkSession = undefined
    return missing.actions.forkSession('s1')
  }, /fork-unavailable/)
})

test('copySessionId delegates to the injected clipboard and reports failure', async () => {
  const { actions, calls } = makeActions()
  assert.equal(await actions.copySessionId('s1'), true)
  assert.deepEqual(calls.copies, ['s1'])
  const failed = makeActions({ clipboard: async () => false })
  assert.equal(await failed.actions.copySessionId('s1'), false)
})

test('createSessionInGroup uses startSession and inserts the new id at the group head', async () => {
  const { actions, calls, groupId, getDoc } = makeActions({ startReturns: 'fresh' })
  const result = await actions.createSessionInGroup({ groupId, workspaceId: 'w2' })
  assert.equal(result.sessionId, 'fresh')
  const group = findGroup(getDoc(), groupId)
  assert.deepEqual(group.sessionIds, ['fresh', 'existing'])
  assert.equal(calls.started, 'w2')
  assert.equal(calls.commits.length, 1)
  assert.deepEqual(calls.opens, ['fresh'])
})

test('createSessionInGroup refuses to steal an already-placed blank via the connect fallback', async () => {
  const { actions, calls, groupId, getDoc } = makeActions({ startReturns: null, connectReturns: 'existing' })
  await assert.rejects(() => actions.createSessionInGroup({ groupId, workspaceId: 'w1' }), /create-failed/)
  const group = findGroup(getDoc(), groupId)
  assert.deepEqual(group.sessionIds, ['existing'])
  assert.equal(calls.commits.length, 0)
})

test('moveSession to ungrouped removes the session from its group', async () => {
  const { actions, getDoc } = makeActions()
  await actions.moveSession('existing', null)
  const doc = getDoc()
  assert.deepEqual(doc.ungrouped, ['existing'])
  assert.equal(doc.groups[0].sessionIds.length, 0)
})
