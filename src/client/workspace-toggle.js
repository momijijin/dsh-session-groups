/**
 * The official workspace header is rendered by the shipped browser while our
 * groups view is unmounted, so it has no plugin slot for an extra action. This
 * module renders one compact overlay button immediately to the left of the
 * official search action; a ResizeObserver keeps it aligned when the header
 * expands/collapses or the sidebar resizes. It never inserts into React's tree.
 *
 * Pure DOM, no React and no host imports so it stays testable with the fake
 * document helpers used by the other client modules.
 */

const BUTTON_TEST_ID = 'session-groups-workspace-toggle'
const STYLE_ATTR = 'data-dsg-workspace-toggle-style'

const GRID_PATH =
  'M2.6 2.6h4.4v4.4H2.6zM9 2.6h4.4v4.4H9zM2.6 9h4.4v4.4H2.6zM9 9h4.4v4.4H9z'

/** Find the official section header without matching our `.dsg-header-*`. */
export const findOfficialHeader = (doc = globalThis.document) => {
  if (!doc?.querySelector) return null
  for (const element of doc.querySelectorAll('[class*="sectionHeader"]')) {
    if (element.classList?.contains?.('dsg-header-stacked')) continue
    if (element.querySelector?.('[class*="headerActions"]')) return element
  }
  return null
}

/** Find the left-most official header action (search, then the actions group). */
export const findOfficialHeaderAnchor = (header) => {
  if (!header?.querySelector) return null
  return (
    header.querySelector('[class*="searchButton"]') ??
    header.querySelector('[class*="search"]') ??
    header.querySelector('[class*="headerActions"]')
  )
}

/**
 * Install the workspace-header toggle.
 * @param {{ doc?: Document, label?: string, onToggle?: () => void }} [options]
 * @returns {{ update: () => void, dispose: () => void }} controller
 */
export const installWorkspaceToggle = ({ doc = globalThis.document, label = '', onToggle } = {}) => {
  if (!doc?.createElement || !doc?.body) return { update: () => {}, dispose: () => {} }

  if (!doc.querySelector(`style[${STYLE_ATTR}]`)) {
    const style = doc.createElement('style')
    style.setAttribute(STYLE_ATTR, '')
    style.textContent = [
      `.dsg-workspace-toggle{position:fixed;z-index:70;display:none;box-sizing:border-box;width:28px;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,CanvasText);cursor:pointer;align-items:center;justify-content:center}`,
      `.dsg-workspace-toggle[data-visible="true"]{display:inline-flex}`,
      `.dsg-workspace-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));color:var(--dsw-alias-label-primary,CanvasText)}`,
      `.dsg-workspace-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,CanvasText);outline-offset:-2px}`,
    ].join('\n')
    doc.head?.appendChild(style)
  }

  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'dsg-workspace-toggle'
  button.setAttribute('data-testid', BUTTON_TEST_ID)
  button.setAttribute('aria-label', label)
  button.title = label
  button.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${GRID_PATH}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  doc.body.appendChild(button)

  let disposed = false
  let frame = null
  let observer = null
  let mutation = null

  const update = () => {
    if (disposed) return
    const header = findOfficialHeader(doc)
    const anchor = header ? findOfficialHeaderAnchor(header) : null
    if (!anchor?.getBoundingClientRect) {
      button.setAttribute('data-visible', 'false')
      return
    }
    const rect = anchor.getBoundingClientRect()
    if (!(rect.width > 0) || !(rect.height > 0)) {
      button.setAttribute('data-visible', 'false')
      return
    }
    const left = Math.max(4, rect.left - 4 - 28)
    const top = rect.top + (rect.height - 28) / 2
    button.style.left = `${Math.round(left)}px`
    button.style.top = `${Math.round(top)}px`
    button.setAttribute('data-visible', 'true')
  }

  const schedule = () => {
    if (disposed || frame !== null) return
    const raf = doc.defaultView?.requestAnimationFrame ?? globalThis.requestAnimationFrame
    if (typeof raf !== 'function') {
      update()
      return
    }
    frame = raf(() => {
      frame = null
      update()
    })
  }

  const ResizeObserverCtor = doc.defaultView?.ResizeObserver ?? globalThis.ResizeObserver
  if (typeof ResizeObserverCtor === 'function') {
    observer = new ResizeObserverCtor(schedule)
    const header = findOfficialHeader(doc)
    if (header) observer.observe(header)
  }

  // The workspace header mounts one React commit after the mode switch; align
  // once its actions appear without polling.
  const MutationObserverCtor = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver
  if (typeof MutationObserverCtor === 'function' && doc.body) {
    mutation = new MutationObserverCtor(schedule)
    mutation.observe(doc.body, { childList: true, subtree: true })
  }

  const onClick = (event) => {
    event.stopPropagation()
    onToggle?.()
    schedule()
  }
  button.addEventListener('click', onClick)
  doc.defaultView?.addEventListener?.('resize', schedule)
  doc.addEventListener?.('scroll', schedule, true)
  update()
  schedule()

  return {
    update: schedule,
    dispose() {
      if (disposed) return
      disposed = true
      button.removeEventListener('click', onClick)
      doc.defaultView?.removeEventListener?.('resize', schedule)
      doc.removeEventListener?.('scroll', schedule, true)
      observer?.disconnect?.()
      mutation?.disconnect?.()
      const raf = doc.defaultView?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame
      if (frame !== null && typeof raf === 'function') raf(frame)
      button.remove()
    },
  }
}
