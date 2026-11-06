import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { installClientRuntime } from '../../src/adapters/client-runtime.js'

// Map the host React peer to a test-only stub before importing UI modules.
// The loader is scoped to this test file/process and never touches src or lib.
register(new URL('../support/react-loader.mjs', import.meta.url))

const flatten = (node, out = []) => {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
  } else if (node && typeof node === 'object') {
    if (node.type) out.push(node)
    if (node.props && 'children' in node.props) flatten(node.props.children, out)
  }
  return out
}
const byTestId = (tree, id) => flatten(tree).find((node) => node.props?.['data-testid'] === id)
const expand = (node) => {
  if (Array.isArray(node)) return node.map(expand)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return expand(node.type(node.props))
  if (!node.type) return node
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } }
}

const uiModules = [
  'components.js',
  'components-header.js',
  'components-rows.js',
  'components-primitives.js',
  'components-ungrouped.js',
  'components-search-box.js',
  'components-resize-handle.js',
  'dialog-host.js',
  'session-menu.js',
  'scroll-area.js',
  'group-list-picker.js',
  'groups-view-width.js',
  'groups-view-search.js',
  'groups-view-state.js',
  'plugin-locale.js',
  'icons.js',
  'floating-label.js',
  'time.js',
  'state.js',
]

test('client UI modules execute under a test React peer', async () => {
  assert.equal(uiModules.length, 19)
  for (const file of uiModules) {
    const module = await import(new URL(`../../src/client/${file}`, import.meta.url))
    assert.ok(module && typeof module === 'object', `${file} did not load`)
    assert.ok(Object.keys(module).length > 0, `${file} exported nothing`)
  }
  const components = await import(new URL('../../src/client/components.js', import.meta.url))
  const dialogs = await import(new URL('../../src/client/dialog-host.js', import.meta.url))
  const menus = await import(new URL('../../src/client/session-menu.js', import.meta.url))
  assert.equal(typeof components.GroupsView, 'function')
  assert.equal(typeof dialogs.DialogHost, 'function')
  assert.equal(typeof menus.MenuPopover, 'function')
})


test('OnboardingCard renders localized copy and invokes create/dismiss', async () => {
  const { OnboardingCard } = await import(new URL('../../src/client/components-header.js', import.meta.url))
  const calls = []
  const tree = OnboardingCard({
    t: (key) => 'T:' + key,
    onCreate: () => calls.push('create'),
    onDismiss: () => calls.push('dismiss'),
  })
  assert.equal(tree.props.class, 'dsg-onboarding')
  assert.match(flatten(tree).map((node) => node.props?.children).filter((child) => typeof child === 'string').join(' '), /T:onboarding\.title/)
  byTestId(tree, 'session-groups-onboarding-create').props.onClick({ stopPropagation() {} })
  byTestId(tree, 'session-groups-onboarding-dismiss').props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls, ['create', 'dismiss'])
})

test('Banner renders retry/dismiss wiring through the command runtime', async () => {
  const calls = []
  installClientRuntime({
    t: (key) => (key === 'banner.load-failed' ? 'Load failed' : key),
    store: { dispatch: (action, payload) => calls.push([action, payload]) },
  })
  const { Banner } = await import(new URL('../../src/client/components-header.js', import.meta.url))
  const tree = Banner({
    store: { banner: { kind: 'error', code: 'load-failed' } },
    handlers: { retryLoad: () => calls.push('retry') },
  })
  assert.equal(tree.props['data-testid'], 'session-groups-banner')
  byTestId(tree, 'session-groups-banner-retry').props.onClick({ stopPropagation() {} })
  byTestId(tree, 'session-groups-banner-dismiss').props.onClick({ stopPropagation() {} })
  assert.equal(calls[0], 'retry')
  assert.deepEqual(calls[1], ['banner', { banner: null }])
})

test('Rail renders the expand action and Toast renders only an active toast', async () => {
  installClientRuntime({ t: (key) => 'T:' + key })
  const { Rail } = await import(new URL('../../src/client/components-header.js', import.meta.url))
  const { Toast } = await import(new URL('../../src/client/session-menu.js', import.meta.url))
  let expanded = 0
  const rail = Rail({ props: { expandSidebar: () => { expanded += 1 } } })
  byTestId(rail, 'session-groups-rail-expand').props.onClick()
  assert.equal(expanded, 1)
  assert.equal(Toast({ store: { toast: null } }), null)
  const toast = Toast({ store: { toast: { message: 'saved' } } });
  assert.equal(toast.props['data-testid'], 'session-groups-toast')
  assert.equal(toast.props.children, 'saved')
})

test('VirtualSpacer is deterministic and null-state surfaces return null', async () => {
  const { VirtualSpacer } = await import(new URL('../../src/client/components-ungrouped.js', import.meta.url))
  const { DialogHost } = await import(new URL('../../src/client/dialog-host.js', import.meta.url))
  const { MenuPopover } = await import(new URL('../../src/client/session-menu.js', import.meta.url))
  const spacer = VirtualSpacer({ height: 37.6, position: 'top' })
  assert.equal(spacer.props.style.height, '38px')
  assert.equal(spacer.props['data-position'], 'top')
  assert.equal(MenuPopover({ store: { menu: null }, handlers: {} }), null)
  assert.equal(DialogHost({ store: { dialog: null }, props: {} }), null)
})


test('SessionRow renders title/status and wires open/archive/menu handlers', async () => {
  installClientRuntime({
    t: (key) => 'T:' + key,
    capabilities: { archive: true, unarchive: true },
    notify: (payload) => calls.push(['notify', payload]),
  })
  const calls = []
  const handlers = {
    openSession: (id) => calls.push(['open', id]),
    onSessionContextMenu: () => {},
    openSessionMenuAtRow: () => {},
    onDragStart: () => {},
    onDragEnd: () => {},
    onDragOverSession: () => {},
    onDragLeave: () => {},
    onDropSession: () => {},
    archiveSession: (id) => calls.push(['archive', id]),
    unarchiveSession: () => {},
    openSessionMenu: () => calls.push(['menu']),
  }
  const { SessionRow } = await import(new URL('../../src/client/components-rows.js', import.meta.url))
  const sessionNode = {
    session: { id: 's1', updatedAt: Date.now(), blank: false },
    archived: false,
    status: null,
    workspace: null,
    runningSubagentCount: 0,
  }
  const tree = SessionRow({ sessionNode, depth: 1, groupId: 'g1', props: {}, handlers, store: { currentSessionId: null } })
  const row = byTestId(tree, 'session-groups-session')
  assert.equal(row.props['data-session-id'], 's1')
  assert.match(row.props.title, /T:session\.untitled|Session/)
  row.props.onClick()
  byTestId(tree, 'session-groups-session-archive').props.onClick({ stopPropagation() {} })
  byTestId(tree, 'session-groups-session-menu').props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls, [['open', 's1'], ['archive', 's1'], ['menu']])
})

test('SessionRow archived click reports through the command runtime instead of throwing', async () => {
  const notices = []
  installClientRuntime({ t: (key) => key, capabilities: { unarchive: false }, notify: (payload) => notices.push(payload) })
  const { SessionRow } = await import(new URL('../../src/client/components-rows.js', import.meta.url))
  const sessionNode = { session: { id: 's2', updatedAt: Date.now(), blank: false }, archived: true, status: null }
  const tree = SessionRow({ sessionNode, depth: 0, groupId: null, ungrouped: true, props: {}, handlers: {}, store: {} })
  tree.props.onClick()
  assert.equal(notices.length, 1)
  assert.equal(notices[0].kind, 'error')
})

test('GroupNode renders header metadata and wires click/menu handlers', async () => {
  const calls = []
  installClientRuntime({ t: (key) => 'T:' + key })
  const handlers = new Proxy({}, { get: (_target, prop) => (...args) => calls.push([String(prop), ...args]) })
  const { GroupNode } = await import(new URL('../../src/client/components-rows.js', import.meta.url))
  const doc = { groups: [{ id: 'g1', name: 'Group one', icon: 'folder', color: 'blue', parentId: null, sessionIds: [] }], ungrouped: [] }
  const node = { group: doc.groups[0], children: [], visibleCount: 0, emptyVisible: true }
  const tree = GroupNode({
    node,
    depth: 0,
    props: {},
    handlers,
    store: { doc, collapsed: {}, dropTarget: null, draggedGroupId: null },
  })
  const row = byTestId(tree, 'session-groups-group')
  assert.equal(row.props['data-group-id'], 'g1')
  assert.equal(byTestId(tree, 'session-groups-group-count').props.children, 0)
  row.props.onClick()
  byTestId(tree, 'session-groups-group-menu').props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls.map((entry) => entry[0]), ['onGroupClick', 'openGroupMenu'])
})


test('MenuPopover renders a group menu and dispatches an item through handlers', async () => {
  const calls = []
  installClientRuntime({ t: (key) => 'T:' + key, capabilities: { fork: () => false } })
  const { MenuPopover } = await import(new URL('../../src/client/session-menu.js', import.meta.url))
  const handlers = new Proxy({}, { get: (_target, prop) => (...args) => calls.push([String(prop), ...args]) })
  const doc = { groups: [{ id: 'g1', name: 'Group one', icon: 'folder', color: 'blue', parentId: null, sessionIds: [] }], ungrouped: [] }
  const tree = MenuPopover({ store: { doc, menu: { kind: 'group', groupId: 'g1', x: 10, y: 20, anchorX: 10, anchorY: 20 } }, handlers })
  assert.equal(tree.props['data-menu-kind'], 'group')
  assert.equal(tree.props['data-source-id'], 'g1')
  const newSession = byTestId(tree, 'session-groups-group-new-session')
  newSession.props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls[0], ['closeMenu'])
  assert.deepEqual(calls[1], ['openNewSession', null, 'g1'])
})

test('DialogHost renders a new-group dialog from non-null store state', async () => {
  installClientRuntime({ t: (key) => 'T:' + key })
  const { DialogHost } = await import(new URL('../../src/client/dialog-host.js', import.meta.url))
  const tree = DialogHost({ store: { dialog: { kind: 'new-group', titleKey: 'dialog.newGroup', parentId: null } }, props: {} })
  assert.ok(byTestId(tree, 'session-groups-dialog'))
  assert.ok(byTestId(tree, 'session-groups-dialog-input'))
  assert.equal(byTestId(tree, 'session-groups-dialog-confirm').props.children, 'T:dialog.confirm')
})

test('FlatFallback renders session rows and retry/return actions', async () => {
  let retried = 0
  let mode = null
  installClientRuntime({ t: (key) => 'T:' + key, retryLoad: () => { retried += 1 }, setMode: (next) => { mode = next }, actions: { openSession: () => {} } })
  const { FlatFallback } = await import(new URL('../../src/client/components-header.js', import.meta.url))
  const tree = FlatFallback({
    store: {},
    reason: 'route-unavailable',
    props: {
      useSessions: () => ({ ids: ['s1'], byId: { s1: { id: 's1', title: 'Session', origin: 'user' } } }),
      useWorkspaces: () => ({ items: [] }),
    },
  })
  assert.equal(tree.props['data-reason'], 'route-unavailable')
  assert.equal(byTestId(tree, 'session-groups-session').props['data-session-id'], 's1')
  byTestId(tree, 'session-groups-flat-retry').props.onClick({ stopPropagation() {} })
  byTestId(tree, 'session-groups-return').props.onClick({ stopPropagation() {} })
  assert.equal(retried, 1)
  assert.equal(mode, 'workspace')
})


test('Header renders title/status counts/options and wires new-group/toggle', async () => {
  const calls = []
  installClientRuntime({
    t: (key) => 'T:' + key,
    toggleMode: () => calls.push('toggle'),
  })
  const { Header } = await import(new URL('../../src/client/components-header.js', import.meta.url))
  const handlers = new Proxy({}, { get: (_target, prop) => (...args) => calls.push([String(prop), ...args]) })
  const tree = expand(Header({
    store: { archiveFilter: 'hidden', viewMode: 'groups' },
    handlers,
    sessionsById: {},
    workspaces: [],
    archivedSessionIds: [],
    runningSessions: { count: 2, sections: [] },
    blockedSessions: { count: 0, sections: [] },
    unreadSessions: { count: 1, sections: [] },
  }))
  assert.equal(tree.props['data-testid'], 'session-groups-header')
  assert.match(JSON.stringify(tree), /T:view\.title/)
  assert.equal(byTestId(tree, 'session-groups-running-button').props['data-count'], '2')
  assert.equal(byTestId(tree, 'session-groups-blocked-button').props['data-count'], '0')
  assert.equal(byTestId(tree, 'session-groups-view-options').props['data-filter'], 'hidden')
  byTestId(tree, 'session-groups-new-group').props.onClick({ stopPropagation() {} })
  byTestId(tree, 'session-groups-toggle').props.onClick({ stopPropagation() {} })
  assert.equal(calls[0][0], 'openNewGroup')
  assert.equal(calls[0][2], null)
  assert.equal(calls[1], 'toggle')
})

test('SessionRow renders current/running/archived data attributes', async () => {
  installClientRuntime({ t: (key) => 'T:' + key, capabilities: { archive: true, unarchive: true } })
  const { SessionRow } = await import(new URL('../../src/client/components-rows.js', import.meta.url))
  const handlers = new Proxy({}, { get: () => () => {} })
  const sessionNode = {
    session: { id: 's-running', updatedAt: Date.now(), blank: false },
    archived: false,
    status: { running: true },
    workspace: null,
    runningSubagentCount: 1,
  }
  const tree = SessionRow({ sessionNode, depth: 0, groupId: 'g1', props: {}, handlers, store: { currentSessionId: 's-running' } })
  assert.equal(tree.props['data-current'], 'true')
  assert.equal(tree.props['data-archived'], 'false')
  assert.equal(tree.props['data-depth'], '0')
  assert.match(tree.props.class, /dsg-session-row/)
})


test('MenuPopover renders a session menu with fork/archive/copy actions', async () => {
  const calls = []
  installClientRuntime({ t: (key) => 'T:' + key, capabilities: { fork: () => true } })
  const { MenuPopover } = await import(new URL('../../src/client/session-menu.js', import.meta.url))
  const handlers = new Proxy({}, { get: (_target, prop) => (...args) => calls.push([String(prop), ...args]) })
  const doc = { groups: [{ id: 'g1', name: 'G', icon: 'folder', color: 'blue', parentId: null, sessionIds: ['s1'] }], ungrouped: [] }
  const tree = MenuPopover({ store: { doc, menu: { kind: 'session', sessionId: 's1', title: 'Session', archived: false, blank: false, x: 10, y: 20 } }, handlers })
  assert.equal(tree.props['data-menu-kind'], 'session')
  assert.equal(tree.props['data-source-id'], 's1')
  const labels = flatten(tree).map((node) => node.props?.children).filter((child) => typeof child === 'string')
  assert.ok(labels.includes('T:session.fork'))
  assert.ok(labels.includes('T:session.copyId'))
  const rename = flatten(tree).find((node) => node.props?.children === 'T:session.rename')
  rename.props.onClick({ stopPropagation() {} })
  assert.deepEqual(calls[0], ['closeMenu'])
  assert.deepEqual(calls[1], ['openRenameSession', 's1', 'Session'])
})

test('DialogHost renders a rename-group dialog with a non-null title input', async () => {
  installClientRuntime({ t: (key) => 'T:' + key })
  const { DialogHost } = await import(new URL('../../src/client/dialog-host.js', import.meta.url))
  const doc = { groups: [{ id: 'g1', name: 'Group one', icon: 'folder', color: 'blue', parentId: null, sessionIds: [] }], ungrouped: [] }
  const tree = DialogHost({ store: { doc, dialog: { kind: 'rename-group', groupId: 'g1', titleKey: 'dialog.renameGroup', value: 'Group one' } }, props: {} })
  const dialog = byTestId(tree, 'session-groups-dialog')
  assert.ok(dialog)
  assert.equal(dialog.props['data-kind'], 'rename-group')
  assert.ok(byTestId(tree, 'session-groups-dialog-input'))
  assert.equal(byTestId(tree, 'session-groups-dialog-cancel').props.children, 'T:dialog.cancel')
})


test('DialogHost shows the new-workspace action only when the host exposes it', async () => {
  const calls = []
  installClientRuntime({
    t: (key) => key,
    canCreateWorkspace: () => true,
    createWorkspaceForNewSession: async (dialog) => {
      calls.push(dialog)
      return { cancelled: false, workspaceId: 'w2' }
    },
  })
  const { DialogHost } = await import(new URL('../../src/client/dialog-host.js', import.meta.url))
  const store = {
    doc: { groups: [], ungrouped: [] },
    dialog: {
      kind: 'new-session',
      groupId: 'g1',
      choices: [{ workspaceId: 'w1', title: 'One', path: 'C:\\one' }],
      inferred: 'w1',
    },
  }
  const tree = DialogHost({ store, props: {} })
  const button = byTestId(tree, 'session-groups-dialog-new-workspace')
  assert.ok(button)
  await button.props.onClick({ stopPropagation() {} })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].kind, 'new-session')

  installClientRuntime({ t: (key) => key, canCreateWorkspace: () => false })
  const hidden = DialogHost({ store, props: {} })
  assert.equal(byTestId(hidden, 'session-groups-dialog-new-workspace'), undefined)
})


test('new-session dialog shows the create-workspace hint when there are no workspaces', async () => {
  installClientRuntime({ t: (key) => key, canCreateWorkspace: () => true })
  const { DialogHost } = await import(new URL('../../src/client/dialog-host.js', import.meta.url))
  const tree = DialogHost({ store: { doc: { groups: [], ungrouped: [] }, dialog: { kind: 'new-session', groupId: 'g1', choices: [] } }, props: {} })
  assert.match(JSON.stringify(tree), /dialog\.noWorkspaceCreate/)
  assert.ok(byTestId(tree, 'session-groups-dialog-new-workspace'))
})
