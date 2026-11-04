/**
 * Narrow the DSH global session snapshot to the rows the groups sidebar needs.
 *
 * The host catalog contains every durable session, including thousands of
 * subagent sessions. The tree already filters `origin === 'subagent'`, but the
 * full snapshot still feeds the O(N) equality/derived-tree path. Keep all main
 * rows plus the currently retained subagent (so the parent highlight can be
 * resolved), and keep only projections for those rows.
 */
export const selectMainSessionView = (snapshot) => {
  if (!snapshot) return snapshot
  const sourceById = snapshot.byId ?? {}
  const ids = []
  const byId = {}
  const sourceIds = Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(sourceById)
  for (const id of sourceIds) {
    const row = sourceById[id]
    if (!row) continue
    const retained = (row.retainedBy?.mainView ?? 0) > 0
    if (row.origin === 'subagent' && !retained) continue
    ids.push(id)
    byId[id] = row
  }
  const sourceProjections = snapshot.projectionsBySession ?? {}
  const projectionsBySession = {}
  for (const id of Object.keys(byId)) {
    if (byId[id].origin === 'subagent') continue
    if (sourceProjections[id] !== undefined) projectionsBySession[id] = sourceProjections[id]
  }
  return { ...snapshot, ids, byId, projectionsBySession }
}
