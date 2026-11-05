/**
 * React components for the groups sidebar (plain `createElement`, no JSX).
 *
 * Components are registered into DSH slots and receive the framework standard
 * toolkit as props (`useSessions`, `useWorkspaces`, `useSessionStatus`,
 * `usePanelInfo`, `…`) plus the slot owner share. Everything host-derived is read
 * from those hooks; the only local state is this plugin's view store.
 */
import { Component, createElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { groupColorCss } from '../core/color.js'
import { estimatedTreeHeight } from '../core/layout.js'
import { sessionRowPropsEqual, statusLabel } from '../core/session-row.js'
import { GROUP_COLORS, GROUP_ICONS, GROUP_COLOR_HEX, MAX_GROUP_NAME, PLUGIN_VERSION, SESSION_WATERMARK_BASE, SESSION_WATERMARK_AUTO_MAX } from '../shared/constants.js'
import {
  childrenOf,
  findGroup,
  groupColor,
  groupColorHex,
  isColorHex,
  moveGroup,
  normalizeColorHex,
} from '../shared/model.js'
import {
  currentColorHexOf,
  currentColorOf,
  currentGroupIdOf,
  currentIconOf,
  currentParentOf,
  deleteGroupNeedsDialog,
  deleteGroupOptions,
  dialogConfirmPayload,
  findGroupsFlat,
  initialDialogSelection,
  isSelectionDialog,
  moveGroupOptions,
  selectionIsValid,
} from '../core/dialog-selection.js'
import { createActions, formatActivity, workspaceChoices, workspaceLabel } from './actions.js'
import { MenuPopover, Toast } from './session-menu.js'
import { GroupListPicker } from './group-list-picker.js'
import { ScrollArea } from './scroll-area.js'
import { DialogHost } from './dialog-host.js'
import { sessionViewEqual, statusMapEqual, workspaceViewEqual } from './session-equality.js'
import {
  centeredDialogRect,
  clampDialogRect,
  dragDialogRect,
  readDialogGeometries,
  resizeDialogRect,
  saveDialogGeometry,
} from './dialog-geometry.js'
import {
  buildVisibleTree,
  countTreeSessions,
  mainSessionIdOf,
  isArchived,
  sessionTitle,
  ARCHIVE_FILTERS,
  ARCHIVE_FILTER_LABEL_KEYS,
} from '../core/filter.js'
import { applyDrop, hitTest, sameDropTarget, stickyDropTarget, ungroupedBodyTarget } from '../core/drag.js'
import {
  diagContext,
  diagDragEnd,
  diagDragStart,
  diagDropState,
  diagEnabled,
  diagHandler,
  diagRender,
  diagTargetChange,
  diagTrace,
} from './diagnostics.js'
import { GROUP_DRAG_MIME, groupHeaderZoneFromRect, isCurrentGroupPosition, resolveGroupDrop } from '../core/group-drag.js'
import { ICON_GROUPS, renderGlyph, renderHeaderIcon, renderIcon } from './icons.js'
import { isMenuKey, menuAnchorFromEvent, menuAnchorFromRow } from '../core/menu-position.js'
import {
  perfDragOver,
  perfDropTarget,
  perfEnabled,
  perfMark,
  perfNow,
  perfRender,
  perfSample,
} from './perf.js'
import { buildSearchIndex, matchSessions, revealSession } from '../core/search.js'
import { readOnboardingDone, writeOnboardingDone } from './state.js'
import {
  applyManagedWidth,
  clampSidebarWidth,
  clearManagedWidth,
  findLayoutNodes,
  maxSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MIN,
} from './sidebar-width.js'
import { relativeTimeParts } from './time.js'
import {
  computeVirtualWindow,
  virtualScrollOffset,
  VIRTUAL_HEADER_HEIGHT,
  VIRTUAL_ROW_GAP,
  VIRTUAL_ROW_HEIGHT,
} from '../core/virtual-list.js'
import {
  displayDepth,
  expandAncestors,
  flattenTree,
  groupPath,
  isExpanded,
  runningSubagentCounts,
  statusSectionsByGroup,
  sessionStatuses,
} from '../core/tree.js'


const h = createElement

const ResizeHandle = ({ width, min, max, onChange, onCommit, onReset }) => {
  const t = rt()?.t ?? ((key) => key)
  const dragRef = useRef(null)
  const frameRef = useRef(null)
  const trackingRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const changeRef = useRef(onChange)
  const commitRef = useRef(onCommit)
  changeRef.current = onChange
  commitRef.current = onCommit

  /** Remove the window-level drag listeners installed by onPointerDown. */
  const stopTracking = () => {
    const stop = trackingRef.current
    trackingRef.current = null
    if (typeof stop === 'function') stop()
  }

  const endDrag = useCallback((commit) => {
    const drag = dragRef.current
    if (!drag) {
      stopTracking()
      return
    }
    dragRef.current = null
    stopTracking()
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    try {
      if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
    } catch {
      /* synthetic pointer */
    }
    setDragging(false)
    if (commit) {
      const clamped = clampSidebarWidth(drag.width, globalThis.innerWidth)
      if (clamped !== null) {
        // The last pointermove only scheduled a rAF that the cancel above may
        // have discarded. Apply the final width before persisting so a fast
        // release cannot store a width the sidebar never took.
        changeRef.current?.(clamped)
        commitRef.current?.(clamped)
      }
    }
  }, [])

  // Unmount mid-drag: drop listeners/capture without committing.
  useEffect(
    () => () => {
      const drag = dragRef.current
      dragRef.current = null
      stopTracking()
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      try {
        if (drag?.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
      } catch {
        /* pointer already released */
      }
    },
    []
  )

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (dragRef.current) endDrag(false)
    const element = event.currentTarget
    try {
      element.setPointerCapture?.(event.pointerId)
    } catch {
      /* synthetic pointer events may not be capturable */
    }
    const start = clampSidebarWidth(width, globalThis.innerWidth) ?? width
    const drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: start, width: start, element }
    dragRef.current = drag

    // Attach synchronously: waiting for a React effect can miss the first
    // pointermove events while the host is still hydrating.
    const onMove = (moveEvent) => {
      const active = dragRef.current
      if (!active || active.pointerId !== moveEvent.pointerId) return
      const next = clampSidebarWidth(active.startWidth + (moveEvent.clientX - active.startX), globalThis.innerWidth)
      if (next === null) return
      active.width = next
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        changeRef.current?.(active.width)
      })
    }
    const onUp = (upEvent) => {
      if (dragRef.current?.pointerId !== upEvent.pointerId) return
      endDrag(true)
    }
    const onCancel = (cancelEvent) => {
      if (dragRef.current?.pointerId !== cancelEvent.pointerId) return
      endDrag(false)
    }
    globalThis.addEventListener('pointermove', onMove)
    globalThis.addEventListener('pointerup', onUp)
    globalThis.addEventListener('pointercancel', onCancel)
    trackingRef.current = () => {
      globalThis.removeEventListener('pointermove', onMove)
      globalThis.removeEventListener('pointerup', onUp)
      globalThis.removeEventListener('pointercancel', onCancel)
    }
    setDragging(true)
  }

  const onKeyDown = (event) => {
    const viewport = globalThis.innerWidth
    const maxWidth = maxSidebarWidth(viewport)
    let requested = null
    if (event.key === 'ArrowLeft') requested = width - 16
    else if (event.key === 'ArrowRight') requested = width + 16
    else if (event.key === 'Home') requested = min
    else if (event.key === 'End') requested = maxWidth
    if (requested === null) return
    event.preventDefault()
    const next = clampSidebarWidth(requested, viewport)
    if (next === null) return
    changeRef.current?.(next)
    commitRef.current?.(next)
  }

  return h('div', {
    class: 'dsg-resize-handle',
    'data-testid': 'session-groups-resize-handle',
    'data-dragging': dragging ? 'true' : 'false',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': t('width.handle'),
    'aria-valuemin': String(min),
    'aria-valuemax': String(max),
    'aria-valuenow': String(Math.round(width)),
    title: t('width.resetHint'),
    tabindex: '0',
    style: { left: `${width - 3}px` },
    onPointerDown,
    onDoubleClick: (event) => {
      event.preventDefault()
      onReset?.()
    },
    onKeyDown,
  })
}

// ---------------------------------------------------------------------------

export { ResizeHandle }
