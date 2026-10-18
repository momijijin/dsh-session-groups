/**
 * React components for the groups sidebar (plain `createElement`, no JSX).
 *
 * Components are registered into DSH slots and receive the framework standard
 * toolkit as props (`useSessions`, `useWorkspaces`, `useSessionStatus`,
 * `usePanelInfo`, `…`) plus the slot owner share. Everything host-derived is read
 * from those hooks; the only local state is this plugin's view store.
 */
import { Component, createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_GROUP_NAME } from '../shared/constants.js'
import { findGroup } from '../shared/model.js'
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
import { renderGlyph, renderIcon } from './icons.js'
import {
  displayDepth,
  expandAncestors,
  flattenTree,
  groupPath,
  isExpanded,
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
const GroupNode = ({ node, depth, props, handlers, store }) => {
  const group = node.group
  const expanded = isExpanded(store.collapsed, group.id)
  const dropTarget = store.dropTarget
  const isAppendTarget = dropTarget && dropTarget.kind === 'group-append' && dropTarget.groupId === group.id
  const visibleSessions = node.children.filter((child) => child.kind === 'session')
  const childGroups = node.children.filter((child) => child.kind === 'group')
  const notFound = rt()?.t('group.empty')
  return h(
    'div',
    { class: 'dsg-group' },
    h(
      'div',
      {
        class: classNames('dsg-group-row', isAppendTarget && 'dsg-insert-after'),
        role: 'treeitem',
        tabindex: '0',
        'aria-expanded': expanded ? 'true' : 'false',
        'data-testid': 'session-groups-group',
        'data-group-id': group.id,
        'data-depth': String(displayDepth(depth)),
        'data-expanded': expanded ? 'true' : 'false',
        'data-drop-active': isAppendTarget ? 'true' : 'false',
        title: groupPath(store.doc, group.id),
        onClick: () => handlers.toggleGroup(group.id),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handlers.toggleGroup(group.id)
          }
        },
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
            node.visibleCount === 0
              ? h('div', { class: 'dsg-group-empty', 'data-testid': 'session-groups-empty' }, notFound)
              : null,
            ...childGroups.map((child) => h(GroupNode, { key: child.group.id, node: child, depth: depth + 1, props, handlers, store })),
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
  const isDrop = dropTarget && dropTarget.kind === 'ungrouped'
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
            'data-drop-kind': 'ungrouped',
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
// Header / banner / toast / dialogs / menus / rail / footer / flat fallback
// ---------------------------------------------------------------------------
const Header = ({ store, handlers }) => {
  const t = rt()?.t
  const filter = store.archiveFilter
  return h(
    'div',
    { class: 'dsg-header', 'data-testid': 'session-groups-header' },
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
    children.push(item('new-subgroup', t('group.newSubgroup'), () => handlers.openNewGroup(null, menu.groupId)))
    children.push(item('rename', t('group.rename'), () => handlers.openRenameGroup(menu.groupId)))
    children.push(item('icon', t('group.icon'), () => handlers.openIconGroup(menu.groupId)))
    children.push(item('move', t('group.moveTo'), () => handlers.openMoveGroup(menu.groupId)))
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
  const autoExpandRef = useRef({ groupId: null, timer: null })
  const dragRef = useRef(null)
  dragRef.current = dragState

  const t = rt()?.t ?? ((key) => key)

  // Auto-expand ancestors of the current session when the view opens.
  useEffect(() => {
    if (!store || store.docState !== 'ready' || !currentId) return
    const entry = findGroup(store.doc, currentGroupIdOf(store.doc, currentId))
    if (!entry) return
    const ancestors = expandAncestors(store.collapsed, store.doc, entry.id)
    if (ancestors !== store.collapsed) store.update({ collapsed: ancestors })
  }, [currentId, store?.docState, store?.doc])

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
  const viewState = { ...store, currentSessionId: highlightCurrent, dropTarget }

  const commitDrop = async (source, target) => {
    setDropTarget(null)
    setDragState(null)
    if (!source || !target || target.kind === 'invalid') return
    const visibleUngrouped = tree.ungrouped.map((node) => node.session.id)
    const { doc: nextDoc, applied } = applyDrop(store.doc, source, target, visibleUngrouped)
    if (!applied) return
    try {
      await rt()?.commitDoc(nextDoc)
    } catch (error) {
      toast('error', t('toast.dropFailed'))
      if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-groups] drop failed', error)
    }
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

  const handlers = {
    toggleGroup: (id) => dispatch('toggle-group', { id }),
    returnToWorkspace: () => rt()?.setMode('workspace'),
    retryLoad: () => rt()?.retryLoad(),
    openSession: (id) => rt()?.actions.openSession(id),
    setArchiveFilter: (filter) => dispatch('archive-filter', { filter }),
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
      const workspace = workspaceItems.find((item) => (item.sessionIds ?? []).includes(sessionId))
      dragRef.current = { kind: 'session', sessionId, label: sessionTitle(row, { blankLabel: t('session.blank'), untitledLabel: t('session.untitled') }) }
      setDragState(dragRef.current)
      rt()?.startDragLabel?.(dragRef.current.label)
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
      if (!drag) return
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
      event.preventDefault()
      const drag = dragRef.current
      const target = dropTarget
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      if (!drag || !target) return commitDrop(drag, { kind: 'invalid' })
      return commitDrop(drag, target)
    },
    onDragOverGroup: (event, groupId) => {
      const drag = dragRef.current
      if (!drag) return
      rowDragOver(event, { kind: 'group-append', groupId })
      scheduleAutoExpand(groupId)
      rt()?.setFloatingLabel?.(`放入『${findGroup(store.doc, groupId)?.name ?? ''}』`)
    },
    onDropGroup: (event, groupId) => {
      event.preventDefault()
      const drag = dragRef.current
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      commitDrop(drag, { kind: 'group-append', groupId })
    },
    onDragOverGroupHead: (event, groupId) => {
      const drag = dragRef.current
      if (!drag) return
      rowDragOver(event, { kind: 'group-head', groupId })
      scheduleAutoExpand(groupId)
    },
    onDropGroupHead: (event, groupId) => {
      event.preventDefault()
      const drag = dragRef.current
      clearAutoExpand()
      rt()?.setFloatingLabel?.(null)
      commitDrop(drag, { kind: 'group-head', groupId })
    },
    onDragOverUngrouped: (event) => {
      const drag = dragRef.current
      if (!drag) return
      rowDragOver(event, { kind: 'ungrouped' })
      rt()?.setFloatingLabel?.('移出分组')
    },
    onDropUngrouped: (event) => {
      event.preventDefault()
      const drag = dragRef.current
      rt()?.setFloatingLabel?.(null)
      commitDrop(drag, { kind: 'ungrouped' })
    },
  }

  return h(
    'div',
    { class: 'dsg-root', 'data-testid': 'session-groups-view', 'data-mode': store.viewMode, 'data-wide': 'true' },
    h(Header, { store, handlers }),
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
