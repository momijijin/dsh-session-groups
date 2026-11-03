// tests/client/diagnostics.test.js
//
// 0.2.5 drag diagnostics: ring buffer bounds, batching/flush, beacon on dragend
// and visibility-hidden, HUD text (<=4 Hz), target-change/placeholder events,
// and the localStorage opt-out. All clocks/DOM/transport are injected so this
// runs in plain Node with no browser.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDiagnostics,
  diagEnabled,
  diagnosticsEnabled,
  getDiagnostics,
  initDiagnostics,
  stopDiagnostics,
  DIAGNOSTICS_HUD_TESTID,
  DIAGNOSTICS_STORAGE_KEY,
} from '../../src/client/diagnostics.js'
import { PLUGIN_VERSION } from '../../src/shared/constants.js'

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

const makeFakeDocument = () => {
  const listeners = []
  const body = {
    children: [],
    appendChild(element) {
      this.children.push(element)
      element.parentNode = this
      return element
    },
  }
  const documentRef = {
    baseURI: 'http://127.0.0.1:4402/',
    visibilityState: 'visible',
    body,
    addEventListener(type, listener, capture) {
      listeners.push({ type, listener, capture: capture === true })
    },
    removeEventListener(type, listener, capture) {
      const index = listeners.findIndex(
        (item) => item.type === type && item.listener === listener && item.capture === (capture === true)
      )
      if (index !== -1) listeners.splice(index, 1)
    },
    createElement() {
      return {
        className: '',
        dataset: {},
        attrs: {},
        textContent: '',
        style: {},
        setAttribute(name, value) {
          this.attrs[name] = String(value)
        },
        getAttribute(name) {
          return this.attrs[name] ?? null
        },
        remove() {},
      }
    },
    dispatch(type, event = {}, capture = false) {
      for (const item of listeners.filter((entry) => entry.type === type && entry.capture === capture)) {
        item.listener(event)
      }
    },
    countListeners(type) {
      return listeners.filter((entry) => entry.type === type).length
    },
  }
  return { documentRef, body, listeners }
}

const makeTimers = () => {
  const timeouts = []
  const intervals = []
  return {
    timeouts,
    intervals,
    setTimeoutImpl(fn, ms) {
      const handle = { fn, ms, cleared: false }
      timeouts.push(handle)
      return handle
    },
    clearTimeoutImpl(handle) {
      handle.cleared = true
    },
    setIntervalImpl(fn, ms) {
      const handle = { fn, ms, cleared: false }
      intervals.push(handle)
      return handle
    },
    clearIntervalImpl(handle) {
      handle.cleared = true
    },
    fireTimeouts() {
      for (const handle of timeouts.splice(0)) if (!handle.cleared) handle.fn()
    },
  }
}

const makeTransport = () => {
  const fetches = []
  const beacons = []
  return {
    fetches,
    beacons,
    fetchImpl: async (url, init) => {
      fetches.push({ url, init, body: JSON.parse(init.body) })
      return { ok: true, status: 200 }
    },
    beacon: (url, blob) => {
      beacons.push({ url, blob })
      return true
    },
  }
}

const makeInstance = (patch = {}) => {
  const fake = makeFakeDocument()
  const timers = makeTimers()
  const transport = makeTransport()
  let clock = 100
  const instance = createDiagnostics({
    enabled: true,
    runId: 'run-unit',
    documentRef: fake.documentRef,
    windowRef: { innerWidth: 1440 },
    now: () => (clock += 1),
    fetchImpl: (...args) => transport.fetchImpl(...args),
    beacon: transport.beacon,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
    setIntervalImpl: timers.setIntervalImpl,
    clearIntervalImpl: timers.clearIntervalImpl,
    native: false,
    hud: false,
    frames: false,
    longTasks: false,
    batchSize: 20,
    flushIntervalMs: 500,
    ...patch,
  })
  return { instance, fake, timers, transport }
}

test('diagnostics are off by default; localStorage 1 opts in', () => {
  assert.equal(diagnosticsEnabled({ getItem: () => null }), false)
  assert.equal(diagnosticsEnabled({ getItem: (key) => (key === DIAGNOSTICS_STORAGE_KEY ? '0' : null) }), false)
  assert.equal(diagnosticsEnabled({ getItem: (key) => (key === DIAGNOSTICS_STORAGE_KEY ? '1' : null) }), true)
  assert.equal(diagnosticsEnabled({ getItem: () => { throw new Error('blocked') } }), false)
})

test('disabled diagnostics are a zero-side-effect no-op', () => {
  const fake = makeFakeDocument()
  const instance = createDiagnostics({ enabled: false, documentRef: fake.documentRef, hud: true })
  assert.equal(instance.enabled, false)
  assert.equal(fake.listeners.length, 0)
  assert.equal(fake.body.children.length, 0)
  assert.equal(instance.trace('x', { a: 1 }), null)
  assert.equal(instance.setContext({ revision: 2 }), undefined)
  assert.deepEqual(instance.snapshot().events, [])
})

test('diagnostics singleton can start and stop on a live config change', () => {
  const fake = makeFakeDocument()
  initDiagnostics({
    enabled: true,
    documentRef: fake.documentRef,
    native: false,
    hud: false,
    frames: false,
    longTasks: false,
  })
  assert.equal(diagEnabled(), true)
  assert.notEqual(getDiagnostics(), null)
  stopDiagnostics()
  assert.equal(diagEnabled(), false)
  assert.equal(getDiagnostics(), null)
})

test('ring buffer is bounded while stats keep the total count', () => {
  const { instance } = makeInstance({ ringSize: 3, batchSize: 999 })
  for (let index = 0; index < 6; index += 1) instance.trace('handler', { handler: `h${index}`, ms: index })
  const snapshot = instance.snapshot()
  assert.equal(snapshot.events.length, 3)
  assert.deepEqual(
    snapshot.events.map((event) => event.handler),
    ['h3', 'h4', 'h5']
  )
  assert.equal(snapshot.stats.events, 7, 'run.start + six traced events')
  assert.equal(instance.enabled, true)
})

test('batches flush at batchSize and flush() drains the queue', async () => {
  const { instance, transport } = makeInstance({ batchSize: 2, maxBatchEvents: 2 })
  await instance.flush()
  transport.fetches.length = 0
  instance.trace('a')
  assert.equal(transport.fetches.length, 0)
  instance.trace('b')
  await flushMicrotasks()
  await instance.flush()
  assert.equal(transport.fetches.length, 1)
  assert.equal(transport.fetches[0].body.events.length, 2)
  assert.equal(transport.fetches[0].body.runId, 'run-unit')
  assert.equal(transport.fetches[0].body.schemaVersion, 1)
  assert.equal(instance.snapshot().pending, 0)

  instance.trace('c')
  instance.trace('d')
  instance.trace('e')
  await instance.flush()
  assert.ok(transport.fetches.length >= 2)
})

test('timer flush batches 20 events into one request', async () => {
  const { instance, timers, transport } = makeInstance({ batchSize: 20 })
  await instance.flush()
  timers.timeouts.length = 0
  transport.fetches.length = 0
  for (let index = 0; index < 5; index += 1) instance.trace('x', { index })
  assert.equal(transport.fetches.length, 0)
  assert.equal(timers.timeouts.length, 1)
  assert.equal(timers.timeouts[0].ms, 500)
  timers.fireTimeouts()
  await flushMicrotasks()
  await instance.flush()
  assert.equal(transport.fetches[0].body.events.filter((event) => event.type === 'x').length, 5)
})

test('dragend and visibility-hidden flush through sendBeacon', async () => {
  const { instance, fake, transport } = makeInstance({ native: true, batchSize: 999 })
  fake.documentRef.dispatch('dragstart', { target: null, clientX: 1, clientY: 2, defaultPrevented: false }, true)
  instance.trace('optimistic.dispatch', { optimistic: true })
  fake.documentRef.dispatch('dragend', { target: null, defaultPrevented: false }, true)
  await flushMicrotasks()
  assert.equal(transport.beacons.length, 1)
  const payload = JSON.parse(await transport.beacons[0].blob.text())
  assert.equal(payload.runId, 'run-unit')
  assert.ok(payload.events.some((event) => event.type === 'native.dragend'))

  fake.documentRef.visibilityState = 'hidden'
  instance.trace('queue.send', { revision: 1 })
  fake.documentRef.dispatch('visibilitychange', {})
  await flushMicrotasks()
  assert.ok(transport.beacons.length >= 2)
})

test('native drag events are traced in capture and bubble phase with target ids', async () => {
  const { instance, fake } = makeInstance({ native: true, batchSize: 999 })
  const target = {
    nodeType: 1,
    tagName: 'DIV',
    getBoundingClientRect() {
      return { left: 10.04, top: 20.06, width: 300.2, height: 32.5 }
    },
    closest(selector) {
      if (selector === '[data-testid]') {
        return { getAttribute: () => 'session-groups-session' }
      }
      if (selector === '[data-session-id]') return { getAttribute: () => 's-1' }
      if (selector === '[data-group-id]') return { getAttribute: () => 'g-1' }
      return null
    },
  }
  fake.documentRef.dispatch('dragover', { target, clientX: 12, clientY: 34, defaultPrevented: false, isTrusted: true }, true)
  fake.documentRef.dispatch('dragover', { target, clientX: 12, clientY: 34, defaultPrevented: true, isTrusted: true }, false)
  const events = instance.snapshot().events.filter((event) => event.type === 'native.dragover')
  // 0.2.18: dragover is capture-only; bubble listeners are reserved for drop/dragend.
  assert.equal(events.length, 1)
  assert.equal(events[0].phase, 'capture')
  assert.equal(events[0].target.sessionId, 's-1')
  assert.equal(events[0].target.groupId, 'g-1')
  assert.equal(events[0].target.rect, undefined)
  assert.equal(events[0].trusted, true)
  assert.equal(instance.snapshot().stats.nativeDragOver, 1)
})

test('target changes emit change + placeholder insert/remove, handler stats update', () => {
  const { instance } = makeInstance({ batchSize: 999 })
  const inserted = instance.targetChange(null, { kind: 'session-before', sessionId: 's-1' })
  assert.equal(inserted, true)
  const types = instance
    .snapshot()
    .events.filter((event) => event.type !== 'run.start')
    .map((event) => event.type)
  assert.deepEqual(types, ['dropTarget.change', 'placeholder.insert'])

  instance.handler('onDragOverSession', 0.42, { clientX: 1, clientY: 2, defaultPrevented: true })
  const stats = instance.snapshot().stats
  assert.equal(stats.lastHandler, 'onDragOverSession')
  assert.equal(stats.lastHandlerMs, 0.42)
  assert.equal(stats.targetChanges, 1)
  assert.equal(stats.placeholderInserts, 1)

  instance.targetChange({ kind: 'session-before', sessionId: 's-1' }, { kind: 'group-append', groupId: 'g-1' })
  assert.equal(instance.snapshot().stats.placeholderRemoves, 1, 'moving between placeholder targets replaces the gap')
  assert.equal(instance.snapshot().stats.placeholderInserts, 2)
  instance.targetChange({ kind: 'group-append', groupId: 'g-1' }, null)
  assert.equal(instance.snapshot().stats.placeholderRemoves, 2)

  const labelTypes = []
  instance.label('放入『A组』')
  instance.label('放入『A组』')
  instance.label(null)
  for (const event of instance.snapshot().events) if (event.type === 'label.change') labelTypes.push(event.text)
  assert.deepEqual(labelTypes, ['放入『A组』', ''])
})

test('HUD is plain DOM text updated on the interval, not per event', () => {
  const { instance, fake, timers } = makeInstance({ hud: true, batchSize: 999 })
  const hud = fake.body.children[0]
  assert.equal(hud.dataset.testid, DIAGNOSTICS_HUD_TESTID)
  assert.match(hud.textContent, new RegExp(`dsg ${PLUGIN_VERSION.replaceAll('.', '\\.')} run-unit`))
  assert.equal(timers.intervals.length, 1)
  assert.equal(timers.intervals[0].ms, 250)

  instance.trace('native.dragover', { phase: 'capture' })
  instance.render('GroupsView')
  instance.render('SessionRow')
  instance.handler('onDropSession', 1.25, { clientX: 0, clientY: 0 })
  instance.label('放到这里')
  instance.dropState('accepted')
  assert.doesNotMatch(hud.textContent, /n=1/) // no per-event update: still the boot text
  timers.intervals[0].fn()
  const text = hud.textContent
  assert.match(text, /n=1/)
  assert.match(text, /chg=0/)
  assert.match(text, /rend=2/)
  assert.match(text, /ms=1\.25/)
  assert.match(text, /lab=放到这里/)
  assert.match(text, /drop=accepted/)
  assert.match(text, /opt=0/)
})

test('flush failures keep the trace in the ring and count the failure', async () => {
  const { instance, timers, transport } = makeInstance({ batchSize: 2 })
  await instance.flush()
  transport.fetchImpl = async () => {
    throw new Error('boom')
  }
  instance.trace('x')
  await flushMicrotasks()
  await instance.flush()
  assert.equal(instance.snapshot().stats.flushFailures >= 1, true)
  assert.ok(instance.snapshot().events.some((event) => event.type === 'x'))
  // A retry timer is armed instead of silently dropping the batch.
  assert.ok(timers.timeouts.some((handle) => handle.ms === 1000))
})

test('dispose removes native listeners and the HUD interval', () => {
  const { instance, fake, timers } = makeInstance({ native: true, hud: true })
  assert.ok(fake.listeners.length > 0)
  instance.dispose()
  assert.equal(fake.listeners.length, 0)
  assert.equal(timers.intervals[0].cleared, true)
  assert.equal(fake.body.children[0].textContent.length > 0, true)
})
