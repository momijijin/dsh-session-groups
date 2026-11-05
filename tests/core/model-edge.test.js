import test from 'node:test'
import assert from 'node:assert/strict'

import { newGroupId } from '../../src/shared/model.js'

test('newGroupId falls back to a stable-shaped random id when crypto.randomUUID is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  if (!descriptor?.configurable) return
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
  try {
    const first = newGroupId()
    const second = newGroupId()
    assert.match(first, /^g-[0-9a-f]{12}$/)
    assert.match(second, /^g-[0-9a-f]{12}$/)
    assert.notEqual(first, second)
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor)
  }
})
