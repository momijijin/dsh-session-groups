/**
 * Drag & drop model for the groups tree.
 *
 * Pure functions only: `hitTest` maps pointer geometry to a drop target and
 * `applyDrop` maps a target to the next GroupDoc via the shared model mutators.
 * Components own the HTML5 drag events, insertion line, floating label and the
 * 500ms collapsed-group auto-expand timer; they call these functions.
 */
import { assignSession, cloneDoc, findGroup, reorderUngrouped } from '../shared/model.js'

/** Drop-target vocabulary. */
export const DROP_KINDS = Object.freeze([
  'session-before',
  'session-after',
  'group-append',
  'group-head',
  'ungrouped',
  'invalid',
])

/** Rows shorter than this still split into before/after halves. */
const MIN_ROW_HEIGHT = 8

/**
 * Resolve where a session currently lives.
 * @returns {{ groupId: string|null, index: number }}
 */
export const sessionLocation = (doc, sessionId) => {
  const groups = Array.isArray(doc?.groups) ? doc.groups : []
  for (const group of groups) {
    const index = Array.isArray(group.sessionIds) ? group.sessionIds.indexOf(sessionId) : -1
    if (index >= 0) return { groupId: group.id, index }
  }
  const ungrouped = Array.isArray(doc?.ungrouped) ? doc.ungrouped : []
  const index = ungrouped.indexOf(sessionId)
  return { groupId: null, index }
}

/**
 * Map pointer geometry + row identity to a drop target.
 *
 * - session row: top half -> before, bottom half -> after (same group)
 * - group row (header): append to the end of that group
 * - group head area (indent guide at the top of a group body): head of group
 * - ungrouped header / empty area: move out of all groups
 * - dragging over itself or an unknown row: invalid
 *
 * @param {{
 *   source: { kind: 'session', sessionId: string },
 *   rowKind: 'session'|'group'|'ungrouped'|'blank',
 *   pointerY: number,
 *   rowTop: number,
 *   rowHeight: number,
 *   targetGroupId?: string|null,
 *   targetSessionId?: string|null,
 * }} input
 * @returns {{ kind: string, groupId?: string|null, sessionId?: string|null, index?: number }}
 */
export const hitTest = ({ source, rowKind, pointerY, rowTop, rowHeight, targetGroupId = null, targetSessionId = null }) => {
  const sessionId = source?.kind === 'session' ? source.sessionId : null
  if (!sessionId) return { kind: 'invalid' }
  const height = Number.isFinite(rowHeight) && rowHeight > 0 ? Math.max(rowHeight, MIN_ROW_HEIGHT) : MIN_ROW_HEIGHT
  const upper = pointerY <= rowTop + height / 2

  switch (rowKind) {
    case 'session':
      if (!targetSessionId) return { kind: 'invalid' }
      if (targetSessionId === sessionId) return { kind: 'invalid' }
      return {
        kind: upper ? 'session-before' : 'session-after',
        groupId: targetGroupId ?? null,
        sessionId: targetSessionId,
      }
    case 'group':
      if (!targetGroupId) return { kind: 'invalid' }
      return { kind: 'group-append', groupId: targetGroupId }
    case 'group-head':
      if (!targetGroupId) return { kind: 'invalid' }
      return { kind: 'group-head', groupId: targetGroupId }
    case 'ungrouped':
      return { kind: 'ungrouped' }
    default:
      return { kind: 'invalid' }
  }
}

/** Whether `groupId` is the dragged session's current group (before/after same-group reorder). */
const sameGroup = (doc, sessionId, groupId) => sessionLocation(doc, sessionId).groupId === groupId

/**
 * Apply one drop to the doc.
 * @param {object} doc
 * @param {{ kind: 'session', sessionId: string }} source
 * @param {{ kind: string, groupId?: string|null, sessionId?: string|null }} target
 * @param {string[]} [visibleUngrouped] full visible ungrouped order (first reorder writes it)
 * @returns {{ doc: object, applied: boolean }}
 */
export const applyDrop = (doc, source, target, visibleUngrouped = null) => {
  const sessionId = source?.kind === 'session' ? source.sessionId : null
  if (!sessionId || !target || target.kind === 'invalid') return { doc, applied: false }

  switch (target.kind) {
    case 'session-before':
    case 'session-after': {
      if (!target.sessionId || target.sessionId === sessionId) return { doc, applied: false }
      const anchor = sessionLocation(doc, target.sessionId)
      if (anchor.index < 0) return { doc, applied: false }
      const insertAt = target.kind === 'session-before' ? anchor.index : anchor.index + 1
      const moving = sessionLocation(doc, sessionId)
      // Removing the moved id first shifts anchors inside the same list.
      let index = insertAt
      if (moving.groupId === anchor.groupId && moving.index < insertAt) index -= 1
      if (moving.groupId === anchor.groupId && moving.index === index) return { doc, applied: false }
      const next = assignSession(doc, sessionId, anchor.groupId, index)
      return { doc: next, applied: true }
    }
    case 'group-append': {
      const group = findGroup(doc, target.groupId)
      if (!group) return { doc, applied: false }
      const next = assignSession(doc, sessionId, group.id, group.sessionIds.length)
      return { doc: next, applied: true }
    }
    case 'group-head': {
      const group = findGroup(doc, target.groupId)
      if (!group) return { doc, applied: false }
      const next = assignSession(doc, sessionId, group.id, 0)
      return { doc: next, applied: true }
    }
    case 'ungrouped': {
      const moving = sessionLocation(doc, sessionId)
      if (moving.groupId === null && Array.isArray(visibleUngrouped) && visibleUngrouped.length > 0) {
        // Reorder the visible ungrouped list, persisting the manual order.
        const order = visibleUngrouped.filter((id) => id !== sessionId)
        order.unshift(sessionId)
        const next = reorderUngrouped(doc, order)
        return { doc: next, applied: true }
      }
      if (moving.groupId === null) return { doc, applied: false }
      const next = assignSession(doc, sessionId, null, 0)
      return { doc: next, applied: true }
    }
    default:
      return { doc, applied: false }
  }
}

/** Whether a group can accept another group as child without creating a cycle. */
export const canDropGroupInto = (doc, groupId, parentId) => {
  if (!groupId || !parentId) return true
  if (groupId === parentId) return false
  let current = findGroup(doc, parentId)
  const seen = new Set()
  while (current) {
    if (current.parentId === groupId) return false
    if (seen.has(current.id)) return false
    seen.add(current.id)
    current = current.parentId === null ? null : findGroup(doc, current.parentId)
  }
  return true
}

/** Read-only clone helper used by components to preview optimistic drops. */
export const previewDrop = (doc) => cloneDoc(doc)
