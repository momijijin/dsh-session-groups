/**
 * Control/event/doctor route registration.
 * Extracted from routes.js; route order and wire behavior are unchanged.
 */
import {
  CONTROL_APPLY_PATH,
  CONTROL_CATALOG_PATH,
  CONTROL_DOCTOR_PATH,
  CONTROL_PLAN_PATH,
  CONTROL_RESOLVE_PATH,
  CONTROL_STATE_PATH,
  EVENTS_PATH,
  MAX_CONTROL_BODY_BYTES,
} from './constants.js'
import { buildControlCatalog } from '../core/catalog.js'
import { applyControlOperations, buildControlState, CONTROL_PROTOCOL, resolveGroupPath } from '../core/control.js'

export const registerControlRoutes = (deps) => {
  const {
    register,
    store,
    ctx,
    options,
    changeHub,
    fenceDenied,
    controlDenied,
    controlUnavailable,
    controlDestructiveEnabled,
    sendJson,
    sendMethodNotAllowed,
    contentTypeOf,
    readBoundedBody,
    unexpectedControlField,
    loadResponse,
    commitResponse,
    controlPlanHash,
    publishChange,
    logInfo,
  } = deps

  let controlStatePath = null
  let controlCatalogPath = null
  let controlDoctorPath = null
  let controlResolvePath = null
  let controlPlanPath = null
  let controlApplyPath = null
  let eventsPath = null

if (changeHub !== null) {
    eventsPath = register(
      EVENTS_PATH,
      async (req, res) => {
        if (fenceDenied(req, res)) return
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        res.statusCode = 200
        res.setHeader('cache-control', 'no-store')
        res.setHeader('content-type', 'text/event-stream; charset=utf-8')
        res.setHeader('connection', 'keep-alive')
        res.writeHead?.(200, {
          'cache-control': 'no-store',
          'content-type': 'text/event-stream; charset=utf-8',
          connection: 'keep-alive',
        })
        res.write?.('retry: 10000\n\n')
        res.write?.('event: ready\ndata: {}\n\n')
        const unsubscribe = changeHub.subscribe(res)
        let cleaned = false
        const cleanup = () => {
          if (cleaned) return
          cleaned = true
          clearInterval(keepalive)
          unsubscribe?.()
        }
        const keepalive = setInterval(() => {
          try {
            res.write?.(': keepalive\n\n')
          } catch {
            cleanup()
          }
        }, 15000)
        keepalive.unref?.()
        req.on?.('close', cleanup)
        res.on?.('close', cleanup)
      },
      `dsh-session-grove: GET ${EVENTS_PATH}`,
    )
  }
  {
    const idempotency = new Map()
    const remember = (key, value) => {
      if (!key) return
      idempotency.set(key, value)
      if (idempotency.size > 128) idempotency.delete(idempotency.keys().next().value)
    }

    controlDoctorPath = register(
      CONTROL_DOCTOR_PATH,
      async (req, res) => {
        if (controlDenied(req, res)) return
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        if (typeof options.doctorReport !== 'function') {
          sendJson(res, 503, {
            ok: false,
            code: 'doctor-unavailable',
            message: 'compatibility doctor is not configured',
          })
          return
        }
        try {
          const report = await options.doctorReport()
          sendJson(res, 200, report)
        } catch (error) {
          sendJson(res, 503, {
            ok: false,
            code: 'doctor-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
      `dsh-session-grove: GET ${CONTROL_DOCTOR_PATH}`,
    )

    controlStatePath = register(
      CONTROL_STATE_PATH,
      async (req, res) => {
        if (controlUnavailable(res)) return
        if (controlDenied(req, res)) return
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        try {
          const result = await store.load()
          if (result.kind === 'unsupported-version') {
            sendJson(res, 409, loadResponse(result).body)
            return
          }
          sendJson(res, 200, { ok: true, ...buildControlState(result.doc, result.revision) })
        } catch (error) {
          sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
        }
      },
      `dsh-session-grove: GET ${CONTROL_STATE_PATH}`,
    )

    controlCatalogPath = register(
      CONTROL_CATALOG_PATH,
      async (req, res) => {
        if (controlUnavailable(res)) return
        if (controlDenied(req, res)) return
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        sendJson(res, 200, { ok: true, ...buildControlCatalog() })
      },
      `dsh-session-grove: GET ${CONTROL_CATALOG_PATH}`,
    )

    controlResolvePath = register(
      CONTROL_RESOLVE_PATH,
      async (req, res) => {
        if (controlUnavailable(res)) return
        if (controlDenied(req, res)) return
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (contentTypeOf(req) !== 'application/json') {
          sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
          return
        }
        let body
        try {
          const read = await readBoundedBody(req, MAX_CONTROL_BODY_BYTES)
          if (read.tooLarge === true) {
            sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
            return
          }
          body = JSON.parse(read.text)
        } catch {
          sendJson(res, 422, { ok: false, code: 'invalid', message: 'body is not valid JSON' })
          return
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(res, 422, { ok: false, code: 'invalid-body', message: 'body must be a JSON object' })
          return
        }
        const unexpected = unexpectedControlField(body, new Set(['path', 'baseRevision']))
        if (unexpected !== null) {
          sendJson(res, 422, {
            ok: false,
            code: 'unexpected-field',
            message: `unexpected top-level field "${unexpected}"`,
            field: unexpected,
          })
          return
        }
        if (body.baseRevision !== undefined && (!Number.isInteger(body.baseRevision) || body.baseRevision < 0)) {
          sendJson(res, 422, {
            ok: false,
            code: 'invalid-revision',
            message: 'baseRevision must be a non-negative integer',
            field: 'baseRevision',
          })
          return
        }
        try {
          const result = await store.load()
          if (result.kind === 'unsupported-version') {
            sendJson(res, 409, loadResponse(result).body)
            return
          }
          if (body.baseRevision !== undefined && result.revision !== body.baseRevision) {
            sendJson(res, 409, {
              ok: false,
              code: 'revision-mismatch',
              message: 'revision changed before path resolution',
              revision: result.revision,
            })
            return
          }
          const resolved = resolveGroupPath(result.doc, body.path)
          if (!resolved.ok) {
            const status = resolved.code === 'ambiguous-path' ? 409 : resolved.code === 'invalid-path' ? 422 : 404
            sendJson(res, status, resolved)
            return
          }
          sendJson(res, 200, { ...resolved, protocol: CONTROL_PROTOCOL, revision: result.revision })
        } catch (error) {
          sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
        }
      },
      `dsh-session-grove: POST ${CONTROL_RESOLVE_PATH}`,
    )

    controlPlanPath = register(
      CONTROL_PLAN_PATH,
      async (req, res) => {
        if (controlUnavailable(res)) return
        if (controlDenied(req, res)) return
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (contentTypeOf(req) !== 'application/json') {
          sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
          return
        }
        let body
        try {
          const read = await readBoundedBody(req, MAX_CONTROL_BODY_BYTES)
          if (read.tooLarge === true) {
            sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
            return
          }
          body = JSON.parse(read.text)
        } catch {
          sendJson(res, 422, { ok: false, code: 'invalid', message: 'body is not valid JSON' })
          return
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(res, 422, { ok: false, code: 'invalid-body', message: 'body must be a JSON object' })
          return
        }
        const unexpected = unexpectedControlField(body, new Set(['baseRevision', 'operations']))
        if (unexpected !== null) {
          sendJson(res, 422, {
            ok: false,
            code: 'unexpected-field',
            message: `unexpected top-level field "${unexpected}"`,
            field: unexpected,
          })
          return
        }
        const baseRevision = body?.baseRevision
        const operations = body?.operations
        if (!Number.isInteger(baseRevision) || baseRevision < 0) {
          sendJson(res, 422, { ok: false, code: 'invalid-revision', message: 'baseRevision must be a non-negative integer' })
          return
        }
        try {
          const result = await store.load()
          if (result.kind === 'unsupported-version') {
            sendJson(res, 409, loadResponse(result).body)
            return
          }
          if (result.revision !== baseRevision) {
            sendJson(res, 409, { ok: false, code: 'conflict', message: 'revision mismatch', revision: result.revision })
            return
          }
          const planned = applyControlOperations(result.doc, operations, {
            allowDestructive: controlDestructiveEnabled(),
          })
          if (!planned.ok) {
            sendJson(res, 422, planned)
            return
          }
          sendJson(res, 200, {
            ok: true,
            protocol: CONTROL_PROTOCOL,
            baseRevision,
            planHash: controlPlanHash(baseRevision, operations),
            changes: planned.changes,
          })
        } catch (error) {
          sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
        }
      },
      `dsh-session-grove: POST ${CONTROL_PLAN_PATH}`,
    )

    controlApplyPath = register(
      CONTROL_APPLY_PATH,
      async (req, res) => {
        if (controlUnavailable(res)) return
        if (controlDenied(req, res)) return
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (contentTypeOf(req) !== 'application/json') {
          sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
          return
        }
        let body
        try {
          const read = await readBoundedBody(req, MAX_CONTROL_BODY_BYTES)
          if (read.tooLarge === true) {
            sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
            return
          }
          body = JSON.parse(read.text)
        } catch {
          sendJson(res, 422, { ok: false, code: 'invalid', message: 'body is not valid JSON' })
          return
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(res, 422, { ok: false, code: 'invalid-body', message: 'body must be a JSON object' })
          return
        }
        const unexpected = unexpectedControlField(
          body,
          new Set(['baseRevision', 'operations', 'planHash', 'idempotencyKey']),
        )
        if (unexpected !== null) {
          sendJson(res, 422, {
            ok: false,
            code: 'unexpected-field',
            message: `unexpected top-level field "${unexpected}"`,
            field: unexpected,
          })
          return
        }
        if (
          body.idempotencyKey !== undefined &&
          (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0 || body.idempotencyKey.length > 128)
        ) {
          sendJson(res, 422, {
            ok: false,
            code: 'invalid-idempotency-key',
            message: 'idempotencyKey must be a non-empty string of at most 128 characters',
            field: 'idempotencyKey',
          })
          return
        }
        const baseRevision = body?.baseRevision
        const operations = body?.operations
        const planHash = body?.planHash
        const idempotencyKey = body?.idempotencyKey ?? null
        if (!Number.isInteger(baseRevision) || baseRevision < 0) {
          sendJson(res, 422, { ok: false, code: 'invalid-revision', message: 'baseRevision must be a non-negative integer' })
          return
        }
        if (typeof planHash !== 'string' || planHash.length === 0) {
          sendJson(res, 422, { ok: false, code: 'invalid-plan', message: 'planHash is required' })
          return
        }
        const expectedHash = controlPlanHash(baseRevision, operations)
        if (expectedHash !== planHash) {
          sendJson(res, 409, { ok: false, code: 'stale-plan', message: 'planHash does not match baseRevision + operations' })
          return
        }
        if (idempotencyKey !== null) {
          const cached = idempotency.get(idempotencyKey)
          if (cached !== undefined) {
            if (cached.planHash !== planHash) {
              sendJson(res, 409, { ok: false, code: 'idempotency-conflict', message: 'idempotencyKey was used for another plan' })
              return
            }
            sendJson(res, 200, cached.body)
            return
          }
        }
        try {
          const result = await store.load()
          if (result.kind === 'unsupported-version') {
            sendJson(res, 409, loadResponse(result).body)
            return
          }
          if (result.revision !== baseRevision) {
            sendJson(res, 409, { ok: false, code: 'conflict', message: 'revision mismatch', revision: result.revision })
            return
          }
          const planned = applyControlOperations(result.doc, operations, {
            allowDestructive: controlDestructiveEnabled(),
          })
          if (!planned.ok) {
            sendJson(res, 422, planned)
            return
          }
          const committed = await store.commit(baseRevision, planned.doc)
          const { status, body: committedBody } = commitResponse(committed)
          if (status === 200) {
            const responseBody = {
              ...committedBody,
              protocol: CONTROL_PROTOCOL,
              planHash,
              changes: planned.changes,
            }
            publishChange(committed.revision, 'control-apply')
            if (idempotencyKey !== null) remember(idempotencyKey, { planHash, body: responseBody })
            logInfo(
              ctx,
              `[dsh-session-grove] control apply revision=${String(committed.revision)} plan=${planHash.slice(0, 12)} operations=${String(planned.changes.length)}`,
            )
            sendJson(res, 200, responseBody)
            return
          }
          sendJson(res, status, committedBody)
        } catch (error) {
          sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
        }
      },
      `dsh-session-grove: POST ${CONTROL_APPLY_PATH}`,
    )
  }

  
  return { eventsPath, controlStatePath, controlCatalogPath, controlDoctorPath, controlResolvePath, controlPlanPath, controlApplyPath }
}
