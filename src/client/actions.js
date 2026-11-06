/**
 * Host-action bridge for the groups view.
 *
 * Every action delegates to a DSH host service (CONTRACTS §5) and reads the
 * result back from host snapshots — the view never keeps a second copy of
 * titles/archive flags. Pure classifiers (`classifyArchiveError`,
 * `workspaceChoices`) are exported for tests; the async bound actions receive
 * the live services from the plugin shell.
 */
import { assignSession, findGroup, inferWorkspaceId, workspaceLabel, workspaceOfSession } from '../shared/model.js'

export { workspaceLabel }

/** Error families reported by `workspace/session-active`. */
export const ACTIVITY_KEYS = Object.freeze(['turn', 'subagent', 'job', 'schedule'])

/**
 * Normalize the activity detail of a `workspace/session-active` refusal.
 * The official client identifies the error by `name` (client bundles do not
 * share error-class identity) and reads `rpcError.code`.
 * @returns {{ activity: string[] } | null}
 */
export const classifyArchiveError = (error) => {
  if (!error || typeof error !== 'object') return null
  if (error.name !== 'WorkspaceArchiveError') return null
  const code = error.rpcError?.code
  if (code !== 'workspace/session-active') return null
  const details = error.rpcError?.details
  const activity = details?.activity
  return { activity: Array.isArray(activity) ? activity.filter((entry) => typeof entry === 'string') : [] }
}

/** Format the activity families for the confirm dialog. */
export const formatActivity = (activity) => {
  if (!Array.isArray(activity) || activity.length === 0) return ''
  return activity.map((family) => (ACTIVITY_KEYS.includes(family) ? family : String(family))).join(', ')
}

/**
 * Workspace choices for the group-head "+" menu: inferred workspace first, then
 * every workspace once (CONTRACTS §5 — our own pre-created workspace menu).
 */
export const workspaceChoices = (doc, groupId, sessionsById, workspaces, currentSessionId) => {
  const list = Array.isArray(workspaces) ? workspaces : []
  if (list.length === 0) return { inferred: null, choices: [] }
  const inferredId = inferWorkspaceId(doc, groupId, sessionsById, list, currentSessionId)
  const ordered = []
  if (inferredId) {
    const inferred = list.find((workspace) => workspace.workspaceId === inferredId)
    if (inferred) ordered.push(inferred)
  }
  for (const workspace of list) {
    if (!ordered.some((entry) => entry.workspaceId === workspace.workspaceId)) ordered.push(workspace)
  }
  return { inferred: inferredId, choices: ordered }
}

/** Append a newly created workspace once; missing workspace ids are ignored. */
export const mergeWorkspaceChoices = (choices, workspace) => {
  const list = Array.isArray(choices) ? choices.slice() : []
  const workspaceId = workspace?.workspaceId
  if (typeof workspaceId === 'string' && workspaceId !== '' && !list.some((entry) => entry?.workspaceId === workspaceId)) {
    list.push(workspace)
  }
  return list
}

/** Result of a host rename call: RemoteResult. */
const assertRemoteOk = (result, fallback) => {
  if (result && result.ok === true) return result
  const message = result?.error?.message ?? fallback
  throw new Error(message)
}

/**
 * Create the bound action set.
 * @param {{
 *   getServices: () => { sessions?: object, workspaces?: object, uiWorkspace?: object },
 *   getDoc: () => object,
 *   commitDoc: (nextDoc: object) => Promise<object>,
 *   notify: (toast: { kind: string, message?: string }) => void,
 *   t: (key: string, params?: object) => string,
 *   clipboard?: (text: string) => Promise<boolean>,
 * }} deps
 */
export const createActions = ({ getServices, getDoc, commitDoc, notify, t, clipboard = null }) => {
  const services = () => getServices() ?? {}
  const normalizeWorkspace = (workspace) => ({ ...workspace, workspaceId: workspace?.workspaceId ?? workspace?.id })

  const renameSession = async (sessionId, title) => {
    const sessions = services().sessions
    if (typeof sessions?.using !== 'function') throw new Error('sessions-unavailable')
    const clean = typeof title === 'string' ? title.trim() : ''
    if (clean === '') throw new Error('title-required')
    const result = await sessions.using(sessionId, { source: 'workspaceOperation' }, (reference) => reference.binding.session.rename(clean))
    assertRemoteOk(result, 'rename-failed')
  }

  const openSession = (sessionId) => {
    const { uiWorkspace, sessions } = services()
    if (typeof uiWorkspace?.openSession === 'function') {
      uiWorkspace.openSession(sessionId)
      return true
    }
    if (typeof sessions?.retain === 'function') {
      sessions.retain(sessionId, { source: 'mainView' })
      return true
    }
    return false
  }

  const archiveSession = async (sessionId, { stopActivity = false } = {}) => {
    const { uiWorkspace } = services()
    if (typeof uiWorkspace?.archiveSession !== 'function') throw new Error('archive-unavailable')
    const options = stopActivity === true ? { stopActivity: true } : undefined
    try {
      await uiWorkspace.archiveSession(sessionId, options)
      return { ok: true }
    } catch (error) {
      return { ok: false, refusal: classifyArchiveError(error), error }
    }
  }

  const unarchiveSession = async (sessionId) => {
    const { uiWorkspace } = services()
    if (typeof uiWorkspace?.unarchiveSession !== 'function') throw new Error('unarchive-unavailable')
    await uiWorkspace.unarchiveSession(sessionId)
  }

  const forkSession = async (sessionId, onCreated) => {
    const { uiWorkspace } = services()
    if (typeof uiWorkspace?.forkSession !== 'function') throw new Error('fork-unavailable')
    let childId = null
    await uiWorkspace.forkSession(
      sessionId,
      (id) => {
        childId = id
        if (typeof onCreated === 'function') onCreated(id)
      },
      { allowMigration: false },
    )
    return childId
  }

  const copySessionId = async (sessionId) => {
    if (typeof clipboard === 'function') return (await clipboard(sessionId)) === true
    try {
      if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') return false
      await globalThis.navigator.clipboard.writeText(sessionId)
      return true
    } catch {
      return false
    }
  }

  /**
   * Group-head "+": pre-created workspace menu -> connectWorkspace -> openSession
   * -> move to the group head (dedupe: connectWorkspace may reuse an existing
   * blank, CONTRACTS §5).
   * @param {{ groupId: string, workspaceId: string }} input
   */
  const createSessionInGroup = async ({ groupId, workspaceId }) => {
    const { uiWorkspace, sessions } = services()
    if (typeof uiWorkspace?.startSession !== 'function') throw new Error('start-unavailable')
    if (typeof workspaceId !== 'string' || workspaceId === '') throw new Error('workspace-required')
    const group = findGroup(getDoc(), groupId)
    if (!group) throw new Error('group-not-found')

    // DSH 0.2.1-rc.5 reuses the workspace's single reusable blank in
    // `startSession`/`connectWorkspace`; that is correct for normal navigation
    // but would steal a blank already placed in another group. Prefer the
    // Session Controller's explicit create when the host exposes it, then fall
    // back to the rc.2 startSession/diff path.
    let sessionId = null
    const snapshot = () => sessions?.list?.getSnapshot?.() ?? { ids: [], byId: {} }
    const createDirectly = async (controller) => {
      const create = controller?.create
      if (typeof create !== 'function') return null
      try {
        const created = await create.call(controller, { workspaceId })
        return typeof created === 'string' && created !== '' ? created : null
      } catch {
        return null
      }
    }
    sessionId = (await createDirectly(sessions)) ?? (await createDirectly(uiWorkspace?.sessions))
    if (sessionId === null) {
      // `connectWorkspace` may REUSE an existing blank, which would steal a blank
      // that already belongs to another group instead of creating a new one.
      // `startSession` creates and navigates but returns void, so diff the session
      // snapshot to learn the new id (Gate 0 S3: delta +1).
      const before = new Set(snapshot().ids ?? [])
      uiWorkspace.startSession(workspaceId)
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const now = snapshot()
        const found = (now.ids ?? []).find((id) => !before.has(id) && now.byId?.[id])
        if (found) { sessionId = found; break }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (sessionId === null) {
        // Fallback: connectWorkspace returns an id but may reuse a blank. Only use
        // it when it is not already placed in a group; otherwise fail visibly.
        if (typeof uiWorkspace.connectWorkspace !== 'function') throw new Error('create-failed')
        const fallback = await uiWorkspace.connectWorkspace(workspaceId)
        const docNow = getDoc()
        const placed = new Set([...docNow.ungrouped, ...docNow.groups.flatMap((entry) => entry.sessionIds)])
        if (typeof fallback === 'string' && fallback !== '' && !placed.has(fallback)) sessionId = fallback
      }
    }
    if (sessionId === null) throw new Error('create-failed')

    const nextDoc = await commitDoc((latest) => assignSession(latest, sessionId, groupId, 0))
    openSession(sessionId)
    // Read back from the host snapshot so callers can verify the placement.
    const sessionsSnapshot = snapshot()
    return {
      sessionId,
      created: sessionsSnapshot?.byId?.[sessionId] !== undefined,
      doc: nextDoc,
    }
  }

  /**
   * Pick a directory through the host's native/browse directory service and
   * create a workspace from it. The caller owns the dialog state; this action
   * only resolves the host result.
   *
   * Returns `{ cancelled: true }` when the picker is dismissed, otherwise
   * `{ cancelled: false, workspace }` with the host workspace snapshot entry.
   */
  const createWorkspaceFromDirectory = async () => {
    const { uiWorkspace, workspaces } = services()
    if (typeof uiWorkspace?.pickDirectory !== 'function') throw new Error('workspace-picker-unavailable')
    if (typeof workspaces?.create !== 'function') throw new Error('workspace-create-unavailable')
    const path = await uiWorkspace.pickDirectory()
    if (typeof path !== 'string' || path.trim() === '') return { cancelled: true }
    try {
      const created = await workspaces.create({ path })
      return { cancelled: false, workspace: normalizeWorkspace(created) }
    } catch (error) {
      // A directory that is already a workspace is not a failure: adopt it.
      const items = workspaces?.list?.getSnapshot?.()?.items
      const existing = Array.isArray(items) ? items.find((entry) => entry?.path === path) : null
      if (existing) return { cancelled: false, workspace: normalizeWorkspace(existing) }
      throw error
    }
  }

  /** Move a session to a group at an index (omit index = append) or out of all groups. */
  const moveSession = async (sessionId, groupId, index) => {
    const doc = getDoc()
    if (groupId !== null && !findGroup(doc, groupId)) throw new Error('group-not-found')
    return await commitDoc((latest) => assignSession(latest, sessionId, groupId, index))
  }

  /** Session's workspace ref (for badges/labels). */
  const workspaceForSession = (sessionId) => {
    const workspaces = services().workspaces?.list?.getSnapshot?.()?.items ?? []
    return workspaceOfSession(workspaces, sessionId)
  }

  const notifyFailure = (key, error) => {
    notify({ kind: 'error', message: t(key) })
    if (globalThis.console?.warn) globalThis.console.warn('[dsh-session-grove]', key, String(error?.message ?? error))
  }

  return {
    renameSession: async (sessionId, title) => {
      try {
        await renameSession(sessionId, title)
      } catch (error) {
        notifyFailure('toast.renameFailed', error)
        throw error
      }
    },
    openSession,
    archiveSession,
    unarchiveSession: async (sessionId) => {
      try {
        await unarchiveSession(sessionId)
      } catch (error) {
        notifyFailure('toast.unarchiveFailed', error)
        throw error
      }
    },
    forkSession,
    copySessionId,
    createSessionInGroup,
    createWorkspaceFromDirectory,
    moveSession,
    workspaceForSession,
  }
}
