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
import { formatAbsoluteTime, relativeTimeParts } from './time.js'
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

import { SessionRow } from './components-rows.js'
import { EmptyDropBox, GROUP_PLACEHOLDER_HEIGHT } from './components-primitives.js'

const h = createElement

const VirtualSpacer = ({ height, position }) =>
  h('div', {
    class: 'dsg-virtual-spacer',
    'data-testid': 'session-groups-virtual-spacer',
    'data-position': position,
    'aria-hidden': 'true',
    style: { height: `${Math.max(0, Math.round(height))}px` },
  })

/**
 * Ungrouped inbox with windowed rows (0.2.3). The section header stays mounted;
 * only rows intersecting `.dsg-tree` plus overscan are rendered, with exact
 * top/bottom spacers preserving the full scroll height. Groups below the inbox
 * stay untouched. `virtualRef` exposes `isVisible`/`scrollToIndex` so search can
 * reveal a row that is outside the current window (spec §3.3).
 */
const UngroupedSection = ({ node, store, props, handlers, virtualRef }) => {
  const collapsedId = '__ungrouped__'
  const expanded = isExpanded(store.collapsed, collapsedId)
  const dropTarget = store.dropTarget
  const dropKind = dropTarget?.kind === 'ungrouped' ? 'ungrouped' : dropTarget?.kind === 'group-root-end' ? 'group-root-end' : null
  const isDrop = dropKind !== null
  const bodyRef = useRef(null)
  const total = node.length
  const [metrics, setMetrics] = useState(() => ({
    scrollTop: 0,
    viewportHeight: estimatedTreeHeight(globalThis.innerHeight),
    listTop: VIRTUAL_HEADER_HEIGHT + 4,
  }))
  const win = computeVirtualWindow({
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportHeight,
    listTop: metrics.listTop,
    rowCount: total,
  })
  const visibleRows = node.slice(win.start, win.end)

  // Track the tree's scroll position/viewport. Only this section re-renders on
  // scroll; the group rows below stay untouched.
  useEffect(() => {
    if (!expanded) {
      if (virtualRef) virtualRef.current = null
      return undefined
    }
    const body = bodyRef.current
    const tree = body?.closest?.('.dsg-tree')
    if (!tree) return undefined
    let scrollFrame = null
    let layoutFrame = null
    let disposed = false
    let listTop = VIRTUAL_HEADER_HEIGHT + 4
    let viewportHeight = tree.clientHeight || estimatedTreeHeight(globalThis.innerHeight)
    const setIfChanged = (scrollTop) => {
      setMetrics((previous) =>
        previous.scrollTop === scrollTop &&
        previous.viewportHeight === viewportHeight &&
        previous.listTop === listTop
          ? previous
          : { scrollTop, viewportHeight, listTop }
      )
    }
    const measureScroll = () => {
      scrollFrame = null
      if (disposed) return
      setIfChanged(tree.scrollTop)
    }
    const measureLayout = () => {
      layoutFrame = null
      if (disposed) return
      const current = bodyRef.current
      if (!current || current.isConnected === false) return
      // Layout reads run only on mount/resize. Scrolling reuses this cached
      // offset instead of forcing getBoundingClientRect() every frame.
      const treeRect = tree.getBoundingClientRect()
      const bodyRect = current.getBoundingClientRect()
      listTop = bodyRect.top - treeRect.top + tree.scrollTop
      viewportHeight = tree.clientHeight
      setIfChanged(tree.scrollTop)
    }
    const scheduleScroll = () => {
      if (scrollFrame === null) scrollFrame = requestAnimationFrame(measureScroll)
    }
    const scheduleLayout = () => {
      if (layoutFrame === null) layoutFrame = requestAnimationFrame(measureLayout)
    }
    measureLayout()
    tree.addEventListener('scroll', scheduleScroll, { passive: true })
    globalThis.addEventListener('resize', scheduleLayout)
    const resizeObserver =
      typeof globalThis.ResizeObserver === 'function'
        ? new globalThis.ResizeObserver(scheduleLayout)
        : null
    resizeObserver?.observe(tree)
    resizeObserver?.observe(body)
    return () => {
      disposed = true
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame)
      tree.removeEventListener('scroll', scheduleScroll)
      globalThis.removeEventListener('resize', scheduleLayout)
      resizeObserver?.disconnect()
      if (virtualRef) virtualRef.current = null
    }
  }, [expanded, total, virtualRef])

  // Expose the imperative search-reveal hook. The controller is refreshed for
  // every window so `isVisible` reflects the current rows.
  useEffect(() => {
    if (!expanded || !virtualRef) return undefined
    const body = bodyRef.current
    const tree = body?.closest?.('.dsg-tree')
    if (!tree) return undefined
    const controller = {
      isVisible: (index) => index >= win.start && index < win.end,
      scrollToIndex: (index) => {
        if (!Number.isInteger(index)) return false
        const currentBody = bodyRef.current
        const currentTree = currentBody?.closest?.('.dsg-tree')
        if (!currentBody || !currentTree) return false
        const treeRect = currentTree.getBoundingClientRect()
        const bodyRect = currentBody.getBoundingClientRect()
        const listTop = bodyRect.top - treeRect.top + currentTree.scrollTop
        const viewportHeight = currentTree.clientHeight
        const target = virtualScrollOffset(index, {
          listTop,
          viewportHeight,
          rowCount: total,
          rowHeight: VIRTUAL_ROW_HEIGHT,
          gap: VIRTUAL_ROW_GAP,
        })
        currentTree.scrollTop = target
        setMetrics({ scrollTop: currentTree.scrollTop, viewportHeight, listTop })
        return true
      },
    }
    virtualRef.current = controller
    return () => {
      if (virtualRef.current === controller) virtualRef.current = null
    }
  }, [expanded, virtualRef, total, win.start, win.end])

  const bodyChildren = []
  if (total === 0) {
    // The section-level drop paints its own placeholder under the header; keep
    // the hint visible only when it would not duplicate that surface.
    if (dropKind !== 'ungrouped') {
      bodyChildren.push(
        h(EmptyDropBox, {
          key: 'empty',
          label: rt()?.t('ungrouped.dropHint'),
          data: { 'data-ungrouped': 'true' },
        })
      )
    }
  } else {
    if (win.topPad > 0) {
      bodyChildren.push(h(VirtualSpacer, { key: 'pad-top', height: win.topPad, position: 'top' }))
    }
    for (const child of visibleRows) {
      const sessionId = child.session.id
      if (dropTarget?.kind === 'session-before' && dropTarget.sessionId === sessionId) {
        bodyChildren.push(h(DropPlaceholder, { key: `ph-b-${sessionId}`, target: dropTarget, store, handlers, height: SESSION_PLACEHOLDER_HEIGHT }))
      }
      bodyChildren.push(h(SessionRow, { key: sessionId, sessionNode: child, depth: 0, groupId: null, ungrouped: true, props, handlers, store }))
      if (dropTarget?.kind === 'session-after' && dropTarget.sessionId === sessionId) {
        bodyChildren.push(h(DropPlaceholder, { key: `ph-a-${sessionId}`, target: dropTarget, store, handlers, height: SESSION_PLACEHOLDER_HEIGHT }))
      }
    }
    if (win.bottomPad > 0) {
      bodyChildren.push(h(VirtualSpacer, { key: 'pad-bottom', height: win.bottomPad, position: 'bottom' }))
    }
  }

  return h(
    'div',
    { class: 'dsg-ungrouped' },
    h(
      'div',
      {
        class: 'dsg-ungrouped-header',
        role: 'treeitem',
        tabindex: '0',
        'aria-expanded': expanded ? 'true' : 'false',
        'data-testid': 'session-groups-ungrouped',
        'data-count': String(total),
        'data-drop-active': isDrop ? 'true' : 'false',
        'data-drop-kind': dropKind ?? '',
        onClick: () => handlers.toggleGroup(collapsedId),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handlers.toggleGroup(collapsedId)
          }
        },
        onDragOver: (event) => handlers.onDragOverUngrouped(event),
        onDragLeave: handlers.onDragLeave,
        onDrop: (event) => handlers.onDropUngrouped(event),
      },
      h('span', { class: 'dsg-group-caret' }, renderGlyph(h, expanded ? 'chevronDown' : 'chevronRight', 16)),
      h('span', { class: 'dsg-group-name' }, rt()?.t('ungrouped.title')),
      h('span', { class: 'dsg-ungrouped-count' }, total)
    ),
    // A session dropped on the ungrouped section becomes the first row; the
    // placeholder sits directly under the header (visible even when scrolled).
    dropKind === 'ungrouped'
      ? h(DropPlaceholder, { target: { kind: 'ungrouped' }, store, handlers, height: SESSION_PLACEHOLDER_HEIGHT })
      : null,
    expanded
      ? h(
          'div',
          { class: 'dsg-group-body' },
          h(
            'div',
            {
              ref: bodyRef,
              class: 'dsg-group-line dsg-virtual-list',
              'data-empty': total === 0 ? 'true' : 'false',
              'data-virtual-start': String(win.start),
              'data-virtual-end': String(win.end),
              'data-virtual-count': String(win.count),
              'data-virtual-total': String(total),
              onDragOver: (event) => handlers.onDragOverUngroupedBody(event),
              onDragLeave: handlers.onDragLeave,
              onDrop: (event) => handlers.onDropUngroupedBody(event),
            },
            ...bodyChildren
          )
        )
      : null
  )
}

// ---------------------------------------------------------------------------

export { UngroupedSection, VirtualSpacer }
