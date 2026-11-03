import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARCHIVE_FILTER_KEY,
  COLLAPSED_KEY,
  ONBOARDING_KEY,
  VIEW_MODE_KEY,
  createStore,
  readArchiveFilter,
  readOnboardingDone,
  readViewMode,
  writeArchiveFilter,
  writeOnboardingDone,
  writeViewMode,
} from '../../src/client/state.js'

const fakeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  }
}

test('view mode defaults to workspace and persists groups', () => {
  const storage = fakeStorage()
  assert.equal(readViewMode(storage), 'workspace')
  writeViewMode('groups', storage)
  assert.equal(storage.getItem(VIEW_MODE_KEY), 'groups')
  assert.equal(readViewMode(storage), 'groups')
  writeViewMode('workspace', storage)
  assert.equal(readViewMode(storage), 'workspace')
  writeViewMode('invalid', storage)
  assert.equal(readViewMode(storage), 'workspace')
})

test('archive filter defaults to hidden and ignores unknown values', () => {
  const storage = fakeStorage({ [ARCHIVE_FILTER_KEY]: 'only' })
  assert.equal(readArchiveFilter(storage), 'only')
  writeArchiveFilter('all', storage)
  assert.equal(readArchiveFilter(storage), 'all')
  writeArchiveFilter('nope', storage)
  assert.equal(readArchiveFilter(storage), 'hidden')
})

test('onboarding dismissal persists once', () => {
  const storage = fakeStorage()
  assert.equal(readOnboardingDone(storage), false)
  writeOnboardingDone(storage)
  assert.equal(storage.getItem(ONBOARDING_KEY), '1')
  assert.equal(readOnboardingDone(storage), true)
  storage.setItem(ONBOARDING_KEY, 'broken')
  assert.equal(readOnboardingDone(storage), false)
})

test('reset-collapsed clears and persists the expansion defaults', () => {
  const storage = fakeStorage()
  const store = createStore({ storage })
  store.dispatch('collapse-group', { id: 'g1' })
  store.dispatch('collapse-group', { id: 'g2' })
  store.dispatch('reset-collapsed')
  assert.deepEqual(store.getSnapshot().collapsed, {})
  assert.deepEqual(createStore({ storage }).getSnapshot().collapsed, {})
})

test('store dispatch updates view mode and persists it', () => {
  const storage = fakeStorage()
  const store = createStore({ storage })
  assert.equal(store.getSnapshot().viewMode, 'workspace')
  store.dispatch('view-mode', { mode: 'groups' })
  assert.equal(store.getSnapshot().viewMode, 'groups')
  assert.equal(storage.getItem(VIEW_MODE_KEY), 'groups')
})

test('store dispatch toggles expansion and only updates subscribers', () => {
  const store = createStore({ storage: fakeStorage() })
  let calls = 0
  const unsubscribe = store.subscribe(() => {
    calls += 1
  })
  store.dispatch('toggle-group', { id: 'g1' })
  assert.equal(store.getSnapshot().collapsed.g1, true)
  store.dispatch('expand-group', { id: 'g1' })
  assert.equal(store.getSnapshot().collapsed.g1, undefined)
  store.dispatch('collapse-group', { id: 'g2' })
  assert.equal(store.getSnapshot().collapsed.g2, true)
  unsubscribe()
  store.dispatch('toggle-group', { id: 'g3' })
  assert.equal(calls, 3)
})

test('collapsed groups persist across store recreation (plugin updates/reloads)', () => {
  const storage = fakeStorage()
  const first = createStore({ storage })
  first.dispatch('toggle-group', { id: 'g1' })
  first.dispatch('collapse-group', { id: 'g2' })
  first.dispatch('expand-group', { id: 'g1' })

  const second = createStore({ storage })
  assert.equal(second.getSnapshot().collapsed.g1, undefined)
  assert.equal(second.getSnapshot().collapsed.g2, true)

  storage.setItem(COLLAPSED_KEY, '{broken')
  assert.deepEqual(createStore({ storage }).getSnapshot().collapsed, {})
})

test('load success/error and commit conflict transitions', () => {
  const store = createStore({ storage: fakeStorage() })
  store.dispatch('load-start')
  assert.equal(store.getSnapshot().docState, 'loading')
  const doc = { version: 1, revision: 0, groups: [], ungrouped: [] }
  store.dispatch('load-success', { doc, revision: 0, warning: 'corrupt-file' })
  assert.equal(store.getSnapshot().docState, 'ready')
  assert.equal(store.getSnapshot().lastConfirmed, doc)
  assert.deepEqual(store.getSnapshot().banner, { kind: 'warning', code: 'corrupt-file' })
  assert.equal(store.getSnapshot().warning, 'corrupt-file')

  store.dispatch('load-error', { code: 'route-unavailable' })
  assert.equal(store.getSnapshot().docState, 'error')
  assert.deepEqual(store.getSnapshot().banner, { kind: 'error', code: 'route-unavailable' })

  const serverDoc = { version: 1, revision: 4, groups: [], ungrouped: [] }
  store.dispatch('commit-conflict', { doc: serverDoc, revision: 4 })
  assert.equal(store.getSnapshot().doc, serverDoc)
  assert.equal(store.getSnapshot().revision, 4)
  assert.equal(store.getSnapshot().banner.code, 'conflict')
})

test('menu/dialog/toast are transient store state', () => {
  const store = createStore({ storage: fakeStorage() })
  store.dispatch('menu', { menu: { kind: 'group', groupId: 'g1' } })
  assert.equal(store.getSnapshot().menu.groupId, 'g1')
  store.dispatch('menu', { menu: null })
  assert.equal(store.getSnapshot().menu, null)
  store.dispatch('dialog', { dialog: { kind: 'new-group' } })
  assert.equal(store.getSnapshot().dialog.kind, 'new-group')
  store.dispatch('dialog', { dialog: null })
  assert.equal(store.getSnapshot().dialog, null)
  store.dispatch('toast', { toast: { kind: 'success', message: 'ok' } })
  assert.equal(store.getSnapshot().toast.message, 'ok')
})

test('storage failures are best-effort and malformed persisted values fall back safely', () => {
  const blocked = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
  }
  assert.equal(readViewMode(blocked), 'workspace')
  assert.equal(readArchiveFilter(blocked), 'hidden')
  assert.equal(readOnboardingDone(blocked), false)
  assert.doesNotThrow(() => writeViewMode('groups', blocked))
  assert.doesNotThrow(() => writeArchiveFilter('all', blocked))
  assert.doesNotThrow(() => writeOnboardingDone(blocked))

  const malformed = fakeStorage({
    [VIEW_MODE_KEY]: 'garbage',
    [ARCHIVE_FILTER_KEY]: 'garbage',
    [COLLAPSED_KEY]: JSON.stringify({ g1: false, g2: true, '': true }),
  })
  const store = createStore({ storage: malformed })
  assert.equal(store.getSnapshot().viewMode, 'workspace')
  assert.equal(store.getSnapshot().archiveFilter, 'hidden')
  assert.deepEqual(store.getSnapshot().collapsed, { g2: true })
})

test('no-op dispatches do not publish and invalid collapse targets are ignored', () => {
  const store = createStore({ storage: fakeStorage() })
  const seen = []
  store.subscribe(() => seen.push(store.getSnapshot()))
  store.dispatch('view-mode', { mode: 'workspace' })
  store.dispatch('archive-filter', { filter: 'hidden' })
  store.dispatch('expand-group', { id: 'missing' })
  store.dispatch('collapse-group', { id: '' })
  store.dispatch('reset-collapsed')
  store.dispatch('unknown-action')
  assert.equal(seen.length, 0)

  store.dispatch('collapse-group', { id: 'g1' })
  assert.equal(store.getSnapshot().collapsed.g1, true)
  store.dispatch('expand-group', { id: 'g1' })
  assert.equal(store.getSnapshot().collapsed.g1, undefined)
  store.dispatch('expand-group', { id: 'g1' })
  store.dispatch('toggle-group', { id: 'g2' })
  assert.equal(store.getSnapshot().collapsed.g2, true)
  store.dispatch('toggle-group', { id: 'g2' })
  assert.equal(store.getSnapshot().collapsed.g2, undefined)
  store.dispatch('reset-collapsed')
  assert.deepEqual(store.getSnapshot().collapsed, {})
})

test('a throwing subscriber cannot break other subscribers or the store', () => {
  const store = createStore({ storage: fakeStorage() })
  const seen = []
  store.subscribe(() => { throw new Error('broken subscriber') })
  store.subscribe(() => seen.push(store.getSnapshot().saving))
  assert.doesNotThrow(() => store.dispatch('saving', { saving: true }))
  assert.deepEqual(seen, [true])
  assert.equal(store.getSnapshot().saving, true)
})
