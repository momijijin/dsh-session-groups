/**
 * React components for the groups sidebar (plain `createElement`, no JSX).
 *
 * Components are registered into DSH slots and receive the framework standard
 * toolkit as props (`useSessions`, `useWorkspaces`, `useSessionStatus`,
 * `usePanelInfo`, `…`) plus the slot owner share. Everything host-derived is read
 * from those hooks; the only local state is this plugin's view store.
 */
import { Component, createElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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
} from './dialog-selection.js'
import { createActions, formatActivity, workspaceChoices, workspaceLabel } from './actions.js'
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
} from './filter.js'
import { applyDrop, hitTest, sameDropTarget, stickyDropTarget, ungroupedBodyTarget } from './drag.js'
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
import { GROUP_DRAG_MIME, resolveGroupDrop } from './group-drag.js'
import { ICON_GROUPS, renderGlyph, renderHeaderIcon, renderIcon } from './icons.js'
import { clampMenuPosition, isMenuKey, menuAnchorFromEvent, menuAnchorFromRow } from './menu-position.js'
import {
  perfDragOver,
  perfDropTarget,
  perfEnabled,
  perfMark,
  perfNow,
  perfRender,
  perfSample,
} from './perf.js'
import { buildSearchIndex, matchSessions, revealSession } from './search.js'
import {
  applyManagedWidth,
  clampSidebarWidth,
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
} from './virtual-list.js'
import {
  displayDepth,
  expandAncestors,
  flattenTree,
  groupPath,
  isExpanded,
  runningSubagentCounts,
  statusSectionsByGroup,
  sessionStatuses,
  siblingNeighbors,
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

/**
 * Record one GroupsView commit + the next animation frame. Used by the opt-in
 * perf probe to separate React commit cost from frame pacing; disabled probes
 * only pay a cached boolean check per render.
 */
const usePerfCommit = (name, renderStartedAt) => {
  useEffect(() => {
    if (!perfEnabled()) return undefined
    perfMark(`commit:${name}`, Math.round((perfNow() - renderStartedAt) * 100) / 100)
    if (typeof globalThis.requestAnimationFrame !== 'function') return undefined
    const frame = globalThis.requestAnimationFrame(() => perfMark(`frame:${name}`))
    return () => globalThis.cancelAnimationFrame?.(frame)
  })
}

/**
 * Dialog scroll region with a persistent 5px custom thumb. Native scrollbars
 * are hidden; the thumb is above the list in the stacking order and can be
 * dragged to scroll.
 */
const ScrollArea = ({ className, children, ...rest }) => {
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
const IconButton = ({ label, glyph, icon, onClick, testId, data, expanded, haspopup, className }) =>
  h(
    'button',
    {
      type: 'button',
      class: classNames('dsg-icon-button', className),
      title: label,
      'aria-label': label,
      'data-testid': testId,
      ...(expanded === undefined ? {} : { 'aria-expanded': expanded ? 'true' : 'false' }),
      ...(haspopup ? { 'aria-haspopup': haspopup } : {}),
      onClick: (event) => {
        event.stopPropagation()
        onClick?.(event)
      },
      ...(data ?? {}),
    },
    // 0.2.5: header actions use the exact DSH workspace icon artwork; every
    // other IconButton keeps the small stroke glyph vocabulary.
    icon ? renderHeaderIcon(h, icon, 16) : renderGlyph(h, glyph)
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

/** Official 14px ongoing spinner: two r=9.5 circles, rotating group + dash arc. */
const StatusSpinner = () =>
  h(
    'svg',
    {
      class: 'dsg-status-spinner',
      width: '14',
      height: '14',
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    h(
      'g',
      { class: 'dsg-status-spinner-motion' },
      h('circle', { class: 'dsg-status-spinner-track', cx: '12', cy: '12', r: '9.5' }),
      h('circle', { class: 'dsg-status-spinner-arc', cx: '12', cy: '12', r: '9.5' })
    )
  )

/** Official 10px solid status dot (6px painted core via inset 20%). */
const StatusDot = ({ state }) => h('span', { class: 'dsg-status-dot', 'data-state': state, 'aria-hidden': 'true' })

/** One translated status label for the visually-hidden accessibility text. */
const statusText = (status) => {
  const t = rt()?.t ?? ((key) => key)
  return t(status.labelKey, status.params)
}

/**
 * The leading 16x20 status cell shared by session rows. Idle renders an empty
 * slot (never a transparent dot); archived/blank rows pass `hidden` and keep
 * the same empty slot. Every visible status contributes a visually-hidden
 * label, including the coexisting subagentsRunning status.
 */
const SessionStatusCell = ({ statuses, hidden = false, testId = 'session-groups-session-status' }) => {
  const list = hidden || !Array.isArray(statuses) ? [] : statuses
  const primary = list[0] ?? null
  const show = primary !== null && primary.state !== 'idle'
  return h(
    'span',
    {
      class: 'dsg-session-status',
      'data-testid': testId,
      'data-state': show ? primary.state : 'idle',
      'data-status-kind': show ? primary.kind : 'idle',
    },
    show ? (primary.state === 'ongoing' ? h(StatusSpinner) : h(StatusDot, { state: primary.state })) : null,
    show ? list.map((status, index) => h('span', { key: `${status.labelKey}-${index}`, class: 'dsg-visually-hidden' }, statusText(status))) : null
  )
}

/** Effective group color for the wrapper custom property (hex wins over palette). */
const groupColorCss = (group) => groupColorHex(group) ?? `var(--dsg-color-${groupColor(group)})`

/**
 * Relative updated-time label + absolute tooltip. Missing/invalid timestamps
 * return null so the row omits the element entirely (0.2.7).
 */
const sessionTime = (updatedAt) => {
  const parts = relativeTimeParts(updatedAt)
  if (!parts) return null
  const t = rt()?.t ?? ((key) => key)
  const label = parts.unit === 'justNow' ? t('time.justNow') : t(`time.${parts.unit}`, { n: parts.value })
  return { label, title: formatAbsoluteTime(updatedAt) ?? label }
}

/** Shift+F10 / ContextMenu opens the row menu; Enter/Space keep their own action. */
const menuKeyHandler = (event, open) => {
  if (!isMenuKey(event)) return false
  event.preventDefault()
  event.stopPropagation()
  open(event.currentTarget)
  return true
}

const menuSourceRow = (menu) => {
  if (!menu) return null
  const testId = menu.kind === 'group' ? 'session-groups-group' : 'session-groups-session'
  const attr = menu.kind === 'group' ? 'data-group-id' : 'data-session-id'
  const value = menu.kind === 'group' ? menu.groupId : menu.sessionId
  const rows = globalThis.document?.querySelectorAll?.(`[data-testid="${testId}"]`) ?? []
  for (const row of rows) {
    if (row.getAttribute?.(attr) === value) return row
  }
  return null
}

// ---------------------------------------------------------------------------
// Drag insertion placeholder (0.2.4)
// ---------------------------------------------------------------------------
/**
 * A real row-height gap at the insertion point. The previous feedback drew a
 * 2px line/border on the target row, which was too subtle to read as "the row
 * will land here". This placeholder participates in the flex layout, so the
 * rows after the insertion point are physically pushed down by roughly one row
 * (32px session rows / 34px group rows) and the gap disappears when the drag
 * leaves, drops or ends.
 *
 * The stable `session-groups-drop-indicator` testid is kept from V1; the
 * `data-drop-kind`/`data-drop-target` attributes carry the same vocabulary and
 * `data-drop-height` exposes the row height to tests.
 */
const DropPlaceholder = ({ target, store, handlers, height }) => {
  const t = rt()?.t ?? ((key) => key)
  const nameOf = (groupId) => findGroup(store?.doc, groupId)?.name ?? ''
  let label = t('drag.dropHere')
  let targetId = 'ungrouped'
  switch (target?.kind) {
    case 'group-before':
      label = t('drag.groupBefore', { name: nameOf(target.targetId) })
      targetId = target.targetId ?? ''
      break
    case 'group-after':
      label = t('drag.groupAfter', { name: nameOf(target.targetId) })
      targetId = target.targetId ?? ''
      break
    case 'group-append':
      label = t('drag.groupAppend', { name: nameOf(target.groupId) })
      targetId = target.groupId ?? ''
      break
    case 'group-head':
      label = t('drag.groupInto', { name: nameOf(target.groupId) })
      targetId = target.groupId ?? ''
      break
    case 'group-child':
      label = t('drag.groupInto', { name: nameOf(target.parentId) })
      targetId = target.parentId ?? ''
      break
    case 'group-root-end':
      label = t('drag.groupRootEnd')
      targetId = 'root-end'
      break
    case 'ungrouped':
      label = t('drag.toUngrouped')
      targetId = 'ungrouped'
      break
    case 'session-before':
    case 'session-after':
      targetId = target.sessionId ?? ''
      break
    default:
      break
  }
  return h(
    'div',
    {
      class: 'dsg-drop-placeholder',
      role: 'presentation',
      'data-testid': 'session-groups-drop-indicator',
      'data-drop-kind': target?.kind ?? '',
      'data-drop-target': targetId,
      'data-drop-height': String(height),
      style: { '--dsg-drop-height': `${height}px` },
      onDragOver: (event) => handlers.onPlaceholderDragOver(event),
      onDrop: (event) => handlers.onPlaceholderDrop(event, target),
      onDragLeave: (event) => handlers.onDragLeave(event),
    },
    h('span', { class: 'dsg-drop-placeholder-label' }, label)
  )
}

/** Session placeholders match the 32px session row, group ones the 34px group row. */
const SESSION_PLACEHOLDER_HEIGHT = 32
const GROUP_PLACEHOLDER_HEIGHT = 34

/**
 * Empty-group / empty-ungrouped drop box (0.2.8). Same geometry and surface as
 * DropPlaceholder: full-width dashed 32px box with a 14px plus glyph and label.
 * It is a hint only — the surrounding group body/section owns the drop handlers.
 */
const EmptyDropBox = ({ label, active = false, testId = 'session-groups-empty', data }) =>
  h(
    'div',
    {
      class: 'dsg-empty-dropbox',
      'data-testid': testId,
      'data-drop-active': active ? 'true' : 'false',
      role: 'presentation',
      ...(data ?? {}),
    },
    h('span', { class: 'dsg-empty-dropbox-plus', 'aria-hidden': 'true' }, renderGlyph(h, 'plus', 14)),
    h('span', { class: 'dsg-empty-dropbox-label' }, label)
  )

// ---------------------------------------------------------------------------
// Session row
// ---------------------------------------------------------------------------
/**
 * 0.2.20: a stream/frame snapshot rebuilds the whole tree. The row only needs
 * to repaint when display data, status, workspace, archive flag or active
 * highlight changes; handlers are the stable proxy supplied by GroupsView.
 */
const sessionRowPropsEqual = (prev, next) => {
  const a = prev.sessionNode
  const b = next.sessionNode
  if (a.session.id !== b.session.id) return false
  if (prev.depth !== next.depth || prev.groupId !== next.groupId || prev.ungrouped !== next.ungrouped) return false
  if (a.archived !== b.archived || a.runningSubagentCount !== b.runningSubagentCount) return false
  if ((prev.store?.currentSessionId === a.session.id) !== (next.store?.currentSessionId === b.session.id)) return false
  const ar = a.session
  const br = b.session
  if (ar.title !== br.title || ar.displayTitle !== br.displayTitle || ar.updatedAt !== br.updatedAt || ar.blank !== br.blank) return false
  const aw = a.workspace
  const bw = b.workspace
  if (aw?.workspaceId !== bw?.workspaceId || aw?.title !== bw?.title || aw?.path !== bw?.path) return false
  const as = a.status
  const bs = b.status
  if (as === bs) return true
  if (!as || !bs) return false
  return (
    as.running === bs.running &&
    as.completionUnread === bs.completionUnread &&
    as.pendingInteraction?.kind === bs.pendingInteraction?.kind
  )
}

const SessionRowImpl = ({
  sessionNode,
  depth,
  groupId,
  ungrouped = false,
  props,
  handlers,
  store,
}) => {
  perfRender('SessionRow')
  diagRender('SessionRow')
  const row = sessionNode.session
  const sessionId = row.id
  const archived = sessionNode.archived === true
  const status = sessionNode.status
  const statuses = sessionStatuses(status, { runningSubagentCount: sessionNode.runningSubagentCount })
  const primaryStatus = statuses[0]
  const title = sessionTitle(row, { blankLabel: rt()?.t('session.blank'), untitledLabel: rt()?.t('session.untitled') })
  const workspaceName = sessionNode.workspace ? workspaceLabel(sessionNode.workspace) : rt()?.t('session.noWorkspace')
  const current = store?.currentSessionId === sessionId
  const time = sessionTime(row.updatedAt)
  // Archived and blank rows keep the 16x20 leading slot but never paint a
  // status marker (official row contract); pending rows trade the time cell for
  // the compact status label.
  const hiddenStatus = archived || row.blank === true
  const compactStatusT = !hiddenStatus && primaryStatus.compactKey ? rt()?.t(primaryStatus.compactKey) : null
  return h(
    'div',
    {
      class: 'dsg-session-row',
      role: 'treeitem',
      tabindex: '0',
      draggable: 'true',
      'aria-selected': current ? 'true' : undefined,
      'aria-label': title,
      'aria-haspopup': 'menu',
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
      onContextMenu: (event) => handlers.onSessionContextMenu(event, sessionNode),
      onKeyDown: (event) => {
        if (menuKeyHandler(event, (rowElement) => handlers.openSessionMenuAtRow(rowElement, sessionNode))) return
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
      onDragLeave: handlers.onDragLeave,
      onDrop: (event) => handlers.onDropSession(event, sessionId, groupId, ungrouped),
    },
    h(SessionStatusCell, { statuses, hidden: hiddenStatus }),
    h('span', { class: 'dsg-session-title' }, title),
    h('span', { class: 'dsg-workspace-badge', 'data-testid': 'session-groups-workspace-badge', title: sessionNode.workspace?.path ?? '' }, workspaceName),
    h(
      'span',
      { class: 'dsg-session-actions' },
      IconButton({
        label: rt()?.t('session.menu'),
        glyph: 'more',
        testId: 'session-groups-session-menu',
        haspopup: 'menu',
        data: { 'data-session-id': sessionId },
        onClick: (event) => handlers.openSessionMenu(event, sessionNode),
      })
    ),
    archived ? h('span', { class: 'dsg-session-badge' }, rt()?.t('session.archivedBadge')) : null,
    compactStatusT
      ? h(
          'span',
          {
            class: 'dsg-session-time dsg-session-compact-status',
            'data-testid': 'session-groups-session-time',
            'data-compact-status': primaryStatus.pendingKind,
            'aria-hidden': 'true',
          },
          compactStatusT
        )
      : time
        ? h(
            'span',
            {
              class: 'dsg-session-time',
              'data-testid': 'session-groups-session-time',
              title: time.title,
            },
            time.label
          )
        : null
  )
}

const SessionRow = memo(SessionRowImpl, sessionRowPropsEqual)

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
  return h(
    'div',
    {
      class: 'dsg-group-drop-slot',
      'data-testid': 'session-groups-group-drop',
      'data-parent-id': parentId,
      'data-before-group-id': anchor ?? '',
      'data-drop-active': active ? 'true' : 'false',
      'data-drop-forbidden': forbidden ? 'true' : 'false',
      onDragOver: (event) => handlers.onDragOverGroupSlot(event, parentId, anchor),
      onDragLeave: handlers.onDragLeave,
      onDrop: (event) => handlers.onDropGroupSlot(event, parentId, anchor),
    },
    active
      ? h(DropPlaceholder, {
          target: { kind: 'group-child', parentId, beforeGroupId: anchor },
          store,
          handlers,
          height: GROUP_PLACEHOLDER_HEIGHT,
        })
      : null
  )
}

const GroupNode = ({ node, depth, props, handlers, store }) => {
  perfRender('GroupNode')
  diagRender('GroupNode')
  const group = node.group
  const expanded = isExpanded(store.collapsed, group.id)
  const dropTarget = store.dropTarget
  const isAppendTarget = dropTarget && dropTarget.kind === 'group-append' && dropTarget.groupId === group.id
  const headerKind = dropTarget && dropTarget.targetId === group.id ? dropTarget.kind : null
  const isBefore = headerKind === 'group-before'
  const isAfter = headerKind === 'group-after'
  const isForbidden = headerKind === 'group-forbidden'
  const isHeadTarget = dropTarget?.kind === 'group-head' && dropTarget.groupId === group.id
  const dragging = store.draggedGroupId === group.id
  const visibleSessions = node.children.filter((child) => child.kind === 'session')
  const childGroups = node.children.filter((child) => child.kind === 'group')
  // Official 0.2.13 watermark: 5 direct sessions by default; a current /
  // running / pending / unread-complete row raises the baseline (max 50).
  // "Show more" is a local expansion of +5 (or all remaining); collapsing the
  // group resets to the official default.
  const [sessionWatermark, setSessionWatermark] = useState(0)
  useEffect(() => {
    if (!expanded) setSessionWatermark(0)
  }, [expanded])
  const currentSessionId = store.currentSessionId ?? null
  let requiredWatermark = 0
  for (let index = 0; index < visibleSessions.length; index += 1) {
    if (index + 1 > SESSION_WATERMARK_AUTO_MAX) break
    const child = visibleSessions[index]
    const status = child.status
    const attention =
      child.session?.id === currentSessionId ||
      status?.running === true ||
      status?.completionUnread === true ||
      (status?.pendingInteraction && typeof status.pendingInteraction.kind === 'string') ||
      (child.runningSubagentCount ?? 0) > 0
    if (attention) requiredWatermark = index + 1
  }
  const baselineWatermark = Math.max(SESSION_WATERMARK_BASE, requiredWatermark)
  const effectiveWatermark = Math.max(baselineWatermark, sessionWatermark)
  const visibleSessionRows = visibleSessions.slice(0, effectiveWatermark)
  const hiddenSessionCount = visibleSessions.length - visibleSessionRows.length
  const baselineHiddenCount = visibleSessions.length - visibleSessions.slice(0, baselineWatermark).length
  const showSessionOverflow = baselineHiddenCount > 0
  const sessionsExpanded = hiddenSessionCount === 0
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

  // Session insertion uses a real placeholder row before/after the target row
  // (not a 2px border) so the rows around the insertion point physically move.
  const sessionChildren = []
  for (const child of visibleSessionRows) {
    const sessionId = child.session.id
    if (dropTarget?.kind === 'session-before' && dropTarget.sessionId === sessionId) {
      sessionChildren.push(h(DropPlaceholder, { key: `ph-b-${sessionId}`, target: dropTarget, store, handlers, height: SESSION_PLACEHOLDER_HEIGHT }))
    }
    sessionChildren.push(h(SessionRow, { key: sessionId, sessionNode: child, depth: depth + 1, groupId: group.id, props, handlers, store }))
    if (dropTarget?.kind === 'session-after' && dropTarget.sessionId === sessionId) {
      sessionChildren.push(h(DropPlaceholder, { key: `ph-a-${sessionId}`, target: dropTarget, store, handlers, height: SESSION_PLACEHOLDER_HEIGHT }))
    }
  }

  const appendPlaceholder = isAppendTarget
    ? h(DropPlaceholder, { key: 'ph-append', target: { kind: 'group-append', groupId: group.id }, store, handlers, height: GROUP_PLACEHOLDER_HEIGHT })
    : null
  const headPlaceholder = isHeadTarget
    ? h(DropPlaceholder, { key: 'ph-head', target: { kind: 'group-head', groupId: group.id }, store, handlers, height: SESSION_PLACEHOLDER_HEIGHT })
    : null
  // An empty group's hint box must not compete with a body placeholder: append,
  // head and child-slot targets each already paint the insertion surface. A
  // boundary target (before/after this group) paints outside the body, so the
  // hint stays and takes the accent drop state.
  const bodyPlaceholderVisible =
    isAppendTarget ||
    isHeadTarget ||
    (dropTarget?.kind === 'group-child' && dropTarget.parentId === group.id)
  const emptyDropActive = Boolean(
    dropTarget &&
      !bodyPlaceholderVisible &&
      (dropTarget.targetId === group.id || dropTarget.groupId === group.id || dropTarget.parentId === group.id)
  )
  const lineChildren = [...bodyChildren]
  if (headPlaceholder) lineChildren.push(headPlaceholder)
  if (node.visibleCount === 0 && childGroups.length === 0 && !bodyPlaceholderVisible) {
    lineChildren.push(
      h(EmptyDropBox, {
        key: 'empty',
        label: notFound,
        active: emptyDropActive,
        data: { 'data-group-id': group.id },
      })
    )
  }
  lineChildren.push(...sessionChildren)
  if (showSessionOverflow) {
    lineChildren.push(
      h(
        'button',
        {
          key: 'session-overflow',
          type: 'button',
          class: 'dsg-session-overflow',
          'data-testid': 'session-groups-session-overflow',
          'data-group-id': group.id,
          'aria-expanded': sessionsExpanded ? 'true' : 'false',
          onClick: (event) => {
            event.stopPropagation()
            if (sessionsExpanded) {
              setSessionWatermark(0)
              return
            }
            setSessionWatermark(
              hiddenSessionCount <= SESSION_WATERMARK_BASE ? Infinity : effectiveWatermark + SESSION_WATERMARK_BASE
            )
          },
        },
        sessionsExpanded
          ? rt()?.t('sessions.collapse')
          : rt()?.t('sessions.expand', { n: hiddenSessionCount })
      )
    )
  }
  // group-append: placeholder at the end of the group body when expanded.
  if (appendPlaceholder) lineChildren.push(appendPlaceholder)

  return h(
    'div',
    {
      class: 'dsg-group',
      'data-color': groupColor(group),
      ...(groupColorHex(group) ? { 'data-color-hex': groupColorHex(group) } : {}),
      // 0.2.7 display precedence: colorHex > palette. Inline custom property is
      // inherited by the row icon/caret and this group's child-guide pseudo.
      style: { '--dsg-group-color': groupColorCss(group) },
    },
    isBefore
      ? h(DropPlaceholder, { target: { kind: 'group-before', targetId: group.id }, store, handlers, height: GROUP_PLACEHOLDER_HEIGHT })
      : null,
    h(
      'div',
      {
        class: 'dsg-group-row',
        role: 'treeitem',
        tabindex: '0',
        draggable: 'true',
        'aria-expanded': expanded ? 'true' : 'false',
        'aria-haspopup': 'menu',
        'data-testid': 'session-groups-group',
        'data-group-id': group.id,
        'data-color': groupColor(group),
        'data-depth': String(displayDepth(depth)),
        'data-expanded': expanded ? 'true' : 'false',
        'data-drop-active': isAppendTarget ? 'true' : 'false',
        'data-drop-kind': isAppendTarget ? 'group-append' : headerKind ?? '',
        'data-drop-forbidden': isForbidden ? 'true' : 'false',
        'data-dragging': dragging ? 'true' : 'false',
        title: groupPath(store.doc, group.id),
        onClick: () => handlers.onGroupClick(group.id),
        onContextMenu: (event) => handlers.onGroupContextMenu(event, group),
        onPointerDown: (event) => handlers.onGroupPointerDown(event, group),
        onKeyDown: (event) => {
          if (menuKeyHandler(event, (rowElement) => handlers.openGroupMenuAtRow(rowElement, group))) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handlers.toggleGroup(group.id)
          }
        },
        onDragStart: (event) => handlers.onGroupDragStart(event, group),
        onDragEnd: handlers.onDragEnd,
        onDragOver: (event) => handlers.onDragOverGroup(event, group.id),
        onDragLeave: handlers.onDragLeave,
        onDrop: (event) => handlers.onDropGroup(event, group.id),
      },
      h('span', { class: 'dsg-group-caret' }, renderGlyph(h, expanded ? 'chevronDown' : 'chevronRight', 16)),
      h('span', { class: 'dsg-group-icon' }, renderIcon(h, group.icon, 16)),
      h('span', { class: 'dsg-group-name' }, group.name),
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
          haspopup: 'menu',
          data: { 'data-group-id': group.id },
          onClick: (event) => handlers.openGroupMenu(event, group),
        })
      ),
      h('span', { class: 'dsg-group-count', 'data-testid': 'session-groups-group-count' }, node.visibleCount)
    ),
    expanded
      ? h(
          'div',
          { class: 'dsg-group-body' },
          h(
            'div',
            {
              class: 'dsg-group-line',
              'data-empty': node.visibleCount === 0 && childGroups.length === 0 ? 'true' : 'false',
              onDragOver: (event) => handlers.onDragOverGroupHead(event, group.id),
              onDragLeave: handlers.onDragLeave,
              onDrop: (event) => handlers.onDropGroupHead(event, group.id),
            },
            ...lineChildren
          )
        )
      : null,
    isAfter
      ? h(DropPlaceholder, { target: { kind: 'group-after', targetId: group.id }, store, handlers, height: GROUP_PLACEHOLDER_HEIGHT })
      : null,
    // group-append on a collapsed group: placeholder directly after its row.
    !expanded && appendPlaceholder ? appendPlaceholder : null
  )
}

// ---------------------------------------------------------------------------
// Ungrouped section (virtualized)
// ---------------------------------------------------------------------------
/**
 * Estimated initial viewport for the first render before the real `.dsg-tree`
 * metrics are measured. The window is recomputed from the DOM immediately after
 * mount, so this only affects the first paint, never the settled list.
 */
const estimatedTreeHeight = () => {
  const height = Number(globalThis.innerHeight)
  return Number.isFinite(height) && height > 0 ? Math.max(240, height - 220) : 700
}

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
    viewportHeight: estimatedTreeHeight(),
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
    let frame = null
    let disposed = false
    const measure = () => {
      frame = null
      if (disposed) return
      const current = bodyRef.current
      if (!current || current.isConnected === false) return
      const treeRect = tree.getBoundingClientRect()
      const bodyRect = current.getBoundingClientRect()
      const next = {
        scrollTop: tree.scrollTop,
        viewportHeight: tree.clientHeight,
        listTop: bodyRect.top - treeRect.top + tree.scrollTop,
      }
      setMetrics((previous) =>
        previous.scrollTop === next.scrollTop &&
        previous.viewportHeight === next.viewportHeight &&
        previous.listTop === next.listTop
          ? previous
          : next
      )
    }
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure)
    }
    measure()
    tree.addEventListener('scroll', schedule, { passive: true })
    globalThis.addEventListener('resize', schedule)
    return () => {
      disposed = true
      if (frame !== null) cancelAnimationFrame(frame)
      tree.removeEventListener('scroll', schedule)
      globalThis.removeEventListener('resize', schedule)
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
const SearchBox = ({ store, handlers, sessionsById, workspaces, archivedSessionIds, autoFocus = false, onDismiss = null }) => {
  perfRender('SearchBox')
  const t = rt()?.t ?? ((key) => key)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const boxRef = useRef(null)
  const listboxRef = useRef(null)

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

  // Escape closes the dropdown first; with no dropdown open it collapses the
  // whole search row (feedback item 3: Escape/clear closes).
  useEffect(() => {
    const doc = globalThis.document
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (visible) setOpen(false)
      else onDismiss?.()
    }
    doc?.addEventListener?.('keydown', onKeyDown, true)
    return () => doc?.removeEventListener?.('keydown', onKeyDown, true)
  }, [visible, onDismiss])

  // Keep the keyboard-active option visible inside the 320px scrolling listbox
  // (spec §3.3): ArrowDown past the fold must never leave the active row clipped.
  // Uses rect difference rather than `scrollIntoView` so the page/tree does not
  // scroll as a side effect.
  useEffect(() => {
    if (!visible || activeIndex < 0) return
    const listbox = listboxRef.current
    if (!listbox) return
    const option = listbox.querySelector?.(`#${SEARCH_LISTBOX_ID}-${activeIndex}`)
    if (!option) return
    const boxRect = listbox.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    if (optionRect.top < boxRect.top) listbox.scrollTop -= boxRect.top - optionRect.top
    else if (optionRect.bottom > boxRect.bottom) listbox.scrollTop += optionRect.bottom - boxRect.bottom
  }, [activeIndex, visible, results.length])

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
      } else {
        onDismiss?.()
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
      autoFocus: autoFocus === true,
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
            ref: listboxRef,
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
/**
 * Three-row view-options popover (feedback item 3): the archive tri-state moves
 * out of the always-visible header into the official-style view menu. Each row
 * is 30px, carries the current check and dispatches the existing
 * `archive-filter` action before closing.
 */
const ArchiveFilterPopover = ({ filter, t, onPick }) =>
  h(
    'div',
    {
      class: 'dsg-view-options-popover',
      role: 'menu',
      'data-testid': 'session-groups-view-options-popover',
      'aria-label': t('archive.label'),
      onClick: (event) => event.stopPropagation(),
    },
    ...ARCHIVE_FILTERS.map((value) => {
      const active = value === filter
      return h(
        'button',
        {
          key: value,
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': active ? 'true' : 'false',
          class: 'dsg-menu-item dsg-view-option',
          'data-testid': 'session-groups-archive-filter',
          'data-filter': value,
          'data-active': active ? 'true' : 'false',
          onClick: (event) => {
            event.stopPropagation()
            onPick(value)
          },
        },
        h('span', { class: 'dsg-view-option-label' }, t(ARCHIVE_FILTER_LABEL_KEYS[value])),
        h('span', { class: 'dsg-view-option-check', 'aria-hidden': 'true' }, active ? renderGlyph(h, 'check', 16) : null)
      )
    })
  )

const StatusSessionsButton = ({
  kind,
  icon,
  count,
  sections,
  label,
  ariaLabel,
  emptyLabel,
  testId,
  popoverTestId,
  sessionsById,
  onSelect,
}) => {
  const t = rt()?.t ?? ((key) => key)
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const doc = globalThis.document
    const onPointerDown = (event) => {
      if (ref.current?.contains?.(event?.target)) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    doc?.addEventListener?.('pointerdown', onPointerDown, true)
    doc?.addEventListener?.('keydown', onKeyDown, true)
    return () => {
      doc?.removeEventListener?.('pointerdown', onPointerDown, true)
      doc?.removeEventListener?.('keydown', onKeyDown, true)
    }
  }, [open])

  return h(
    'div',
    { class: 'dsg-status-action-wrap', ref },
    h(
      'button',
      {
        type: 'button',
        class: 'dsg-status-action',
        'data-testid': testId,
        'data-kind': kind,
        'data-count': String(count),
        title: label,
        'aria-label': ariaLabel,
        'aria-expanded': open ? 'true' : 'false',
        onClick: (event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        },
      },
      h('span', { class: 'dsg-status-action-icon', 'aria-hidden': 'true' }, renderIcon(h, icon, 16)),
      h('span', { class: 'dsg-status-action-count' }, String(count))
    ),
    open
      ? h(
          'div',
          { class: 'dsg-running-popover', role: 'menu', 'data-testid': popoverTestId },
          sections.length === 0
            ? h('div', { class: 'dsg-running-empty' }, emptyLabel)
            : sections.map((section, index) =>
                h(
                  'div',
                  {
                    class: 'dsg-running-section',
                    key: section.groupId ?? `ungrouped-${index}`,
                    'data-group-id': section.groupId ?? '',
                  },
                  h(
                    'div',
                    { class: 'dsg-running-group-label' },
                    section.groupId
                      ? section.groupName || t('session.untitled')
                      : t('running.group.ungrouped')
                  ),
                  section.sessions.map((entry) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'dsg-running-item',
                        key: entry.sessionId,
                        'data-testid': `${testId}-item`,
                        'data-session-id': entry.sessionId,
                        onClick: (event) => {
                          event.stopPropagation()
                          setOpen(false)
                          onSelect(entry.sessionId, entry.archived === true)
                        },
                      },
                      h(
                        'span',
                        { class: 'dsg-running-item-title' },
                        sessionTitle(sessionsById?.[entry.sessionId], {
                          blankLabel: t('session.blank'),
                          untitledLabel: t('session.untitled'),
                        })
                      ),
                      entry.archived
                        ? h('span', { class: 'dsg-running-item-archived' }, t('session.archived'))
                        : null
                    )
                  )
                )
              )
        )
      : null
  )
}

const Header = ({ store, handlers, sessionsById, workspaces, archivedSessionIds, runningSessions, blockedSessions, unreadSessions }) => {
  perfRender('Header')
  diagRender('Header')
  const t = rt()?.t ?? ((key) => key)
  const filter = store.archiveFilter
  const [searchOpen, setSearchOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef(null)

  // View-options popover: Escape or an outside pointerdown closes it.
  useEffect(() => {
    if (!optionsOpen) return undefined
    const doc = globalThis.document
    const onPointerDown = (event) => {
      if (optionsRef.current?.contains?.(event?.target)) return
      setOptionsOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOptionsOpen(false)
    }
    doc?.addEventListener?.('pointerdown', onPointerDown, true)
    doc?.addEventListener?.('keydown', onKeyDown, true)
    return () => {
      doc?.removeEventListener?.('pointerdown', onPointerDown, true)
      doc?.removeEventListener?.('keydown', onKeyDown, true)
    }
  }, [optionsOpen])

  return h(
    'div',
    {
      class: 'dsg-header dsg-header-stacked',
      'data-testid': 'session-groups-header',
      'data-search-open': searchOpen ? 'true' : 'false',
      'data-options-open': optionsOpen ? 'true' : 'false',
    },
    h(
      'div',
      { class: 'dsg-header-row', 'data-testid': 'session-groups-header-row' },
      h(
        'span',
        { class: 'dsg-header-title', title: t('view.title') },
        h('span', { class: 'dsg-header-label' }, t('view.title'))
      ),
      h(
        'div',
        { class: 'dsg-header-actions' },
        h(
          'div',
          { class: 'dsg-status-actions' },
          h(StatusSessionsButton, {
            kind: 'running',
            icon: 'activity',
            count: runningSessions?.count ?? 0,
            sections: runningSessions?.sections ?? [],
            label: t('running.open'),
            ariaLabel: t('running.aria', { n: runningSessions?.count ?? 0 }),
            emptyLabel: t('running.empty'),
            testId: 'session-groups-running-button',
            popoverTestId: 'session-groups-running-popover',
            sessionsById,
            onSelect: handlers.openRunningSession,
          }),
          h(StatusSessionsButton, {
            kind: 'blocked',
            icon: 'pause',
            count: blockedSessions?.count ?? 0,
            sections: blockedSessions?.sections ?? [],
            label: t('blocked.open'),
            ariaLabel: t('blocked.aria', { n: blockedSessions?.count ?? 0 }),
            emptyLabel: t('blocked.empty'),
            testId: 'session-groups-blocked-button',
            popoverTestId: 'session-groups-blocked-popover',
            sessionsById,
            onSelect: handlers.openRunningSession,
          }),
          h(StatusSessionsButton, {
            kind: 'unread',
            icon: 'mail',
            count: unreadSessions?.count ?? 0,
            sections: unreadSessions?.sections ?? [],
            label: t('unread.open'),
            ariaLabel: t('unread.aria', { n: unreadSessions?.count ?? 0 }),
            emptyLabel: t('unread.empty'),
            testId: 'session-groups-unread-button',
            popoverTestId: 'session-groups-unread-popover',
            sessionsById,
            onSelect: handlers.openRunningSession,
          })
        ),        // 0.2.24: view switch moved from the footer to the header's leading slot.
        // The grid glyph means "go to the workspace browser".
        IconButton({
          label: t('footer.toWorkspace'),
          glyph: 'grid',
          testId: 'session-groups-toggle',
          data: { 'data-mode': store.viewMode, 'data-target': 'workspace' },
          onClick: () => rt()?.toggleMode(),
        }),
        // Official workspace-section order: search → view options → new group.
        IconButton({
          label: t('search.label'),
          icon: 'search',
          testId: 'session-groups-search-toggle',
          expanded: searchOpen,
          onClick: () => {
            setOptionsOpen(false)
            setSearchOpen((open) => !open)
          },
        }),
        h(
          'div',
          { ref: optionsRef, class: 'dsg-view-options' },
          IconButton({
            label: t('view.options'),
            icon: 'view-options',
            testId: 'session-groups-view-options',
            expanded: optionsOpen,
            haspopup: 'menu',
            data: { 'data-filter': filter },
            onClick: () => {
              setOptionsOpen((open) => !open)
            },
          }),
          optionsOpen
            ? h(ArchiveFilterPopover, {
                filter,
                t,
                onPick: (value) => {
                  handlers.setArchiveFilter(value)
                  setOptionsOpen(false)
                },
              })
            : null
        ),
        IconButton({
          label: t('view.newGroup'),
          icon: 'project-add',
          testId: 'session-groups-new-group',
          onClick: (event) => handlers.openNewGroup(event, null),
        })
      )
    ),
    searchOpen
      ? h(
          'div',
          { class: 'dsg-header-row dsg-header-search-row', 'data-testid': 'session-groups-header-search-row' },
          h(SearchBox, {
            store,
            handlers,
            sessionsById,
            workspaces,
            archivedSessionIds,
            autoFocus: true,
            onDismiss: () => setSearchOpen(false),
          }),
          IconButton({
            label: t('search.close'),
            glyph: 'close',
            testId: 'session-groups-search-close',
            onClick: () => setSearchOpen(false),
          })
        )
      : null
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
  const menuRef = useRef(null)
  // Refine the estimated anchor with the real menu rect so a ~275px group menu
  // is clamped to the viewport instead of relying on a hard-coded 200px guess.
  useLayoutEffect(() => {
    const node = menuRef.current
    if (!node || !menu) return
    const rect = node.getBoundingClientRect()
    // Re-clamp the *desired* anchor (not the conservative pre-clamp result):
    // a menu that fits below the cursor keeps its exact +2px offset, while one
    // taller than the remaining space is pushed up by its measured height.
    const next = clampMenuPosition({
      x: menu.anchorX ?? menu.x,
      y: menu.anchorY ?? menu.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: globalThis.innerWidth,
      viewportHeight: globalThis.innerHeight,
    })
    node.style.left = `${next.x}px`
    node.style.top = `${next.y}px`
  }, [menu])
  // Focus the first item when the menu opens; when it closes (Escape, outside,
  // scroll, resize or an action) focus returns to the originating row.
  useEffect(() => {
    if (!menu) return undefined
    const node = menuRef.current
    const first = node?.querySelector?.('button:not([disabled])')
    ;(first ?? node)?.focus?.({ preventScroll: true })
    return () => {
      menuSourceRow(menu)?.focus?.({ preventScroll: true })
    }
  }, [menu])
  if (!menu) return null
  const t = rt()?.t
  const item = (key, label, onClick, extra = {}) =>
    h('button', { key, type: 'button', role: 'menuitem', class: 'dsg-menu-item', onClick: (event) => { event.stopPropagation(); handlers.closeMenu(); onClick() }, ...extra }, label)
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
    children.push(item('color', t('group.color'), () => handlers.openGroupColor(menu.groupId)))
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
      ref: menuRef,
      class: 'dsg-menu',
      role: 'menu',
      tabindex: '-1',
      'data-testid': 'session-groups-menu',
      'data-menu-kind': menu.kind,
      'data-source-id': menu.kind === 'group' ? menu.groupId : menu.sessionId,
      style: { left: `${menu.x}px`, top: `${menu.y}px` },
      onClick: (event) => event.stopPropagation(),
    },
    ...children
  )
}

/**
 * Move-to-group option list (0.2.6). A click only highlights the row
 * (`aria-selected`); the shared dialog footer owns the actual move, so a stray
 * click can never move a session or group by itself.
 */
const GroupListPicker = ({ options, selection, onSelect, rootLabel, ariaLabel, allowRoot = true, testId = 'session-groups-dialog-options' }) => {
  const t = rt()?.t
  const option = (key, value, label, depth) =>
    h(
      'button',
      {
        key,
        type: 'button',
        role: 'option',
        'aria-selected': selection === value ? 'true' : 'false',
        class: 'dsg-menu-item dsg-dialog-option',
        'data-testid': 'session-groups-dialog-group',
        'data-group-id': value ?? '',
        'data-selected': selection === value ? 'true' : 'false',
        style: { paddingLeft: `${12 + depth * 16}px` },
        onClick: (event) => {
          event.stopPropagation()
          onSelect(value)
        },
      },
      h('span', { class: 'dsg-dialog-option-label' }, label),
      selection === value
        ? h('span', { class: 'dsg-dialog-option-check', 'aria-hidden': 'true' }, renderGlyph(h, 'check', 16))
        : null
    )
  return h(
    ScrollArea,
    {
      className: 'dsg-menu dsg-dialog-list',
      role: 'listbox',
      'data-testid': testId,
      'aria-label': ariaLabel ?? t('dialog.moveTo'),
    },
    allowRoot ? option('ungrouped', null, rootLabel ?? t('ungrouped.title'), 0) : null,
    ...options.flatMap((group, index) => {
      const nodes = []
      if (group.depth === 0 && index > 0) {
        nodes.push(
          h('div', {
            key: `separator:${group.id}`,
            class: 'dsg-dialog-group-separator',
            role: 'presentation',
            'aria-hidden': 'true',
          })
        )
      }
      nodes.push(option(group.id, group.id, group.name, group.depth + 1))
      return nodes
    })
  )
}

const DialogHost = ({ store, props }) => {
  const dialog = store.dialog
  const t = rt()?.t
  const [value, setValue] = useState('')
  const [selection, setSelection] = useState(undefined)
  const [hexInput, setHexInput] = useState('')
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const [dialogRect, setDialogRect] = useState(null)
  const dialogRectRef = useRef(null)
  const gestureRef = useRef(null)
  const gestureCleanupRef = useRef(null)
  const debugSentRef = useRef(null)
  dialogRectRef.current = dialogRect
  useEffect(() => {
    if (!dialog) {
      setDialogRect(null)
      return
    }
    const saved = readDialogGeometries()[dialog.kind]
    setDialogRect(saved ? clampDialogRect(saved, globalThis.innerWidth, globalThis.innerHeight) : null)
  }, [dialog?.kind])

  // Measure the natural dialog once when there is no saved geometry; after that
  // the explicit rect is the single source of truth for drag/resize.
  useLayoutEffect(() => {
    if (!dialog || dialogRect !== null) return
    const element = dialogRef.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const titlebar = element.querySelector('.dsg-dialog-titlebar')
    const content = element.querySelector('.dsg-dialog-content')
    const actions = element.querySelector('.dsg-dialog-actions')
    // The dialog is a column flex with gap:12px and 16px vertical padding, so
    // include the two gaps + padding + the 0.5px top/bottom border (which
    // becomes fractional at non-1 DPR) or the content bottom is clipped.
    const borderHeight =
      (Number.parseFloat(globalThis.getComputedStyle(element).borderTopWidth) || 0) +
      (Number.parseFloat(globalThis.getComputedStyle(element).borderBottomWidth) || 0)
    const laidOutHeight = Math.ceil(
      (titlebar?.offsetHeight ?? 0) +
        Math.ceil(content?.scrollHeight ?? 0) +
        (actions?.offsetHeight ?? 0) +
        57 +
        borderHeight
    )
    const naturalHeight = laidOutHeight || Math.ceil(box.height) || 320
    setDialogRect(
      centeredDialogRect(
        box.width || (dialog.kind === 'icon' ? 420 : 360),
        naturalHeight || 320,
        globalThis.innerWidth,
        globalThis.innerHeight
      )
    )
  }, [dialog, dialogRect])

  useEffect(() => {
    if (!dialog || dialogRect === null) return undefined
    const onResize = () => {
      const next = clampDialogRect(dialogRectRef.current ?? dialogRect, globalThis.innerWidth, globalThis.innerHeight)
      setDialogRect(next)
      saveDialogGeometry(dialog.kind, next)
    }
    globalThis.addEventListener('resize', onResize)
    return () => globalThis.removeEventListener('resize', onResize)
  }, [dialog?.kind, dialogRect === null])

  useEffect(() => {
    if (!dialog) {
      debugSentRef.current = null
      return undefined
    }
    if (debugSentRef.current === dialog.kind) return undefined
    debugSentRef.current = dialog.kind
    const timer = setTimeout(() => {
      const element = dialogRef.current
      if (!element || typeof globalThis.getComputedStyle !== 'function') return
      try {
        const bodyStyle = globalThis.getComputedStyle(globalThis.document.body)
        const dialogStyle = globalThis.getComputedStyle(element)
        const content = element.querySelector('.dsg-dialog-content')
        const input = element.querySelector('.dsg-dialog-input')
        const confirm = element.querySelector('.dsg-dialog-confirm')
        const contentStyle = content ? globalThis.getComputedStyle(content) : null
        const inputStyle = input ? globalThis.getComputedStyle(input) : null
        const confirmStyle = confirm ? globalThis.getComputedStyle(confirm) : null
        const tokenNames = [
          '--dsw-alias-bg-layer-1',
          '--dsw-alias-bg-layer-2',
          '--dsw-alias-button-primary-fill',
          '--dsw-alias-button-primary-hover',
          '--dsw-alias-label-primary-foreground',
          '--dsw-alias-border-l3',
          '--dsw-alias-border-l4',
          '--dsw-alias-label-primary',
          '--dsw-alias-label-secondary',
          '--dsh-scrollbar-thumb',
          '--dsh-scrollbar-thumb-hover',
          '--dsw-radius-panel',
        ]
        const tokens = Object.fromEntries(tokenNames.map((name) => [name, bodyStyle.getPropertyValue(name).trim()]))
        const payload = {
          pluginVersion: PLUGIN_VERSION,
          kind: dialog.kind,
          dark: globalThis.document.body?.getAttribute?.('data-ds-dark-theme'),
          dialog: {
            rect: element.getBoundingClientRect().toJSON?.() ?? null,
            background: dialogStyle.backgroundColor,
            color: dialogStyle.color,
            border: dialogStyle.border,
            borderRadius: dialogStyle.borderRadius,
            padding: dialogStyle.padding,
          },
          content: content
            ? {
                rect: content.getBoundingClientRect().toJSON?.() ?? null,
                flex: contentStyle?.flex,
                height: contentStyle?.height,
                scrollHeight: content.scrollHeight,
              }
            : null,
          input: input
            ? {
                rect: input.getBoundingClientRect().toJSON?.() ?? null,
                display: inputStyle?.display,
                height: inputStyle?.height,
                flex: inputStyle?.flex,
                opacity: inputStyle?.opacity,
                background: inputStyle?.backgroundColor,
                color: inputStyle?.color,
                border: inputStyle?.border,
              }
            : null,
          confirm: confirm
            ? {
                background: confirmStyle?.backgroundColor,
                color: confirmStyle?.color,
                height: confirmStyle?.height,
              }
            : null,
          scrollAreas: [...element.querySelectorAll('.dsg-scroll-area')].map((area) => {
            const scroller = area.firstElementChild
            const rail = [...area.children].find((child) => child.classList?.contains('dsg-scroll-rail')) ?? null
            const thumb = rail ? [...rail.children].find((child) => child.classList?.contains('dsg-scroll-thumb')) ?? null : null
            return {
              className: scroller?.className ?? '',
              clientHeight: scroller?.clientHeight ?? null,
              scrollHeight: scroller?.scrollHeight ?? null,
              max: scroller ? scroller.scrollHeight - scroller.clientHeight : null,
              rail: rail
                ? {
                    rect: rail.getBoundingClientRect().toJSON?.() ?? null,
                    display: getComputedStyle(rail).display,
                    opacity: getComputedStyle(rail).opacity,
                    zIndex: getComputedStyle(rail).zIndex,
                  }
                : null,
              thumb: thumb
                ? {
                    rect: thumb.getBoundingClientRect().toJSON?.() ?? null,
                    display: getComputedStyle(thumb).display,
                    background: getComputedStyle(thumb).backgroundColor,
                  }
                : null,
            }
          }),
          tokens,
        }
        void globalThis.fetch?.('/dsh-session-groups/debug', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {})
      } catch {
        /* debug probe must never affect the dialog */
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [dialog?.kind])

  const beginDialogGesture = (event, dir = null) => {
    if (!dialog || event.button !== 0) return
    if (dir === null && event.target?.closest?.('button, input, textarea, select, a')) return
    const start = dialogRectRef.current
    if (!start) return
    event.preventDefault()
    event.stopPropagation()
    const doc = event.currentTarget?.ownerDocument ?? globalThis.document
    const gesture = { start, x: event.clientX, y: event.clientY, dir }
    gestureRef.current = gesture
    const onMove = (moveEvent) => {
      const current = gestureRef.current
      if (!current) return
      const dx = moveEvent.clientX - current.x
      const dy = moveEvent.clientY - current.y
      const next = current.dir
        ? resizeDialogRect(current.start, current.dir, dx, dy, globalThis.innerWidth, globalThis.innerHeight)
        : dragDialogRect(current.start, dx, dy, globalThis.innerWidth, globalThis.innerHeight)
      setDialogRect(next)
    }
    const onEnd = () => {
      const current = gestureRef.current
      gestureRef.current = null
      doc?.removeEventListener?.('pointermove', onMove)
      doc?.removeEventListener?.('pointerup', onEnd)
      doc?.removeEventListener?.('pointercancel', onEnd)
      gestureCleanupRef.current = null
      if (current && dialogRectRef.current) saveDialogGeometry(dialog.kind, dialogRectRef.current)
    }
    doc?.addEventListener?.('pointermove', onMove)
    doc?.addEventListener?.('pointerup', onEnd)
    doc?.addEventListener?.('pointercancel', onEnd)
    gestureCleanupRef.current = () => {
      doc?.removeEventListener?.('pointermove', onMove)
      doc?.removeEventListener?.('pointerup', onEnd)
      doc?.removeEventListener?.('pointercancel', onEnd)
    }
  }

  // A dialog can unmount mid-gesture; release its window listeners.
  useEffect(
    () => () => {
      gestureRef.current = null
      gestureCleanupRef.current?.()
      gestureCleanupRef.current = null
    },
    []
  )
  useEffect(() => {
    setValue(dialog?.value ?? '')
    // Every selection dialog opens with a visible current/inferred highlight;
    // when nothing usable exists Confirm stays disabled until the user picks.
    const initial = dialog ? initialDialogSelection(dialog, store.doc) : undefined
    setSelection(initial)
    setHexInput(dialog?.kind === 'group-color' && isColorHex(initial) ? initial : '')
    if (dialog && (dialog.kind === 'new-group' || dialog.kind === 'rename-group' || dialog.kind === 'rename-session')) {
      const timer = setTimeout(() => inputRef.current?.focus(), 10)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [dialog])
  if (!dialog) return null
  const close = () => dispatch('dialog', { dialog: null })
  const confirm = (payload) => rt()?.confirmDialog(dialog, payload)
  const errorText = dialog.error ? t(dialog.error === 'name-required' ? 'dialog.namePlaceholder' : dialog.error) : null
  const title = t(dialog.titleKey)
  const optionCheck = () => h('span', { class: 'dsg-dialog-option-check', 'aria-hidden': 'true' }, renderGlyph(h, 'check', 16))
  const bodyNodes = []
  if (dialog.kind === 'delete-group') {
    const options = deleteGroupOptions(store.doc, dialog.groupId)
    bodyNodes.push(
      h(
        'div',
        { class: 'dsg-dialog-body', 'data-testid': 'session-groups-dialog-delete-body' },
        t('dialog.deleteMoveBody', { sessions: dialog.sessionCount ?? 0, groups: dialog.childCount ?? 0 })
      )
    )
    bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.deleteDestination')))
    bodyNodes.push(
      h(GroupListPicker, {
        options,
        selection,
        onSelect: setSelection,
        rootLabel: t('dialog.rootDestination'),
        ariaLabel: t('dialog.deleteDestination'),
        testId: 'session-groups-dialog-delete-options',
      })
    )
  }
  if (dialog.kind === 'archive-running') bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.archiveRunningBody', { families: formatActivity(dialog.activity) })))
  if (dialog.kind === 'new-session') {
    if ((dialog.choices ?? []).length === 0) bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.noWorkspace')))
    else {
      bodyNodes.push(h('div', { class: 'dsg-dialog-body' }, t('dialog.newSessionWorkspace')))
      bodyNodes.push(
        h(
          ScrollArea,
          {
            className: 'dsg-menu dsg-dialog-list',
            role: 'listbox',
            'data-testid': 'session-groups-dialog-options',
            'aria-label': t('dialog.newSessionWorkspace'),
          },
          ...dialog.choices.map((workspace) => {
            const active = selection === workspace.workspaceId
            return h(
              'button',
              {
                key: workspace.workspaceId,
                type: 'button',
                role: 'option',
                'aria-selected': active ? 'true' : 'false',
                class: 'dsg-menu-item dsg-dialog-option',
                'data-testid': 'session-groups-dialog-workspace',
                'data-workspace-id': workspace.workspaceId,
                'data-selected': active ? 'true' : 'false',
                onClick: (event) => {
                  event.stopPropagation()
                  setSelection(workspace.workspaceId)
                },
              },
              h(
                'span',
                { class: 'dsg-dialog-option-label' },
                `${workspaceLabel(workspace)}${workspace.workspaceId === dialog.inferred ? ' ★' : ''}`
              ),
              active ? optionCheck() : null
            )
          })
        )
      )
    }
  }
  if (dialog.kind === 'move-session' || dialog.kind === 'move-group') {
    const options = dialog.kind === 'move-group' ? moveGroupOptions(store.doc, dialog.groupId) : findGroupsFlat(store.doc)
    bodyNodes.push(h(GroupListPicker, {
      options,
      selection,
      onSelect: setSelection,
      allowRoot: dialog.kind !== 'move-group',
    }))
  }
  if (dialog.kind === 'icon') {
    const icons = Array.isArray(dialog.icons) ? dialog.icons : []
    const available = new Set(icons)
    const sections = ICON_GROUPS.map((section) => ({
      ...section,
      icons: section.icons.filter((icon) => available.has(icon)),
    })).filter((section) => section.icons.length > 0)
    const grouped = new Set(sections.flatMap((section) => section.icons))
    const leftovers = icons.filter((icon) => !grouped.has(icon))
    if (leftovers.length > 0) {
      const general = sections.find((section) => section.key === 'general')
      if (general) general.icons.push(...leftovers)
      else sections.push({ key: 'general', labelKey: 'iconGroup.general', icons: leftovers })
    }
    const iconButton = (icon) => {
      const active = selection === icon
      return h(
        'button',
        {
          key: icon,
          type: 'button',
          role: 'radio',
          'aria-checked': active ? 'true' : 'false',
          class: 'dsg-menu-item dsg-dialog-option dsg-icon-option',
          'data-testid': 'session-groups-dialog-icon',
          'data-icon': icon,
          'data-selected': active ? 'true' : 'false',
          title: t(`icon.${icon}`),
          onClick: (event) => {
            event.stopPropagation()
            setSelection(icon)
          },
        },
        renderIcon(h, icon, 16),
        h('span', { class: 'dsg-dialog-option-label' }, t(`icon.${icon}`))
      )
    }
    bodyNodes.push(
      h(
        ScrollArea,
        {
          className: 'dsg-icon-sections',
          'data-testid': 'session-groups-dialog-options',
          'aria-label': t('group.icon'),
        },
        ...sections.map((section, index) =>
          h(
            'section',
            {
              key: section.key,
              class: 'dsg-icon-section',
              'data-icon-group': section.key,
              'aria-label': t(section.labelKey),
            },
            h(
              'div',
              { class: 'dsg-icon-section-title' },
              t(section.labelKey)
            ),
            h(
              'div',
              {
                class: 'dsg-menu dsg-dialog-icon-grid',
                role: 'radiogroup',
                'aria-label': t(section.labelKey),
              },
              ...section.icons.map(iconButton)
            )
          )
        )
      )
    )
  }
  if (dialog.kind === 'group-color') {
    const customActive = isColorHex(selection)
    const hexValid = normalizeColorHex(hexInput) !== null
    const nativeValue = normalizeColorHex(hexInput) ?? (isColorHex(selection) ? selection : GROUP_COLOR_HEX[selection] ?? GROUP_COLOR_HEX.blue)
    const pickPreset = (color) => {
      setSelection(color)
      setHexInput('')
    }
    const changeHex = (raw) => {
      setHexInput(raw)
      const hex = normalizeColorHex(raw)
      setSelection(hex ?? undefined)
    }
    const pickNative = (raw) => {
      const hex = normalizeColorHex(raw)
      if (!hex) return
      setHexInput(hex)
      setSelection(hex)
    }
    const hint = hexInput.trim() === '' || hexValid ? t('color.hint') : t('color.invalidHex')
    bodyNodes.push(
      h(
        'div',
        {
          class: 'dsg-color-grid',
          role: 'radiogroup',
          'data-testid': 'session-groups-dialog-options',
          'aria-label': t('dialog.groupColor'),
        },
        ...GROUP_COLORS.map((color) => {
          const active = selection === color
          return h(
            'button',
            {
              key: color,
              type: 'button',
              role: 'radio',
              'aria-checked': active ? 'true' : 'false',
              class: 'dsg-dialog-option dsg-color-option',
              'data-testid': 'session-groups-dialog-color',
              'data-color': color,
              'data-selected': active ? 'true' : 'false',
              title: t(`color.${color}`),
              onClick: (event) => {
                event.stopPropagation()
                pickPreset(color)
              },
            },
            h('span', { class: 'dsg-color-swatch', 'aria-hidden': 'true', style: { background: `var(--dsg-color-${color})` } }),
            h('span', { class: 'dsg-dialog-option-label' }, t(`color.${color}`)),
            // 0.2.7: the check slot is always present and only hidden, so the
            // label column never shifts when selection moves between cells.
            h(
              'span',
              {
                class: 'dsg-dialog-option-check',
                'data-testid': 'session-groups-dialog-color-check',
                'data-empty': active ? 'false' : 'true',
                'aria-hidden': 'true',
                style: { visibility: active ? 'visible' : 'hidden' },
              },
              renderGlyph(h, 'check', 16)
            )
          )
        })
      )
    )
    bodyNodes.push(
      h(
        'div',
        { class: 'dsg-color-custom-row', 'data-selected': customActive ? 'true' : 'false' },
        h('span', { class: 'dsg-color-custom-label' }, t('color.custom')),
        h('input', {
          type: 'color',
          class: 'dsg-color-native',
          'data-testid': 'session-groups-dialog-color-native',
          'aria-label': t('color.custom'),
          value: nativeValue,
          onChange: (event) => pickNative(event.target.value),
        }),
        h('input', {
          type: 'text',
          class: 'dsg-dialog-input dsg-color-hex',
          'data-testid': 'session-groups-dialog-color-hex',
          maxlength: '7',
          spellcheck: 'false',
          autocomplete: 'off',
          placeholder: '#RRGGBB',
          'aria-label': t('color.customHex'),
          value: hexInput,
          onChange: (event) => changeHex(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Escape') close()
          },
        })
      )
    )
    bodyNodes.push(
      h(
        'div',
        {
          class: 'dsg-color-hint',
          'data-testid': 'session-groups-dialog-color-hint',
          'data-tone': hexInput.trim() !== '' && !hexValid ? 'error' : 'hint',
          'aria-live': 'polite',
        },
        hint
      )
    )
  }
  const needsInput = dialog.kind === 'new-group' || dialog.kind === 'rename-group' || dialog.kind === 'rename-session'
  const selectable = isSelectionDialog(dialog.kind)
  const danger = dialog.kind === 'delete-group' || dialog.kind === 'archive-running'
  const canConfirm = needsInput ? value.trim().length > 0 : selectable ? selectionIsValid(dialog, selection, store.doc) : true
  return h(
    'div',
    {
      class: 'dsg-dialog-backdrop',
      // Backdrop click deliberately does not close independent dialogs. The
      // user closes via Cancel/Escape or the explicit action.
    },
    h(
      'div',
      {
        ref: dialogRef,
        class: 'dsg-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'data-testid': 'session-groups-dialog',
        'data-kind': dialog.kind,
        'data-positioned': dialogRect ? 'true' : 'false',
        style: dialogRect
          ? {
              left: `${dialogRect.x}px`,
              top: `${dialogRect.y}px`,
              width: `${dialogRect.width}px`,
              height: `${dialogRect.height}px`,
            }
          : undefined,
      },
      h(
        'div',
        {
          class: 'dsg-dialog-titlebar',
          onPointerDown: (event) => beginDialogGesture(event),
        },
        h('div', { class: 'dsg-dialog-title' }, title)
      ),
      h(
        ScrollArea,
        { className: 'dsg-dialog-content' },
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
        errorText ? h('div', { class: 'dsg-dialog-error' }, errorText) : null
      ),
      h(
        'div',
        { class: 'dsg-dialog-actions' },
        h('button', { type: 'button', class: 'dsg-dialog-cancel', onClick: close }, t('dialog.cancel')),
        h(
          'button',
          {
            type: 'button',
            class: 'dsg-dialog-confirm',
            'data-testid': 'session-groups-dialog-confirm',
            'data-variant': danger ? 'danger' : 'primary',
            disabled: !canConfirm,
            onClick: () =>
              confirm(needsInput ? { value: value.trim() } : selectable ? dialogConfirmPayload(dialog, selection) : {}),
          },
          danger ? (dialog.kind === 'delete-group' ? t('dialog.moveAndDelete') : t('dialog.stopAndArchive')) : t('dialog.confirm')
        )
      ),
      ...['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) =>
        h('div', {
          key: dir,
          class: 'dsg-dialog-resizer',
          'data-dir': dir,
          'aria-hidden': 'true',
          onPointerDown: (event) => beginDialogGesture(event, dir),
        })
      )
    )
  )
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
          h(SessionStatusCell, { statuses: [], hidden: true }),
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
  const perfRenderStart = perfEnabled() ? perfNow() : 0
  perfRender('GroupsView')
  diagRender('GroupsView')

  // Framework standard hooks: always called (rules of hooks), feature-detected.
  const sessions = typeof props?.useSessions === 'function' ? props.useSessions((snapshot) => snapshot, sessionViewEqual) : null
  const workspaces = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces((snapshot) => snapshot, workspaceViewEqual) : null
  const statuses = typeof props?.useSessionStatus === 'function' ? props.useSessionStatus((snapshot) => snapshot, statusMapEqual) : null
  const subagentCounts = useMemo(() => runningSubagentCounts(sessions, statuses), [sessions, statuses])
  const statusBuckets = useMemo(
    () =>
      statusSectionsByGroup(
        store?.doc,
        sessions?.byId ?? {},
        statuses,
        workspaces?.archivedSessionIds ?? [],
        subagentCounts
      ),
    [store?.doc, sessions?.byId, statuses, workspaces?.archivedSessionIds, subagentCounts]
  )
  const runningSessions = statusBuckets.running
  const blockedSessions = statusBuckets.blocked
  const unreadSessions = statusBuckets.unread

  const byId = sessions?.byId ?? {}
  const workspaceItems = workspaces?.items ?? []
  const archivedSessionIds = Array.isArray(workspaces?.archivedSessionIds) ? workspaces.archivedSessionIds : []
  const currentId = mainSessionIdOf(sessions)
  const highlightCurrent = currentId
  const tree = useMemo(
    () =>
      store
        ? buildVisibleTree(store.doc, byId, workspaceItems, {
            archivedSessionIds,
            filter: store.archiveFilter,
            currentSessionId: highlightCurrent,
            statuses: statuses instanceof Map ? statuses : null,
            subagentCounts,
          })
        : { groups: [], ungrouped: [] },
    [store?.doc, store?.archiveFilter, byId, workspaceItems, archivedSessionIds, highlightCurrent, statuses, subagentCounts]
  )

  const [dragState, setDragState] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  // Latest committed target, compared with stable equality before every React
  // update. Dragover fires continuously while the pointer rests on one row and
  // rebuilds an equivalent object each time; updating state unconditionally
  // re-rendered the whole tree on every event (0.2.2 perf probe: 48 renders for
  // 45 stationary dragovers, 800 SessionRow renders for 30 paced dragovers).
  const dropTargetRef = useRef(null)

  /**
   * Drop-target setter used by every drag handler: skips React when the stable
   * target descriptor is unchanged. The opt-in probe records set attempts and
   * the ones that actually changed the rendered target.
   */
  const setDropTargetTracked = (next) => {
    if (next === null) dragTargetLockRef.current = null
    if (sameDropTarget(dropTargetRef.current, next)) {
      if (perfEnabled()) perfDropTarget(false)
      return
    }
    // Diagnostics: record the stable target transition before React updates; the
    // helper also emits placeholder insert/remove for the placeholder kinds.
    if (diagEnabled()) diagTargetChange(dropTargetRef.current, next)
    dropTargetRef.current = next
    if (!perfEnabled()) {
      setDropTarget(next)
      return
    }
    const started = perfNow()
    setDropTarget(next)
    perfDropTarget(true, perfNow() - started)
  }
  // Search highlight is a transient DOM class (1.5 s) on the revealed row: the
  // rows are plain React nodes and the class must survive the host-triggered
  // re-render right after openSession without adding new view-store state.
  const searchHitTimerRef = useRef(null)
  const searchHitRowRef = useRef(null)
  const autoExpandRef = useRef({ groupId: null, timer: null })
  const dragRef = useRef(null)
  const dragTargetLockRef = useRef(null)
  const suppressedClickRef = useRef(null)
  // Pointerdown origin for the group row: a dragstart always targets the
  // draggable row, so the button check must be captured on pointerdown (where the
  // target really is the `+`/`…` button) and consumed by onGroupDragStart.
  const buttonPointerRef = useRef(null)
  dragRef.current = dragState

  /** Locked target for the current resting pointer position (0.2.21). */
  const stickyTargetFor = (event) =>
    stickyDropTarget(dragTargetLockRef.current, event?.clientX, event?.clientY)
  const lockTargetAt = (event, target) => {
    if (!target || !event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
    dragTargetLockRef.current = { x: event.clientX, y: event.clientY, target }
  }

  // Sidebar width override state. `preferredWidth` is the persisted preference;
  // the applied width is always its viewport clamp, so a narrow viewport never
  // destroys the stored preference.
  const rootRef = useRef(null)
  /** True only when the drag pointer is definitely outside the sidebar root. */
  const pointerOutsideRoot = (event) => {
    const root = rootRef.current
    const rect = root?.getBoundingClientRect?.()
    if (!rect) return false
    const x = event?.clientX
    const y = event?.clientY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
  }
  // Imperative bridge to the virtualized ungrouped list (search reveal).
  const virtualRef = useRef(null)
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

  usePerfCommit('groups-view', perfRenderStart)

  if (!wide) return h(Rail, { props })

  if (store === null) return h('div', { class: 'dsg-root', 'data-testid': 'session-groups-view' }, t('flat.title'))

  // Flat fallback for load/route/commit failures (CONTRACTS §6).
  if (store.docState === 'error') return h(FlatFallback, { props, store, reason: store.banner?.code === 'route-unavailable' ? 'route-unavailable' : 'error' })

  const ungroupedCount = tree.ungrouped.length
  // Diagnostics run context: every traced event carries the current revision,
  // optimistic flag, tree counts, viewport and applied sidebar width. Building
  // the patch object is skipped entirely when diagnostics are off.
  if (diagEnabled()) {
    diagContext({
      mode: store.viewMode,
      revision: store.revision,
      optimistic: store.optimistic === true,
      groups: store.doc.groups.length,
      ungrouped: ungroupedCount,
      visibleSessions: countTreeSessions(tree),
      viewport: globalThis.innerWidth || viewportWidth,
      sidebarWidth: appliedWidth,
    })
  }
  // Row components read current/drop state; merge it into the snapshot handed down.
  const viewState = {
    ...store,
    currentSessionId: highlightCurrent,
    dropTarget,
    draggedGroupId: dragState?.kind === 'group' ? dragState.groupId : null,
  }

  const commitDrop = async (source, target) => {
    perfMark('commitDrop:start', { kind: target?.kind ?? null })
    if (diagEnabled()) {
      const accepted = Boolean(source && target && target.kind !== 'invalid')
      diagTrace(accepted ? 'drop.accept' : 'drop.reject', {
        dragKind: source?.kind ?? null,
        kind: target?.kind ?? null,
        sessionId: source?.sessionId ?? null,
        targetSessionId: target?.sessionId ?? null,
        groupId: target?.groupId ?? null,
      })
      diagDropState(accepted ? 'accepted' : 'invalid', { kind: target?.kind ?? null })
    }
    setDropTargetTracked(null)
    setDragState(null)
    if (!source || !target || target.kind === 'invalid') return
    const visibleUngrouped = tree.ungrouped.map((node) => node.session.id)
    try {
      // Optimistic (0.2.4): resolve against the current optimistic doc so the
      // row moves in this tick; the queue persists/coalesces/reconciles async.
      await rt()?.commitOptimistic((currentDoc) => applyDrop(currentDoc, source, target, visibleUngrouped).doc)
    } catch (error) {
      if (error?.reported === true) return
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
    perfMark('commitGroupDrop:start', { kind: target?.kind ?? null })
    if (diagEnabled()) {
      diagTrace('drop.accept', {
        dragKind: 'group',
        kind: target?.kind ?? null,
        groupId: draggedId,
        targetId: target?.targetId ?? null,
        parentId: target?.parentId ?? null,
        beforeGroupId: target?.beforeGroupId ?? null,
      })
      diagDropState('accepted', { kind: target?.kind ?? null })
    }
    setDropTargetTracked(null)
    setDragState(null)
    dragRef.current = null
    rt()?.setFloatingLabel?.(null)
    try {
      await rt()?.commitOptimistic((latest) => {
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
      if (error?.reported === true) return
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
    const task = rt()?.commitOptimistic((latest) => {
      const group = findGroup(latest, groupId)
      if (!group) throw GROUP_DROP_NOOP
      const siblings = childrenOf(latest, group.parentId)
      const currentIndex = siblings.findIndex((item) => item.id === groupId)
      const nextIndex = currentIndex + delta
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= siblings.length) throw GROUP_DROP_NOOP
      return moveGroup(latest, groupId, group.parentId, nextIndex)
    })
    task?.catch((error) => {
      if (error === GROUP_DROP_NOOP || error?.reported === true) return
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] group move failed', error)
    })
  }

  const clearAutoExpand = () => {
    const current = autoExpandRef.current
    if (current.timer !== null) clearTimeout(current.timer)
    if (current.timer !== null && diagEnabled()) diagTrace('autoexpand.cancel', { groupId: current.groupId })
    autoExpandRef.current = { groupId: null, timer: null }
  }

  const scheduleAutoExpand = (groupId) => {
    const collapsedNow = !isExpanded(store.collapsed, groupId)
    if (!collapsedNow) return clearAutoExpand()
    const current = autoExpandRef.current
    if (current.groupId === groupId && current.timer !== null) return
    clearAutoExpand()
    if (diagEnabled()) diagTrace('autoexpand.schedule', { groupId, delayMs: 500 })
    const timer = setTimeout(() => {
      if (diagEnabled()) diagTrace('autoexpand.fire', { groupId })
      dispatch('expand-group', { id: groupId })
      autoExpandRef.current = { groupId: null, timer: null }
    }, 500)
    autoExpandRef.current = { groupId, timer }
  }

  const rowDragOver = (event, target) => {
    const drag = dragRef.current
    if (!drag) return
    const sticky = stickyTargetFor(event)
    if (sticky) {
      // The placeholder itself moved the row under the pointer. Keep the
      // already-rendered target until the pointer deliberately moves.
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setDropTargetTracked(target)
    lockTargetAt(event, target)
  }

  const ungroupedBodyRows = (container) =>
    [...(container?.querySelectorAll?.('[data-session-id]') ?? [])].map((row) => {
      const rect = row.getBoundingClientRect()
      return { sessionId: row.getAttribute('data-session-id'), top: rect.top, height: rect.height }
    })

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
    if (stickyTargetFor(event)) {
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      return
    }
    const resolved = resolveGroupDrop({ doc: store.doc, draggedId, target: resolveTargetFor(viewTarget) })
    if (resolved.invalid) {
      setDropTargetTracked({ ...viewTarget, kind: 'group-forbidden' })
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
   * the first frame after the collapsed update, so retry for up to eight frames;
   * add `dsg-search-hit` for 1.5 s; scroll with
   * `scrollTop + (row.top - tree.top) - 0.3 * tree.clientHeight`, clamped to the
   * scrollable range. When the target is an ungrouped row outside the current
   * virtual window, the window is forced forward first so the row can mount.
   * A row that never appears (orphan / filtered out) is a no-op: no scroll, no
   * highlight, no throw.
   */
  const revealSearchRow = (sessionId) => {
    const root = rootRef.current
    const ungroupedIndex = tree.ungrouped.findIndex((child) => child.session.id === sessionId)
    let attempts = 0
    const tick = () => {
      // The section may mount one frame after the collapsed update (search on a
      // collapsed ungrouped inbox), so re-check the controller every retry.
      if (ungroupedIndex >= 0) {
        const controller = virtualRef.current
        if (controller && !controller.isVisible(ungroupedIndex)) controller.scrollToIndex(ungroupedIndex)
      }
      const treeElement = root?.querySelector?.('.dsg-tree')
      const row = treeElement
        ? Array.from(treeElement.querySelectorAll('[data-session-id]')).find((element) => element.getAttribute('data-session-id') === sessionId)
        : null
      if (!treeElement || !row) {
        attempts += 1
        if (attempts <= 8) requestAnimationFrame(tick)
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
      const treeRect = treeElement.getBoundingClientRect()
      const maxScroll = Math.max(0, treeElement.scrollHeight - treeElement.clientHeight)
      const next = Math.min(Math.max(0, treeElement.scrollTop + (rowRect.top - treeRect.top) - treeElement.clientHeight * 0.3), maxScroll)
      treeElement.scrollTop = next
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
    retryLoad: () => rt()?.retryLoad(),
    openSession: (id) => rt()?.actions.openSession(id),
    setArchiveFilter: (filter) => dispatch('archive-filter', { filter }),
    searchSelect: (entry) => selectSearchResult(entry),
    openRunningSession: (sessionId, archived) => selectSearchResult({ sessionId, archived }),
    searchArchived: () => toast('info', t('search.archivedDisabled')),
    openNewGroup: (event, parentId) => rt()?.openDialog({ kind: 'new-group', parentId, titleKey: parentId ? 'dialog.newSubgroup' : 'dialog.newGroup' }),
    openRenameGroup: (groupId) => rt()?.openDialog({ kind: 'rename-group', groupId, titleKey: 'dialog.renameGroup', value: findGroup(store.doc, groupId)?.name ?? '' }),
    openIconGroup: (groupId) =>
      rt()?.openDialog({
        kind: 'icon',
        groupId,
        titleKey: 'group.icon',
        icons: [...GROUP_ICONS],
        current: currentIconOf(store.doc, groupId),
      }),
    openGroupColor: (groupId) =>
      rt()?.openDialog({
        kind: 'group-color',
        groupId,
        titleKey: 'dialog.groupColor',
        current: currentColorOf(store.doc, groupId),
        currentHex: currentColorHexOf(store.doc, groupId),
      }),
    openMoveGroup: (groupId) =>
      rt()?.openDialog({ kind: 'move-group', groupId, titleKey: 'dialog.moveTo', currentId: currentParentOf(store.doc, groupId) }),
    openDeleteGroup: (groupId) => {
      const group = findGroup(store.doc, groupId)
      if (!group) return undefined
      // 0.2.9: an empty leaf deletes immediately (no dialog, toast only); any
      // direct sessions or child groups require an explicit destination.
      if (!deleteGroupNeedsDialog(store.doc, groupId)) return rt()?.deleteGroupDirect?.(groupId)
      rt()?.openDialog({
        kind: 'delete-group',
        groupId,
        titleKey: 'dialog.deleteGroup',
        sessionCount: group.sessionIds.length,
        childCount: childrenOf(store.doc, groupId).length,
      })
      return undefined
    },
    openSessionMenu: (event, sessionNode) => {
      const row = sessionNode.session
      const point = menuAnchorFromEvent(event)
      dispatch('menu', {
        menu: {
          kind: 'session',
          x: point.x,
          y: point.y,
          anchorX: point.anchorX,
          anchorY: point.anchorY,
          sessionId: row.id,
          title: sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }),
          archived: sessionNode.archived === true,
          pinned: false,
        },
      })
    },
    openSessionMenuAtRow: (rowElement, sessionNode) => {
      const row = sessionNode.session
      const point = menuAnchorFromRow(rowElement)
      dispatch('menu', {
        menu: {
          kind: 'session',
          x: point.x,
          y: point.y,
          anchorX: point.anchorX,
          anchorY: point.anchorY,
          sessionId: row.id,
          title: sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }),
          archived: sessionNode.archived === true,
          pinned: false,
        },
      })
    },
    onSessionContextMenu: (event, sessionNode) => {
      event.preventDefault()
      event.stopPropagation()
      if (dragRef.current) return
      handlers.openSessionMenu(event, sessionNode)
    },
    openGroupMenu: (event, group) => {
      const point = menuAnchorFromEvent(event)
      dispatch('menu', {
        menu: {
          kind: 'group',
          x: point.x,
          y: point.y,
          anchorX: point.anchorX,
          anchorY: point.anchorY,
          groupId: group.id,
        },
      })
    },
    openGroupMenuAtRow: (rowElement, group) => {
      const point = menuAnchorFromRow(rowElement)
      dispatch('menu', {
        menu: {
          kind: 'group',
          x: point.x,
          y: point.y,
          anchorX: point.anchorX,
          anchorY: point.anchorY,
          groupId: group.id,
        },
      })
    },
    onGroupContextMenu: (event, group) => {
      event.preventDefault()
      event.stopPropagation()
      if (dragRef.current) return
      handlers.openGroupMenu(event, group)
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
    openMoveSession: (sessionId) =>
      rt()?.openDialog({ kind: 'move-session', sessionId, titleKey: 'dialog.moveTo', currentId: currentGroupIdOf(store.doc, sessionId) }),
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
      // Never trace the session title: the id is the only session identity in
      // the diagnostics file (privacy rule in diagnostics.js).
      if (diagEnabled()) diagDragStart('session', { sessionId })
      suppressedClickRef.current = null
      dragTargetLockRef.current = null
      setDragState(dragRef.current)
      rt()?.startDragLabel?.(dragRef.current.label)
    },
    onGroupPointerDown: (event, group) => {
      const target = event.target
      const insideButton = target && typeof target.closest === 'function' && target.closest('button')
      if (!insideButton) {
        buttonPointerRef.current = null
        return
      }
      const marker = { groupId: group.id, at: Date.now() }
      buttonPointerRef.current = marker
      const doc = globalThis.document
      const clear = () => {
        if (buttonPointerRef.current === marker) buttonPointerRef.current = null
        doc?.removeEventListener?.('pointerup', clear, true)
        doc?.removeEventListener?.('pointercancel', clear, true)
      }
      doc?.addEventListener?.('pointerup', clear, true)
      doc?.addEventListener?.('pointercancel', clear, true)
    },
    onGroupDragStart: (event, group) => {
      // A dragstart always targets the draggable row, never the inner button, so
      // the origin is remembered from pointerdown. Without this, a slight
      // movement while pressing `+`/`…` starts a real group drag (and its drop
      // can reorder/reparent) even though the click is suppressed afterwards.
      const pointer = buttonPointerRef.current
      buttonPointerRef.current = null
      const fromButton =
        pointer !== null && pointer !== undefined && pointer.groupId === group.id && Date.now() - pointer.at <= 5000
      const origin = event.target
      const originIsButton = origin && typeof origin.closest === 'function' && origin.closest('button')
      if (fromButton || originIsButton) {
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
      if (diagEnabled()) diagDragStart('group', { groupId: group.id, name: group.name })
      suppressedClickRef.current = { groupId: group.id, at: Date.now() }
      dragTargetLockRef.current = null
      setDragState(drag)
      setDropTargetTracked(null)
      rt()?.startDragLabel?.(group.name)
    },
    onDragEnd: () => {
      if (diagEnabled()) diagDragEnd()
      buttonPointerRef.current = null
      clearAutoExpand()
      dragRef.current = null
      setDragState(null)
      setDropTargetTracked(null)
      rt()?.setFloatingLabel?.(null)
    },
    /**
     * Clear the insertion placeholder as soon as the pointer leaves the row.
     * Moving into a child of the same row (or into the placeholder that is
     * pushing the row) must not clear it, otherwise the layout would oscillate.
     */
    onDragLeave: (event) => {
      if (!dragRef.current) return
      // Layout shift can fire dragleave on the row that just moved; a stationary
      // pointer must not tear down the locked placeholder.
      if (stickyTargetFor(event)) return
      const current = event?.currentTarget
      const next = event?.relatedTarget
      if (current && next && typeof current.contains === 'function' && current.contains(next)) return
      if (next && typeof next.closest === 'function' && next.closest('.dsg-drop-placeholder')) return
      // Moving between rows/gaps inside one group body must not remove the
      // placeholder; the next row's dragover will retarget it.
      if (next && typeof next.closest === 'function' && next.closest('.dsg-group-line')) return
      // A dragleave between rows/gaps is a transient boundary, not leaving the
      // sidebar. Clearing here removed the placeholder for one frame and the
      // next dragover reinserted it at the same place (visible flicker).
      if (!pointerOutsideRoot(event)) return
      clearAutoExpand()
      setDropTargetTracked(null)
      rt()?.setFloatingLabel?.(null)
    },
    onPlaceholderDragOver: (event) => {
      if (!dragRef.current) return
      // Keep the resolved target alive while the pointer is over the gap.
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    },
    onPlaceholderDrop: (event, target) => {
      const drag = dragRef.current
      if (!drag) return
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      if (drag.kind === 'group') {
        const resolved = resolveTargetFor(target)
        if (!resolved) return
        commitGroupDrop(drag.groupId, resolved)
        return
      }
      commitDrop(drag, target)
    },
    onDragOverSession: (event, sessionId, groupId, ungrouped) => {
      const drag = dragRef.current
      if (!drag || drag.kind !== 'session') return
      if (stickyTargetFor(event)) {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        return
      }
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
        // Never let a self-row/unknown-row invalid target fall through to the
        // wider ungrouped body handler: that handler used to retarget the drop
        // to the top of the ungrouped list and made the placeholder oscillate.
        event.preventDefault()
        event.stopPropagation()
        if (targetSessionId !== sessionId) {
          setDropTargetTracked(null)
        }
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
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
      const sticky = stickyTargetFor(event)
      if (sticky) {
        clearAutoExpand()
        rt()?.setFloatingLabel?.(null)
        return commitDrop(drag, sticky)
      }
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
      const sticky = stickyTargetFor(event)
      if (sticky) {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = sticky.kind === 'group-forbidden' ? 'none' : 'move'
        return
      }
      if (drag.kind === 'group') {
        const name = findGroup(store.doc, groupId)?.name ?? ''
        const zone = groupHeaderZone(event.currentTarget, event.clientY)
        if (zone === null) {
          setDropTargetTracked({ kind: 'group-forbidden', targetId: groupId })
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
        setDropTargetTracked(null)
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
      // The line also owns the tiny gaps between session rows. A gap is not a
      // "group head" drop zone: treating it as one made the placeholder jump to
      // the group top while the pointer slowly crossed a 2px gap. Only the area
      // above the first visible session is the group-head zone.
      const firstRow = event.currentTarget?.querySelector?.('[data-session-id]')
      const firstRect = firstRow?.getBoundingClientRect?.()
      if (firstRect && Number.isFinite(firstRect.top) && event.clientY >= firstRect.top) {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        return
      }
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
        // The implicit ungrouped inbox is session-only. It is not a custom-group
        // parent, so a group drag never paints an insertion target here.
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        setDropTargetTracked(null)
        rt()?.setFloatingLabel?.(t('ungrouped.sessionsOnly'))
        return
      }
      // Header only: this is the explicit "top of ungrouped" target.
      rowDragOver(event, { kind: 'ungrouped' })
      rt()?.setFloatingLabel?.('移出分组')
    },
    /**
     * Body-level fallback for virtual gaps/spacers. A session row owns its own
     * dragover; this handler only sees gaps and empty body space, so it must
     * resolve against visible rows rather than jumping to the section top.
     */
    onDragOverUngroupedBody: (event) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        setDropTargetTracked(null)
        rt()?.setFloatingLabel?.(t('ungrouped.sessionsOnly'))
        return
      }
      if (event.target?.closest?.('[data-session-id], .dsg-drop-placeholder')) return
      const target = ungroupedBodyTarget(ungroupedBodyRows(event.currentTarget), event.clientY)
      rowDragOver(event, target)
      rt()?.setFloatingLabel?.('移出分组')
    },
    onDropUngrouped: (event) => {
      const drag = dragRef.current
      if (drag?.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        setDropTargetTracked(null)
        clearAutoExpand()
        rt()?.setFloatingLabel?.(null)
        toast('info', t('ungrouped.sessionsOnly'))
        return
      }
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      // Header drop is always the explicit top-of-section target.
      commitDrop(drag, { kind: 'ungrouped' })
    },
    onDropUngroupedBody: (event) => {
      const drag = dragRef.current
      if (drag?.kind === 'group') {
        event.preventDefault()
        event.stopPropagation()
        setDropTargetTracked(null)
        clearAutoExpand()
        rt()?.setFloatingLabel?.(null)
        toast('info', t('ungrouped.sessionsOnly'))
        return
      }
      event.preventDefault()
      event.stopPropagation()
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      const current = dropTargetRef.current
      const target =
        current && (current.kind === 'session-before' || current.kind === 'session-after' || current.kind === 'ungrouped')
          ? current
          : ungroupedBodyTarget(ungroupedBodyRows(event.currentTarget), event.clientY)
      commitDrop(drag, target)
    },
  }

  // Time every drag handler for the opt-in perf probe and for diagnostics
  // (0.2.5, default on). Handlers stay unwrapped when both are off.
  if (perfEnabled() || diagEnabled()) {
    const isDragHandler = (name) =>
      name.startsWith('onDrag') ||
      name.startsWith('onDrop') ||
      name.startsWith('onGroupDrag') ||
      name.startsWith('onPlaceholderDrag') ||
      name.startsWith('onPlaceholderDrop')
    for (const name of Object.keys(handlers)) {
      if (!isDragHandler(name)) continue
      const original = handlers[name]
      handlers[name] = (event, ...args) => {
        const timed = perfEnabled() || diagEnabled()
        const started = timed ? perfNow() : 0
        try {
          return original(event, ...args)
        } finally {
          if (!timed) return
          const elapsed = perfNow() - started
          if (diagEnabled()) diagHandler(name, elapsed, event)
          if (!perfEnabled()) return
          if (name.startsWith('onDragOver')) {
            perfDragOver(name.slice(2), elapsed)
          } else if (name.startsWith('onDrop')) {
            perfSample('dropHandlerMs', elapsed)
            perfMark('drop:event', { handler: name, ms: Math.round(elapsed * 100) / 100 })
          }
        }
      }
    }
  }

  // 0.2.20: stable handler facade for memoized rows. Every call reads the
  // latest render's closure, so memoization cannot dispatch stale drag/doc data.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const stableHandlers = useMemo(() => {
    const proxy = {}
    for (const handlerName of Object.keys(handlersRef.current)) {
      proxy[handlerName] = (...args) => handlersRef.current[handlerName]?.(...args)
    }
    return proxy
  }, [])

  return h(
    'div',
    { ref: rootRef, class: 'dsg-root', 'data-testid': 'session-groups-view', 'data-mode': store.viewMode, 'data-wide': 'true', 'data-narrow': appliedWidth !== null && appliedWidth <= 320 ? 'true' : 'false', 'data-optimistic': store.optimistic ? 'true' : 'false' },
    h(Header, { store: viewState, handlers: stableHandlers, sessionsById: byId, workspaces: workspaceItems, archivedSessionIds, runningSessions, blockedSessions, unreadSessions }),
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
    h(Banner, { store, handlers: stableHandlers }),
    store.docState === 'loading'
      ? h('div', { class: 'dsg-empty' }, t('flat.title'))
      : h(
          'div',
          { class: 'dsg-tree', role: 'tree', 'aria-label': t('view.title') },
          h(UngroupedSection, { node: tree.ungrouped, store: viewState, props, handlers: stableHandlers, virtualRef }),
          ...tree.groups.map((node) => h(GroupNode, { key: node.group.id, node, depth: 0, props, handlers: stableHandlers, store: viewState })),
          // Group dragged to the root end: a group-row-height placeholder after
          // the last group makes the insertion point unmistakable.
          dropTarget?.kind === 'group-root-end'
            ? h(DropPlaceholder, { target: dropTarget, store: viewState, handlers: stableHandlers, height: GROUP_PLACEHOLDER_HEIGHT })
            : null
        ),
    h(Toast, { store }),
    h(MenuPopover, { store, handlers: stableHandlers }),
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

// Keep the module-level runtime reachable for plugin.js helpers.
export const __internal = { findGroupsFlat, currentGroupIdOf }

