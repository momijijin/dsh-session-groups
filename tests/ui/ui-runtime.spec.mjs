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
