import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceChrome } from '../../src/client/plugin-workspace-chrome.js'

const makeHarness = ({ mode = 'workspace', synced = true, mounted = true } = {}) => {
  const calls = { install: 0, update: 0, dispose: 0, labels: [], toggles: 0, synced: 0 }
  const installToggle = (options) => {
    calls.install += 1
    calls.labels.push(options.label)
    let disposed = false
    return {
      update: () => {
        assert.equal(disposed, false)
        calls.update += 1
      },
      dispose: () => {
        disposed = true
        calls.dispose += 1
      },
    }
  }
  const chrome = createWorkspaceChrome({
    getMode: () => mode,
    getLabel: () => 'Switch to groups',
    onToggle: () => {
      calls.toggles += 1
    },
    syncSidebarWidth: () => {
      calls.synced += 1
      return synced
    },
    isMounted: () => mounted,
    installToggle,
  })
  return { chrome, calls }
}

test('workspace chrome installs once, updates on sync and disposes outside workspace mode', () => {
  const { chrome, calls } = makeHarness()
  chrome.sync()
  chrome.sync()
  assert.equal(calls.install, 1)
  assert.equal(calls.update, 1)
  assert.deepEqual(calls.labels, ['Switch to groups'])
  chrome.dispose()
  assert.equal(calls.dispose, 1)
})

test('workspace chrome disposes the toggle as soon as the groups view is active', () => {
  const { chrome, calls } = makeHarness()
  chrome.sync()
  const state = { mode: 'workspace' }
  chrome.dispose()
  // Recreate with a mode getter that flips after install; a second sync disposes.
  const calls2 = { install: 0, update: 0, dispose: 0 }
  const flipping = createWorkspaceChrome({
    getMode: () => state.mode,
    getLabel: () => 'label',
    syncSidebarWidth: () => true,
    isMounted: () => true,
    installToggle: () => ({
      update: () => {},
      dispose: () => {
        calls2.dispose += 1
      },
    }),
  })
  flipping.sync()
  state.mode = 'groups'
  flipping.sync()
  assert.equal(calls2.dispose, 1)
  assert.equal(calls.dispose, 1)
})

test('workspace chrome retries unresolved layout while mounted and stops after dispose', async () => {
  const { chrome, calls } = makeHarness({ synced: false, mounted: true })
  chrome.sync()
  assert.equal(calls.install, 1)
  await new Promise((resolve) => setTimeout(resolve, 70))
  assert.equal(calls.synced, 2)
  assert.equal(calls.install, 1)
  assert.equal(calls.update, 1)
  chrome.dispose()
  await new Promise((resolve) => setTimeout(resolve, 70))
  assert.equal(calls.synced, 2)
})

test('workspace chrome does not retry after unmount', async () => {
  const { chrome, calls } = makeHarness({ synced: false, mounted: false })
  chrome.sync()
  await new Promise((resolve) => setTimeout(resolve, 70))
  assert.equal(calls.synced, 1)
  chrome.dispose()
})
