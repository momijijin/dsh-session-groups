import {
  DEFAULT_GROUP_COLOR,
  DEFAULT_ICON,
  DOC_VERSION,
  GROUP_COLORS,
  GROUP_ICONS,
  MAX_COLOR_LENGTH,
  MAX_DEPTH,
  MAX_GROUP_NAME,
  MAX_ICON_LENGTH,
} from './constants.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const clone = (value) => JSON.parse(JSON.stringify(value))
const asString = (value) => (typeof value === 'string' ? value : '')

export const emptyDoc = () => ({
  version: DOC_VERSION,
  revision: 0,
  groups: [],
  ungrouped: [],
})

export const cloneDoc = (doc) => clone(doc)

export const newGroupId = () => {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `g-${uuid.replace(/-/g, '').slice(0, 12)}`
  return `g-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`
}

export const isKnownIcon = (icon) => GROUP_ICONS.includes(icon)

export const normalizeIcon = (icon) => (isKnownIcon(icon) ? icon : DEFAULT_ICON)

export const isKnownColor = (color) => GROUP_COLORS.includes(color)

/** Unknown/missing colors fall back to the blue default (0.2.6 additive). */
export const normalizeColor = (color) => (isKnownColor(color) ? color : DEFAULT_GROUP_COLOR)

/** Display color of a group: the persisted palette id or the blue default. */
export const groupColor = (group) => normalizeColor(group?.color)

export const normalizeName = (name) => {
  const text = asString(name).trim()
  if (text.length === 0) throw new Error('name-required')
  if (text.length > MAX_GROUP_NAME) throw new Error('name-too-long')
  return text
}

const findGroupIndex = (doc, groupId) => doc.groups.findIndex((group) => group.id === groupId)

export const findGroup = (doc, groupId) => {
  const index = findGroupIndex(doc, groupId)
  return index === -1 ? null : doc.groups[index]
}

export const childrenOf = (doc, parentId) =>
  doc.groups.filter((group) => group.parentId === parentId)

export const groupDepth = (doc, groupId) => {
  let depth = 0
  let current = findGroup(doc, groupId)
  const seen = new Set()
  while (current) {
    if (seen.has(current.id)) throw new Error('cycle')
    seen.add(current.id)
    depth += 1
    current = current.parentId === null ? null : findGroup(doc, current.parentId)
  }
  return depth
}

export const isDescendant = (doc, groupId, maybeAncestorId) => {
  if (!maybeAncestorId) return false
  let current = findGroup(doc, groupId)
  const seen = new Set()
  while (current && current.parentId !== null) {
    if (seen.has(current.id)) throw new Error('cycle')
    seen.add(current.id)
    if (current.parentId === maybeAncestorId) return true
    current = findGroup(doc, current.parentId)
  }
  return false
}

const subtreeHeight = (doc, groupId) => {
  const children = childrenOf(doc, groupId)
  if (children.length === 0) return 0
  return 1 + Math.max(...children.map((child) => subtreeHeight(doc, child.id)))
}

const insertGroupAt = (doc, group, index) => {
  const siblings = childrenOf(doc, group.parentId)
  if (siblings.length === 0) {
    doc.groups.push(group)
    return
  }
  const at = Math.max(0, Math.min(Number.isInteger(index) ? index : siblings.length, siblings.length))
  if (at >= siblings.length) {
    const last = siblings[siblings.length - 1]
    doc.groups.splice(doc.groups.indexOf(last) + 1, 0, group)
    return
  }
  doc.groups.splice(doc.groups.indexOf(siblings[at]), 0, group)
}

export const createGroup = (doc, { name, icon = DEFAULT_ICON, color = DEFAULT_GROUP_COLOR, parentId = null, index } = {}) => {
  const next = cloneDoc(doc)
  const cleanName = normalizeName(name)
  if (parentId !== null && !findGroup(next, parentId)) throw new Error('parent-not-found')
  if (parentId !== null && groupDepth(next, parentId) >= MAX_DEPTH) throw new Error('depth-exceeded')
  const group = {
    id: newGroupId(),
    name: cleanName,
    icon: normalizeIcon(icon),
    color: normalizeColor(color),
    parentId,
    sessionIds: [],
  }
  insertGroupAt(next, group, index)
  return next
}

export const renameGroup = (doc, groupId, name) => {
  const next = cloneDoc(doc)
  const group = findGroup(next, groupId)
  if (!group) throw new Error('group-not-found')
  group.name = normalizeName(name)
  return next
}

export const setGroupIcon = (doc, groupId, icon) => {
  const next = cloneDoc(doc)
  const group = findGroup(next, groupId)
  if (!group) throw new Error('group-not-found')
  group.icon = normalizeIcon(icon)
  return next
}

/** Set a group's palette color (0.2.6). Unknown ids normalize to blue. */
export const setGroupColor = (doc, groupId, color) => {
  const next = cloneDoc(doc)
  const group = findGroup(next, groupId)
  if (!group) throw new Error('group-not-found')
  group.color = normalizeColor(color)
  return next
}

export const moveGroup = (doc, groupId, parentId, index) => {
  const next = cloneDoc(doc)
  const group = findGroup(next, groupId)
  if (!group) throw new Error('group-not-found')
  if (parentId === groupId || isDescendant(next, parentId, groupId)) throw new Error('cycle')
  if (parentId !== null && !findGroup(next, parentId)) throw new Error('parent-not-found')
  const parentDepth = parentId === null ? 0 : groupDepth(next, parentId)
  if (parentDepth + 1 + subtreeHeight(next, groupId) > MAX_DEPTH) throw new Error('depth-exceeded')
  next.groups.splice(findGroupIndex(next, groupId), 1)
  group.parentId = parentId
  insertGroupAt(next, group, index)
  return next
}

export const deleteGroup = (doc, groupId) => {
  const next = cloneDoc(doc)
  const group = findGroup(next, groupId)
  if (!group) throw new Error('group-not-found')
  const parent = group.parentId === null ? null : findGroup(next, group.parentId)
  next.groups.splice(findGroupIndex(next, groupId), 1)
  for (const child of next.groups) {
    if (child.parentId === groupId) child.parentId = group.parentId
  }
  if (group.sessionIds.length > 0) {
    if (parent) parent.sessionIds = [...group.sessionIds, ...parent.sessionIds]
    else next.ungrouped = [...group.sessionIds, ...next.ungrouped]
  }
  return next
}

const removeSessionEverywhere = (doc, sessionId) => {
  for (const group of doc.groups) {
    group.sessionIds = group.sessionIds.filter((id) => id !== sessionId)
  }
  doc.ungrouped = doc.ungrouped.filter((id) => id !== sessionId)
}

export const assignSession = (doc, sessionId, groupId, index) => {
  const next = cloneDoc(doc)
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('session-required')
  const group = groupId === null ? null : findGroup(next, groupId)
  if (groupId !== null && !group) throw new Error('group-not-found')
  removeSessionEverywhere(next, sessionId)
  if (group) {
    const at = Math.max(0, Math.min(Number.isInteger(index) ? index : group.sessionIds.length, group.sessionIds.length))
    group.sessionIds.splice(at, 0, sessionId)
  } else {
    const at = Math.max(0, Math.min(Number.isInteger(index) ? index : next.ungrouped.length, next.ungrouped.length))
    next.ungrouped.splice(at, 0, sessionId)
  }
  return next
}

export const removeSession = (doc, sessionId) => {
  const next = cloneDoc(doc)
  removeSessionEverywhere(next, sessionId)
  return next
}

export const reorderUngrouped = (doc, sessionIds) => {
  const next = cloneDoc(doc)
  const seen = new Set()
  const ids = []
  for (const id of Array.isArray(sessionIds) ? sessionIds : []) {
    if (typeof id === 'string' && id !== '' && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  next.ungrouped = ids
  return next
}

const toArray = (value) => {
  if (Array.isArray(value)) return value
  if (value instanceof Set) return [...value]
  return []
}

export const workspaceOfSession = (workspaces, sessionId) => {
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    if (Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)) return workspace
  }
  return null
}

export const workspaceLabel = (workspace) => {
  if (!workspace) return ''
  const title = asString(workspace.title).trim()
  if (title) return title
  const path = asString(workspace.path).replace(/[\\/]+$/, '')
  const base = path.split(/[\\/]/).filter(Boolean).pop()
  return base || asString(workspace.workspaceId) || ''
}

export const inferWorkspaceId = (doc, groupId, sessionsById, workspaces, currentSessionId) => {
  const current = currentSessionId
    ? workspaceOfSession(workspaces, currentSessionId)?.workspaceId ?? null
    : null
  const group = groupId ? findGroup(doc, groupId) : null
  if (!group) return current
  const ids = new Set()
  for (const sessionId of group.sessionIds) {
    if (!sessionsById?.[sessionId]) continue
    const workspace = workspaceOfSession(workspaces, sessionId)
    if (workspace?.workspaceId) ids.add(workspace.workspaceId)
  }
  if (ids.size === 1) return [...ids][0]
  return current
}

const sessionVisible = (row, id, archivedSet, filter, currentSessionId) => {
  if (!row) return false
  if (row.origin === 'subagent') return false
  if (row.blank === true && id !== currentSessionId) return false
  if (filter === 'hidden' && archivedSet.has(id)) return false
  if (filter === 'only' && !archivedSet.has(id)) return false
  return true
}

const sessionNode = (row, archivedSet, statuses, workspaces) => ({
  kind: 'session',
  session: row,
  workspace: workspaceOfSession(workspaces, row.id),
  archived: archivedSet.has(row.id),
  status: typeof statuses?.get === 'function' ? statuses.get(row.id) ?? null : null,
})

export const buildRenderTree = (doc, sessionsById = {}, workspaces = [], options = {}) => {
  const filter = options.filter === 'all' || options.filter === 'only' ? options.filter : 'hidden'
  const archivedSet = new Set(toArray(options.archivedSessionIds))
  const currentSessionId = typeof options.currentSessionId === 'string' ? options.currentSessionId : null
  const statuses = options.statuses instanceof Map ? options.statuses : null
  const sessions = isObject(sessionsById) ? sessionsById : {}
  const visible = (id) => sessionVisible(sessions[id], id, archivedSet, filter, currentSessionId)
  const makeSession = (id) => sessionNode(sessions[id], archivedSet, statuses, workspaces)

  const groupNode = (group) => {
    const childGroups = childrenOf(doc, group.id).map(groupNode)
    const groupSessions = group.sessionIds.filter(visible).map(makeSession)
    const visibleCount = groupSessions.length + childGroups.reduce((sum, child) => sum + child.visibleCount, 0)
    return {
      kind: 'group',
      group,
      children: [...childGroups, ...groupSessions],
      visibleCount,
      emptyVisible: visibleCount === 0,
    }
  }

  const groups = childrenOf(doc, null).map(groupNode)
  const assigned = new Set()
  for (const group of doc.groups) for (const id of group.sessionIds) assigned.add(id)
  const stored = doc.ungrouped.filter((id) => !assigned.has(id) && visible(id))
  const storedSet = new Set(stored)
  const derived = Object.keys(sessions)
    .filter((id) => !assigned.has(id) && !storedSet.has(id) && visible(id))
    .sort((a, b) => Number(sessions[b]?.updatedAt || 0) - Number(sessions[a]?.updatedAt || 0))
  const ungrouped = [...derived, ...stored].map(makeSession)

  return { groups, ungrouped }
}

export const flattenRenderTree = (tree) => {
  const out = []
  const walk = (node, depth) => {
    out.push({ ...node, depth })
    if (node.kind === 'group') for (const child of node.children) walk(child, depth + 1)
  }
  for (const group of tree.groups) walk(group, 0)
  for (const session of tree.ungrouped) walk(session, 0)
  return out
}

export const validateDoc = (doc) => {
  const errors = []
  if (!isObject(doc)) return { ok: false, errors: ['doc-not-object'] }
  if (doc.version !== DOC_VERSION) errors.push('version')
  if (!Number.isInteger(doc.revision) || doc.revision < 0) errors.push('revision')
  if (!Array.isArray(doc.groups)) errors.push('groups')
  if (!Array.isArray(doc.ungrouped)) errors.push('ungrouped')
  if (errors.length > 0) return { ok: false, errors }

  const ids = new Set()
  const sessionOwners = new Map()
  for (const group of doc.groups) {
    if (!isObject(group)) { errors.push('group-not-object'); continue }
    if (typeof group.id !== 'string' || group.id === '') errors.push('group-id')
    else if (ids.has(group.id)) errors.push(`duplicate-group:${group.id}`)
    else ids.add(group.id)
    if (typeof group.name !== 'string' || group.name.trim() === '' || group.name.trim().length > MAX_GROUP_NAME) {
      errors.push(`group-name:${group.id}`)
    }
    if (typeof group.icon !== 'string' || group.icon.length > MAX_ICON_LENGTH) errors.push(`group-icon:${group.id}`)
    // 0.2.6 additive: `color` is optional (legacy docs) but, when present, must
    // be one of the frozen palette ids; the host rejects anything else.
    if (group.color !== undefined) {
      if (
        typeof group.color !== 'string' ||
        group.color.length > MAX_COLOR_LENGTH ||
        !GROUP_COLORS.includes(group.color)
      ) {
        errors.push(`group-color:${group.id}`)
      }
    }
    if (group.parentId !== null && typeof group.parentId !== 'string') errors.push(`group-parent:${group.id}`)
    if (!Array.isArray(group.sessionIds)) errors.push(`group-sessions:${group.id}`)
    else {
      for (const sessionId of group.sessionIds) {
        if (typeof sessionId !== 'string' || sessionId === '') { errors.push('session-id'); continue }
        const owner = sessionOwners.get(sessionId)
        if (owner !== undefined) errors.push(`duplicate-session:${sessionId}`)
        else sessionOwners.set(sessionId, group.id)
      }
    }
  }
  for (const group of doc.groups) {
    if (group.parentId !== null && !ids.has(group.parentId)) errors.push(`missing-parent:${group.id}`)
  }
  for (const sessionId of doc.ungrouped) {
    if (typeof sessionId !== 'string' || sessionId === '') errors.push('ungrouped-session-id')
    else if (sessionOwners.has(sessionId)) errors.push(`duplicate-session:${sessionId}`)
    else sessionOwners.set(sessionId, null)
  }
  const state = new Map()
  const visit = (id) => {
    if (state.get(id) === 1) { errors.push(`cycle:${id}`); return }
    if (state.get(id) === 2) return
    state.set(id, 1)
    const group = doc.groups.find((item) => item.id === id)
    if (group && group.parentId !== null) visit(group.parentId)
    state.set(id, 2)
  }
  for (const id of ids) visit(id)
  for (const group of doc.groups) {
    try {
      if (groupDepth(doc, group.id) > MAX_DEPTH) errors.push(`depth:${group.id}`)
    } catch {
      errors.push(`cycle:${group.id}`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export const normalizeDoc = (doc) => {
  const source = isObject(doc) ? doc : {}
  const groups = []
  const known = new Set()
  const firstRawById = new Map()
  for (const raw of Array.isArray(source.groups) ? source.groups : []) {
    if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '' || known.has(raw.id)) continue
    known.add(raw.id)
    firstRawById.set(raw.id, raw)
    const name = asString(raw.name).trim().slice(0, MAX_GROUP_NAME) || '未命名'
    groups.push({
      id: raw.id,
      name,
      icon: normalizeIcon(raw.icon),
      color: normalizeColor(raw.color),
      parentId: typeof raw.parentId === 'string' && raw.parentId !== '' ? raw.parentId : null,
      sessionIds: [],
    })
  }
  const byId = new Map(groups.map((group) => [group.id, group]))
  for (const group of groups) {
    if (group.parentId !== null && !byId.has(group.parentId)) group.parentId = null
  }
  const seen = new Set()
  for (const raw of Array.isArray(source.groups) ? source.groups : []) {
    if (!isObject(raw) || firstRawById.get(raw.id) !== raw) continue
    const group = byId.get(raw.id)
    if (!group) continue
    for (const sessionId of Array.isArray(raw.sessionIds) ? raw.sessionIds : []) {
      if (typeof sessionId !== 'string' || sessionId === '' || seen.has(sessionId)) continue
      seen.add(sessionId)
      group.sessionIds.push(sessionId)
    }
  }
  const ungrouped = []
  for (const sessionId of Array.isArray(source.ungrouped) ? source.ungrouped : []) {
    if (typeof sessionId !== 'string' || sessionId === '' || seen.has(sessionId)) continue
    seen.add(sessionId)
    ungrouped.push(sessionId)
  }
  return {
    version: DOC_VERSION,
    revision: Number.isInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    groups,
    ungrouped,
  }
}
