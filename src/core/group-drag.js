/**
 * Group drag & drop drop-target resolver.
 *
 * Pure, DOM-free module. The client captures a stable drop-target descriptor
 * while a group header is dragged, then resolves it inside the queued doc
 * updater so the numeric insertion index is always measured against the latest
 * confirmed GroupDoc. The child-slot target therefore carries a `beforeGroupId`
 * anchor instead of a cached index: two rapid drops into the same slot must
 * re-resolve the anchor, never reuse the first drop's number.
 *
 * Resolution never mutates the doc; callers pass the result to
 * `moveGroup(doc, draggedId, parentId, index)` from the shared model.
 */
import { childrenOf, findGroup, isDescendant } from '../shared/model.js'

/** DataTransfer type carrying the dragged group id. */
export const GROUP_DRAG_MIME = 'application/x-dsh-group-id'

/**
 * @typedef {{ parentId: string|null, index: number }} DropPosition
 * @typedef {{ invalid: true, reason: string }} InvalidDrop
 * @typedef {{ kind: 'before'|'after', targetId: string }
 *   | { kind: 'child', parentId: string, beforeGroupId: string|null }
 *   | { kind: 'root-end' }} GroupDropTarget
 */

const invalid = (reason) => ({ invalid: true, reason })

const indexOfId = (groups, groupId) => groups.findIndex((group) => group.id === groupId)

/**
 * Turn a sibling insertion index (measured on the current children array) into
 * the index `moveGroup` expects. `moveGroup` removes the dragged group before
 * inserting it, so a same-parent move that starts before the insertion point
 * shifts the target one slot left.
 *
 * @param {object} doc
 * @param {object} dragged dragged group record
 * @param {string|null} parentId destination parent
 * @param {number} index insertion index on the current children array
 * @returns {DropPosition | InvalidDrop}
 */
const placeAt = (doc, dragged, parentId, index) => {
  if (parentId === dragged.id) return invalid('self')
  if (parentId !== null && isDescendant(doc, parentId, dragged.id)) return invalid('descendant')
  let insertIndex = index
  if (dragged.parentId === parentId) {
    const currentIndex = indexOfId(childrenOf(doc, parentId), dragged.id)
    if (currentIndex !== -1 && currentIndex < insertIndex) insertIndex -= 1
  }
  return { parentId, index: insertIndex }
}

/**
 * Resolve one group drop target against the latest doc.
 *
 * Supported targets:
 * - `{ kind: 'before'|'after', targetId }`: sibling of `targetId`, same parent.
 * - `{ kind: 'child', parentId, beforeGroupId }`: first child of `parentId`
 *   that currently precedes `beforeGroupId`; `null` (or omitted) appends, and
 *   an empty group yields index 0.
 * - `{ kind: 'root-end' }`: last root slot (`index` = current root count, as
 *   fixed by the design; `moveGroup` clamps it after removing the dragged
 *   group).
 *
 * Invalid drops return `{ invalid: true, reason }`; reasons are stable
 * machine-readable strings (`dragged-missing`, `target-missing`,
 * `parent-missing`, `anchor-missing`, `self`, `descendant`, `target-invalid`,
 * `doc-invalid`).
 *
 * @param {{ doc: object, draggedId: string, target: GroupDropTarget }} input
 * @returns {DropPosition | InvalidDrop}
 */
export const resolveGroupDrop = ({ doc, draggedId, target } = {}) => {
  if (!doc || !Array.isArray(doc.groups)) return invalid('doc-invalid')
  if (typeof draggedId !== 'string' || draggedId === '') return invalid('dragged-missing')
  const dragged = findGroup(doc, draggedId)
  if (!dragged) return invalid('dragged-missing')
  if (!target || typeof target !== 'object') return invalid('target-invalid')

  switch (target.kind) {
    case 'before':
    case 'after': {
      if (typeof target.targetId !== 'string' || target.targetId === '') return invalid('target-missing')
      if (target.targetId === draggedId) return invalid('self')
      const anchor = findGroup(doc, target.targetId)
      if (!anchor) return invalid('target-missing')
      const siblings = childrenOf(doc, anchor.parentId)
      const anchorIndex = indexOfId(siblings, anchor.id)
      if (anchorIndex === -1) return invalid('target-missing')
      return placeAt(doc, dragged, anchor.parentId, target.kind === 'after' ? anchorIndex + 1 : anchorIndex)
    }
    case 'child': {
      if (typeof target.parentId !== 'string' || target.parentId === '') return invalid('parent-missing')
      if (!findGroup(doc, target.parentId)) return invalid('parent-missing')
      const children = childrenOf(doc, target.parentId)
      // Re-resolve the anchor against the latest children: a rapid second drop
      // into the same slot must not reuse the first drop's numeric index.
      let index = children.length
      if (target.beforeGroupId != null) {
        if (typeof target.beforeGroupId !== 'string') return invalid('anchor-missing')
        index = indexOfId(children, target.beforeGroupId)
        if (index === -1) return invalid('anchor-missing')
      }
      return placeAt(doc, dragged, target.parentId, index)
    }
    case 'root-end':
      return { parentId: null, index: childrenOf(doc, null).length }
    default:
      return invalid('target-invalid')
  }
}

/**
 * True when a group drop would leave the dragged group at its current position.
 * Pure: callers pass the latest doc and resolved drop target.
 */
export const isCurrentGroupPosition = (doc, draggedId, resolved, target) => {
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

/**
 * Map a vertical position inside a group header to its valid drop zone.
 * A plain rect keeps this pure; the client adapter reads the DOM rect.
 *
 * @param {{top:number,height:number}|null|undefined} rect
 * @param {number} clientY
 * @returns {'before'|'after'|null}
 */
export const groupHeaderZoneFromRect = (rect, clientY) => {
  if (!rect || !(rect.height > 0)) return null
  const ratio = (clientY - rect.top) / rect.height
  if (ratio < 0.25) return 'before'
  if (ratio > 0.75) return 'after'
  return null
}
