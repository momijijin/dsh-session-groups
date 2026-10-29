// tests/client/floating-label.test.js
//
// 0.2.8 drag-label hardening: one label instance, cached text/visibility,
// requestAnimationFrame last-wins coalescing and flush-on-dispose/hide.

import test from 'node:test'
import assert from 'node:assert/strict'

import { createFloatingLabel, FLOATING_LABEL_TESTID } from '../../src/client/floating-label.js'

const SELECTOR = `[data-testid="${FLOATING_LABEL_TESTID}"]`

const createElement = (document) => {
  const writes = { text: 0, display: 0, left: 0, top: 0 }
  const attributes = new Map()
  const style = new Proxy(
    {},
    {
      set(target, property, value) {
        if (property === 'display') writes.display += 1
        else if (property === 'left') writes.left += 1
        else if (property === 'top') writes.top += 1
        target[property] = value
        return true
      },
    }
  )
  let text = ''
  const element = {
    ownerDocument: document,
    isConnected: false,
    style,
    dataset: {},
    writes,
    get className() {
      return this._className ?? ''
    },
    set className(value) {
      this._className = String(value)
    },
    get textContent() {
      return text
    },
    set textContent(value) {
      writes.text += 1
      text = String(value)
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null
    },
    setAttribute(name, value) {
      attributes.set(name, String(value))
    },
    remove() {
      this.isConnected = false
    },
  }
  return element
}

const createDocument = () => {
  const elements = []
  let appends = 0
  const document = {
    elements,
    get appends() {
      return appends
    },
    createElement() {
      const element = createElement(document)
      elements.push(element)
      return element
    },
    querySelectorAll(selector) {
      if (selector !== SELECTOR) return []
      return elements.filter((element) => element.isConnected && element.dataset.testid === FLOATING_LABEL_TESTID)
    },
    body: {
      appendChild(element) {
        appends += 1
        element.isConnected = true
        return element
      },
    },
  }
  /** Seed a label node as if a previous plugin instance left it in the DOM. */
  document.seed = (text, visible = true) => {
    const element = document.createElement()
    element.className = 'dsg-floating-label'
    element.dataset.testid = FLOATING_LABEL_TESTID
    element.textContent = text
    element.style.display = visible ? 'block' : 'none'
    document.body.appendChild(element)
    return element
  }
  return document
}

const createFrames = () => {
  let nextId = 1
  const queue = new Map()
  return {
    requestAnimationFrame(callback) {
      const id = nextId++
      queue.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      queue.delete(id)
    },
    runAll() {
      while (queue.size > 0) {
        const [id, callback] = queue.entries().next().value
        queue.delete(id)
        callback(0)
      }
    },
    get size() {
      return queue.size
    },
  }
}

const createHarness = (options = {}) => {
  const document = options.document ?? createDocument()
  const frames = options.frames ?? createFrames()
  const changes = []
  const label = createFloatingLabel({
    document,
    requestAnimationFrame: options.requestAnimationFrame === null ? null : frames.requestAnimationFrame,
    cancelAnimationFrame: options.requestAnimationFrame === null ? null : frames.cancelAnimationFrame,
    onTextChange: (text) => changes.push(text),
  })
  return { document, frames, changes, label }
}

test('reuses an existing label and hides duplicate DOM nodes without appending', () => {
  const document = createDocument()
  const first = document.seed('Drop into A')
  const duplicate = document.seed('Drop into A')
  const { frames, changes, label } = createHarness({ document })

  label.setText('Drop into B')
  frames.runAll()

  assert.equal(document.querySelectorAll(SELECTOR).length, 2, 'duplicate nodes are kept in the DOM (hidden), not removed/deleted')
  assert.equal(document.appends, 2, 'no third label was appended')
  assert.equal(first.textContent, 'Drop into B')
  assert.equal(first.style.display, 'block')
  assert.equal(duplicate.style.display, 'none')
  assert.deepEqual(changes, ['Drop into B'])
})

test('creates exactly one label when none exists and never appends a second', () => {
  const { document, frames, label } = createHarness()
  label.setText('Drop here')
  label.setText('Drop here')
  frames.runAll()
  assert.equal(document.querySelectorAll(SELECTOR).length, 1)
  assert.equal(document.appends, 1)
  label.setText('Drop there')
  frames.runAll()
  assert.equal(document.querySelectorAll(SELECTOR).length, 1)
  assert.equal(document.appends, 1)
})

test('identical text/visibility schedules and diagnostics are skipped', () => {
  const { document, frames, changes, label } = createHarness()
  label.setText('Drop here')
  frames.runAll()
  assert.deepEqual(changes, ['Drop here'])
  const element = document.querySelectorAll(SELECTOR)[0]
  element.writes.text = 0
  element.writes.display = 0
  element.writes.left = 0
  element.writes.top = 0

  label.setText('Drop here')
  label.setText('Drop here')
  label.setText('Drop here')
  frames.runAll()

  assert.equal(element.writes.text, 0, 'identical text must not be written again')
  assert.equal(element.writes.display, 0, 'identical visibility must not be written again')
  assert.equal(element.writes.left, 0, 'unchanged layout position must not be written again')
  assert.equal(element.writes.top, 0)
  assert.deepEqual(changes, ['Drop here'], 'diagnostics only hear real text changes')
})

test('coalesces many per-frame updates to the last text in one animation frame', () => {
  const { document, frames, changes, label } = createHarness()
  label.setText('A')
  label.setText('B')
  label.setText('C')
  assert.equal(frames.size, 1, 'only one animation frame is requested')
  assert.equal(document.querySelectorAll(SELECTOR).length, 0, 'no DOM label before the frame')
  assert.deepEqual(changes, [])

  frames.runAll()
  const element = document.querySelectorAll(SELECTOR)[0]
  assert.equal(element.textContent, 'C', 'last write wins')
  assert.equal(element.writes.text, 1)
  assert.equal(element.style.display, 'block')
  assert.equal(element.style.left, '24px')
  assert.equal(element.style.top, '120px')
  assert.deepEqual(changes, ['C'])
})

test('hide flushes immediately and cancels pending text/layout work', () => {
  const { document, frames, changes, label } = createHarness()
  label.setText('A')
  frames.runAll()
  const element = document.querySelectorAll(SELECTOR)[0]
  element.writes.text = 0
  element.writes.display = 0

  label.setText('B')
  label.hide()

  assert.equal(frames.size, 0, 'pending frame was cancelled')
  assert.equal(element.style.display, 'none', 'hide is applied without waiting for a frame')
  assert.equal(element.textContent, '', 'the never-shown B text is not painted')
  assert.equal(element.writes.text, 1, 'one clear write replaces the pending B write')
  assert.equal(element.writes.display, 1)
  assert.deepEqual(changes, ['A', ''], 'hide emits the empty-label diagnostics state once')
})

test('dispose flushes the pending last update, reports it, and removes the label', () => {
  const { document, changes, label } = createHarness()
  label.setText('last')
  label.dispose()
  assert.equal(document.querySelectorAll(SELECTOR).length, 0)
  assert.deepEqual(changes, ['last'])
})

test('falls back to synchronous writes when requestAnimationFrame is unavailable', () => {
  const { document, changes, label } = createHarness({ requestAnimationFrame: null })
  label.setText('sync')
  const element = document.querySelectorAll(SELECTOR)[0]
  assert.equal(element.textContent, 'sync')
  assert.equal(element.style.display, 'block')
  assert.deepEqual(changes, ['sync'])
})
