import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyManagedWidth,
  applyWidthOverride,
  clearManagedWidth,
  findLayoutNodes,
  updateManagedWidth,
} from '../../src/client/sidebar-width.js'

class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase()
    this.ownerDocument = doc
    this.children = []
    this.parentElement = null
    this.attributes = new Map()
    this.style = {}
    this.isConnected = true
    this.textContent = ''
  }

  setAttribute(name, value = '') { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  removeAttribute(name) { this.attributes.delete(name) }
  appendChild(child) {
    child.parentElement = this
    child.ownerDocument = this.ownerDocument
    this.children.push(child)
    return child
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
    this.isConnected = false
  }
  contains(node) {
    for (let current = node; current; current = current.parentElement) if (current === this) return true
    return false
  }
  querySelector(selector) {
    const matches = (element) => {
      if (selector === '[data-side="sidebar"]') return element.getAttribute('data-side') === 'sidebar'
      if (selector === 'style[data-dsg-width]') return element.tagName === 'STYLE' && element.getAttribute('data-dsg-width') !== null
      return false
    }
    const walk = (element) => {
      if (matches(element)) return element
      for (const child of element.children) {
        const found = walk(child)
        if (found) return found
      }
      return null
    }
    return walk(this)
  }
}

const makeDom = () => {
  const doc = {
    head: null,
    documentElement: null,
    createElement(tag) { return new FakeElement(tag, doc) },
    querySelector(selector) { return doc.head?.querySelector(selector) ?? null },
  }
  doc.head = new FakeElement('head', doc)
  doc.documentElement = new FakeElement('html', doc)
  const frame = new FakeElement('div', doc)
  frame.style.gridTemplateColumns = '420px minmax(0, 1fr) 320px'
  const sidebarRoot = new FakeElement('aside', doc)
  sidebarRoot.style.width = '420px'
  const handle = new FakeElement('button', doc)
  handle.setAttribute('data-side', 'sidebar')
  frame.appendChild(handle)
  frame.appendChild(sidebarRoot)
  doc.documentElement.appendChild(frame)
  const root = new FakeElement('div', doc)
  sidebarRoot.appendChild(root)
  return { doc, frame, sidebarRoot, root, handle }
}

const withMutationObserver = (body) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver')
  let observer = null
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; observer = this }
    observe(target) { this.target = target }
    disconnect() { this.disconnected = true }
    trigger() { this.callback() }
  }
  try {
    return body(() => observer)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'MutationObserver', descriptor)
    else delete globalThis.MutationObserver
    clearManagedWidth()
  }
}

test('findLayoutNodes locates the frame, sidebar track and rest template', () => {
  const { root, frame, sidebarRoot, handle } = makeDom()
  const nodes = findLayoutNodes(root)
  assert.equal(nodes.supported, true)
  assert.equal(nodes.frame, frame)
  assert.equal(nodes.sidebarRoot, sidebarRoot)
  assert.equal(nodes.officialHandle, handle)
  assert.equal(nodes.rest, 'minmax(0, 1fr) 320px')
  assert.equal(findLayoutNodes(null).supported, false)
  assert.equal(findLayoutNodes({ ownerDocument: null }).supported, false)
})

test('applyWidthOverride writes the override, clamps updates and clears on collapse', () => {
  withMutationObserver((getObserver) => {
    const { doc, root, frame, sidebarRoot } = makeDom()
    const nodes = findLayoutNodes(root)
    const controller = applyWidthOverride(nodes, 900, 700)
    assert.ok(controller)
    const style = doc.querySelector('style[data-dsg-width]')
    assert.ok(style)
    assert.match(style.textContent, /grid-template-columns:560px minmax\(0, 1fr\) 320px/)
    assert.match(style.textContent, /width:560px/)
    assert.equal(frame.getAttribute('data-dsg-sidebar-frame'), '')
    assert.equal(sidebarRoot.getAttribute('data-dsg-sidebar-root'), '')

    assert.equal(controller.update(100, 500), 264)
    assert.equal(controller.update(100, 300), null)
    assert.equal(doc.querySelector('style[data-dsg-width]'), null)
    assert.equal(frame.getAttribute('data-dsg-sidebar-frame'), null)

    const observer = getObserver()
    assert.equal(observer.target, frame)
  })
})

test('applyWidthOverride reports a lost host only once and clears its DOM state', () => {
  withMutationObserver((getObserver) => {
    const { root, frame, sidebarRoot } = makeDom()
    const nodes = findLayoutNodes(root)
    let lost = 0
    const controller = applyWidthOverride(nodes, 600, 1200, { onLost: () => { lost += 1 } })
    assert.ok(controller)
    frame.isConnected = false
    getObserver().trigger()
    assert.equal(lost, 1)
    assert.equal(frame.getAttribute('data-dsg-sidebar-frame'), null)
    assert.equal(sidebarRoot.getAttribute('data-dsg-sidebar-root'), null)
    controller.clear()
    assert.equal(lost, 1)
  })
})

test('managed width is a singleton and handles collapse and host replacement', () => {
  withMutationObserver((getObserver) => {
    const first = makeDom()
    const firstNodes = findLayoutNodes(first.root)
    const firstController = applyManagedWidth(firstNodes, 600, 1200)
    assert.ok(firstController)
    assert.equal(applyManagedWidth(firstNodes, 620, 1200), firstController)
    assert.equal(updateManagedWidth(640, 1200), 640)

    first.frame.setAttribute('data-sidebar-collapsed', 'true')
    assert.equal(applyManagedWidth(firstNodes, 700, 1200), null)
    assert.equal(updateManagedWidth(700, 1200), null)

    const second = makeDom()
    const secondNodes = findLayoutNodes(second.root)
    const secondController = applyManagedWidth(secondNodes, 700, 1200)
    assert.ok(secondController)
    assert.notEqual(secondController, firstController)
    clearManagedWidth()
    assert.equal(second.doc.querySelector('style[data-dsg-width]'), null)
    assert.equal(getObserver().disconnected, true)
  })
})
