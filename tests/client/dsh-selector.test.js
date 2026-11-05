import test from 'node:test'
import assert from 'node:assert/strict'

import { DSH_0_2_ADAPTER } from '../../src/adapters/dsh-0.2.js'
import { DSH_ADAPTERS, resolveDshVersion, selectDshAdapter } from '../../src/adapters/dsh-selector.js'

test('DSH 0.2 adapter supports the current prerelease and patch line', () => {
  assert.equal(DSH_0_2_ADAPTER.id, 'dsh-0.2')
  assert.equal(DSH_0_2_ADAPTER.supports('0.2.1-rc.2'), true)
  assert.equal(DSH_0_2_ADAPTER.supports('0.2.99'), true)
  assert.equal(DSH_0_2_ADAPTER.supports('0.3.0'), false)
  assert.equal(DSH_0_2_ADAPTER.supports('0.1.99'), false)
  assert.equal(DSH_0_2_ADAPTER.supports(''), false)
})

test('selector returns one exact adapter and rejects unsupported/unknown versions', () => {
  assert.equal(selectDshAdapter('0.2.1-rc.2'), DSH_0_2_ADAPTER)
  assert.equal(selectDshAdapter('0.2.0'), DSH_0_2_ADAPTER)
  assert.equal(selectDshAdapter('0.3.0'), null)
  assert.equal(selectDshAdapter('1.0.0'), null)
  assert.equal(selectDshAdapter(undefined), null)
  assert.equal(selectDshAdapter(''), null)
})

test('adapter matrix is explicit and additive', () => {
  assert.equal(DSH_ADAPTERS.length, 1)
  assert.deepEqual(
    DSH_ADAPTERS.map((adapter) => ({ id: adapter.id, range: adapter.range })),
    [{ id: 'dsh-0.2', range: '>=0.2.0-rc.2 <0.3.0' }],
  )
  // The selector only ever returns a registered adapter.
  assert.equal(DSH_ADAPTERS.includes(selectDshAdapter('0.2.99')), true)
})

test('host version resolution is optional and fail-soft', () => {
  assert.equal(resolveDshVersion({ get: (name) => (name === 'dshVersion' ? '0.2.1-rc.2' : undefined) }), '0.2.1-rc.2')
  assert.equal(resolveDshVersion({ get: () => undefined }), null)
  assert.equal(resolveDshVersion({ get: () => { throw new Error('not exposed') } }), null)
})
