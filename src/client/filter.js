/**
 * Visibility / archive-filter helpers for the groups view.
 *
 * The authoritative tree builder lives in `src/shared/model.js`
 * (`buildRenderTree`); this module adapts it to the client's options shape and
 * owns the pure presentation rules (title text, subagent detection, current
 * session) so they can be unit-tested without React.
 */
import { ARCHIVE_FILTERS } from '../shared/constants.js'
import { buildRenderTree, workspaceOfSession } from '../shared/model.js'

export { ARCHIVE_FILTERS }

/** Human labels for the archive tri-state (locale keys, see locale.js). */
export const ARCHIVE_FILTER_LABEL_KEYS = Object.freeze({
  hidden: 'archive.hidden',
  all: 'archive.all',
  only: 'archive.only',
})

/** Next filter in the cycle hidden -> all -> only -> hidden. */
export const nextArchiveFilter = (current) => {
  const index = ARCHIVE_FILTERS.indexOf(current)
  return ARCHIVE_FILTERS[(index + 1) % ARCHIVE_FILTERS.length]
}

/**
 * A tree row is a subagent exactly when the host marks `origin === 'subagent'`.
 * Ordinary rows may omit `origin`/`parentId` entirely (Gate 0 finding), so no
 * other field may be used for this decision.
 */
export const isSubagent = (row) => row !== null && typeof row === 'object' && row.origin === 'subagent'

/** Current session id from the global session snapshot (`retainedBy.mainView`). */
export const currentSessionIdOf = (sessionsSnapshot) => {
  const ids = sessionsSnapshot?.ids ?? []
  const byId = sessionsSnapshot?.byId ?? {}
  for (const id of ids) {
    const row = byId[id]
    if (row && typeof row.retainedBy === 'object' && row.retainedBy !== null && (row.retainedBy.mainView ?? 0) > 0) return id
  }
  return null
}

/** Display title per CONTRACTS §4: displayTitle/title, blank -> "新会话". */
export const sessionTitle = (row, { blankLabel = '新会话', untitledLabel = '未命名' } = {}) => {
  if (!row || typeof row !== 'object') return untitledLabel
  if (row.blank === true) {
    // A blank session can still be renamed by the user; show that title instead
    // of pinning the row to the blank label forever. Fall back to blankLabel when
    // the host has no title yet.
    const renamed = typeof row.title === 'string' ? row.title.trim() : ''
    return renamed || blankLabel
  }
  const display = typeof row.displayTitle === 'string' ? row.displayTitle.trim() : ''
  if (display) return display
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  return title || untitledLabel
}

/** True when a session row is archived per the host array (array, never a Set). */
export const isArchived = (archivedSessionIds, sessionId) =>
  Array.isArray(archivedSessionIds) && archivedSessionIds.includes(sessionId)

/** Workspace ref for a session id (shared model is the single authority). */
export const workspaceFor = (workspaces, sessionId) => workspaceOfSession(workspaces, sessionId)

/**
 * Build the visible render tree for the current view options.
 * @param {object} doc - confirmed GroupDoc
 * @param {Record<string, object>} sessionsById
 * @param {Array<object>} workspaces
 * @param {{
 *   archivedSessionIds?: string[],
 *   filter?: 'hidden'|'all'|'only',
 *   currentSessionId?: string|null,
 *   statuses?: Map<string, object>|null,
 * }} [options]
 */
export const buildVisibleTree = (doc, sessionsById = {}, workspaces = [], options = {}) =>
  buildRenderTree(doc, sessionsById, workspaces, {
    archivedSessionIds: Array.isArray(options.archivedSessionIds) ? options.archivedSessionIds : [],
    filter: ARCHIVE_FILTERS.includes(options.filter) ? options.filter : 'hidden',
    currentSessionId: typeof options.currentSessionId === 'string' ? options.currentSessionId : null,
    statuses: options.statuses instanceof Map ? options.statuses : null,
  })

/** Count sessions in a visible tree (groups + ungrouped). */
export const countTreeSessions = (tree) => {
  let total = tree?.ungrouped?.length ?? 0
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.kind === 'session') total += 1
      else walk(node.children)
    }
  }
  walk(tree?.groups)
  return total
}
