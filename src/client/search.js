/**
 * Pure session search index + reveal logic for the groups view (v1.1).
 *
 * Requirements: docs/superpowers/specs/2026-10-28-session-groups-v1.1-design.md
 * §3.3 / §4.4. This module is DOM-free: the SearchBox component owns rendering,
 * keyboard state and scrolling; it only builds an immutable index, filters it and
 * computes the collapsed patch needed to reveal one session.
 *
 * Search scope: every non-subagent session in `sessionsById` — archived, blank
 * and host-derived ungrouped rows included (visibility filters are a view concern,
 * not an index concern). Titles use the same rules as the tree (`sessionTitle`),
 * workspace labels use `workspaceLabel`, and the group path/ids come from the
 * confirmed GroupDoc (a flat `groups` array with `parentId`).
 */
import { workspaceLabel, workspaceOfSession } from '../shared/model.js'
import { sessionTitle } from './filter.js'
import { groupAncestors, groupPath } from './tree.js'

/** Collapsed-map sentinel for the "Ungrouped" container. */
export const UNGROUPED_ID = '__ungrouped__'

/** Hard cap on rendered search results (spec §3.3: at most 20 rows). */
const DEFAULT_LIMIT = 20

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])

/**
 * Containing group id for a session, or null when ungrouped.
 * The doc owns no reverse index, so a linear scan is authoritative (the same
 * rule the tree uses: a group assignment wins over `doc.ungrouped`).
 */
const groupOfSession = (doc, sessionId) => {
  for (const group of asArray(doc?.groups)) {
    if (!isObject(group) || !Array.isArray(group.sessionIds)) continue
    if (!group.sessionIds.includes(sessionId)) continue
    return typeof group.id === 'string' && group.id !== '' ? group.id : null
  }
  return null
}

/**
 * Build the flat search index.
 * @param {{
 *   doc?: object,
 *   sessionsById?: Record<string, object>,
 *   workspaces?: object[],
 *   archivedSessionIds?: string[],
 * }} [input]
 * @returns {Array<{
 *   sessionId: string,
 *   title: string,
 *   workspace: string,
 *   groupPath: string,
 *   groupIds: string[],
 *   archived: boolean,
 * }>}
 */
export const buildSearchIndex = ({ doc, sessionsById, workspaces, archivedSessionIds } = {}) => {
  const sessions = isObject(sessionsById) ? sessionsById : {}
  const workspaceList = asArray(workspaces)
  const archived = asArray(archivedSessionIds)
  const entries = []

  for (const sessionId of Object.keys(sessions)) {
    const row = sessions[sessionId]
    if (!isObject(row)) continue
    if (row.origin === 'subagent') continue

    const groupId = groupOfSession(doc, sessionId)
    // `groupIds` is the full id chain root -> containing group (the id twin of
    // `groupPath`); ungrouped sessions carry an empty chain.
    const groupIds = groupId ? [...groupAncestors(doc, groupId)].reverse().concat(groupId) : []

    entries.push({
      sessionId,
      title: sessionTitle(row),
      workspace: workspaceLabel(workspaceOfSession(workspaceList, sessionId)),
      groupPath: groupId ? groupPath(doc, groupId) : '',
      groupIds,
      archived: archived.includes(sessionId),
    })
  }

  return entries
}

const normalizeQuery = (query) => (typeof query === 'string' ? query.trim().toLowerCase() : '')

const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : '')

/** 0 = title prefix, 1 = title contains, 2 = workspace / group path, -1 = no match. */
const rankEntry = (entry, needle) => {
  const title = lower(entry.title)
  if (title.startsWith(needle)) return 0
  if (title.includes(needle)) return 1
  if (lower(entry.workspace).includes(needle)) return 2
  if (lower(entry.groupPath).includes(needle)) return 2
  return -1
}

/** Deterministic codepoint ordering (no locale-dependent collation in tests). */
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const normalizeLimit = (limit) => (Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_LIMIT)

/**
 * Filter the index for a query, best match first.
 *
 * Ranking: title prefix > title substring > workspace / group path substring.
 * Ties are sorted by title, then session id, so repeated calls are stable.
 *
 * @param {object[]} index - output of {@link buildSearchIndex}
 * @param {string} query
 * @param {number} [limit]
 * @returns {object[]} matching entries (never more than `limit`)
 */
export const matchSessions = (index, query, limit = DEFAULT_LIMIT) => {
  const needle = normalizeQuery(query)
  if (needle === '') return []
  const max = normalizeLimit(limit)
  if (max === 0) return []

  const ranked = []
  for (const entry of asArray(index)) {
    if (!isObject(entry)) continue
    const rank = rankEntry(entry, needle)
    if (rank === -1) continue
    ranked.push({ entry, rank })
  }

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank
    const byTitle = compareText(String(left.entry.title ?? ''), String(right.entry.title ?? ''))
    if (byTitle !== 0) return byTitle
    return compareText(String(left.entry.sessionId ?? ''), String(right.entry.sessionId ?? ''))
  })

  return ranked.slice(0, max).map((item) => item.entry)
}

/**
 * Compute the collapsed map that reveals one session.
 *
 * Expanded-by-default model: `collapsed[groupId] === true` means collapsed. The
 * patch removes the containing group (or {@link UNGROUPED_ID}) plus every
 * ancestor, so one call reveals nested rows. A session absent from `doc.groups`
 * is always treated as ungrouped — this covers host-derived ungrouped sessions
 * that never appear in `doc.ungrouped`.
 *
 * The input map is never mutated; when no flag needs removing, the original
 * reference is returned so callers can skip a store update.
 *
 * @param {object} doc - confirmed GroupDoc
 * @param {Record<string, true>} collapsed
 * @param {string} sessionId
 * @returns {Record<string, true>} the same map or a new one
 */
export const revealSession = (doc, collapsed, sessionId) => {
  if (!isObject(collapsed)) return collapsed

  const groupId = groupOfSession(doc, sessionId)
  const revealIds = groupId ? [...groupAncestors(doc, groupId), groupId] : [UNGROUPED_ID]

  let next = null
  for (const id of revealIds) {
    if (!collapsed[id]) continue
    if (next === null) next = { ...collapsed }
    delete next[id]
  }

  return next ?? collapsed
}
