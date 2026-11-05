/**
 * Session-control HTTP routes, split from routes.js without behavior changes.
 */
import {
  CONTROL_SESSION_ARCHIVE_PATH,
  CONTROL_SESSION_INSPECT_PATH,
  CONTROL_SESSION_RENAME_PATH,
} from './constants.js'
import { hasControlChars } from '../shared/model.js'

export const registerSessionRoutes = ({
  register,
  controlUnavailable,
  controlDenied,
  controlSessionsEnabled,
  readControlJson,
  getService,
  sendJson,
  sendMethodNotAllowed,
  unexpectedControlField,
}) => {
  let sessionInspectPath = null
  let sessionRenamePath = null
  let sessionArchivePath = null
  {
    const sessionLookup = (sessionId) => {
      const sessions = getService('sessions')
      if (sessions === null || typeof sessions.get !== 'function') return null
      return sessions.get(sessionId) ?? null
    }
    const archivedSessionIds = () => {
      const registry = getService('workspaceRegistry')
      return registry !== null && Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : null
    }
    const sessionBody = async (req, res) => {
      if (controlUnavailable(res)) return null
      if (!controlSessionsEnabled()) {
        sendJson(res, 404, { ok: false, code: 'session-controls-disabled' })
        return null
      }
      if (controlDenied(req, res)) return null
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return null
      }
      return await readControlJson(req, res)
    }

    sessionInspectPath = register(
      CONTROL_SESSION_INSPECT_PATH,
      async (req, res) => {
        const body = await sessionBody(req, res)
        if (body === null) return
        const unexpected = unexpectedControlField(body, new Set(['sessionId']))
        if (unexpected !== null) {
          sendJson(res, 422, { ok: false, code: 'unexpected-field', message: `unexpected top-level field "${unexpected}"`, field: unexpected })
          return
        }
        if (typeof body.sessionId !== 'string' || body.sessionId.length === 0 || hasControlChars(body.sessionId)) {
          sendJson(res, 422, { ok: false, code: 'invalid-session-id', field: 'sessionId' })
          return
        }
        const live = sessionLookup(body.sessionId)
        const archivedIds = archivedSessionIds()
        if (live === null && archivedIds === null) {
          sendJson(res, 503, { ok: false, code: 'service-unavailable', message: 'session services are unavailable' })
          return
        }
        const archived = archivedIds?.includes(body.sessionId) === true
        if (live === null && !archived) {
          sendJson(res, 404, { ok: false, code: 'session-not-found', sessionId: body.sessionId })
          return
        }
        let title = null
        if (live !== null) {
          try {
            title = getService('sessionTitle')?.get?.(live)?.title ?? null
          } catch {
            title = null
          }
        }
        sendJson(res, 200, { ok: true, sessionId: body.sessionId, live: live !== null, archived, title })
      },
      `dsh-session-grove: POST ${CONTROL_SESSION_INSPECT_PATH}`,
    )
  }

  {
    sessionRenamePath = register(
      CONTROL_SESSION_RENAME_PATH,
      async (req, res) => {
        if (controlUnavailable(res)) return
        if (controlDenied(req, res)) return
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        const body = await readControlJson(req, res)
        if (body === null) return
        const unexpected = unexpectedControlField(body, new Set(['sessionId', 'title', 'expectedTitle']))
        if (unexpected !== null) {
          sendJson(res, 422, { ok: false, code: 'unexpected-field', message: `unexpected top-level field "${unexpected}"`, field: unexpected })
          return
        }
        if (typeof body.sessionId !== 'string' || body.sessionId.length === 0 || hasControlChars(body.sessionId)) {
          sendJson(res, 422, { ok: false, code: 'invalid-session-id', field: 'sessionId' })
          return
        }
        if (typeof body.title !== 'string' || body.title.length === 0 || hasControlChars(body.title)) {
          sendJson(res, 422, { ok: false, code: 'invalid-title', field: 'title' })
          return
        }
        if (body.expectedTitle !== undefined && (typeof body.expectedTitle !== 'string' || hasControlChars(body.expectedTitle))) {
          sendJson(res, 422, { ok: false, code: 'invalid-title', field: 'expectedTitle' })
          return
        }
        const sessions = getService('sessions')
        const titleService = getService('sessionTitle')
        if (sessions === null || typeof sessions.get !== 'function' || titleService === null || typeof titleService.rename !== 'function') {
          sendJson(res, 503, { ok: false, code: 'service-unavailable', message: 'session services are unavailable' })
          return
        }
        const live = sessions.get(body.sessionId) ?? null
        if (live === null) {
          sendJson(res, 409, { ok: false, code: 'session-not-live', message: 'session title can only be changed while live' })
          return
        }
        let current = null
        try {
          current = titleService.get?.(live)?.title ?? null
        } catch {
          current = null
        }
        if (body.expectedTitle !== undefined && body.expectedTitle !== current) {
          sendJson(res, 409, { ok: false, code: 'title-changed', expectedTitle: body.expectedTitle, title: current })
          return
        }
        if (current === body.title) {
          sendJson(res, 200, { ok: true, sessionId: body.sessionId, title: body.title })
          return
        }
        try {
          const next = titleService.rename(live, body.title)
          sendJson(res, 200, { ok: true, sessionId: body.sessionId, title: next?.title ?? body.title })
        } catch (error) {
          sendJson(res, 422, {
            ok: false,
            code: 'session-operation-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
      `dsh-session-grove: POST ${CONTROL_SESSION_RENAME_PATH}`,
    )
  }

  {
    sessionArchivePath = register(
      CONTROL_SESSION_ARCHIVE_PATH,
      async (req, res) => {
        if (controlUnavailable(res)) return
        if (controlDenied(req, res)) return
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        const body = await readControlJson(req, res)
        if (body === null) return
        const unexpected = unexpectedControlField(body, new Set(['sessionId', 'archived', 'expectedArchived', 'stopActivity']))
        if (unexpected !== null) {
          sendJson(res, 422, { ok: false, code: 'unexpected-field', message: `unexpected top-level field "${unexpected}"`, field: unexpected })
          return
        }
        if (typeof body.sessionId !== 'string' || body.sessionId.length === 0 || hasControlChars(body.sessionId)) {
          sendJson(res, 422, { ok: false, code: 'invalid-session-id', field: 'sessionId' })
          return
        }
        if (typeof body.archived !== 'boolean') {
          sendJson(res, 422, { ok: false, code: 'invalid-archived', field: 'archived' })
          return
        }
        if (body.expectedArchived !== undefined && typeof body.expectedArchived !== 'boolean') {
          sendJson(res, 422, { ok: false, code: 'invalid-archived', field: 'expectedArchived' })
          return
        }
        if (body.stopActivity !== undefined && typeof body.stopActivity !== 'boolean') {
          sendJson(res, 422, { ok: false, code: 'invalid-stop-activity', field: 'stopActivity' })
          return
        }
        const registry = getService('workspaceRegistry')
        if (registry === null || typeof registry.archiveSession !== 'function' || typeof registry.unarchiveSession !== 'function') {
          sendJson(res, 503, { ok: false, code: 'service-unavailable', message: 'workspace registry is unavailable' })
          return
        }
        const current = Array.isArray(registry.archivedSessionIds) && registry.archivedSessionIds.includes(body.sessionId)
        if (body.expectedArchived !== undefined && body.expectedArchived !== current) {
          sendJson(res, 409, { ok: false, code: 'archive-changed', expectedArchived: body.expectedArchived, archived: current })
          return
        }
        if (current === body.archived) {
          sendJson(res, 200, { ok: true, sessionId: body.sessionId, archived: current })
          return
        }
        try {
          if (body.archived) {
            await registry.archiveSession(body.sessionId, body.stopActivity === true ? { stopActivity: true } : {})
          } else {
            await registry.unarchiveSession(body.sessionId)
          }
          sendJson(res, 200, { ok: true, sessionId: body.sessionId, archived: body.archived })
        } catch (error) {
          sendJson(res, 409, {
            ok: false,
            code: 'session-operation-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
      `dsh-session-grove: POST ${CONTROL_SESSION_ARCHIVE_PATH}`,
    )
  }


  return { sessionInspectPath, sessionRenamePath, sessionArchivePath }
}
