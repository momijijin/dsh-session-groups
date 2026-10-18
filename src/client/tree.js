/**
 * Tree presentation helpers (pure): flatten visible tree for row rendering,
 * ancestor expansion, status tone, group paths and depth clamping.
 */
import { childrenOf, findGroup } from '../shared/model.js'

/** Soft UI depth limit from V1-PLAN (contract allows 8, UI recommends 4). */
export const UI_SOFT_DEPTH = 4

/** Status text keys (locale.js owns the strings). */
export const statusLabelKey = (status) => {
  if (!status) return 'status.idle'
  const pending = status.pendingInteraction
  if (pending && typeof pending.kind === 'string') {
    if (pending.kind === 'approval') return 'status.waitingApproval'
    if (pending.kind === 'plan-review') return 'status.planReview'
    if (pending.kind === 'question') return 'status.waitingAnswer'
  }
  if (status.running === true) return 'status.running'
  if (status.completionUnread === true) return 'status.completed'
  return 'status.idle'
}

/** Visual tone for the status dot. */
export const statusTone = (status) => {
  if (!status) return 'idle'
  if (status.pendingInteraction && typeof status.pendingInteraction.kind === 'string') return 'awaiting'
  if (status.running === true) return 'running'
  if (status.completionUnread === true) return 'done'
  return 'idle'
}

/** Ancestor group ids from nearest to root. */
export const groupAncestors = (doc, groupId) => {
  const out = []
  let current = groupId ? findGroup(doc, groupId) : null
  const seen = new Set()
  while (current && current.parentId !== null) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    out.push(current.parentId)
    current = findGroup(doc, current.parentId)
  }
  return out
}

/**
 * Expanded-by-default model: `collapsed` stores explicitly collapsed group ids.
 * @returns {boolean}
 */
export const isExpanded = (collapsed, groupId) => collapsed[groupId] !== true

/** Ensure every ancestor of `groupId` is expanded (patch for collapsed state). */
export const expandAncestors = (collapsed, doc, groupId) => {
  const next = { ...collapsed }
  let changed = false
  for (const ancestorId of groupAncestors(doc, groupId)) {
    if (next[ancestorId]) {
      delete next[ancestorId]
      changed = true
    }
  }
  return changed ? next : collapsed
}

/** Group path display (siblings may share names, per V1-PLAN). */
export const groupPath = (doc, groupId, separator = ' / ') => {
  const names = []
  let current = groupId ? findGroup(doc, groupId) : null
  const seen = new Set()
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    names.unshift(current.name)
    current = current.parentId === null ? null : findGroup(doc, current.parentId)
  }
  return names.join(separator)
}

/** Depth used for indentation (CSS clamps deeper nesting visually). */
export const displayDepth = (depth) => Math.min(Math.max(depth, 0), UI_SOFT_DEPTH)

/**
 * Flatten a render tree into rows in display order: groups (subgroups below the
 * group row, then sessions) and finally the ungrouped sessions. Collapsed groups
 * emit only their own header row.
 *
 * @param {{ groups: object[], ungrouped: object[] }} tree
 * @param {Record<string, true>} collapsed
 * @returns {Array<{ kind: 'group'|'session', depth: number, node: object, parentId: string|null }>}
 */
export const flattenTree = (tree, collapsed = {}) => {
  const rows = []
  const walkGroup = (node, depth, parentId) => {
    rows.push({ kind: 'group', depth, node, parentId })
    if (!isExpanded(collapsed, node.group.id)) return
    for (const child of node.children) {
      if (child.kind === 'group') walkGroup(child, depth + 1, node.group.id)
      else rows.push({ kind: 'session', depth: depth + 1, node: child, parentId: node.group.id })
    }
  }
  for (const node of tree?.groups ?? []) walkGroup(node, 0, null)
  for (const node of tree?.ungrouped ?? []) rows.push({ kind: 'session', depth: 0, node, parentId: null })
  return rows
}

/** Group ids that render nothing (used to show the empty-state row). */
export const emptyGroups = (tree) => {
  const out = []
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.kind !== 'group') continue
      if (node.emptyVisible === true) out.push(node)
      walk(node.children)
    }
  }
  walk(tree?.groups)
  return out
}

/** Direct children ids of a parent (null = root groups), display order. */
export const siblingGroupIds = (doc, parentId) => childrenOf(doc, parentId).map((group) => group.id)

/** Next/previous sibling id for move-up/down menu actions (P1 graceful). */
export const siblingNeighbors = (doc, groupId) => {
  const group = findGroup(doc, groupId)
  if (!group) return { previous: null, next: null }
  const siblings = childrenOf(doc, group.parentId)
  const index = siblings.findIndex((item) => item.id === groupId)
  return {
    previous: index > 0 ? siblings[index - 1].id : null,
    next: index >= 0 && index < siblings.length - 1 ? siblings[index + 1].id : null,
  }
}
