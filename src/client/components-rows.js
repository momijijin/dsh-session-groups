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

import { SessionStatusCell, sessionTime, menuKeyHandler, DropPlaceholder, EmptyDropBox, IconButton, GROUP_PLACEHOLDER_HEIGHT, SESSION_PLACEHOLDER_HEIGHT } from './components-primitives.js'

const h = createElement

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
      archived
        ? rt()?.capabilities.unarchive === true
          ? IconButton({
              label: rt()?.t('session.unarchive'),
              glyph: 'unarchive',
              testId: 'session-groups-session-archive',
              data: { 'data-session-id': sessionId, 'data-archived': 'true' },
              onClick: () => handlers.unarchiveSession(sessionId),
            })
          : null
        : rt()?.capabilities.archive === true
          ? IconButton({
              label: rt()?.t('session.archive'),
              glyph: 'archive',
              testId: 'session-groups-session-archive',
              data: { 'data-session-id': sessionId, 'data-archived': 'false' },
              onClick: () => handlers.archiveSession(sessionId),
            })
          : null,
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

export { SessionRow, SessionRowImpl, GroupNode, GroupDropSlot }
