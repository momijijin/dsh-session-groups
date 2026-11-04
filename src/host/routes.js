/**
 * The host routes.
 *
 * GET  /dsh-session-groups/load         -> current revision + document
 * POST /dsh-session-groups/commit       -> compare-and-set write
 * POST /dsh-session-groups/diagnostics  -> append-only drag trace (0.2.5)
 *
 * Frozen contract: docs/CONTRACTS.md §2.
 * Status matrix: 200 / 400 (unreadable body) / 405+Allow / 409 conflict /
 * 409 unsupported-version / 413 / 415 / 422 / 503 fence-unavailable|io.
 * Responses are JSON, `cache-control: no-store`, and never set CORS headers.
 * The fence runs before method/body handling. Diagnostics writes only the
 * dedicated `.ndjson` file under `storages/`, never the official host data.
 */

import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { createHash, timingSafeEqual } from 'node:crypto'
import { basename, dirname } from 'node:path'
import { DOC_VERSION } from '../shared/constants.js'
import { normalizeColor, normalizeColorHex, validateDoc } from '../shared/model.js'
import { applyControlOperations, buildControlState, CONTROL_PROTOCOL, resolveGroupPath } from '../core/control.js'
import { hasControlChars } from '../shared/model.js'
import { repairManagedSkill } from './skill-install.js'
import { registerSessionRoutes } from './session-routes.js'
import {
  COMMIT_PATH,
  CONTROL_APPLY_PATH,
  CONTROL_DOCTOR_PATH,
  CONTROL_PLAN_PATH,
  CONTROL_RESOLVE_PATH,
  CONTROL_SESSION_ARCHIVE_PATH,
  CONTROL_SESSION_INSPECT_PATH,
  CONTROL_SESSION_RENAME_PATH,
  CONTROL_STATE_PATH,
  DEBUG_PATH,
  DIAGNOSTICS_PATH,
  EVENTS_PATH,
  LOAD_PATH,
  MAX_BODY_BYTES,
  MAX_CONTROL_BODY_BYTES,
  MAX_DIAGNOSTICS_BODY_BYTES,
  MAX_DIAGNOSTICS_EVENTS,
  MAX_DIAGNOSTICS_FILE_BYTES,
  SKILL_REPAIR_PATH,
} from './constants.js'
import { fenceRequest, probeConnection } from './fence.js'
import { logInfo, logWarn } from './log.js'

import {
  sendJson,
  sendEmpty,
  sendMethodNotAllowed,
  contentTypeOf,
  isObject,
  readBoundedBody,
  controlPlanHash,
  unexpectedControlField,
  loadResponse,
  commitResponse,
  parseCommitBody,
  parseDiagnosticsBody,
} from './route-contract.js'
export { loadResponse, commitResponse, parseCommitBody, parseDiagnosticsBody } from './route-contract.js'

export const registerRoutes = (ctx, store, options = {}) => {
  if (typeof ctx?.webServer?.register !== 'function') {
    logWarn(ctx, 'dsh-session-groups: webServer.register is unavailable; host routes are not mounted')
    return { registered: false, routes: [] }
  }
  const diagnosticsFilePath =
    typeof options.diagnosticsFilePath === 'string' && options.diagnosticsFilePath.length > 0
      ? options.diagnosticsFilePath
      : null
  const debugFilePath =
    typeof options.debugFilePath === 'string' && options.debugFilePath.length > 0 ? options.debugFilePath : null
  const diagnosticsEnabled = () =>
    typeof options.diagnosticsEnabled === 'function'
      ? options.diagnosticsEnabled() === true
      : options.diagnosticsEnabled !== false
  const debugProbeEnabled = () =>
    typeof options.debugProbeEnabled === 'function'
      ? options.debugProbeEnabled() === true
      : options.debugProbeEnabled === true
  const controlApiEnabled = () => (typeof options.controlApiEnabled === 'function' ? options.controlApiEnabled() === true : options.controlApiEnabled === true)
  const controlDestructiveEnabled = () => (typeof options.controlDestructiveEnabled === 'function' ? options.controlDestructiveEnabled() === true : options.controlDestructiveEnabled === true)
  const controlSessionsEnabled = () => (typeof options.controlSessionsEnabled === 'function' ? options.controlSessionsEnabled() === true : options.controlSessionsEnabled === true)
  const skillDshHome = typeof options.skillDshHome === 'string' && options.skillDshHome.length > 0 ? options.skillDshHome : null
  const changeHub = options.changeHub ?? null
  const publishChange = (revision, source) => {
    try {
      changeHub?.publish?.(revision, source)
    } catch {
      /* notification must never fail a committed write */
    }
  }
  const getService = (name) => {
    try {
      return ctx.get?.(name) ?? null
    } catch {
      return null
    }
  }
  const controlToken = typeof options.controlToken === 'string' && options.controlToken.length > 0 ? options.controlToken : null
  const hasControlToken = (req) => {
    if (controlToken === null) return false
    const header = req.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
    const value = header.slice(7)
    const supplied = Buffer.from(value, 'utf8')
    const expected = Buffer.from(controlToken, 'utf8')
    return supplied.length === expected.length && timingSafeEqual(supplied, expected)
  }
  const controlDenied = (req, res) => (hasControlToken(req) ? false : fenceDenied(req, res))
  const controlUnavailable = (res) => {
    if (controlApiEnabled()) return false
    sendJson(res, 404, { ok: false, code: 'control-disabled' })
    return true
  }
  const readControlJson = async (req, res) => {
    if (contentTypeOf(req) !== 'application/json') {
      sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
      return null
    }
    try {
      const read = await readBoundedBody(req, MAX_CONTROL_BODY_BYTES)
      if (read.tooLarge === true) {
        sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
        return null
      }
      const body = JSON.parse(read.text)
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 422, { ok: false, code: 'invalid-body', message: 'body must be a JSON object' })
        return null
      }
      return body
    } catch {
      sendJson(res, 422, { ok: false, code: 'invalid', message: 'body is not valid JSON' })
      return null
    }
  }

  // The composition's `connection` service may arrive through a sibling row
  // after this plugin activates, so the fence is resolved per request and the
  // winning mechanism is logged once for Gate 1 diagnostics.
  let fenceLogged = false
  const fenceDenied = (req, res) => {
    const fence = fenceRequest(ctx, req)
    if (!fenceLogged) {
      fenceLogged = true
      const probe = probeConnection(ctx)
      logInfo(
        ctx,
        `[dsh-session-groups] request fence: ${fence.via} (mode=${probe.mode} requestRejection=${String(
          probe.requestRejection,
        )} fetchRegister=${String(probe.fetchRegister)})${
          fence.allowed ? '' : `; first request rejected: ${String(fence.status)}`
        }`,
      )
    }
    if (fence.allowed) return false
    if (!fence.available) {
      sendJson(res, 503, {
        ok: false,
        code: 'fence-unavailable',
        message: 'connection.requestRejection is unavailable; refusing to serve group routes',
      })
      return true
    }
    sendEmpty(res, fence.status ?? 403)
    return true
  }

  const register = (path, handler, label) => {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path,
          handler,
        }),
      label,
    )
    return path
  }

  const loadPath = register(
    LOAD_PATH,
    async (req, res) => {
      if (fenceDenied(req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      try {
        const result = await store.load()
        if (result.warning !== undefined) {
          logWarn(
            ctx,
            `dsh-session-groups: load warning ${result.warning}: ${result.detail ?? ''} (quarantined: ${
              result.quarantinedTo ?? 'no'
            })`,
          )
        }
        const { status, body } = loadResponse(result)
        sendJson(res, status, { ...body, diagnostics: diagnosticsEnabled(), debugProbe: debugProbeEnabled() })
      } catch (error) {
        logWarn(ctx, `dsh-session-groups: load failed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
      }
    },
    `dsh-session-groups: GET ${LOAD_PATH}`,
  )

  const commitPath = register(
    COMMIT_PATH,
    async (req, res) => {
      if (fenceDenied(req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      if (contentTypeOf(req) !== 'application/json') {
        sendJson(res, 415, {
          ok: false,
          code: 'unsupported-media-type',
          message: 'content-type must be application/json',
        })
        return
      }

      let text
      try {
        const read = await readBoundedBody(req)
        if (read.tooLarge === true) {
          sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
          return
        }
        text = read.text
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          code: 'bad-request',
          message: `request body unreadable: ${error instanceof Error ? error.message : String(error)}`,
        })
        return
      }

      let body
      try {
        body = JSON.parse(text)
      } catch {
        sendJson(res, 422, { ok: false, code: 'invalid', message: 'body is not valid JSON' })
        return
      }

      const parsed = parseCommitBody(body)
      if (!parsed.ok) {
        sendJson(res, 422, { ok: false, code: 'invalid', message: parsed.message })
        return
      }

      try {
        const result = await store.commit(parsed.baseRevision, parsed.doc)
        const { status, body: payload } = commitResponse(result)
        if (status === 200) publishChange(payload.revision, 'http-commit')
        sendJson(res, status, payload)
      } catch (error) {
        logWarn(ctx, `dsh-session-groups: commit failed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
      }
    },
    `dsh-session-groups: POST ${COMMIT_PATH}`,
  )

  const diagnosticsPath = register(
    DIAGNOSTICS_PATH,
    async (req, res) => {
      if (fenceDenied(req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      if (!diagnosticsEnabled()) {
        sendJson(res, 403, { ok: false, code: 'diagnostics-disabled', message: 'diagnostics are disabled' })
        return
      }
      if (contentTypeOf(req) !== 'application/json') {
        sendJson(res, 415, {
          ok: false,
          code: 'unsupported-media-type',
          message: 'content-type must be application/json',
        })
        return
      }
      if (diagnosticsFilePath === null) {
        sendJson(res, 503, { ok: false, code: 'io', message: 'diagnostics path is not configured' })
        return
      }

      let text
      try {
        const read = await readBoundedBody(req, MAX_DIAGNOSTICS_BODY_BYTES)
        if (read.tooLarge === true) {
          sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
          return
        }
        text = read.text
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          code: 'bad-request',
          message: `request body unreadable: ${error instanceof Error ? error.message : String(error)}`,
        })
        return
      }

      let body
      try {
        body = JSON.parse(text)
      } catch {
        sendJson(res, 422, { ok: false, code: 'invalid', message: 'body is not valid JSON' })
        return
      }
      const parsed = parseDiagnosticsBody(body)
      if (!parsed.ok) {
        sendJson(res, 422, { ok: false, code: 'invalid', message: parsed.message })
        return
      }

      // Append-only NDJSON; one line per event so a truncated tail loses at
      // most one record. create dir, no fsync, never touch the record file.
      const lines = parsed.events
        .map((event) =>
          JSON.stringify({
            receivedAt: new Date().toISOString(),
            runId: parsed.runId,
            schemaVersion: parsed.schemaVersion,
            event,
          })
        )
        .join('\n')
      try {
        await mkdir(dirname(diagnosticsFilePath), { recursive: true })
        try {
          const info = await stat(diagnosticsFilePath)
          if (info.size + Buffer.byteLength(`${lines}\n`, 'utf8') > MAX_DIAGNOSTICS_FILE_BYTES) {
            // Bounded local trace: truncate rather than grow without limit.
            await writeFile(diagnosticsFilePath, '', 'utf8')
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
        await appendFile(diagnosticsFilePath, `${lines}\n`, 'utf8')
        sendJson(res, 200, { ok: true, appended: parsed.events.length })
      } catch (error) {
        logWarn(
          ctx,
          `dsh-session-groups: diagnostics append failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
      }
    },
    `dsh-session-groups: POST ${DIAGNOSTICS_PATH}`,
  )

  const debugPath = register(
    DEBUG_PATH,
    async (req, res) => {
      if (fenceDenied(req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      if (!debugProbeEnabled()) {
        sendJson(res, 404, { ok: false, code: 'debug-disabled', message: 'debug probe is disabled' })
        return
      }
      if (contentTypeOf(req) !== 'application/json') {
        sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
        return
      }
      if (debugFilePath === null) {
        sendJson(res, 503, { ok: false, code: 'io', message: 'debug path is not configured' })
        return
      }
      try {
        const read = await readBoundedBody(req, MAX_BODY_BYTES)
        if (read.tooLarge === true) {
          sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
          return
        }
        const body = JSON.parse(read.text)
        await mkdir(dirname(debugFilePath), { recursive: true })
        await appendFile(
          debugFilePath,
          `${JSON.stringify({ receivedAt: new Date().toISOString(), body })}\n`,
          'utf8'
        )
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 422, {
          ok: false,
          code: 'invalid',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    `dsh-session-groups: POST ${DEBUG_PATH}`,
  )

  let controlStatePath = null
  let controlDoctorPath = null
  let controlResolvePath = null
  let controlPlanPath = null
  let controlApplyPath = null
  let sessionInspectPath = null
  let sessionRenamePath = null
  let sessionArchivePath = null
  let skillRepairPath = null
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
      `dsh-session-groups: GET ${EVENTS_PATH}`,
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
      `dsh-session-groups: GET ${CONTROL_DOCTOR_PATH}`,
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
      `dsh-session-groups: GET ${CONTROL_STATE_PATH}`,
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
      `dsh-session-groups: POST ${CONTROL_RESOLVE_PATH}`,
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
      `dsh-session-groups: POST ${CONTROL_PLAN_PATH}`,
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
              `[dsh-session-groups] control apply revision=${String(committed.revision)} plan=${planHash.slice(0, 12)} operations=${String(planned.changes.length)}`,
            )
            sendJson(res, 200, responseBody)
            return
          }
          sendJson(res, status, committedBody)
        } catch (error) {
          sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
        }
      },
      `dsh-session-groups: POST ${CONTROL_APPLY_PATH}`,
    )
  }

  const sessionRoutes = registerSessionRoutes({
    register,
    controlUnavailable,
    controlDenied,
    controlSessionsEnabled,
    readControlJson,
    getService,
    sendJson,
    sendMethodNotAllowed,
    unexpectedControlField,
  })
  sessionInspectPath = sessionRoutes.sessionInspectPath
  sessionRenamePath = sessionRoutes.sessionRenamePath
  sessionArchivePath = sessionRoutes.sessionArchivePath

  if (skillDshHome !== null) {
    skillRepairPath = register(
      SKILL_REPAIR_PATH,
      async (req, res) => {
        if (fenceDenied(req, res)) return
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        if (!controlApiEnabled()) {
          sendJson(res, 409, {
            ok: false,
            code: 'control-api-disabled',
            message: 'enable controlApi before installing or repairing the control skill',
          })
          return
        }
        try {
          const result = repairManagedSkill({ dshHome: skillDshHome })
          if (result.status === 'skipped-user-owned') {
            sendJson(res, 409, {
              ...result,
              ok: false,
              code: 'skill-user-owned',
              message: 'the existing skill is user-owned; refusing to overwrite it',
            })
            return
          }
          sendJson(res, 200, result)
        } catch (error) {
          sendJson(res, 503, {
            ok: false,
            code: 'skill-install-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
      `dsh-session-groups: POST ${SKILL_REPAIR_PATH}`,
    )
  }

  return {
    registered: true,
    routes: [
      loadPath,
      commitPath,
      diagnosticsPath,
      ...(eventsPath === null ? [] : [eventsPath]),
      debugPath,
      ...(controlDoctorPath === null ? [] : [controlDoctorPath]),
      ...(controlStatePath === null ? [] : [controlStatePath, controlResolvePath, controlPlanPath, controlApplyPath]),
      ...(sessionInspectPath === null ? [] : [sessionInspectPath, sessionRenamePath, sessionArchivePath]),
      ...(skillRepairPath === null ? [] : [skillRepairPath]),
    ],
  }
}
