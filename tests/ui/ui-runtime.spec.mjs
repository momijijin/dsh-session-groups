import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// Map the host React peer to a test-only stub before importing UI modules.
// The loader is scoped to this test file/process and never touches src or lib.
register(new URL('../support/react-loader.mjs', import.meta.url))

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
