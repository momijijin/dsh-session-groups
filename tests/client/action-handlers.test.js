import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installClientRuntime } from '../../src/adapters/client-runtime.js'
import { createMenuHandlers } from '../../src/client/groups-view-menu-handlers.js'
import { createDialogHandlers } from '../../src/client/groups-view-dialog-handlers.js'

const t = (key) => key

const makeDoc = () => ({
  version: 1,
  groups: [
    { id: 'g1', name: 'Group one', parentId: null, icon: 'folder', color: 'blue', sessionIds: ['s1'] },
    { id: 'g2', name: 'Group two', parentId: null, icon: 'folder', color: 'green', sessionIds: [] },
  ],
  ungrouped: [],
})

const installRuntime = (overrides = {}) => {
  const calls = { dispatch: [], dialog: [], notify: [], resetLayout: 0, deleteGroupDirect: [], copy: [], archive: [] }
  const runtime = {
    store: {
      doc: makeDoc(),
      dispatch: (action, payload) => calls.dispatch.push([action, payload]),
    },
    openDialog: (payload) => calls.dialog.push(payload),
    notify: (payload) => calls.notify.push(payload),
    showToast: (kind, message) => calls.notify.push({ kind, message }),
    resetLayout: () => {
      calls.resetLayout += 1
    },
    deleteGroupDirect: (groupId) => calls.deleteGroupDirect.push(groupId),
    copySessionId: (sessionId) => calls.copy.push(sessionId),
    archiveSession: (sessionId) => calls.archive.push(sessionId),
    unarchiveSession: () => {},
    forkSession: () => {},
    retryLoad: () => {},
    actions: { openSession: () => {} },
    commitOptimistic: () => Promise.resolve({ ok: true }),
  }
  installClientRuntime({ ...runtime, ...overrides })
  return calls
}

const menuHandlers = (calls, overrides = {}) =>
  createMenuHandlers({
    t,
    dragRef: { current: null },
    consumeDragClick: () => false,
    handleWidthReset: () => {
      calls.dispatch.push(['width-reset'])
    },
    selectSearchResult: () => {},
    ...overrides,
  })

const dialogHandlers = (calls) => createDialogHandlers({ store: { doc: makeDoc() }, t, byId: {}, workspaceItems: [], currentId: null })

test('menu handlers dispatch navigation, archive filter and reset actions through the runtime bridge', () => {
  const calls = installRuntime()
  const menu = menuHandlers(calls)
  menu.toggleGroup('g1')
  menu.setArchiveFilter('only')
  menu.resetLayout()
  menu.searchArchived()
  menu.retryLoad()
  assert.deepEqual(calls.dispatch[0], ['toggle-group', { id: 'g1' }])
  assert.deepEqual(calls.dispatch[1], ['archive-filter', { filter: 'only' }])
  assert.equal(calls.dispatch[2][0], 'width-reset')
  assert.equal(calls.resetLayout, 1)
  assert.equal(calls.notify[0].message, 'search.archivedDisabled')
})

test('group click is consumed after a drag and open-close menu handlers use the latest snapshot', () => {
  const calls = installRuntime()
  const menu = menuHandlers(calls, { consumeDragClick: () => true })
  menu.onGroupClick('g1')
  assert.deepEqual(calls.dispatch, [])
  const open = menuHandlers(calls)
  open.closeMenu()
  assert.deepEqual(calls.dispatch.at(-1), ['menu', { menu: null }])
})

test('menu anchors set session and group menu state; context menus respect dragRef', () => {
  globalThis.innerWidth = 1280
  globalThis.innerHeight = 800
  const calls = installRuntime()
  const menu = menuHandlers(calls)
  const event = { preventDefault: () => {}, stopPropagation: () => {}, clientX: 30, clientY: 40 }
  menu.openGroupMenu(event, { id: 'g2' })
  assert.equal(calls.dispatch.at(-1)[0], 'menu')
  assert.equal(calls.dispatch.at(-1)[1].menu.groupId, 'g2')
  menu.onGroupContextMenu(event, { id: 'g2' })
  assert.equal(calls.dispatch.at(-1)[1].menu.groupId, 'g2')
  const blocked = menuHandlers(calls, { dragRef: { current: { kind: 'group' } } })
  const before = calls.dispatch.length
  blocked.onGroupContextMenu(event, { id: 'g2' })
  assert.equal(calls.dispatch.length, before)
})

test('group dialog handlers open the expected dialog kinds and empty leaf deletion is direct', () => {
  const calls = installRuntime()
  const dialog = dialogHandlers(calls)
  dialog.openNewGroup(undefined, null)
  dialog.openRenameGroup('g1')
  dialog.openIconGroup('g1')
  dialog.openGroupColor('g1')
  dialog.openMoveGroup('g1')
  dialog.openDeleteGroup('g2')
  dialog.openDeleteGroup('g1')
  assert.deepEqual(calls.dialog.map((entry) => entry.kind), [
    'new-group',
    'rename-group',
    'icon',
    'group-color',
    'move-group',
    'delete-group',
  ])
  assert.deepEqual(calls.deleteGroupDirect, ['g2'])
  assert.equal(calls.dialog.at(-1).groupId, 'g1')
  assert.equal(calls.dialog.at(-1).sessionCount, 1)
})

test('session dialog commands forward archive/fork/copy and rename payloads', () => {
  const calls = installRuntime()
  const dialog = dialogHandlers(calls)
  dialog.openRenameSession('s1', 'stale title')
  dialog.openMoveSession('s1')
  dialog.archiveSession('s1')
  dialog.unarchiveSession('s1')
  dialog.forkSession('s1')
  dialog.copySessionId('s1')
  assert.equal(calls.dialog[0].kind, 'rename-session')
  assert.equal(calls.dialog[0].value, 'stale title')
  assert.equal(calls.dialog[1].kind, 'move-session')
  assert.deepEqual(calls.archive, ['s1'])
  assert.deepEqual(calls.copy, ['s1'])
})

test('session menu anchors cover row/session context and session commands', () => {
  globalThis.innerWidth = 1280
  globalThis.innerHeight = 800
  const calls = installRuntime()
  const menu = menuHandlers(calls)
  const event = { preventDefault: () => {}, stopPropagation: () => {}, clientX: 30, clientY: 40 }
  const sessionNode = { session: { id: 's1', title: 'Session one' }, archived: false, sessionId: 's1' }
  menu.openSessionMenu(event, sessionNode)
  assert.equal(calls.dispatch.at(-1)[1].menu.sessionId, 's1')
  menu.openSessionMenuAtRow({ getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30 }) }, sessionNode)
  assert.equal(calls.dispatch.at(-1)[1].menu.sessionId, 's1')
  menu.onSessionContextMenu(event, sessionNode)
  assert.equal(calls.dispatch.at(-1)[1].menu.sessionId, 's1')
  menu.openGroupMenuAtRow({ getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30 }) }, { id: 'g1' })
  assert.equal(calls.dispatch.at(-1)[1].menu.groupId, 'g1')
  menu.openSession('s1')
  menu.onGroupClick('g1')
  assert.ok(calls.dispatch.some(([action]) => action === 'toggle-group'))
})

test('move steps execute the updater and swallow errors without a crash', async () => {
  const calls = installRuntime({ commitOptimistic: (updater) => Promise.resolve().then(() => updater(makeDoc())) })
  const dialog = dialogHandlers(calls)
  dialog.moveGroupStep('g1', 1)
  dialog.moveSessionStep('s1', 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.notify.length, 0)
  const rejected = installRuntime({ commitOptimistic: () => Promise.reject(new Error('nope')) })
  const dialog2 = dialogHandlers(rejected)
  dialog2.moveGroupStep('g1', 1)
  dialog2.moveSessionStep('s1', 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(rejected.notify.length, 0)
})

test('new session without a workspace emits the localized error toast', () => {
  const calls = installRuntime()
  const dialog = dialogHandlers(calls)
  dialog.openNewSession(undefined, 'g1')
  assert.equal(calls.notify.at(-1).kind, 'error')
  assert.equal(calls.notify.at(-1).message, 'dialog.noWorkspace')
})

test('dialog move steps reject a no-op task without surfacing an error', async () => {
  const calls = installRuntime({ commitOptimistic: () => Promise.resolve({ ok: true }) })
  const dialog = dialogHandlers(calls)
  dialog.moveGroupStep('g1', 1)
  dialog.moveSessionStep('s1', 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.notify.length, 0)
})


test('new session opens the dialog without workspaces when the host can create one', () => {
  const calls = installRuntime({ canCreateWorkspace: () => true })
  const dialog = dialogHandlers(calls)
  dialog.openNewSession(undefined, 'g1')
  assert.equal(calls.notify.length, 0)
  assert.equal(calls.dialog.length, 1)
  assert.equal(calls.dialog[0].kind, 'new-session')
  assert.deepEqual(calls.dialog[0].choices, [])
})
