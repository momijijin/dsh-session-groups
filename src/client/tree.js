/**
 * Tree presentation helpers (pure): flatten visible tree for row rendering,
 * ancestor expansion, status tone, group paths and depth clamping.
 */
import { childrenOf, findGroup } from '../shared/model.js'

/** Soft UI depth limit from V1-PLAN (contract allows 8, UI recommends 4). */
export const UI_SOFT_DEPTH = 4

/**
 * Official pending-interaction statuses (DSH `sessionStatuses`): only these
 * three `pendingInteraction.kind` values are visible. Anything else falls
 * through to the running/completed/idle states instead of inventing a status.
 */
export const PENDING_STATUSES = Object.freeze({
  approval: Object.freeze({ state: 'warning', labelKey: 'status.waitingApproval', compactKey: 'status.compact.approval' }),
  'plan-review': Object.freeze({ state: 'warning', labelKey: 'status.planReview', compactKey: 'status.compact.planReview' }),
  question: Object.freeze({ state: 'warning', labelKey: 'status.waitingAnswer', compactKey: 'status.compact.answer' }),
})

/** Primary pending status descriptor, or null when the kind is unknown/absent. */
export const pendingStatus = (status) => {
  const kind = status?.pendingInteraction?.kind
  if (typeof kind !== 'string') return null
  const entry = PENDING_STATUSES[kind]
  if (!entry) return null
  return { ...entry, kind: 'pending', pendingKind: kind }
}

/** Official secondary/standalone `subagentsRunning` descriptor. */
export const subagentStatus = (runningSubagentCount) => {
  const count = Number.isInteger(runningSubagentCount) && runningSubagentCount > 0 ? runningSubagentCount : 0
  if (count === 0) return null
  return {
    state: 'ongoing',
    kind: 'subagents',
    count,
    labelKey: count === 1 ? 'status.subagentsRunning.one' : 'status.subagentsRunning.other',
    params: { n: count },
  }
}

/**
 * Official session status list, in priority order:
 * pending > running > subagents-only > completed > idle. Pending/running keep
 * `subagentsRunning` as a coexisting second status; the subagents-only case uses
 * the official ongoing renderer with that same label (no new primary status).
 *
 * @param {{ running?: boolean, pendingInteraction?: { kind?: string }, completionUnread?: boolean }|null} status
 * @param {{ runningSubagentCount?: number }} [options]
 */
export const sessionStatuses = (status, options = {}) => {
  const subagents = subagentStatus(options.runningSubagentCount)
  const pending = pendingStatus(status)
  if (pending) return subagents ? [pending, subagents] : [pending]
  if (status?.running === true) {
    const running = { state: 'ongoing', kind: 'running', labelKey: 'status.running' }
    return subagents ? [running, subagents] : [running]
  }
  if (subagents) return [subagents]
  if (status?.completionUnread === true) return [{ state: 'done', kind: 'completed', labelKey: 'status.completed' }]
  return [{ state: 'idle', kind: 'idle', labelKey: 'status.idle' }]
}

/**
 * Running child count for one session, matching the official projection rule:
 * count `subagentCatalog` entries whose unified status is running, falling back
 * to the child row's own `running` flag. Returns 0 when the host exposes no
 * projection data (never invents a marker).
 */
export const runningSubagentCount = (sessions, parentId, statuses) => {
  if (typeof parentId !== 'string' || parentId === '') return 0
  const catalog = sessions?.projectionsBySession?.[parentId]?.values?.subagentCatalog
  if (!Array.isArray(catalog)) return 0
  const byId = sessions?.byId ?? {}
  const getStatus = typeof statuses?.get === 'function' ? (id) => statuses.get(id) : () => undefined
  let count = 0
  for (const child of catalog) {
    if (!child || typeof child.id !== 'string' || child.id === '') continue
    const running = getStatus(child.id)?.running ?? byId[child.id]?.running
    if (running === true) count += 1
  }
  return count
}

/** Map parent session id -> running subagent count (only positive counts). */
export const runningSubagentCounts = (sessions, statuses) => {
  const out = new Map()
  const projections = sessions?.projectionsBySession
  if (!projections || typeof projections !== 'object') return out
  for (const parentId of Object.keys(projections)) {
    const count = runningSubagentCount(sessions, parentId, statuses)
    if (count > 0) out.set(parentId, count)
  }
  return out
}

/**
 * Running (spinner) sessions grouped by their direct parent group, in document
 * order, plus the ungrouped inbox at the end. `statuses` is the host Map; only
 * main sessions are listed (subagent rows stay with their parent).
 *
 * @returns {{ sections: Array<{ groupId: string|null, groupName: string, sessions: Array<{ sessionId: string, archived: boolean }> }>, count: number }}
 */
export const sessionsByGroupMatching = (doc, sessionsById = {}, statuses = null, archivedSessionIds = [], subagentCounts = new Map(), match = () => false) => {
  const archived = new Set(Array.isArray(archivedSessionIds) ? archivedSessionIds : [])
  const seen = new Set()
  const sections = []
  const add = (sessionId, groupId, groupName) => {
    if (typeof sessionId !== 'string' || seen.has(sessionId)) return
    const row = sessionsById?.[sessionId]
    if (!row || row.origin === 'subagent') return
    const status = typeof statuses?.get === 'function' ? statuses.get(sessionId) : null
    const projected = typeof subagentCounts?.get === 'function' ? subagentCounts.get(sessionId) : 0
    const primary = sessionStatuses(status, { runningSubagentCount: projected })[0]
    if (!match(primary, status)) return
    seen.add(sessionId)
    let section = sections.find((item) => item.groupId === groupId)
    if (!section) {
      section = { groupId, groupName: groupName ?? '', sessions: [] }
      sections.push(section)
    }
    section.sessions.push({ sessionId, archived: archived.has(sessionId) })
  }
  const walk = (parentId) => {
    for (const group of childrenOf(doc, parentId)) {
      for (const sessionId of group.sessionIds ?? []) add(sessionId, group.id, group.name ?? '')
      walk(group.id)
    }
  }
  walk(null)
  for (const sessionId of doc?.ungrouped ?? []) add(sessionId, null, '')
  const count = sections.reduce((total, section) => total + section.sessions.length, 0)
  return { sections, count }
}

export const runningSessionsByGroup = (...args) =>
  sessionsByGroupMatching(...args, (primary) => primary?.state === 'ongoing')

export const blockedSessionsByGroup = (...args) =>
  sessionsByGroupMatching(...args, (primary) => primary?.state === 'warning')

export const unreadSessionsByGroup = (...args) =>
  sessionsByGroupMatching(...args, (primary) => primary?.kind === 'completed')

/**
 * One traversal for all three header counters. The three independent scans were
 * O(3n) on every stream snapshot; this returns the same grouped shape in O(n).
 */
export const statusSectionsByGroup = (doc, sessionsById = {}, statuses = null, archivedSessionIds = [], subagentCounts = new Map()) => {
  const buckets = {
    running: { sections: [], count: 0 },
    blocked: { sections: [], count: 0 },
    unread: { sections: [], count: 0 },
  }
  const archived = new Set(Array.isArray(archivedSessionIds) ? archivedSessionIds : [])
  const seen = new Set()
  const add = (sessionId, groupId, groupName) => {
    if (typeof sessionId !== 'string' || seen.has(sessionId)) return
    const row = sessionsById?.[sessionId]
    if (!row || row.origin === 'subagent') return
    const status = typeof statuses?.get === 'function' ? statuses.get(sessionId) : null
    const projected = typeof subagentCounts?.get === 'function' ? subagentCounts.get(sessionId) : 0
    const primary = sessionStatuses(status, { runningSubagentCount: projected })[0]
    const bucket = primary?.state === 'ongoing' ? 'running' : primary?.state === 'warning' ? 'blocked' : primary?.kind === 'completed' ? 'unread' : null
    if (bucket === null) return
    seen.add(sessionId)
    const target = buckets[bucket]
    let section = target.sections.find((item) => item.groupId === groupId)
    if (!section) {
      section = { groupId, groupName: groupName ?? '', sessions: [] }
      target.sections.push(section)
    }
    section.sessions.push({ sessionId, archived: archived.has(sessionId) })
    target.count += 1
  }
  const walk = (parentId) => {
    for (const group of childrenOf(doc, parentId)) {
      for (const sessionId of group.sessionIds ?? []) add(sessionId, group.id, group.name ?? '')
      walk(group.id)
    }
  }
  walk(null)
  for (const sessionId of doc?.ungrouped ?? []) add(sessionId, null, '')
  return buckets
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
