/**
 * React components for the groups sidebar (plain `createElement`, no JSX).
 *
 * Components are registered into DSH slots and receive the framework standard
 * toolkit as props (`useSessions`, `useWorkspaces`, `useSessionStatus`,
 * `usePanelInfo`, `…`) plus the slot owner share. Everything host-derived is read
 * from those hooks; the only local state is this plugin's view store.
 */
import { Component, createElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_GROUP_NAME } from '../shared/constants.js'
import { childrenOf, findGroup, moveGroup } from '../shared/model.js'
import { createActions, formatActivity, workspaceChoices, workspaceLabel } from './actions.js'
import {
  buildVisibleTree,
  countTreeSessions,
  currentSessionIdOf,
  isArchived,
  sessionTitle,
  ARCHIVE_FILTERS,
  ARCHIVE_FILTER_LABEL_KEYS,
  nextArchiveFilter,
} from './filter.js'
import { hitTest, applyDrop } from './drag.js'
import { GROUP_DRAG_MIME, resolveGroupDrop } from './group-drag.js'
import { renderGlyph, renderIcon } from './icons.js'
import { buildSearchIndex, matchSessions, revealSession } from './search.js'
import {
  applyWidthOverride,
  clampSidebarWidth,
  findLayoutNodes,
  readSidebarWidth,
  writeSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from './sidebar-width.js'
import {
  displayDepth,
  expandAncestors,
  flattenTree,
  groupPath,
  isExpanded,
  siblingNeighbors,
  statusLabelKey,
  statusTone,
} from './tree.js'

const h = createElement

// ---------------------------------------------------------------------------
// Runtime bridge (set by plugin.js during apply; module scope = one plugin
// instance per page, matching the single sidebar.workspaces slot).
// ---------------------------------------------------------------------------
let runtime = null

/** @param {object} value - plugin runtime {store, t, actions, commitDoc, load, requestLoad, ...} */
export const setRuntime = (value) => {
  runtime = value
}

const rt = () => runtime

const useViewStore = () => {
  const store = rt()?.store
  const subscribe = useCallback((listener) => (store ? store.subscribe(listener) : () => {}), [store])
  const getSnapshot = useCallback(() => (store ? store.getSnapshot() : null), [store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const classNames = (...values) => values.filter(Boolean).join(' ')

/** Dispatch helper bound to the live store. */
const dispatch = (action, payload) => rt()?.store.dispatch(action, payload)

/** Show one toast through the plugin shell (auto-dismiss). */
const toast = (kind, message) => rt()?.notify({ kind, message })

/**
 * Thrown inside a queued doc updater to abandon a no-op group drop before the
 * commit queue sends a request. `commitDoc` resolves the updater against the
 * latest confirmed doc first, so this keeps the latest-doc semantics while still
 * skipping the write entirely (no revision bump).
 */
const GROUP_DROP_NOOP = Symbol('dsh-session-groups/group-drop-noop')

/**
 * Whether a resolved group drop lands on the dragged group's current position.
 *
 * `resolveGroupDrop` measures `resolved.index` on the pre-removal siblings, but
 * `moveGroup` inserts after removing the dragged group. The effective insertion
 * index is therefore `min(resolved.index, postRemovalCount)`; the group's
 * post-removal original index is its pre-removal index (`moveGroup` restores it
 * by inserting at that index). A generic `resolved.index >= count` shortcut is
 * wrong: dragging the first root group to the end resolves index=rootCount, which
 * is >= postRemovalCount yet is a real move.
 *
 * `root-end` is the one target whose index includes the dragged group, so a
 * dragged group that is already the last root is explicitly a no-op.
 */
const isCurrentGroupPosition = (doc, draggedId, resolved, target) => {
  const dragged = findGroup(doc, draggedId)
  if (!dragged || !resolved || resolved.invalid) return false
  if (resolved.parentId !== dragged.parentId) return false
  const siblings = childrenOf(doc, dragged.parentId)
  const originalIndex = siblings.findIndex((group) => group.id === draggedId)
  if (originalIndex === -1) return false
  const postRemovalCount = siblings.length - 1
  if (target?.kind === 'root-end' && dragged.parentId === null && originalIndex === postRemovalCount) return true
  return Math.min(resolved.index, postRemovalCount) === originalIndex
}

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------
const IconButton = ({ label, glyph, onClick, testId, data }) =>
  h(
    'button',
    {
      type: 'button',
      class: 'dsg-icon-button',
      title: label,
      'aria-label': label,
      'data-testid': testId,
      onClick: (event) => {
        event.stopPropagation()
        onClick?.(event)
      },
      ...(data ?? {}),
    },
    renderGlyph(h, glyph)
  )

const TextButton = ({ label, onClick, testId, data }) =>
  h(
    'button',
    {
      type: 'button',
      class: 'dsg-text-button',
      title: label,
      'data-testid': testId,
      onClick: (event) => {
        event.stopPropagation()
        onClick?.(event)
      },
      ...(data ?? {}),
    },
    label
  )

const StatusDot = ({ status }) => h('span', { class: 'dsg-session-dot', 'data-tone': statusTone(status), 'aria-hidden': 'true' })

// ---------------------------------------------------------------------------
// Session row
// ---------------------------------------------------------------------------
const SessionRow = ({
  sessionNode,
  depth,
  groupId,
  ungrouped = false,
  props,
  handlers,
  store,
}) => {
  const row = sessionNode.session
  const sessionId = row.id
  const archived = sessionNode.archived === true
  const status = sessionNode.status
  const title = sessionTitle(row, { blankLabel: rt()?.t('session.blank'), untitledLabel: rt()?.t('session.untitled') })
  const workspaceName = sessionNode.workspace ? workspaceLabel(sessionNode.workspace) : rt()?.t('session.noWorkspace')
  const current = store?.currentSessionId === sessionId
  const dropTarget = store?.dropTarget
  const isDropTarget = dropTarget && dropTarget.sessionId === sessionId
  const indicator = isDropTarget
    ? h('div', {
        class: 'dsg-drop-indicator',
        'data-testid': 'session-groups-drop-indicator',
        'data-drop-kind': dropTarget.kind,
        'data-drop-target': sessionId,
      })
    : null
  return h(
    'div',
    {
      class: classNames('dsg-session-row', isDropTarget && dropTarget.kind === 'session-before' && 'dsg-insert-before', isDropTarget && dropTarget.kind === 'session-after' && 'dsg-insert-after'),
      role: 'treeitem',
      tabindex: '0',
      draggable: 'true',
      'aria-selected': current ? 'true' : undefined,
      'aria-label': title,
      'data-testid': 'session-groups-session',
      'data-session-id': sessionId,
      ...(ungrouped ? { 'data-ungrouped': 'true' } : { 'data-group-id': groupId ?? '' }),
      'data-current': current ? 'true' : 'false',
      'data-archived': archived ? 'true' : 'false',
      'data-depth': String(displayDepth(depth)),
      title: `${title} · ${workspaceName}`,
      onClick: () => {
        if (archived) {
          toast('error', rt()?.t('session.archivedBadge'))
          return
        }
        handlers.openSession(sessionId)
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handlers.openSession(sessionId)
        }
      },
      onDragStart: (event) => {
        event.dataTransfer?.setData('text/plain', sessionId)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        handlers.onDragStart(sessionId)
      },
      onDragEnd: handlers.onDragEnd,
      onDragOver: (event) => handlers.onDragOverSession(event, sessionId, groupId, ungrouped),
      onDrop: (event) => handlers.onDropSession(event, sessionId, groupId, ungrouped),
    },
    h(StatusDot, { status }),
    h('span', { class: 'dsg-session-title' }, title),
    archived ? h('span', { class: 'dsg-session-badge' }, rt()?.t('session.archivedBadge')) : null,
    h('span', { class: 'dsg-workspace-badge', 'data-testid': 'session-groups-workspace-badge', title: sessionNode.workspace?.path ?? '' }, workspaceName),
    h(
      'span',
      { class: 'dsg-session-actions' },
      IconButton({ label: rt()?.t('session.menu'), glyph: 'more', testId: 'session-groups-session-menu', data: { 'data-session-id': sessionId }, onClick: (event) => handlers.openSessionMenu(event, sessionNode) })
    ),
    indicator
  )
}

// ---------------------------------------------------------------------------
// Group tree node
// ---------------------------------------------------------------------------
/**
 * One body drop slot between child groups. The slot carries the stable
 * `beforeGroupId` anchor (next child group id, `null` for the last slot / empty
 * group); the numeric index is always resolved against the latest doc, never
 * cached in the drag gesture.
 */
const GroupDropSlot = ({ parentId, beforeGroupId, store, handlers }) => {
  const dropTarget = store.dropTarget
  const anchor = beforeGroupId ?? null
  const active =
    dropTarget && dropTarget.kind === 'group-child' && dropTarget.parentId === parentId && (dropTarget.beforeGroupId ?? null) === anchor
  const forbidden =
    dropTarget && dropTarget.kind === 'group-forbidden' && dropTarget.parentId === parentId && (dropTarget.beforeGroupId ?? null) === anchor
  return h('div', {
    class: classNames('dsg-group-drop-slot', active && 'dsg-drop-active'),
    'data-testid': 'session-groups-group-drop',
    'data-parent-id': parentId,
    'data-before-group-id': anchor ?? '',
    'data-drop-active': active ? 'true' : 'false',
    'data-drop-forbidden': forbidden ? 'true' : 'false',
    onDragOver: (event) => handlers.onDragOverGroupSlot(event, parentId, anchor),
    onDrop: (event) => handlers.onDropGroupSlot(event, parentId, anchor),
  })
}

const GroupNode = ({ node, depth, props, handlers, store }) => {
  const group = node.group
  const expanded = isExpanded(store.collapsed, group.id)
  const dropTarget = store.dropTarget
  const isAppendTarget = dropTarget && dropTarget.kind === 'group-append' && dropTarget.groupId === group.id
  const headerKind = dropTarget && dropTarget.targetId === group.id ? dropTarget.kind : null
  const isBefore = headerKind === 'group-before'
  const isAfter = headerKind === 'group-after'
  const isForbidden = headerKind === 'group-forbidden'
  const dragging = store.draggedGroupId === group.id
  const visibleSessions = node.children.filter((child) => child.kind === 'session')
  const childGroups = node.children.filter((child) => child.kind === 'group')
  const notFound = rt()?.t('group.empty')
  // n child groups => n+1 slots; every slot and child group renders before the
  // session rows so slots never sit between sessions. Collapsed groups render no
  // body and therefore no child slots.
  const bodyChildren = []
  for (let index = 0; index <= childGroups.length; index += 1) {
    const beforeGroupId = childGroups[index]?.group.id ?? null
    bodyChildren.push(h(GroupDropSlot, { key: `drop-${index}`, parentId: group.id, beforeGroupId, store, handlers }))
    if (index < childGroups.length) {
      const child = childGroups[index]
      bodyChildren.push(h(GroupNode, { key: child.group.id, node: child, depth: depth + 1, props, handlers, store }))
    }
  }
  return h(
    'div',
    { class: 'dsg-group' },
    h(
      'div',
      {
        class: classNames(
          'dsg-group-row',
          isAppendTarget && 'dsg-insert-after',
          isBefore && 'dsg-insert-before',
          isAfter && 'dsg-insert-after',
          dragging && 'dsg-dragging'
        ),
        role: 'treeitem',
        tabindex: '0',
        draggable: 'true',
        'aria-expanded': expanded ? 'true' : 'false',
        'data-testid': 'session-groups-group',
        'data-group-id': group.id,
        'data-depth': String(displayDepth(depth)),
        'data-expanded': expanded ? 'true' : 'false',
        'data-drop-active': isAppendTarget ? 'true' : 'false',
        'data-drop-kind': headerKind ?? '',
        'data-drop-forbidden': isForbidden ? 'true' : 'false',
        'data-dragging': dragging ? 'true' : 'false',
        title: groupPath(store.doc, group.id),
        onClick: () => handlers.onGroupClick(group.id),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handlers.toggleGroup(group.id)
          }
        },
        onDragStart: (event) => handlers.onGroupDragStart(event, group),
        onDragEnd: handlers.onDragEnd,
        onDragOver: (event) => handlers.onDragOverGroup(event, group.id),
        onDrop: (event) => handlers.onDropGroup(event, group.id),
      },
      h('span', { class: 'dsg-group-caret' }, renderGlyph(h, expanded ? 'chevronDown' : 'chevronRight', 12)),
      h('span', { class: 'dsg-group-icon' }, renderIcon(h, group.icon, 14)),
      h('span', { class: 'dsg-group-name' }, group.name),
      h('span', { class: 'dsg-group-count' }, node.visibleCount),
      h(
        'span',
        { class: 'dsg-group-actions' },
        IconButton({
          label: rt()?.t('group.addSession'),
          glyph: 'plus',
          testId: 'session-groups-group-add',
          data: { 'data-group-id': group.id },
          onClick: (event) => handlers.openNewSession(event, group.id),
        }),
        IconButton({
          label: rt()?.t('group.menu'),
          glyph: 'more',
          testId: 'session-groups-group-menu',
          data: { 'data-group-id': group.id },
          onClick: (event) => handlers.openGroupMenu(event, group),
        })
      ),
      isAppendTarget
        ? h('div', {
            class: 'dsg-drop-indicator',
            'data-testid': 'session-groups-drop-indicator',
            'data-drop-kind': 'group-append',
            'data-drop-target': group.id,
          })
        : null
    ),
    expanded
      ? h(
          'div',
          { class: 'dsg-group-body' },
          h(
            'div',
            {
              class: 'dsg-group-line',
              'data-empty': node.visibleCount === 0 ? 'true' : 'false',
              onDragOver: (event) => handlers.onDragOverGroupHead(event, group.id),
              onDrop: (event) => handlers.onDropGroupHead(event, group.id),
            },
            ...bodyChildren,
            node.visibleCount === 0
              ? h('div', { class: 'dsg-group-empty', 'data-testid': 'session-groups-empty' }, notFound)
              : null,
            ...visibleSessions.map((child) =>
              h(SessionRow, { key: child.session.id, sessionNode: child, depth: depth + 1, groupId: group.id, props, handlers })
            )
          )
        )
      : null
  )
}

// ---------------------------------------------------------------------------
// Ungrouped section
// ---------------------------------------------------------------------------
const UngroupedSection = ({ node, store, props, handlers }) => {
  const collapsedId = '__ungrouped__'
  const expanded = isExpanded(store.collapsed, collapsedId)
  const dropTarget = store.dropTarget
  const dropKind = dropTarget?.kind === 'ungrouped' ? 'ungrouped' : dropTarget?.kind === 'group-root-end' ? 'group-root-end' : null
  const isDrop = dropKind !== null
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
        onDrop: (event) => handlers.onDropUngrouped(event),
      },
      h('span', { class: 'dsg-group-caret' }, renderGlyph(h, expanded ? 'chevronDown' : 'chevronRight', 12)),
      h('span', { class: 'dsg-group-name' }, rt()?.t('ungrouped.title')),
      h('span', { class: 'dsg-ungrouped-count' }, node.length),
      isDrop
        ? h('div', {
            class: 'dsg-drop-indicator',
            'data-testid': 'session-groups-drop-indicator',
            'data-drop-kind': dropKind,
            'data-drop-target': 'ungrouped',
          })
        : null
    ),
    expanded
      ? h(
          'div',
          { class: 'dsg-group-body' },
          h(
            'div',
            {
              class: 'dsg-group-line',
              'data-empty': node.length === 0 ? 'true' : 'false',
              onDragOver: (event) => handlers.onDragOverUngrouped(event),
              onDrop: (event) => handlers.onDropUngrouped(event),
            },
            node.length === 0
              ? h('div', { class: 'dsg-group-empty', 'data-testid': 'session-groups-empty' }, rt()?.t('ungrouped.dropHint'))
              : node.map((child) => h(SessionRow, { key: child.session.id, sessionNode: child, depth: 0, groupId: null, ungrouped: true, props, handlers }))
          )
        )
      : null
  )
}

// ---------------------------------------------------------------------------
// Resize handle (groups view, wide only)
// ---------------------------------------------------------------------------
/**
 * Six-pixel separator pinned to the right edge of the sidebar column. Dragging
 * reports live clamped widths; commit persists. Pointer capture is best-effort
 * because synthetic pointer events may not be capturable.
 */
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
      if (clamped !== null) commitRef.current?.(clamped)
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
    const maxWidth = clampSidebarWidth(SIDEBAR_WIDTH_MAX, viewport) ?? max
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
// Search combobox (groups view header, second row)
// ---------------------------------------------------------------------------
/** Stable id so `aria-controls` points at the listbox while it is rendered. */
const SEARCH_LISTBOX_ID = 'dsg-session-search-listbox'

/**
 * Session search combobox (spec §3.3 / §4.4).
 *
 * Controlled input + listbox. The immutable index is memoized by the host data
 * (`doc`, `sessionsById`, `workspaces`, `archivedSessionIds`) so typing never
 * rebuilds it; filtering, active-row and open state stay local. Archived
 * entries render (disabled) but never select. Selecting a normal entry delegates
 * to `handlers.searchSelect` — opening, revealing, scrolling and highlighting
 * live in GroupsView because they need the tree ref and the live store.
 */
const SearchBox = ({ store, handlers, sessionsById, workspaces, archivedSessionIds }) => {
  const t = rt()?.t ?? ((key) => key)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const boxRef = useRef(null)

  const index = useMemo(
    () => buildSearchIndex({ doc: store?.doc, sessionsById, workspaces, archivedSessionIds }),
    [store?.doc, sessionsById, workspaces, archivedSessionIds]
  )
  const results = useMemo(() => matchSessions(index, query), [index, query])
  const visible = open && query.trim() !== ''

  // Click outside the combobox closes the dropdown (query is kept for editing).
  useEffect(() => {
    if (!visible) return undefined
    const doc = globalThis.document
    const onPointerDown = (event) => {
      if (boxRef.current?.contains?.(event?.target)) return
      setOpen(false)
    }
    doc?.addEventListener?.('pointerdown', onPointerDown, true)
    return () => doc?.removeEventListener?.('pointerdown', onPointerDown, true)
  }, [visible])

  // Escape closes even after focus has left the input.
  useEffect(() => {
    if (!visible) return undefined
    const doc = globalThis.document
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    doc?.addEventListener?.('keydown', onKeyDown, true)
    return () => doc?.removeEventListener?.('keydown', onKeyDown, true)
  }, [visible])

  /** Apply a new query: typing always re-evaluates and clears the active row. */
  const openFor = (value) => {
    const next = typeof value === 'string' ? value : ''
    setQuery(next)
    setActiveIndex(-1)
    setOpen(next.trim() !== '')
  }

  const select = (entry) => {
    if (!entry) return
    if (entry.archived === true) {
      handlers.searchArchived?.(entry)
      return
    }
    setQuery('')
    setActiveIndex(-1)
    setOpen(false)
    handlers.searchSelect?.(entry)
  }

  /** Localized display title; the index itself keeps Task 5's title contract. */
  const titleOf = (entry) => {
    const row = sessionsById?.[entry.sessionId]
    if (!row) return entry.title ?? ''
    return sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') })
  }

  const move = (delta) => {
    if (!visible) {
      if (query.trim() === '') return
      setOpen(true)
      if (results.length > 0) setActiveIndex(delta > 0 ? 0 : results.length - 1)
      return
    }
    if (results.length === 0) return
    setActiveIndex((current) => {
      if (current < 0) return delta > 0 ? 0 : results.length - 1
      return (current + delta + results.length) % results.length
    })
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
      return
    }
    if (event.key === 'Escape') {
      if (visible) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (event.key === 'Enter' && visible) {
      event.preventDefault()
      select(activeIndex >= 0 ? results[activeIndex] : undefined)
    }
  }

  return h(
    'div',
    { ref: boxRef, class: 'dsg-search', 'data-open': visible ? 'true' : 'false' },
    h('input', {
      class: 'dsg-search-input',
      type: 'text',
      role: 'combobox',
      'data-testid': 'session-groups-search',
      'aria-label': t('search.label'),
      'aria-expanded': visible ? 'true' : 'false',
      'aria-controls': SEARCH_LISTBOX_ID,
      'aria-autocomplete': 'list',
      'aria-activedescendant': visible && activeIndex >= 0 ? `${SEARCH_LISTBOX_ID}-${activeIndex}` : undefined,
      placeholder: t('search.placeholder'),
      autoComplete: 'off',
      spellCheck: false,
      value: query,
      onChange: (event) => openFor(event.target.value),
      onFocus: () => {
        if (query.trim() !== '') setOpen(true)
      },
      onKeyDown,
    }),
    visible
      ? h(
          'div',
          {
            id: SEARCH_LISTBOX_ID,
            class: 'dsg-search-results',
            role: 'listbox',
            'data-testid': 'session-groups-search-results',
            'aria-label': t('search.results'),
          },
          results.length === 0
            ? h('div', { class: 'dsg-search-empty', 'data-testid': 'session-groups-search-empty' }, t('search.empty'))
            : results.map((entry, position) => {
                const title = titleOf(entry)
                const meta = [entry.groupPath, entry.workspace].filter(Boolean).join(' · ')
                const archived = entry.archived === true
                return h(
                  'div',
                  {
                    key: entry.sessionId,
                    id: `${SEARCH_LISTBOX_ID}-${position}`,
                    class: 'dsg-search-result',
                    role: 'option',
                    'data-testid': 'session-groups-search-result',
                    'data-session-id': entry.sessionId,
                    'data-archived': archived ? 'true' : 'false',
                    'data-active': position === activeIndex ? 'true' : 'false',
                    'aria-selected': position === activeIndex ? 'true' : 'false',
                    'aria-disabled': archived ? 'true' : undefined,
                    'aria-label': archived ? `${title} (${t('session.archivedBadge')})` : title,
                    onMouseDown: (event) => event.preventDefault(),
                    onMouseEnter: () => setActiveIndex(position),
                    onClick: () => select(entry),
                  },
                  h('span', { class: 'dsg-search-result-title' }, title),
                  meta ? h('span', { class: 'dsg-search-result-meta' }, meta) : null,
                  archived ? h('span', { class: 'dsg-search-result-badge' }, t('session.archivedBadge')) : null
                )
              })
        )
      : null
  )
}

// ---------------------------------------------------------------------------
// Header / banner / toast / dialogs / menus / rail / footer / flat fallback
// ---------------------------------------------------------------------------
const Header = ({ store, handlers, sessionsById, workspaces, archivedSessionIds }) => {
  const t = rt()?.t
  const filter = store.archiveFilter
  return h(
    'div',
    { class: 'dsg-header dsg-header-stacked', 'data-testid': 'session-groups-header' },
    h(
      'div',
      { class: 'dsg-header-row', 'data-testid': 'session-groups-header-row' },
      h('span', { class: 'dsg-header-title', title: t('view.title') }, t('view.title')),
      h(
        'button',
        {
          type: 'button',
          class: 'dsg-text-button dsg-filter',
          'data-testid': 'session-groups-archive-filter',
          'data-filter': filter,
          title: `${t('archive.label')}：${t(ARCHIVE_FILTER_LABEL_KEYS[filter])}`,
          onClick: (event) => {
            event.stopPropagation()
            handlers.setArchiveFilter(nextArchiveFilter(filter))
          },
        },
        t(ARCHIVE_FILTER_LABEL_KEYS[filter])
      ),
      TextButton({ label: t('view.newGroup'), onClick: (event) => handlers.openNewGroup(event, null), testId: 'session-groups-new-group' }),
      TextButton({ label: t('view.returnWorkspace'), onClick: () => handlers.returnToWorkspace(), testId: 'session-groups-return' })
    ),
    h(
      'div',
      { class: 'dsg-header-row dsg-header-search-row' },
      h(SearchBox, { store, handlers, sessionsById, workspaces, archivedSessionIds })
    )
  )
}

const Banner = ({ store, handlers }) => {
  const banner = store.banner
  if (!banner) return null
  const t = rt()?.t
  const key = `banner.${banner.code}`
  const message = t(key)
  const retryable = banner.kind === 'error'
  return h(
    'div',
    { class: 'dsg-banner', 'data-testid': 'session-groups-banner', 'data-kind': banner.kind },
    h('span', { class: 'dsg-banner-text' }, message === key ? t('banner.loadFailed') : message),
    retryable ? TextButton({ label: t('banner.retry'), onClick: () => handlers.retryLoad(), testId: 'session-groups-banner-retry' }) : null,
    TextButton({ label: t('banner.dismiss'), onClick: () => dispatch('banner', { banner: null }), testId: 'session-groups-banner-dismiss' })
  )
}

const Toast = ({ store }) => {
  const toastState = store.toast
  if (!toastState) return null
  return h('div', { class: 'dsg-toast', 'data-testid': 'session-groups-toast' }, toastState.message ?? '')
}

const MenuPopover = ({ store, handlers }) => {
  const menu = store.menu
  if (!menu) return null
  const t = rt()?.t
  const item = (key, label, onClick, extra = {}) =>
    h('button', { key, type: 'button', class: 'dsg-menu-item', onClick: (event) => { event.stopPropagation(); handlers.closeMenu(); onClick() }, ...extra }, label)
  const children = []
  if (menu.kind === 'group') {
    const { previous, next } = siblingNeighbors(store.doc, menu.groupId)
    const moveItem = (key, label, testid, disabled, delta) =>
      item(key, label, () => handlers.moveGroupStep(menu.groupId, delta), {
        'data-testid': testid,
        'data-group-id': menu.groupId,
        'data-disabled': disabled ? 'true' : 'false',
        ...(disabled ? { disabled: true } : {}),
      })
    children.push(item('new-subgroup', t('group.newSubgroup'), () => handlers.openNewGroup(null, menu.groupId)))
    children.push(item('rename', t('group.rename'), () => handlers.openRenameGroup(menu.groupId)))
    children.push(item('icon', t('group.icon'), () => handlers.openIconGroup(menu.groupId)))
    children.push(item('move', t('group.moveTo'), () => handlers.openMoveGroup(menu.groupId)))
    children.push(moveItem('move-up', t('group.moveUp'), 'session-groups-group-move-up', previous === null, -1))
    children.push(moveItem('move-down', t('group.moveDown'), 'session-groups-group-move-down', next === null, 1))
    children.push(h('div', { key: 'sep', class: 'dsg-menu-separator' }))
    children.push(item('delete', t('group.delete'), () => handlers.openDeleteGroup(menu.groupId)))
  } else if (menu.kind === 'session') {
    children.push(item('rename', t('session.rename'), () => handlers.openRenameSession(menu.sessionId, menu.title)))
    children.push(
      menu.archived
        ? item('unarchive', t('session.unarchive'), () => handlers.unarchiveSession(menu.sessionId))
        : item('archive', t('session.archive'), () => handlers.archiveSession(menu.sessionId))
    )
    children.push(item('move', t('session.moveTo'), () => handlers.openMoveSession(menu.sessionId)))
    if (rt()?.capabilities.pin === true) {
      children.push(item(menu.pinned ? 'unpin' : 'pin', menu.pinned ? t('session.unpin') : t('session.pin'), () => handlers.pinSession(menu.sessionId, !menu.pinned)))
    }
  }
  return h(
    'div',
    {
      class: 'dsg-menu',
      role: 'menu',
      'data-testid': 'session-groups-menu',
      style: { left: `${menu.x}px`, top: `${menu.y}px` },
      onClick: (event) => event.stopPropagation(),
    },
    ...children
  )
}

const GroupListPicker = ({ groups, excludeId, onPick, currentId }) => {
  const t = rt()?.t
  return h(
    'div',
    { class: 'dsg-menu', style: { position: 'static', boxShadow: 'none' } },
    h('button', { type: 'button', class: 'dsg-menu-item', onClick: () => onPick(null) }, t('ungrouped.title')),
    ...groups
      .filter((group) => group.id !== excludeId)
      .map((group) => h('button', { key: group.id, type: 'button', class: 'dsg-menu-item', onClick: () => onPick(group.id) }, group.name))
  )
}

const DialogHost = ({ store, props }) => {
  const dialog = store.dialog
  const t = rt()?.t
  const [value, setValue] = useState('')
  const inputRef = useRef(null)
  useEffect(() => {
    setValue(dialog?.value ?? '')
    if (dialog && (dialog.kind === 'new-group' || dialog.kind === 'rename-group' || dialog.kind === 'rename-session')) {
      const timer = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(timer)
    }
  }, [dialog])
  if (!dialog) return null
  const close = () => dispatch('dialog', { dialog: null })
  const confirm = (payload) => rt()?.confirmDialog(dialog, payload)
  const errorText = dialog.error ? t(dialog.error === 'name-required' ? 'dialog.namePlaceholder' : dialog.error) : null
  const title = t(dialog.titleKey)
  const bodyNodes = []
  if (dialog.kind === 'delete-group') bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.deleteBody', { n: dialog.sessionCount ?? 0 })))
  if (dialog.kind === 'archive-running') bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.archiveRunningBody', { families: formatActivity(dialog.activity) })))
  if (dialog.kind === 'new-session') {
    if (dialog.choices.length === 0) bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.noWorkspace')))
    else {
      bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.newSessionWorkspace')))
      bodyNodes.push(
        ...dialog.choices.map((workspace) =>
          h(
            'button',
            {
              key: workspace.workspaceId,
              type: 'button',
              class: 'dsg-menu-item',
              'data-testid': 'session-groups-dialog-workspace',
              'data-workspace-id': workspace.workspaceId,
              onClick: () => confirm({ workspaceId: workspace.workspaceId }),
            },
            `${workspaceLabel(workspace)}${workspace.workspaceId === dialog.inferred ? ' ★' : ''}`
          )
        )
      )
    }
  }
  if (dialog.kind === 'move-session' || dialog.kind === 'move-group') {
    bodyNodes.push(
      h(GroupListPicker, {
        groups: findGroupsFlat(store.doc),
        excludeId: dialog.kind === 'move-group' ? dialog.groupId : undefined,
        onPick: (groupId) => confirm({ groupId }),
      })
    )
  }
  if (dialog.kind === 'icon') {
    bodyNodes.push(
      h(
        'div',
        { class: 'dsg-menu', style: { position: 'static', boxShadow: 'none', flexDirection: 'row', flexWrap: 'wrap' } },
        ...dialog.icons.map((icon) =>
          h(
            'button',
            { key: icon, type: 'button', class: 'dsg-menu-item', title: icon, onClick: () => confirm({ icon }) },
            renderIcon(h, icon, 16),
            icon
          )
        )
      )
    )
  }
  const needsInput = dialog.kind === 'new-group' || dialog.kind === 'rename-group' || dialog.kind === 'rename-session'
  const canConfirm = !needsInput || value.trim().length > 0
  return h(
    'div',
    {
      class: 'dsg-dialog-backdrop',
      onClick: (event) => {
        if (event.target === event.currentTarget) close()
      },
    },
    h(
      'div',
      { class: 'dsg-dialog', role: 'dialog', 'aria-modal': 'true', 'data-testid': 'session-groups-dialog', 'data-kind': dialog.kind },
      h('div', { class: 'dsg-dialog-title' }, title),
      ...bodyNodes,
      needsInput
        ? h('input', {
            ref: inputRef,
            class: 'dsg-dialog-input',
            'data-testid': 'session-groups-dialog-input',
            value,
            maxlength: String(MAX_GROUP_NAME),
            placeholder: t('dialog.namePlaceholder'),
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && canConfirm) confirm({ value: value.trim() })
              if (event.key === 'Escape') close()
            },
          })
        : null,
      errorText ? h('div', { class: 'dsg-dialog-error' }, errorText) : null,
      h(
        'div',
        { class: 'dsg-dialog-actions' },
        h('button', { type: 'button', class: 'dsg-dialog-cancel', onClick: close }, t('dialog.cancel')),
        needsInput || dialog.kind === 'delete-group' || dialog.kind === 'archive-running'
          ? h(
              'button',
              {
                type: 'button',
                class: 'dsg-dialog-confirm',
                'data-testid': 'session-groups-dialog-confirm',
                'data-variant': dialog.kind === 'delete-group' || dialog.kind === 'archive-running' ? 'danger' : 'primary',
                disabled: !canConfirm,
                onClick: () => confirm(needsInput ? { value: value.trim() } : {}),
              },
              dialog.kind === 'archive-running' ? t('dialog.stopAndArchive') : t('dialog.confirm')
            )
          : null
      )
    )
  )
}

const findGroupsFlat = (doc) => {
  const out = []
  const walk = (parentId, depth) => {
    for (const group of doc.groups.filter((item) => item.parentId === parentId)) {
      out.push({ ...group, depth })
      walk(group.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

const Rail = ({ props }) => {
  const t = rt()?.t
  const expandSidebar = typeof props?.expandSidebar === 'function' ? props.expandSidebar : () => {}
  return h(
    'div',
    { class: 'dsg-rail', 'data-testid': 'session-groups-rail' },
    h(
      'button',
      {
        type: 'button',
        class: 'dsg-rail-button',
        title: t('rail.expand'),
        'aria-label': t('rail.expand'),
        'data-testid': 'session-groups-rail-expand',
        onClick: () => expandSidebar(),
      },
      renderGlyph(h, 'folderAdjust', 18)
    ),
    h('span', { class: 'dsg-rail-label' }, t('rail.groups'))
  )
}

/** Footer action: always registered; renders its own label/icon per slot contract. */
export const FooterAction = (props) => {
  const store = useViewStore()
  const wide = props?.wide !== false
  const mode = store?.viewMode ?? 'workspace'
  const t = rt()?.t
  const label = mode === 'groups' ? t('footer.toWorkspace') : t('footer.toGroups')
  return h(
    'button',
    {
      type: 'button',
      'data-testid': 'session-groups-toggle',
      'data-mode': mode,
      title: label,
      'aria-label': label,
      'aria-pressed': mode === 'groups' ? 'true' : 'false',
      class: 'dsg-footer-toggle',
      onClick: () => rt()?.toggleMode(),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        height: '28px',
        width: wide ? '100%' : '28px',
        padding: wide ? '0 8px' : '0',
        margin: '0 auto',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        border: '1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.35))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #57606a)',
        fontSize: '11px',
        cursor: 'pointer',
        boxSizing: 'border-box',
      },
    },
    renderGlyph(h, 'folderAdjust', 14),
    wide ? h('span', null, label) : null
  )
}

// ---------------------------------------------------------------------------
// Flat fallback / error boundary
// ---------------------------------------------------------------------------
const FlatFallback = ({ props, store, reason }) => {
  const t = rt()?.t
  const sessions = typeof props?.useSessions === 'function' ? props.useSessions((snapshot) => snapshot) : null
  const workspaces = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces((snapshot) => snapshot) : null
  const workspaceItems = workspaces?.items ?? []
  const archived = workspaces?.archivedSessionIds ?? []
  const byId = sessions?.byId ?? {}
  const ids = (sessions?.ids ?? []).filter((id) => byId[id] && byId[id].origin !== 'subagent')
  const rows = ids.map((id) => byId[id])
  return h(
    'div',
    { class: 'dsg-root', 'data-testid': 'session-groups-flat-fallback', 'data-reason': reason ?? 'error' },
    h('div', { class: 'dsg-header', 'data-testid': 'session-groups-error' }, h('span', { class: 'dsg-header-title' }, t('error.title'))),
    h('div', { class: 'dsg-banner', 'data-kind': 'error' }, h('span', { class: 'dsg-banner-text' }, reason === 'route-unavailable' ? t('banner.routeUnavailable') : t('error.body'))),
    h(
      'div',
      { class: 'dsg-flat' },
      ...rows.map((row) =>
        h(
          'div',
          {
            key: row.id,
            class: 'dsg-session-row',
            'data-testid': 'session-groups-session',
            'data-session-id': row.id,
            'data-archived': isArchived(archived, row.id) ? 'true' : 'false',
            onClick: () => !isArchived(archived, row.id) && rt()?.actions.openSession(row.id),
          },
          h(StatusDot, { status: null }),
          h('span', { class: 'dsg-session-title' }, sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') })),
          h('span', { class: 'dsg-workspace-badge', style: { opacity: 1 } }, (() => {
            const workspace = workspaceItems.find((item) => (item.sessionIds ?? []).includes(row.id))
            return workspace ? workspaceLabel(workspace) : t('session.noWorkspace')
          })())
        )
      ),
      rows.length === 0 ? h('div', { class: 'dsg-empty', 'data-testid': 'session-groups-empty' }, t('empty.none')) : null
    ),
    h(
      'div',
      { class: 'dsg-header' },
      TextButton({ label: t('banner.retry'), onClick: () => rt()?.retryLoad(), testId: 'session-groups-flat-retry' }),
      TextButton({ label: t('view.returnWorkspace'), onClick: () => rt()?.setMode('workspace'), testId: 'session-groups-return' })
    )
  )
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error) {
    globalThis.console?.error?.('[dsh-session-groups] render error', error)
  }
  render() {
    if (this.state.error) return this.props.fallback(this.state.error)
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Groups view (Sidebar occupant)
// ---------------------------------------------------------------------------
export const GroupsView = (props) => {
  const store = useViewStore()
  const wide = props?.wide !== false

  // Framework standard hooks: always called (rules of hooks), feature-detected.
  const sessions = typeof props?.useSessions === 'function' ? props.useSessions((snapshot) => snapshot) : null
  const workspaces = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces((snapshot) => snapshot) : null
  const statuses = typeof props?.useSessionStatus === 'function' ? props.useSessionStatus((snapshot) => snapshot) : null
  const panelInfo = typeof props?.usePanelInfo === 'function' ? props.usePanelInfo((snapshot) => snapshot) : null

  const byId = sessions?.byId ?? {}
  const workspaceItems = workspaces?.items ?? []
  const archivedSessionIds = Array.isArray(workspaces?.archivedSessionIds) ? workspaces.archivedSessionIds : []
  const currentId = currentSessionIdOf(sessions)
  const panelActive = panelInfo?.activePanelId !== null && panelInfo?.activePanelId !== undefined
  const highlightCurrent = panelActive ? null : currentId

  const [dragState, setDragState] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  // Search highlight is a transient DOM class (1.5 s) on the revealed row: the
  // rows are plain React nodes and the class must survive the host-triggered
  // re-render right after openSession without adding new view-store state.
  const searchHitTimerRef = useRef(null)
  const searchHitRowRef = useRef(null)
  const autoExpandRef = useRef({ groupId: null, timer: null })
  const dragRef = useRef(null)
  const suppressedClickRef = useRef(null)
  dragRef.current = dragState

  // Sidebar width override state. `preferredWidth` is the persisted preference;
  // the applied width is always its viewport clamp, so a narrow viewport never
  // destroys the stored preference.
  const rootRef = useRef(null)
  const widthControllerRef = useRef(null)
  const preferredWidthRef = useRef(0)
  const [preferredWidth, setPreferredWidth] = useState(() => readSidebarWidth())
  const [viewportWidth, setViewportWidth] = useState(() => globalThis.innerWidth || 1440)
  const [widthSupported, setWidthSupported] = useState(false)
  preferredWidthRef.current = preferredWidth
  const appliedWidth = clampSidebarWidth(preferredWidth, viewportWidth)
  const maxAppliedWidth = clampSidebarWidth(SIDEBAR_WIDTH_MAX, viewportWidth) ?? SIDEBAR_WIDTH_MIN

  useEffect(() => {
    if (!wide) {
      widthControllerRef.current?.clear()
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
        const controller = applyWidthOverride(nodes, clamped, viewport, { onLost })
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
      clearController()
      setWidthSupported(false)
    }
  }, [wide, store?.docState])

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
    const next = clampSidebarWidth(SIDEBAR_WIDTH_DEFAULT, viewport)
    if (next === null) return
    preferredWidthRef.current = next
    setPreferredWidth(next)
    widthControllerRef.current?.update(next, viewport)
    writeSidebarWidth(next)
  }

  const t = rt()?.t ?? ((key) => key)

  // Auto-expand ancestors of the current session when the view opens.
  useEffect(() => {
    if (!store || store.docState !== 'ready' || !currentId) return
    const entry = findGroup(store.doc, currentGroupIdOf(store.doc, currentId))
    if (!entry) return
    const ancestors = expandAncestors(store.collapsed, store.doc, entry.id)
    if (ancestors !== store.collapsed) store.update({ collapsed: ancestors })
  }, [currentId, store?.docState, store?.doc])

  // Drop the 1.5 s search highlight timer if the view unmounts mid-highlight.
  useEffect(
    () => () => {
      if (searchHitTimerRef.current !== null) {
        clearTimeout(searchHitTimerRef.current)
        searchHitTimerRef.current = null
      }
      searchHitRowRef.current?.classList?.remove?.('dsg-search-hit')
      searchHitRowRef.current = null
    },
    []
  )

  if (!wide) return h(Rail, { props })

  if (store === null) return h('div', { class: 'dsg-root', 'data-testid': 'session-groups-view' }, t('flat.title'))

  // Flat fallback for load/route/commit failures (CONTRACTS §6).
  if (store.docState === 'error') return h(FlatFallback, { props, store, reason: store.banner?.code === 'route-unavailable' ? 'route-unavailable' : 'error' })

  const tree = buildVisibleTree(store.doc, byId, workspaceItems, {
    archivedSessionIds,
    filter: store.archiveFilter,
    currentSessionId: highlightCurrent,
    statuses: statuses instanceof Map ? statuses : null,
  })
  const ungroupedCount = tree.ungrouped.length
  // Row components read current/drop state; merge it into the snapshot handed down.
  const viewState = {
    ...store,
    currentSessionId: highlightCurrent,
    dropTarget,
    draggedGroupId: dragState?.kind === 'group' ? dragState.groupId : null,
  }

  const commitDrop = async (source, target) => {
    setDropTarget(null)
    setDragState(null)
    if (!source || !target || target.kind === 'invalid') return
    const visibleUngrouped = tree.ungrouped.map((node) => node.session.id)
    try {
      // Resolve against the latest confirmed doc inside the commit queue; the
      // rendered doc can lag one or more in-flight drops.
      await rt()?.commitDoc((currentDoc) => applyDrop(currentDoc, source, target, visibleUngrouped).doc)
    } catch (error) {
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] drop failed', error)
    }
  }

  /**
   * Commit a group drag. The gesture stores only the stable target descriptor;
   * the numeric parent/index is resolved inside the queued updater against the
   * latest confirmed doc (B5). A same-parent/current-position drop throws the
   * no-op sentinel before the queue sends any request, so no revision is bumped.
   */
  const commitGroupDrop = async (draggedId, target) => {
    setDropTarget(null)
    setDragState(null)
    dragRef.current = null
    rt()?.setFloatingLabel?.(null)
    try {
      await rt()?.commitDoc((latest) => {
        const resolved = resolveGroupDrop({ doc: latest, draggedId, target })
        if (resolved.invalid) {
          const error = new Error(resolved.reason)
          error.groupDropInvalid = true
          throw error
        }
        if (isCurrentGroupPosition(latest, draggedId, resolved, target)) throw GROUP_DROP_NOOP
        return moveGroup(latest, draggedId, resolved.parentId, resolved.index)
      })
    } catch (error) {
      if (error === GROUP_DROP_NOOP) return
      if (error?.groupDropInvalid) {
        toast('error', t('drag.groupInvalid'))
        return
      }
      if (error?.message === 'depth-exceeded') {
        toast('error', t('drag.depthExceeded'))
        return
      }
      if (error?.message === 'cycle') {
        toast('error', t('drag.groupInvalid'))
        return
      }
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] group drop failed', error)
    }
  }

  /** Menu move-up/move-down: one sibling step inside the latest confirmed doc. */
  const moveGroupStep = (groupId, delta) => {
    const task = rt()?.commitDoc((latest) => {
      const group = findGroup(latest, groupId)
      if (!group) throw GROUP_DROP_NOOP
      const siblings = childrenOf(latest, group.parentId)
      const currentIndex = siblings.findIndex((item) => item.id === groupId)
      const nextIndex = currentIndex + delta
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= siblings.length) throw GROUP_DROP_NOOP
      return moveGroup(latest, groupId, group.parentId, nextIndex)
    })
    task?.catch((error) => {
      if (error === GROUP_DROP_NOOP) return
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] group move failed', error)
    })
  }

  const clearAutoExpand = () => {
    const current = autoExpandRef.current
    if (current.timer !== null) clearTimeout(current.timer)
    autoExpandRef.current = { groupId: null, timer: null }
  }

  const scheduleAutoExpand = (groupId) => {
    const collapsedNow = !isExpanded(store.collapsed, groupId)
    if (!collapsedNow) return clearAutoExpand()
    const current = autoExpandRef.current
    if (current.groupId === groupId && current.timer !== null) return
    clearAutoExpand()
    const timer = setTimeout(() => {
      dispatch('expand-group', { id: groupId })
      autoExpandRef.current = { groupId: null, timer: null }
    }, 500)
    autoExpandRef.current = { groupId, timer }
  }

  const rowDragOver = (event, target) => {
    const drag = dragRef.current
    if (!drag) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setDropTarget(target)
  }

  const groupOwnedIds = (groupId) => {
    const group = findGroup(store.doc, groupId)
    return group ? group.sessionIds : []
  }

  const groupDragId = () => (dragRef.current?.kind === 'group' ? dragRef.current.groupId : null)

  /** Translate the view drop-target vocabulary to the resolver target shape. */
  const resolveTargetFor = (viewTarget) => {
    switch (viewTarget?.kind) {
      case 'group-before':
        return { kind: 'before', targetId: viewTarget.targetId }
      case 'group-after':
        return { kind: 'after', targetId: viewTarget.targetId }
      case 'group-child':
        return { kind: 'child', parentId: viewTarget.parentId, beforeGroupId: viewTarget.beforeGroupId ?? null }
      case 'group-root-end':
        return { kind: 'root-end' }
      default:
        return null
    }
  }

  /**
   * Live indicator for a group drop. Invalid targets (self/descendant, missing
   * anchors) render the forbidden state and never accept the drop.
   */
  const previewGroupDrop = (event, viewTarget, label) => {
    const draggedId = groupDragId()
    if (!draggedId) return
    const resolved = resolveGroupDrop({ doc: store.doc, draggedId, target: resolveTargetFor(viewTarget) })
    if (resolved.invalid) {
      setDropTarget({ ...viewTarget, kind: 'group-forbidden' })
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
      rt()?.setFloatingLabel?.(t('drag.groupInvalid'))
      return
    }
    rowDragOver(event, viewTarget)
    rt()?.setFloatingLabel?.(label)
  }

  /** Top/bottom edge zone of a group header; the middle 50% is invalid. */
  const groupHeaderZone = (row, clientY) => {
    const rect = row?.getBoundingClientRect?.()
    if (!rect || !(rect.height > 0)) return null
    const ratio = (clientY - rect.top) / rect.height
    if (ratio < 0.25) return 'before'
    if (ratio > 0.75) return 'after'
    return null
  }

  /** Consume the click synthesized right after a dragstart (400 ms guard). */
  const consumeDragClick = (groupId) => {
    const marker = suppressedClickRef.current
    if (!marker) return false
    suppressedClickRef.current = null
    return marker.groupId === groupId && Date.now() - marker.at <= 400
  }

  /** Drop the current search highlight class/timer (safe to call repeatedly). */
  const clearSearchHit = () => {
    if (searchHitTimerRef.current !== null) {
      clearTimeout(searchHitTimerRef.current)
      searchHitTimerRef.current = null
    }
    searchHitRowRef.current?.classList?.remove?.('dsg-search-hit')
    searchHitRowRef.current = null
  }

  /**
   * Highlight + scroll the revealed row (spec §4.4). The row may not exist on
   * the first frame after the collapsed update, so retry for up to two frames;
   * add `dsg-search-hit` for 1.5 s; scroll with
   * `scrollTop + (row.top - tree.top) - 0.3 * tree.clientHeight`, clamped to the
   * scrollable range. A row that never appears (orphan / filtered out) is a
   * no-op: no scroll, no highlight, no throw.
   */
  const revealSearchRow = (sessionId) => {
    const root = rootRef.current
    let attempts = 0
    const tick = () => {
      const tree = root?.querySelector?.('.dsg-tree')
      const row = tree
        ? Array.from(tree.querySelectorAll('[data-session-id]')).find((element) => element.getAttribute('data-session-id') === sessionId)
        : null
      if (!tree || !row) {
        attempts += 1
        if (attempts <= 2) requestAnimationFrame(tick)
        return
      }
      clearSearchHit()
      row.classList.add('dsg-search-hit')
      searchHitRowRef.current = row
      searchHitTimerRef.current = setTimeout(() => {
        searchHitTimerRef.current = null
        row.classList.remove('dsg-search-hit')
        if (searchHitRowRef.current === row) searchHitRowRef.current = null
      }, 1500)
      const rowRect = row.getBoundingClientRect()
      const treeRect = tree.getBoundingClientRect()
      const maxScroll = Math.max(0, tree.scrollHeight - tree.clientHeight)
      const next = Math.min(Math.max(0, tree.scrollTop + (rowRect.top - treeRect.top) - tree.clientHeight * 0.3), maxScroll)
      tree.scrollTop = next
    }
    requestAnimationFrame(tick)
  }

  /**
   * Search result selection (spec §3.3 / §4.4): archived entries only toast;
   * normal entries switch `only` -> `all` when needed, open the session, reveal
   * its containing group/ancestors in one store update, then highlight + scroll.
   */
  const selectSearchResult = (entry) => {
    if (!entry || typeof entry.sessionId !== 'string') return
    if (entry.archived === true) {
      toast('info', t('search.archivedDisabled'))
      return
    }
    // Read the live snapshot: the rendered `store` prop can lag a queued commit.
    const live = rt()?.store?.getSnapshot?.() ?? store
    if (live?.archiveFilter === 'only') dispatch('archive-filter', { filter: 'all' })
    rt()?.actions.openSession(entry.sessionId)
    const collapsed = revealSession(live?.doc, live?.collapsed ?? {}, entry.sessionId)
    if (collapsed !== live?.collapsed) rt()?.store?.update({ collapsed })
    revealSearchRow(entry.sessionId)
  }

  const handlers = {
    toggleGroup: (id) => dispatch('toggle-group', { id }),
    onGroupClick: (id) => {
      if (consumeDragClick(id)) return
      dispatch('toggle-group', { id })
    },
    moveGroupStep,
    returnToWorkspace: () => rt()?.setMode('workspace'),
    retryLoad: () => rt()?.retryLoad(),
    openSession: (id) => rt()?.actions.openSession(id),
    setArchiveFilter: (filter) => dispatch('archive-filter', { filter }),
    searchSelect: (entry) => selectSearchResult(entry),
    searchArchived: () => toast('info', t('search.archivedDisabled')),
    openNewGroup: (event, parentId) => rt()?.openDialog({ kind: 'new-group', parentId, titleKey: parentId ? 'dialog.newSubgroup' : 'dialog.newGroup' }),
    openRenameGroup: (groupId) => rt()?.openDialog({ kind: 'rename-group', groupId, titleKey: 'dialog.renameGroup', value: findGroup(store.doc, groupId)?.name ?? '' }),
    openIconGroup: (groupId) => rt()?.openDialog({ kind: 'icon', groupId, titleKey: 'group.icon', icons: ['folder', 'folder-open', 'star', 'flag', 'bookmark', 'tag', 'bulb', 'rocket'] }),
    openMoveGroup: (groupId) => rt()?.openDialog({ kind: 'move-group', groupId, titleKey: 'dialog.moveTo' }),
    openDeleteGroup: (groupId) => {
      const group = findGroup(store.doc, groupId)
      const sessionCount = group ? group.sessionIds.length : 0
      rt()?.openDialog({ kind: 'delete-group', groupId, titleKey: 'dialog.deleteGroup', sessionCount })
    },
    openSessionMenu: (event, sessionNode) => {
      const row = sessionNode.session
      dispatch('menu', {
        menu: {
          kind: 'session',
          x: Math.min(event.clientX, globalThis.innerWidth - 200),
          y: Math.min(event.clientY, globalThis.innerHeight - 200),
          sessionId: row.id,
          title: sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }),
          archived: sessionNode.archived === true,
          pinned: false,
        },
      })
    },
    openGroupMenu: (event, group) => {
      dispatch('menu', {
        menu: {
          kind: 'group',
          x: Math.min(event.clientX, globalThis.innerWidth - 200),
          y: Math.min(event.clientY, globalThis.innerHeight - 200),
          groupId: group.id,
        },
      })
    },
    openNewSession: (event, groupId) => {
      const choices = workspaceChoices(store.doc, groupId, byId, workspaceItems, currentId)
      if (choices.choices.length === 0) {
        rt()?.showToast('error', t('dialog.noWorkspace'))
        return
      }
      rt()?.openDialog({ kind: 'new-session', groupId, titleKey: 'dialog.newSession', choices: choices.choices, inferred: choices.inferred })
    },
    openRenameSession: (sessionId, title) => rt()?.openDialog({ kind: 'rename-session', sessionId, titleKey: 'dialog.renameSession', value: title ?? '' }),
    openMoveSession: (sessionId) => rt()?.openDialog({ kind: 'move-session', sessionId, titleKey: 'dialog.moveTo' }),
    archiveSession: (sessionId) => rt()?.archiveSession(sessionId),
    unarchiveSession: (sessionId) => rt()?.unarchiveSession(sessionId),
    pinSession: (sessionId, pinned) => rt()?.pinSession(sessionId, pinned),
    closeMenu: () => dispatch('menu', { menu: null }),
    onDragStart: (sessionId) => {
      const row = byId[sessionId]
      dragRef.current = {
        kind: 'session',
        sessionId,
        label: sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }),
      }
      suppressedClickRef.current = null
      setDragState(dragRef.current)
      rt()?.startDragLabel?.(dragRef.current.label)
    },
    onGroupDragStart: (event, group) => {
      const origin = event.target
      if (origin && typeof origin.closest === 'function' && origin.closest('button')) {
        event.preventDefault()
        return
      }
      if (event.dataTransfer) {
        event.dataTransfer.setData(GROUP_DRAG_MIME, group.id)
        event.dataTransfer.setData('text/plain', group.name)
        event.dataTransfer.effectAllowed = 'move'
      }
      const drag = { kind: 'group', groupId: group.id, label: group.name }
      dragRef.current = drag
      suppressedClickRef.current = { groupId: group.id, at: Date.now() }
      setDragState(drag)
      setDropTarget(null)
      rt()?.startDragLabel?.(group.name)
    },
    onDragEnd: () => {
      clearAutoExpand()
      dragRef.current = null
      setDragState(null)
      setDropTarget(null)
      rt()?.setFloatingLabel?.(null)
    },
    onDragOverSession: (event, sessionId, groupId, ungrouped) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      const rect = event.currentTarget.getBoundingClientRect()
      const target = hitTest({
        source: drag,
        rowKind: 'session',
        pointerY: event.clientY,
        rowTop: rect.top,
        rowHeight: rect.height,
        targetGroupId: ungrouped ? null : groupId,
        targetSessionId: sessionId,
      })
      if (target.kind === 'invalid') {
        setDropTarget(null)
        return
      }
      rowDragOver(event, target)
      const label = groupId ? `放入『${findGroup(store.doc, groupId)?.name ?? ''}』` : '移出分组'
      rt()?.setFloatingLabel?.(label)
    },
    onDropSession: (event, sessionId, groupId, ungrouped) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      // Resolve from this drop event instead of the react state mirror: a
      // dragover and drop can arrive in one tick (synthetic E2E / fast pointer),
      // and the state may not have committed yet.
      const rect = event.currentTarget.getBoundingClientRect()
      const target = hitTest({
        source: drag,
        rowKind: 'session',
        pointerY: event.clientY,
        rowTop: rect.top,
        rowHeight: rect.height,
        targetGroupId: ungrouped ? null : groupId,
        targetSessionId: sessionId,
      })
      if (!target || target.kind === 'invalid') return commitDrop(drag, { kind: 'invalid' })
      return commitDrop(drag, target)
    },
    onDragOverGroup: (event, groupId) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.kind === 'group') {
        const name = findGroup(store.doc, groupId)?.name ?? ''
        const zone = groupHeaderZone(event.currentTarget, event.clientY)
        if (zone === null) {
          setDropTarget({ kind: 'group-forbidden', targetId: groupId })
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
          rt()?.setFloatingLabel?.(t('drag.groupInvalid'))
          return
        }
        previewGroupDrop(event, { kind: `group-${zone}`, targetId: groupId }, t(zone === 'before' ? 'drag.groupBefore' : 'drag.groupAfter', { name }))
        return
      }
      rowDragOver(event, { kind: 'group-append', groupId })
      scheduleAutoExpand(groupId)
      rt()?.setFloatingLabel?.(`放入『${findGroup(store.doc, groupId)?.name ?? ''}』`)
    },
    onDropGroup: (event, groupId) => {
      const drag = dragRef.current
      if (drag?.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        clearAutoExpand()
        setDropTarget(null)
        rt()?.setFloatingLabel?.(null)
        const zone = groupHeaderZone(event.currentTarget, event.clientY)
        if (zone === null) {
          toast('error', t('drag.groupInvalid'))
          return
        }
        commitGroupDrop(drag.groupId, { kind: zone, targetId: groupId })
        return
      }
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      commitDrop(drag, { kind: 'group-append', groupId })
    },
    onDragOverGroupHead: (event, groupId) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      rowDragOver(event, { kind: 'group-head', groupId })
      scheduleAutoExpand(groupId)
    },
    onDropGroupHead: (event, groupId) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      commitDrop(drag, { kind: 'group-head', groupId })
    },
    onDragOverGroupSlot: (event, parentId, beforeGroupId) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'group') return
      const name = findGroup(store.doc, parentId)?.name ?? ''
      previewGroupDrop(event, { kind: 'group-child', parentId, beforeGroupId }, t('drag.groupInto', { name }))
    },
    onDropGroupSlot: (event, parentId, beforeGroupId) => {
      const drag = dragRef.current
      // A session dragged across the slot keeps its existing group-head drop
      // behaviour (event bubbles to the body line); only group drags land here.
      if (!drag || drag.kind !== 'group') return
      event.preventDefault()
      event.stopPropagation()
      commitGroupDrop(drag.groupId, { kind: 'child', parentId, beforeGroupId })
    },
    onDragOverUngrouped: (event) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.kind === 'group') {
        previewGroupDrop(event, { kind: 'group-root-end' }, t('drag.groupRootEnd'))
        return
      }
      rowDragOver(event, { kind: 'ungrouped' })
      rt()?.setFloatingLabel?.('移出分组')
    },
    onDropUngrouped: (event) => {
      const drag = dragRef.current
      if (drag?.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        rt()?.setFloatingLabel?.(null)
        commitGroupDrop(drag.groupId, { kind: 'root-end' })
        return
      }
      event.preventDefault()
      event.stopPropagation()
      rt()?.setFloatingLabel?.(null)
      commitDrop(drag, { kind: 'ungrouped' })
    },
  }

  return h(
    'div',
    { ref: rootRef, class: 'dsg-root', 'data-testid': 'session-groups-view', 'data-mode': store.viewMode, 'data-wide': 'true' },
    h(Header, { store: viewState, handlers, sessionsById: byId, workspaces: workspaceItems, archivedSessionIds }),
    wide && widthSupported && appliedWidth !== null
      ? h(ResizeHandle, {
          width: appliedWidth,
          min: SIDEBAR_WIDTH_MIN,
          max: maxAppliedWidth,
          onChange: handleWidthChange,
          onCommit: handleWidthCommit,
          onReset: handleWidthReset,
        })
      : null,
    h(Banner, { store, handlers }),
    store.docState === 'loading'
      ? h('div', { class: 'dsg-empty' }, t('flat.title'))
      : h(
          'div',
          { class: 'dsg-tree', role: 'tree', 'aria-label': t('view.title') },
          h(UngroupedSection, { node: tree.ungrouped, store: viewState, props, handlers }),
          ...tree.groups.map((node) => h(GroupNode, { key: node.group.id, node, depth: 0, props, handlers, store: viewState }))
        ),
    h(Toast, { store }),
    h(MenuPopover, { store, handlers }),
    h(DialogHost, { store, props })
  )
}

/** Export the error boundary wrapped occupant used by the slot registration. */
export const GroupsViewBoundary = (props) =>
  h(
    ErrorBoundary,
    {
      fallback: (error) =>
        h(FlatFallback, {
          props,
          store: rt()?.store?.getSnapshot() ?? null,
          reason: 'render-error',
        }),
    },
    h(GroupsView, props)
  )

const currentGroupIdOf = (doc, sessionId) => {
  for (const group of doc.groups) if (group.sessionIds.includes(sessionId)) return group.id
  return null
}

// Keep the module-level runtime reachable for plugin.js helpers.
export const __internal = { findGroupsFlat, currentGroupIdOf }
