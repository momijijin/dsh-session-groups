import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldShowLoading } from '../../src/client/load-mode.js'

test('initial reads show the loading placeholder', () => {
  assert.equal(shouldShowLoading({ background: false, docState: 'idle' }), true)
  assert.equal(shouldShowLoading({ background: false, docState: 'ready' }), true)
})

test('a ready tree stays visible during a background refresh', () => {
  assert.equal(shouldShowLoading({ background: true, docState: 'ready' }), false)
})

test('a background refresh still shows loading before any usable tree exists', () => {
  assert.equal(shouldShowLoading({ background: true, docState: 'loading' }), true)
  assert.equal(shouldShowLoading({ background: true, docState: 'error' }), true)
  assert.equal(shouldShowLoading({ background: true, docState: 'idle' }), true)
})

test('the default is the conservative loading state', () => {
  assert.equal(shouldShowLoading(), true)
})
