/**
 * Host snapshot equality for the narrow client subscriptions (0.2.29).
 *
 * The official list/status hooks accept a selector equality function. The host
 * rebuilds snapshot containers during stream updates; comparing the fields this
 * sidebar actually paints prevents a full React render when only unrelated
 * transport data changed.
 */

const sameArray = (a, b) => {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false
  return true
}

const sameSessionRow = (a, b) => {
  if (a === b) return true
  if (!a || !b) return false
  if (
    a.id !== b.id ||
    a.title !== b.title ||
    a.displayTitle !== b.displayTitle ||
    a.updatedAt !== b.updatedAt ||
    a.blank !== b.blank ||
    a.origin !== b.origin ||
    a.running !== b.running ||
    a.pinned !== b.pinned
  ) {
    return false
  }
  return (a.retainedBy?.mainView ?? 0) === (b.retainedBy?.mainView ?? 0)
}

const sameProjections = (left, right) => {
  if (left === right) return true
  const a = left ?? {}
  const b = right ?? {}
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) return false
    const ac = a[key]?.values?.subagentCatalog
    const bc = b[key]?.values?.subagentCatalog
    if (ac === bc) continue
    if (!Array.isArray(ac) || !Array.isArray(bc) || ac.length !== bc.length) return false
    for (let index = 0; index < ac.length; index += 1) {
      if (ac[index]?.id !== bc[index]?.id || ac[index]?.running !== bc[index]?.running) return false
    }
  }
  return true
}

/** Compare the session-list fields used by the tree, rows and active highlight. */
export const sessionViewEqual = (left, right) => {
  if (left === right) return true
  if (!left || !right) return false
  if (!sameArray(left.ids, right.ids)) return false
  if (!sameProjections(left.projectionsBySession, right.projectionsBySession)) return false
  const leftById = left.byId ?? {}
  const rightById = right.byId ?? {}
  const leftKeys = Object.keys(leftById)
  const rightKeys = Object.keys(rightById)
  if (leftKeys.length !== rightKeys.length) return false
  for (const id of leftKeys) {
    if (!Object.hasOwn(rightById, id)) return false
    if (!sameSessionRow(leftById[id], rightById[id])) return false
  }
  return true
}

const sameStatus = (a, b) => {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.running === b.running &&
    a.completionUnread === b.completionUnread &&
    a.pendingInteraction?.kind === b.pendingInteraction?.kind
  )
}

/** Compare the host status map by the fields SessionStatusCell consumes. */
export const statusMapEqual = (left, right) => {
  if (left === right) return true
  if (!left || !right || typeof left.get !== 'function' || typeof right.get !== 'function') return false
  const leftSize = typeof left.size === 'number' ? left.size : null
  const rightSize = typeof right.size === 'number' ? right.size : null
  if (leftSize !== null && rightSize !== null && leftSize !== rightSize) return false
  for (const [id, status] of left) if (!sameStatus(status, right.get(id))) return false
  for (const id of right.keys()) if (!left.has(id)) return false
  return true
}

const sameWorkspaceItem = (a, b) => {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.workspaceId === b.workspaceId &&
    a.title === b.title &&
    a.path === b.path &&
    sameArray(a.sessionIds, b.sessionIds)
  )
}

/** Compare the workspace projection fields used for badges and archive filtering. */
export const workspaceViewEqual = (left, right) => {
  if (left === right) return true
  if (!left || !right) return false
  if (!sameArray(left.archivedSessionIds, right.archivedSessionIds)) return false
  const leftItems = left.items ?? []
  const rightItems = right.items ?? []
  if (leftItems.length !== rightItems.length) return false
  for (let index = 0; index < leftItems.length; index += 1) {
    if (!sameWorkspaceItem(leftItems[index], rightItems[index])) return false
  }
  return true
}
