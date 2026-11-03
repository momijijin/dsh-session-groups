// tests/client/optimistic.test.js
//
// 0.2.4 optimistic commit-queue semantics. These tests pin the WYSIWYG contract
// requested by the user: dispatch immediately, coalesce rapid moves, keep the
// last confirmed revision as baseRevision, reconcile on success, roll back on
// failure/conflict, and never write a stale intermediate doc over a newer
// optimistic one.

import test from 'node:test'
import assert from 'node:assert/strict'

import { createOptimisticQueue } from '../../src/client/optimistic.js'
import { createStore } from '../../src/client/state.js'
import { assignSession, createGroup, emptyDoc } from '../../src/shared/model.js'

const fakeStorage = () => {
  const map = new Map()
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) }
}

const seedDoc = () => {
  let doc = createGroup(emptyDoc(), { name: 'A' })
  const groupId = doc.groups[0].id
  doc = assignSession(doc, 's1', groupId)
  doc = assignSession(doc, 's2', groupId)
  doc = assignSession(doc, 's3', null)
  return doc
}

const makeStore = (doc, revision = 3) => {
  const store = createStore({ storage: fakeStorage() })
  store.dispatch('load-success', { doc, revision })
  return store
}

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Commit fake with externally controlled outcomes. */
const controlledCommit = () => {
  const calls = []
  const commit = (doc, baseRevision) => {
    const gate = deferred()
    calls.push({ doc, baseRevision, resolve: gate.resolve, reject: gate.reject })
    return gate.promise
  }
  return { calls, commit }
}

const flushTasks = () => new Promise((resolve) => setTimeout(resolve, 0))

const waitFor = async (predicate, label = 'condition') => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await flushTasks()
  }
  throw new Error(`timed out waiting for ${label}`)
}

test('optimistic: dispatches the next doc immediately and keeps the confirmed revision', async () => {
  const base = seedDoc()
  const store = makeStore(base, 7)
  const commit = controlledCommit()
  const queue = createOptimisticQueue({ store, commit: commit.commit })
  const next = assignSession(base, 's3', base.groups[0].id, 0)
  const task = queue.commitOptimistic(next)

  // Synchronous dispatch: the view is already updated before the HTTP write.
  assert.equal(store.getSnapshot().doc, next)
  assert.equal(store.getSnapshot().revision, 7, 'revision stays server-confirmed')
  assert.equal(store.getSnapshot().lastConfirmed, base)
  assert.equal(store.getSnapshot().optimistic, true)

  await waitFor(() => commit.calls.length === 1, 'optimistic request')
  assert.equal(commit.calls[0].doc, next)
  assert.equal(commit.calls[0].baseRevision, 7)
  commit.calls[0].resolve({ ok: true, doc: next, revision: 8 })
  assert.equal(await task, next)
  assert.equal(store.getSnapshot().doc, next)
  assert.equal(store.getSnapshot().revision, 8)
  assert.equal(store.getSnapshot().lastConfirmed, next)
  assert.equal(store.getSnapshot().optimistic, false)
})

test('optimistic: rapid moves coalesce into one request carrying the latest doc', async () => {
  const base = seedDoc()
  const store = makeStore(base, 2)
  const commit = controlledCommit()
  const queue = createOptimisticQueue({ store, commit: commit.commit })
  const first = assignSession(base, 's3', base.groups[0].id, 0)
  const second = assignSession(first, 's2', base.groups[0].id, 0)

  const taskA = queue.commitOptimistic(first)
  const taskB = queue.commitOptimistic(second)
  assert.equal(store.getSnapshot().doc, second, 'both drops render immediately')
  assert.equal(store.getSnapshot().revision, 2)

  await waitFor(() => commit.calls.length === 1, 'coalesced request')
  await flushTasks()
  assert.equal(commit.calls.length, 1, 'two same-tick drops -> one request')
  assert.equal(commit.calls[0].doc, second, 'request carries the newest doc, never the intermediate')
  assert.equal(commit.calls[0].baseRevision, 2)

  commit.calls[0].resolve({ ok: true, doc: second, revision: 3 })
  await Promise.all([taskA, taskB])
  assert.equal(store.getSnapshot().revision, 3)
  assert.equal(store.getSnapshot().doc, second)
})

test('optimistic: a drop during an in-flight write is written next with the new base revision', async () => {
  const base = seedDoc()
  const store = makeStore(base, 4)
  const commit = controlledCommit()
  const queue = createOptimisticQueue({ store, commit: commit.commit })
  const first = assignSession(base, 's3', base.groups[0].id, 0)
  const second = assignSession(first, 's2', base.groups[0].id, 0)

  const taskA = queue.commitOptimistic(first)
  await waitFor(() => commit.calls.length === 1, 'first request')
  const taskB = queue.commitOptimistic(second)
  assert.equal(store.getSnapshot().doc, second)
  assert.equal(store.getSnapshot().revision, 4)

  commit.calls[0].resolve({ ok: true, doc: first, revision: 5 })
  await taskA
  // The newer optimistic doc is not clobbered by the first server response.
  assert.equal(store.getSnapshot().doc, second, 'newer optimistic doc survives reconciliation')
  assert.equal(store.getSnapshot().revision, 5)
  assert.equal(store.getSnapshot().lastConfirmed, first)

  await waitFor(() => commit.calls.length === 2, 'second request')
  assert.equal(commit.calls[1].doc, second)
  assert.equal(commit.calls[1].baseRevision, 5, 'serial queue uses the latest confirmed revision')
  commit.calls[1].resolve({ ok: true, doc: second, revision: 6 })
  await taskB
  assert.equal(store.getSnapshot().revision, 6)
  assert.equal(store.getSnapshot().doc, second)
  assert.equal(store.getSnapshot().optimistic, false)
})

test('optimistic: failure rolls back to the last confirmed doc/revision and reports once', async () => {
  const base = seedDoc()
  const store = makeStore(base, 9)
  const commit = controlledCommit()
  const toasts = []
  const queue = createOptimisticQueue({
    store,
    commit: commit.commit,
    notify: (toast) => toasts.push(toast),
    t: (key) => key,
  })
  const next = assignSession(base, 's3', base.groups[0].id, 0)
  const task = queue.commitOptimistic(next)
  await waitFor(() => commit.calls.length === 1, 'optimistic request')

  commit.calls[0].resolve({ ok: false, code: 'io', message: 'disk full' })
  await assert.rejects(task, (error) => error.reported === true && error.code === 'io')
  assert.equal(store.getSnapshot().doc, base, 'rolled back to the confirmed doc')
  assert.equal(store.getSnapshot().revision, 9, 'revision never advanced optimistically')
  assert.equal(store.getSnapshot().optimistic, false)
  assert.equal(store.getSnapshot().banner.code, 'io')
  assert.deepEqual(toasts, [{ kind: 'error', message: 'toast.dropFailed' }])
})

test('optimistic: conflict also rolls back to the last confirmed state with the conflict toast', async () => {
  const base = seedDoc()
  const store = makeStore(base, 5)
  const commit = controlledCommit()
  const toasts = []
  const queue = createOptimisticQueue({
    store,
    commit: commit.commit,
    notify: (toast) => toasts.push(toast),
    t: (key) => key,
  })
  const next = assignSession(base, 's3', base.groups[0].id, 0)
  const task = queue.commitOptimistic(next)
  await waitFor(() => commit.calls.length === 1, 'optimistic request')

  const serverDoc = seedDoc()
  commit.calls[0].resolve({ ok: false, code: 'conflict', doc: serverDoc, revision: 12 })
  await assert.rejects(task, (error) => error.reported === true && error.code === 'conflict')
  assert.equal(store.getSnapshot().doc, base, 'conflict reverts to the last confirmed doc')
  assert.equal(store.getSnapshot().revision, 5)
  assert.equal(store.getSnapshot().banner.code, 'conflict')
  assert.deepEqual(toasts, [{ kind: 'error', message: 'banner.conflict' }])
})

test('optimistic: strict commit flushes pending writes and resolves against the latest doc/revision', async () => {
  const base = seedDoc()
  const store = makeStore(base, 1)
  const commit = controlledCommit()
  const queue = createOptimisticQueue({ store, commit: commit.commit })
  const optimisticDoc = assignSession(base, 's3', base.groups[0].id, 0)

  const taskOptimistic = queue.commitOptimistic(optimisticDoc)
  await waitFor(() => commit.calls.length === 1, 'optimistic request')
  let strictDoc = null
  const strict = queue.commitStrict((latest) => {
    strictDoc = latest
    return { ...latest, groups: latest.groups.map((group) => ({ ...group, name: 'renamed' })) }
  })
  await flushTasks()
  assert.equal(commit.calls.length, 1, 'strict write waits for the optimistic flush')

  commit.calls[0].resolve({ ok: true, doc: optimisticDoc, revision: 2 })
  await taskOptimistic
  await waitFor(() => commit.calls.length === 2, 'strict request')
  assert.equal(strictDoc, optimisticDoc, 'strict updater sees the reconciled optimistic doc')
  assert.equal(commit.calls[1].baseRevision, 2)
  const renamed = commit.calls[1].doc
  commit.calls[1].resolve({ ok: true, doc: renamed, revision: 3 })
  await strict
  assert.equal(store.getSnapshot().doc, renamed)
  assert.equal(store.getSnapshot().revision, 3)
})

test('optimistic: strict writer defers a concurrent drop so it computes on the new doc', async () => {
  const base = seedDoc()
  const store = makeStore(base, 2)
  const commit = controlledCommit()
  const queue = createOptimisticQueue({ store, commit: commit.commit })
  const renamedDoc = { ...base, groups: base.groups.map((group) => ({ ...group, name: 'renamed' })) }

  const strict = queue.commitStrict(renamedDoc)
  await waitFor(() => commit.calls.length === 1, 'strict request')

  let updaterSaw = null
  const drop = queue.commitOptimistic((latest) => {
    updaterSaw = latest
    return assignSession(latest, 's3', latest.groups[0].id, 0)
  })
  assert.equal(store.getSnapshot().doc, base, 'drop waits for the strict writer instead of dispatching a stale doc')

  commit.calls[0].resolve({ ok: true, doc: renamedDoc, revision: 3 })
  await strict
  await waitFor(() => commit.calls.length === 2, 'deferred optimistic request')
  assert.equal(updaterSaw, renamedDoc, 'deferred drop resolves against the server-confirmed doc')
  assert.equal(commit.calls[1].baseRevision, 3)
  commit.calls[1].resolve({ ok: true, doc: commit.calls[1].doc, revision: 4 })
  await drop
  assert.equal(store.getSnapshot().revision, 4)
})

test('optimistic: updater errors and non-document returns reject without dispatching', async () => {
  const base = seedDoc()
  const store = makeStore(base, 1)
  const queue = createOptimisticQueue({ store, commit: async () => ({ ok: true, doc: base, revision: 2 }) })
  await assert.rejects(() => queue.commitOptimistic(() => { throw new Error('updater-failed') }), /updater-failed/)
  await assert.rejects(() => queue.commitOptimistic(() => null), /doc-required/)
  assert.equal(store.getSnapshot().doc, base)
  assert.equal(store.getSnapshot().revision, 1)
})

test('optimistic: thrown commits roll back, report once and preserve the error code', async () => {
  const base = seedDoc()
  const store = makeStore(base, 4)
  const toasts = []
  const errors = []
  const queue = createOptimisticQueue({
    store,
    commit: async () => { throw new Error('network-down') },
    notify: (toast) => toasts.push(toast),
    t: (key) => key,
    onError: (error) => errors.push(error),
  })
  await assert.rejects(() => queue.commitOptimistic((doc) => doc), /network-down/)
  assert.equal(store.getSnapshot().doc, base)
  assert.equal(store.getSnapshot().optimistic, false)
  assert.deepEqual(toasts, [{ kind: 'error', message: 'toast.dropFailed' }])
  assert.equal(errors.length, 1)
  assert.equal(errors[0].reported, true)
})

test('optimistic: strict commit failure dispatches commit-error and throws the server code', async () => {
  const base = seedDoc()
  const store = makeStore(base, 2)
  const queue = createOptimisticQueue({
    store,
    commit: async () => ({ ok: false, code: 'fence-unavailable', message: 'fence down' }),
  })
  await assert.rejects(() => queue.commitStrict((doc) => doc), (error) => error.code === 'fence-unavailable')
  assert.equal(store.getSnapshot().doc, base)
})

test('optimistic: dispose rejects a queued write and leaves the confirmed doc intact', async () => {
  const base = seedDoc()
  const store = makeStore(base, 1)
  const queue = createOptimisticQueue({
    store,
    commit: () => new Promise(() => {}),
  })
  const pending = queue.commitOptimistic((doc) => doc)
  queue.dispose()
  await assert.rejects(() => pending, /optimistic-queue-disposed/)
  assert.equal(store.getSnapshot().doc, base)
})
