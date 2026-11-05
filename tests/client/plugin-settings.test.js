import test from 'node:test'
import assert from 'node:assert/strict'
import { installSettingsSlot } from '../../src/client/plugin-settings.js'

const makeContext = ({ card, form = { title: 'form' } } = {}) => {
  const calls = []
  const disposer = () => calls.push('disposed')
  return {
    calls,
    ctx: {
      get: (name) => (name === 'configForms' ? { get: (key) => (key === 'dsh-session-grove' ? form : null) } : null),
      slots: {
        inject: (name, callback) => {
          calls.push(['inject', name])
          return callback()
        },
        register: (entry, registeredCard) => {
          calls.push(['register', entry, registeredCard])
          return disposer
        },
      },
    },
    disposer,
  }
}

test('settings slot registers the bundle-config card and returns its disposer', () => {
  const card = { name: 'SkillRepairCard' }
  const { ctx, calls, disposer } = makeContext({ card })
  const dispose = installSettingsSlot(ctx, card)
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.deepEqual(calls.at(-1), 'disposed')
  assert.equal(calls[0][0], 'inject')
  assert.equal(calls[0][1], 'plugins.bundle.config')
  assert.equal(calls[1][0], 'register')
  assert.equal(calls[1][1].name, 'plugins.bundle.config')
  assert.equal(calls[1][1].key, 'dsh-session-grove')
  assert.deepEqual(calls[1][1].inject().form, { title: 'form' })
  assert.equal(calls[1][2], card)
})

test('settings slot is optional on hosts without the bundle-config slot', () => {
  assert.equal(installSettingsSlot({ get: () => null }, {}), null)
  assert.equal(installSettingsSlot({ slots: { inject: () => { throw new Error('unsupported') } } }, {}), null)
  assert.equal(installSettingsSlot({ slots: null }, {}), null)
})

test('config form lookup is fail-soft when the config service throws', () => {
  const card = {}
  let seen = null
  installSettingsSlot(
    {
      get: () => {
        throw new Error('service unavailable')
      },
      slots: {
        inject: (_name, callback) => callback(),
        register: (entry) => {
          seen = entry
          return null
        },
      },
    },
    card,
  )
  assert.equal(seen.inject().form, null)
})
