/**
 * Sidebar width controller for the groups view.
 *
 * Keeps the persisted preference separate from the viewport-clamped applied
 * width; owns the host-DOM controller lifecycle and the resize event.
 */
import { useEffect, useRef, useState } from 'react'
import {
  applyManagedWidth,
  clampSidebarWidth,
  clearManagedWidth,
  findLayoutNodes,
  maxSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
} from './sidebar-width.js'

export const useGroupsSidebarWidth = ({ wide, docState, rootRef }) => {
const widthControllerRef = useRef(null)
const preferredWidthRef = useRef(0)
const [preferredWidth, setPreferredWidth] = useState(() => readSidebarWidth())
const [viewportWidth, setViewportWidth] = useState(() => globalThis.innerWidth || 1440)
const [widthSupported, setWidthSupported] = useState(false)
preferredWidthRef.current = preferredWidth
const appliedWidth = clampSidebarWidth(preferredWidth, viewportWidth)
const maxAppliedWidth = maxSidebarWidth(viewportWidth)

useEffect(() => {
  if (!wide) {
    // The host owns the 56px rail. The cross-view managed override must also
    // be released, not just this component's local controller reference.
    clearManagedWidth()
    widthControllerRef.current = null
    setWidthSupported(false)
    return undefined
  }
  const root = rootRef.current
  if (!root) return undefined
  let disposed = false

  const clearController = () => {
    if (!widthControllerRef.current) return
    try {
      widthControllerRef.current.clear()
    } catch {
      /* fail-soft: a detached host node is already gone */
    }
    widthControllerRef.current = null
  }

  const sync = () => {
    if (disposed) return
    const viewport = globalThis.innerWidth || viewportWidth
    const nodes = findLayoutNodes(root)
    if (!nodes.supported) {
      clearController()
      setWidthSupported(false)
      return
    }
    const clamped = clampSidebarWidth(preferredWidthRef.current, viewport)
    if (clamped === null) {
      clearController()
      setWidthSupported(false)
      return
    }
    if (widthControllerRef.current === null) {
      const controller = applyManagedWidth(nodes, clamped, viewport)
      if (!controller) {
        setWidthSupported(false)
        return
      }
      widthControllerRef.current = controller
    } else if (widthControllerRef.current.update(clamped, viewport) === null) {
      clearController()
      setWidthSupported(false)
      return
    }
    setWidthSupported(true)
  }

  // The host replaced the frame / sidebar root underneath us: the adapter has
  // already cleared the override, so hide the handle and re-find the nodes.
  // When the groups root itself is detached, `findLayoutNodes` reports
  // unsupported and the handle stays hidden.
  function onLost() {
    if (disposed) return
    clearController()
    setWidthSupported(false)
    sync()
  }

  const onResize = () => {
    setViewportWidth(globalThis.innerWidth)
    sync()
  }

  sync()
  globalThis.addEventListener('resize', onResize)
  return () => {
    disposed = true
    globalThis.removeEventListener('resize', onResize)
    // Keep the managed override alive across a groups -> workspace switch;
    // the plugin shell owns its final release.
    widthControllerRef.current = null
    setWidthSupported(false)
  }
}, [wide, docState])

const handleWidthChange = (next) => {
  preferredWidthRef.current = next
  setPreferredWidth(next)
  widthControllerRef.current?.update(next, globalThis.innerWidth)
}

const handleWidthCommit = (next) => {
  writeSidebarWidth(next)
}

const handleWidthReset = () => {
  const viewport = globalThis.innerWidth || viewportWidth
  // The preference is always the design default (420); the applied width is
  // only its viewport clamp. Persisting the clamp would permanently downgrade
  // a narrow-window reset (e.g. 320 at 800px) and widening later would stay
  // narrow instead of restoring 420.
  const next = clampSidebarWidth(SIDEBAR_WIDTH_DEFAULT, viewport)
  preferredWidthRef.current = SIDEBAR_WIDTH_DEFAULT
  setPreferredWidth(SIDEBAR_WIDTH_DEFAULT)
  if (next !== null) widthControllerRef.current?.update(next, viewport)
  writeSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
}


  return {
    viewportWidth,
    appliedWidth,
    maxAppliedWidth,
    widthSupported,
    handleWidthChange,
    handleWidthCommit,
    handleWidthReset,
  }
}
