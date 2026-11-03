import test from 'node:test'
import assert from 'node:assert/strict'

import { createChangeStream } from '../../src/adapters/change-stream.js'

const makeEventSource = () => {
  class FakeEventSource {
    static instances = []
    constructor(url, options) {
      this.url = url
      this.options = options
      this.listeners = new Map()
      this.closed = false
      FakeEventSource.instances.push(this)
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener)
    }
    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type)
    }
    emit(type, event) {
      this.listeners.get(type)?.(event)
    }
    close() {
      this.closed = true
    }
  }
  return FakeEventSource
}

test('change stream wires revision and reconnect callbacks', () => {
  const Fake = makeEventSource()
  const revisions = []
  const opens = []
  const errors = []
  const stream = createChangeStream({
    EventSourceImpl: Fake,
    url: '/dsh-session-groups/events',
    onRevision: (event) => revisions.push(event.data),
    onOpen: () => opens.push(true),
    onError: (error) => errors.push(error),
  })
  const source = Fake.instances[0]
  assert.equal(source.url, '/dsh-session-groups/events')
  assert.deepEqual(source.options, { withCredentials: true })

  source.emit('revision', { data: '{"revision":3}' })
  source.onopen()
  source.onerror(new Error('offline'))
  assert.deepEqual(revisions, ['{"revision":3}'])
  assert.deepEqual(opens, [true])
  assert.equal(errors.length, 1)

  stream.close()
  assert.equal(source.closed, true)
  assert.equal(source.listeners.size, 0)
})

test('missing EventSource yields a null stream without throwing', () => {
  assert.equal(createChangeStream({ EventSourceImpl: null, url: '/x' }), null)
  assert.equal(createChangeStream({ EventSourceImpl: function Broken() { throw new Error('no') }, url: '/x' }), null)
})
