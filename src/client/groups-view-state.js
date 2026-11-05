/**
 * Framework-derived state for the groups view.
 *
 * Reads the host-standard session/workspace/status hooks, derives the visible
 * tree and status sections, and returns plain view data. Handler identity and
 * the stable proxy belong to the view's event layer, not this adapter.
 */
import { useMemo } from 'react'
import { selectMainSessionView } from './main-session-view.js'
import { sessionViewEqual, statusMapEqual, workspaceViewEqual } from './session-equality.js'
import { buildVisibleTree, mainSessionIdOf } from '../core/filter.js'
import { runningSubagentCounts, statusSectionsByGroup } from '../core/tree.js'

export const useGroupsViewState = ({ store, props }) => {
  const sessions = typeof props?.useSessions === 'function' ? props.useSessions(selectMainSessionView, sessionViewEqual) : null
  const workspaces = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces((snapshot) => snapshot, workspaceViewEqual) : null
  const statuses = typeof props?.useSessionStatus === 'function' ? props.useSessionStatus((snapshot) => snapshot, statusMapEqual) : null
  const subagentCounts = useMemo(() => runningSubagentCounts(sessions, statuses), [sessions, statuses])
  const statusBuckets = useMemo(
    () =>
      statusSectionsByGroup(
        store?.doc,
        sessions?.byId ?? {},
        statuses,
        workspaces?.archivedSessionIds ?? [],
        subagentCounts,
      ),
    [store?.doc, sessions?.byId, statuses, workspaces?.archivedSessionIds, subagentCounts],
  )
  const runningSessions = statusBuckets.running
  const blockedSessions = statusBuckets.blocked
  const unreadSessions = statusBuckets.unread
  const byId = sessions?.byId ?? {}
  const workspaceItems = workspaces?.items ?? []
  const archivedSessionIds = Array.isArray(workspaces?.archivedSessionIds) ? workspaces.archivedSessionIds : []
  const currentId = mainSessionIdOf(sessions)
  const highlightCurrent = currentId
  const tree = useMemo(
    () =>
      store
        ? buildVisibleTree(store.doc, byId, workspaceItems, {
            archivedSessionIds,
            filter: store.archiveFilter,
            currentSessionId: highlightCurrent,
            statuses: statuses instanceof Map ? statuses : null,
            subagentCounts,
          })
        : { groups: [], ungrouped: [] },
    [store?.doc, store?.archiveFilter, byId, workspaceItems, archivedSessionIds, highlightCurrent, statuses, subagentCounts],
  )

  return {
    sessions,
    workspaces,
    statuses,
    subagentCounts,
    runningSessions,
    blockedSessions,
    unreadSessions,
    byId,
    workspaceItems,
    archivedSessionIds,
    currentId,
    highlightCurrent,
    tree,
  }
}
