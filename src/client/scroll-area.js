/**
 * Dialog scroll region with a persistent 5px custom thumb. Native scrollbars
 * are hidden; the thumb is above the list in the stacking order and can be
 * dragged to scroll.
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const h = createElement

export const ScrollArea = ({ className, children, ...rest }) => {
  const scrollerRef = useRef(null)
  const dragCleanupRef = useRef(null)
  const [bar, setBar] = useState(null)
  const update = useCallback(() => {
    const element = scrollerRef.current
    if (!element) {
      setBar(null)
      return
    }
    const max = element.scrollHeight - element.clientHeight
    if (max <= 1) {
      setBar(null)
      return
    }
    const railHeight = Math.max(0, element.clientHeight - 12)
    const height = Math.max(20, Math.round((railHeight * element.clientHeight) / element.scrollHeight))
    const top = Math.round((element.scrollTop / max) * Math.max(0, railHeight - height))
    setBar((previous) => (previous?.height === height && previous?.top === top ? previous : { height, top }))
  }, [])
  const startDrag = (event) => {
    const element = scrollerRef.current
    if (!element || !bar || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const max = element.scrollHeight - element.clientHeight
    const railHeight = Math.max(1, element.clientHeight - 12)
    const track = Math.max(1, railHeight - bar.height)
    const startY = event.clientY
    const startTop = element.scrollTop
    const doc = event.currentTarget?.ownerDocument ?? globalThis.document
    const onMove = (moveEvent) => {
      element.scrollTop = Math.max(0, Math.min(max, startTop + ((moveEvent.clientY - startY) * max) / track))
      update()
    }
    const onEnd = () => {
      doc?.removeEventListener?.('pointermove', onMove)
      doc?.removeEventListener?.('pointerup', onEnd)
      doc?.removeEventListener?.('pointercancel', onEnd)
      dragCleanupRef.current = null
    }
    doc?.addEventListener?.('pointermove', onMove)
    doc?.addEventListener?.('pointerup', onEnd)
    doc?.addEventListener?.('pointercancel', onEnd)
    dragCleanupRef.current = onEnd
  }
  useLayoutEffect(() => {
    const element = scrollerRef.current
    if (!element) return undefined
    update()
    const frame = globalThis.requestAnimationFrame?.(update)
    const timer = globalThis.setTimeout?.(update, 50)
    element.addEventListener('scroll', update, { passive: true })
    globalThis.addEventListener?.('resize', update)
    let observer = null
    if (typeof globalThis.ResizeObserver === 'function') {
      observer = new globalThis.ResizeObserver(update)
      observer.observe(element)
    }
    return () => {
      globalThis.cancelAnimationFrame?.(frame)
      globalThis.clearTimeout?.(timer)
      element.removeEventListener('scroll', update)
      globalThis.removeEventListener?.('resize', update)
      observer?.disconnect()
    }
  }, [update])
  useEffect(() => () => dragCleanupRef.current?.(), [])
  return h(
    'div',
    { class: 'dsg-scroll-area' },
    h('div', { ref: scrollerRef, class: className, ...rest }, children),
    bar
      ? h(
          'div',
          { class: 'dsg-scroll-rail', 'aria-hidden': 'true' },
          h('div', {
            class: 'dsg-scroll-thumb',
            style: { height: `${bar.height}px`, top: `${bar.top}px` },
            onPointerDown: startDrag,
          })
        )
      : null
  )
}
