/**
 * React components for the groups sidebar (plain `createElement`, no JSX).
 *
 * Components are registered into DSH slots and receive the framework standard
 * toolkit as props (`useSessions`, `useWorkspaces`, `useSessionStatus`,
 * `usePanelInfo`, `…`) plus the slot owner share. Everything host-derived is read
 * from those hooks; the only local state is this plugin's view store.
 */
import { createElement, useCallback, useEffect, useSyncExternalStore } from 'react'
import { clientRuntime as rt } from '../adapters/client-runtime.js'
import { statusLabel } from '../core/session-row.js'
import { findGroup, moveGroup } from '../shared/model.js'
import { resolveGroupDrop } from '../core/group-drag.js'
import { renderGlyph, renderHeaderIcon } from './icons.js'
import { isMenuKey } from '../core/menu-position.js'
import { perfEnabled, perfMark, perfNow } from './perf.js'
import { relativeTimeParts } from './time.js'


const h = createElement

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
const GROUP_DROP_NOOP = Symbol('dsh-session-grove/group-drop-noop')

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
const statusText = (status) => statusLabel(status, rt()?.t)

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

/**
 * Relative updated-time label + absolute tooltip. Missing/invalid timestamps
 * return null so the row omits the element entirely (0.2.7).
 */
const sessionTime = (updatedAt) => {
  const parts = relativeTimeParts(updatedAt)
  if (!parts) return null
  const t = rt()?.t ?? ((key) => key)
  const label = parts.unit === 'justNow' ? t('time.justNow') : t(`time.${parts.unit}`, { n: parts.value })
  return { label, title: rt()?.formatAbsoluteTime?.(updatedAt) ?? label }
}

/** Shift+F10 / ContextMenu opens the row menu; Enter/Space keep their own action. */
const menuKeyHandler = (event, open) => {
  if (!isMenuKey(event)) return false
  event.preventDefault()
  event.stopPropagation()
  open(event.currentTarget)
  return true
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

export {
  useViewStore, classNames, usePerfCommit, dispatch, toast, IconButton, TextButton,
  StatusSpinner, StatusDot, SessionStatusCell, sessionTime, menuKeyHandler,
  DropPlaceholder, EmptyDropBox, SESSION_PLACEHOLDER_HEIGHT, GROUP_PLACEHOLDER_HEIGHT,
}
