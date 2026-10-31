/**
 * Sidebar width math and persistence for the resizable global session groups
 * sidebar.
 *
 * Pure, DOM-free module: the width policy lives here so it can be unit tested
 * and reused by the client components. The sidebar may only grow while the main
 * conversation area keeps at least `mainMin` pixels, and it never exceeds
 * {@link SIDEBAR_WIDTH_MAX}; when the viewport cannot host a wider-than-minimum
 * sidebar the clamp reports `null` so callers skip the resize entirely.
 */
import { safeStorage } from './state.js'

/** localStorage key for the user-chosen sidebar width. */
export const SIDEBAR_WIDTH_KEY = 'dsh-session-groups.width.v1'

/** Smallest width the resize handle may produce. */
export const SIDEBAR_WIDTH_MIN = 264

/** Largest width the sidebar may take on a wide viewport. */
export const SIDEBAR_WIDTH_MAX = 760

/** Width used when nothing valid has been persisted yet. */
export const SIDEBAR_WIDTH_DEFAULT = 420

/** Main area width that must remain visible next to the sidebar. */
const MAIN_MIN_DEFAULT = 480

/**
 * Clamp a requested sidebar width to the viewport-aware range.
 *
 * @param {number} px requested width
 * @param {number} viewportWidth current viewport width
 * @param {{ mainMin?: number }} [options]
 * @returns {number | null} clamped width, or `null` when no wider range exists
 */
export const clampSidebarWidth = (px, viewportWidth, { mainMin = MAIN_MIN_DEFAULT } = {}) => {
  const reserve = Number.isFinite(mainMin) ? mainMin : MAIN_MIN_DEFAULT
  const viewport = Number(viewportWidth)
  const max = Math.min(SIDEBAR_WIDTH_MAX, viewport - reserve)
  if (!(max > SIDEBAR_WIDTH_MIN)) return null
  const width = Number.isFinite(px) ? px : SIDEBAR_WIDTH_DEFAULT
  return Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, width))
}

/**
 * Read the persisted sidebar width.
 *
 * @param {Storage | null} [storage]
 * @returns {number} persisted width, or {@link SIDEBAR_WIDTH_DEFAULT}
 */
export const readSidebarWidth = (storage = safeStorage()) => {
  try {
    const raw = storage?.getItem(SIDEBAR_WIDTH_KEY)
    if (raw == null || raw === '') return SIDEBAR_WIDTH_DEFAULT
    const px = Number(raw)
    return Number.isFinite(px) ? px : SIDEBAR_WIDTH_DEFAULT
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

/**
 * Persist the sidebar width (best effort: blocked storage keeps session state only).
 *
 * @param {number} px
 * @param {Storage | null} [storage]
 * @returns {void}
 */
export const writeSidebarWidth = (px, storage = safeStorage()) => {
  try {
    storage?.setItem(SIDEBAR_WIDTH_KEY, String(px))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Host layout override (DOM adapter)
//
// The shipped layout package solves the three grid tracks itself and clamps the
// first track to 264..420px, so a wider sidebar cannot be expressed through the
// host API. The adapter marks the frame / sidebar root with data attributes and
// installs one `<style>` element whose `!important` rules win over the host's
// inline `grid-template-columns` / `width`. Nothing is written into the host's
// inline styles, which keeps React re-renders and restoration simple.
// ---------------------------------------------------------------------------

/** Attribute marking the host frame (inline `grid-template-columns`). */
const FRAME_ATTR = 'data-dsg-sidebar-frame'
/** Attribute marking the host sidebar root (inline `width`). */
const ROOT_ATTR = 'data-dsg-sidebar-root'
/** Attribute on the singleton override `<style>` element. */
const STYLE_ATTR = 'data-dsg-width'
/** The host's own resize handle; hidden while the override is active. */
const OFFICIAL_HANDLE_SELECTOR = '[data-side="sidebar"]'

/**
 * Split a CSS `grid-template-columns` value into top-level tracks.
 * `minmax(400px, 1fr)` contains a space but must stay one token.
 *
 * @param {string} template
 * @returns {string[]}
 */
const splitTracks = (template) => {
  const tracks = []
  let token = ''
  let depth = 0
  for (const char of String(template ?? '')) {
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (/\s/.test(char) && depth === 0) {
      if (token) {
        tracks.push(token)
        token = ''
      }
    } else {
      token += char
    }
  }
  if (token) tracks.push(token)
  return tracks
}

/**
 * The tracks after the sidebar track (right panel + center sizing), preserved
 * verbatim so overriding the first track never collapses the other columns.
 *
 * @param {string} template
 * @returns {string}
 */
const restOfTemplate = (template) => splitTracks(template).slice(1).join(' ')

/**
 * Locate the host layout nodes that own the sidebar width by walking up from
 * the groups view root.
 *
 * @param {Element | null} rootElement groups view root element
 * @returns {{
 *   supported: boolean,
 *   frame: HTMLElement | null,
 *   sidebarRoot: HTMLElement | null,
 *   officialHandle: Element | null,
 *   template: string | null,
 *   rest: string | null
 * }}
 */
export const findLayoutNodes = (rootElement) => {
  const nodes = {
    supported: false,
    frame: null,
    sidebarRoot: null,
    officialHandle: null,
    template: null,
    rest: null,
  }
  const doc = rootElement?.ownerDocument
  if (!rootElement || !doc) return nodes

  let frame = null
  let sidebarRoot = null
  for (let element = rootElement; element && element !== doc.documentElement; element = element.parentElement) {
    const style = element.style
    if (!frame && style && typeof style.gridTemplateColumns === 'string' && style.gridTemplateColumns.trim() !== '') {
      frame = element
    }
    if (!sidebarRoot && style && /^\d+(?:\.\d+)?px$/.test(style.width ?? '')) sidebarRoot = element
  }
  if (!frame || !sidebarRoot || !frame.contains(sidebarRoot)) return nodes

  nodes.frame = frame
  nodes.sidebarRoot = sidebarRoot
  nodes.officialHandle = frame.querySelector(OFFICIAL_HANDLE_SELECTOR)
  nodes.template = frame.style.gridTemplateColumns
  nodes.rest = restOfTemplate(nodes.template)
  nodes.supported = true
  return nodes
}

/**
 * Resolve a viewport width, falling back to the live one. `update()` is called
 * long after the controller was created (window resize, or a drag after the
 * user widened the window), so a captured value must never win over the live
 * viewport: mounting at 1024px and widening to 1440px would otherwise leave the
 * old 1024px cap in place.
 *
 * @param {number} value explicit viewport candidate
 * @param {number} fallback value captured when the controller was created
 * @returns {number}
 */
const resolveViewportWidth = (value, fallback) => {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  const live = Number(globalThis.innerWidth)
  if (Number.isFinite(live) && live > 0) return live
  return Number(fallback) > 0 ? Number(fallback) : 0
}

/**
 * Install (or refresh) the width override on the host layout nodes.
 *
 * @param {ReturnType<typeof findLayoutNodes>} nodes
 * @param {number} width requested width (clamped here)
 * @param {number} viewportWidth current viewport width
 * @param {{ onLost?: () => void }} [options] `onLost` runs when the host removed
 *   the frame / sidebar root; the caller must hide the handle and re-find nodes.
 * @returns {{ update: (width: number, viewportWidth?: number) => number | null, clear: () => void } | null}
 *   `null` when the nodes are unsupported, disconnected, or the viewport cannot
 *   host a wider-than-minimum sidebar.
 */
export const applyWidthOverride = (nodes, width, viewportWidth, { onLost } = {}) => {
  if (!nodes?.supported || !nodes.frame || !nodes.sidebarRoot) return null
  const frame = nodes.frame
  const sidebarRoot = nodes.sidebarRoot
  const doc = frame.ownerDocument
  if (!doc || !frame.isConnected || !sidebarRoot.isConnected) return null

  let viewport = resolveViewportWidth(viewportWidth, 0)
  let current = clampSidebarWidth(width, viewport)
  if (current === null) return null
  let rest = nodes.rest || restOfTemplate(frame.style.gridTemplateColumns)

  const existing = doc.querySelector(`style[${STYLE_ATTR}]`)
  const style = existing ?? doc.createElement('style')
  style.setAttribute(STYLE_ATTR, '')

  const writeStyle = () => {
    const columns = rest ? `${current}px ${rest}` : `${current}px`
    style.textContent = [
      `[${FRAME_ATTR}]{grid-template-columns:${columns} !important}`,
      `[${ROOT_ATTR}]{width:${current}px !important;max-width:none !important;min-width:0 !important}`,
      `[${FRAME_ATTR}] ${OFFICIAL_HANDLE_SELECTOR}{display:none !important}`,
    ].join('\n')
  }

  let active = true
  const applyAttrs = () => {
    frame.setAttribute(FRAME_ATTR, '')
    sidebarRoot.setAttribute(ROOT_ATTR, '')
  }

  const clear = () => {
    if (!active) return
    active = false
    observer.disconnect()
    frame.removeAttribute(FRAME_ATTR)
    sidebarRoot.removeAttribute(ROOT_ATTR)
    style.remove()
  }

  const refresh = () => {
    if (!active) return
    // The host replaced the frame or the sidebar root: drop the override so the
    // shipped layout owns the width again and let the caller re-find the nodes
    // (and hide the handle) instead of silently keeping a stale controller.
    if (!frame.isConnected || !sidebarRoot.isConnected) {
      clear()
      onLost?.()
      return
    }
    const latestRest = restOfTemplate(frame.style.gridTemplateColumns)
    if (latestRest && latestRest !== rest) {
      rest = latestRest
      writeStyle()
    }
    applyAttrs()
  }

  const observer = new MutationObserver(refresh)
  observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
  if (doc.body) observer.observe(doc.body, { childList: true })

  applyAttrs()
  writeStyle()
  if (!existing) doc.head?.appendChild(style)

  return {
    update(nextWidth, nextViewportWidth) {
      if (!active) return null
      // Always re-clamp against the live viewport, never the creation one.
      const nextViewport = resolveViewportWidth(nextViewportWidth, viewport)
      const next = clampSidebarWidth(nextWidth, nextViewport)
      if (next === null) {
        clear()
        return null
      }
      viewport = nextViewport
      current = next
      writeStyle()
      applyAttrs()
      return current
    },
    clear,
  }
}

// ---------------------------------------------------------------------------
// Cross-view width ownership
// ---------------------------------------------------------------------------
// The groups view can be unmounted while the official workspace browser is
// shown. Keep one override alive for the shell so switching views never snaps
// the sidebar back to the shipped 264..420px cap; the plugin shell releases it
// on unload.
let managedWidth = null
let managedNodes = null

/**
 * Apply or retune the single cross-view width override.
 * @param {ReturnType<typeof findLayoutNodes>} nodes
 * @param {number} width
 * @param {number} viewportWidth
 * @returns {ReturnType<typeof applyWidthOverride>}
 */
export const applyManagedWidth = (nodes, width, viewportWidth) => {
  const sameHost = managedWidth !== null && managedNodes?.frame === nodes?.frame && managedNodes?.sidebarRoot === nodes?.sidebarRoot
  if (managedWidth !== null && !sameHost) {
    managedWidth.clear()
    managedWidth = null
    managedNodes = null
  }
  if (managedWidth !== null) {
    const next = managedWidth.update(width, viewportWidth)
    if (next !== null) return managedWidth
    managedWidth = null
    managedNodes = null
  }
  managedWidth = applyWidthOverride(nodes, width, viewportWidth)
  if (managedWidth !== null) managedNodes = nodes
  return managedWidth
}

/** Retune the existing cross-view override; no-op when it was not installed. */
export const updateManagedWidth = (width, viewportWidth) => managedWidth?.update(width, viewportWidth) ?? null

/** Remove the cross-view override (plugin unload / unsupported layout). */
export const clearManagedWidth = () => {
  managedWidth?.clear()
  managedWidth = null
  managedNodes = null
}
