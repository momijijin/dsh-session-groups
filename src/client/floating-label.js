/**
 * Floating drag-label controller (0.2.8).
 *
 * The drag overlay is a single DOM node shared by every drag gesture. This
 * controller owns it imperatively (outside React) and hardens the 0.2.7 path:
 *
 * - one instance: an existing `[data-testid="session-groups-floating-label"]`
 *   (possibly left by a previous plugin instance) is reused; additional copies
 *   are hidden, and a second label is never appended;
 * - cached text/visibility/position: identical writes are skipped, and
 *   diagnostics only hear real text changes;
 * - requestAnimationFrame coalescing (last-wins): many dragover events in one
 *   frame produce one text + one layout write;
 * - hide/dispose flush synchronously so the overlay never survives a drag end
 *   or plugin teardown.
 */

/** Stable test id shared with E2E and the legacy 0.2.5+ DOM contract. */
export const FLOATING_LABEL_TESTID = 'session-groups-floating-label'

const LABEL_SELECTOR = `[data-testid="${FLOATING_LABEL_TESTID}"]`

/**
 * Create one label controller.
 *
 * @param {{
 *   document?: Document|null,
 *   requestAnimationFrame?: ((callback: (time: number) => void) => number)|null,
 *   cancelAnimationFrame?: ((id: number) => void)|null,
 *   position?: { x: number, y: number },
 *   onTextChange?: ((text: string) => void)|null,
 *   perfEnabled?: (() => boolean)|null,
 *   perfNow?: (() => number)|null,
 *   perfSample?: ((name: string, ms: number) => void)|null,
 * }} [options]
 */
export const createFloatingLabel = (options = {}) => {
  const doc = options.document ?? globalThis.document ?? null
  const requestFrame =
    options.requestAnimationFrame === undefined
      ? typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null
      : options.requestAnimationFrame
  const cancelFrame =
    options.cancelAnimationFrame === undefined
      ? typeof globalThis.cancelAnimationFrame === 'function'
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : null
      : options.cancelAnimationFrame
  const position = options.position ?? { x: 24, y: 120 }
  const onTextChange = typeof options.onTextChange === 'function' ? options.onTextChange : null
  const perfEnabled = typeof options.perfEnabled === 'function' ? options.perfEnabled : null
  const perfNow = typeof options.perfNow === 'function' ? options.perfNow : null
  const perfSample = typeof options.perfSample === 'function' ? options.perfSample : null

  let element = null
  let initialized = false
  let disposed = false
  let frame = null
  /** Last state applied to the DOM (or read from a reused DOM label). */
  let appliedText = ''
  let appliedVisible = false
  let appliedLeft = null
  let appliedTop = null
  /** Pending last-wins state for the next animation frame. */
  let pending = null

  const queryExisting = () => {
    if (!doc || typeof doc.querySelectorAll !== 'function') return []
    const nodes = doc.querySelectorAll(LABEL_SELECTOR)
    if (!nodes || typeof nodes.length !== 'number') return []
    const usable = []
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      if (node && node.isConnected !== false) usable.push(node)
    }
    return usable
  }

  /** Hide every copy after the first; keep them in the DOM (no node deletion). */
  const adoptFirst = (nodes) => {
    const first = nodes[0] ?? null
    for (let index = 1; index < nodes.length; index += 1) {
      const duplicate = nodes[index]
      if (duplicate?.style) duplicate.style.display = 'none'
      duplicate?.setAttribute?.('data-dsg-duplicate', 'true')
    }
    return first
  }

  /** Read the reused DOM label's current state before the first comparison. */
  const initialize = () => {
    if (initialized) return
    initialized = true
    const existing = adoptFirst(queryExisting())
    if (!existing) return
    element = existing
    appliedText = typeof existing.textContent === 'string' ? existing.textContent : ''
    appliedVisible = existing.style?.display !== 'none'
    appliedLeft = existing.style?.left || null
    appliedTop = existing.style?.top || null
  }

  const ensureElement = (visible) => {
    if (element && element.isConnected === false) element = null
    if (!element) {
      const existing = adoptFirst(queryExisting())
      if (existing) {
        element = existing
        if (!initialized) {
          appliedText = typeof existing.textContent === 'string' ? existing.textContent : ''
          appliedVisible = existing.style?.display !== 'none'
          appliedLeft = existing.style?.left || null
          appliedTop = existing.style?.top || null
          initialized = true
        }
      }
    }
    if (element) return element
    if (!visible || !doc || typeof doc.createElement !== 'function' || !doc.body) return null
    const created = doc.createElement('div')
    created.className = 'dsg-floating-label'
    if (created.dataset) created.dataset.testid = FLOATING_LABEL_TESTID
    else created.setAttribute?.('data-testid', FLOATING_LABEL_TESTID)
    if (created.style) created.style.display = 'none'
    doc.body.appendChild(created)
    element = created
    return element
  }

  const apply = (state) => {
    const label = ensureElement(state.visible)
    if (!label) {
      appliedText = state.text
      appliedVisible = false
      return
    }
    const started = perfEnabled?.() === true && perfNow ? perfNow() : 0
    if (state.text !== appliedText) {
      label.textContent = state.text
      appliedText = state.text
      onTextChange?.(state.text)
    }
    if (state.visible !== appliedVisible) {
      label.style.display = state.visible ? 'block' : 'none'
      appliedVisible = state.visible
    }
    if (state.visible) {
      const left = `${position.x}px`
      const top = `${position.y}px`
      if (left !== appliedLeft) {
        label.style.left = left
        appliedLeft = left
      }
      if (top !== appliedTop) {
        label.style.top = top
        appliedTop = top
      }
    }
    if (started !== 0) perfSample?.('floatingLabelMs', perfNow() - started)
  }

  const flush = () => {
    frame = null
    if (disposed || pending === null) return
    const state = pending
    pending = null
    apply(state)
  }

  const setText = (text) => {
    if (disposed) return
    initialize()
    const value = typeof text === 'string' ? text : ''
    const state = { text: value, visible: value !== '' }
    const current = pending ?? { text: appliedText, visible: appliedVisible }
    if (state.text === current.text && state.visible === current.visible) return
    pending = state
    if (frame !== null) return
    if (typeof requestFrame === 'function') frame = requestFrame(flush)
    else flush()
  }

  const hide = () => {
    if (disposed) return
    initialize()
    pending = { text: '', visible: false }
    if (frame !== null) {
      if (typeof cancelFrame === 'function') cancelFrame(frame)
      frame = null
    }
    flush()
  }

  const dispose = () => {
    if (disposed) return
    if (frame !== null) {
      if (typeof cancelFrame === 'function') cancelFrame(frame)
      frame = null
    }
    flush()
    disposed = true
    element?.remove?.()
    element = null
    pending = null
  }

  return {
    setText,
    hide,
    flush,
    dispose,
    get element() {
      return element
    },
  }
}
