/**
 * Pure session-row policy.
 *
 * No React, DSH service, DOM, storage, locale or time dependency is allowed in
 * `src/core`. Host versions may change how these values are read, but the row
 * comparison and accessibility-label policy must stay stable.
 */

/**
 * Translate one status descriptor into its accessible label.
 *
 * @param {{ labelKey?: string, params?: object } | null | undefined} status
 * @param {(key: string, params?: object) => string} translate
 * @returns {string}
 */
export const statusLabel = (status, translate) => {
  if (status === null || status === undefined) return ''
  const t = typeof translate === 'function' ? translate : (key) => key
  return t(status.labelKey, status.params)
}

/**
 * Decide whether a memoized SessionRow needs to repaint.
 *
 * The comparator intentionally ignores handler identity: GroupsView supplies a
 * stable proxy whose calls always read the latest closure. It compares only
 * values that can change the rendered row.
 *
 * @param {object} prev
 * @param {object} next
 * @returns {boolean}
 */
export const sessionRowPropsEqual = (prev, next) => {
  const a = prev.sessionNode
  const b = next.sessionNode
  if (a.session.id !== b.session.id) return false
  if (prev.depth !== next.depth || prev.groupId !== next.groupId || prev.ungrouped !== next.ungrouped) return false
  if (a.archived !== b.archived || a.runningSubagentCount !== b.runningSubagentCount) return false
  if ((prev.store?.currentSessionId === a.session.id) !== (next.store?.currentSessionId === b.session.id)) return false
  const ar = a.session
  const br = b.session
  if (ar.title !== br.title || ar.displayTitle !== br.displayTitle || ar.updatedAt !== br.updatedAt || ar.blank !== br.blank) {
    return false
  }
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
