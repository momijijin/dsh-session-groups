/**
 * The host routes.
 *
 * GET  /dsh-session-grove/load         -> current revision + document
 * POST /dsh-session-grove/commit       -> compare-and-set write
 * POST /dsh-session-grove/diagnostics  -> append-only drag trace (0.2.5)
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
import { registerControlRoutes } from './control-routes.js'
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
    logWarn(ctx, 'dsh-session-grove: webServer.register is unavailable; host routes are not mounted')
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
        `[dsh-session-grove] request fence: ${fence.via} (mode=${probe.mode} requestRejection=${String(
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
            `dsh-session-grove: load warning ${result.warning}: ${result.detail ?? ''} (quarantined: ${
              result.quarantinedTo ?? 'no'
            })`,
          )
        }
        const { status, body } = loadResponse(result)
        sendJson(res, status, { ...body, diagnostics: diagnosticsEnabled(), debugProbe: debugProbeEnabled() })
      } catch (error) {
        logWarn(ctx, `dsh-session-grove: load failed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
      }
    },
    `dsh-session-grove: GET ${LOAD_PATH}`,
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
        logWarn(ctx, `dsh-session-grove: commit failed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
      }
    },
    `dsh-session-grove: POST ${COMMIT_PATH}`,
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
          `dsh-session-grove: diagnostics append failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
      }
    },
    `dsh-session-grove: POST ${DIAGNOSTICS_PATH}`,
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
    `dsh-session-grove: POST ${DEBUG_PATH}`,
  )

  let controlStatePath = null
  let controlCatalogPath = null
  let controlDoctorPath = null
  let controlResolvePath = null
  let controlPlanPath = null
  let controlApplyPath = null
  let sessionInspectPath = null
  let sessionRenamePath = null
  let sessionArchivePath = null
  let skillRepairPath = null
  let eventsPath = null
    const controlRoutes = registerControlRoutes({
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
  })
  eventsPath = controlRoutes.eventsPath
  controlDoctorPath = controlRoutes.controlDoctorPath
  controlStatePath = controlRoutes.controlStatePath
  controlCatalogPath = controlRoutes.controlCatalogPath
  controlResolvePath = controlRoutes.controlResolvePath
  controlPlanPath = controlRoutes.controlPlanPath
  controlApplyPath = controlRoutes.controlApplyPath

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
      `dsh-session-grove: POST ${SKILL_REPAIR_PATH}`,
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
      ...(controlStatePath === null ? [] : [controlStatePath, controlCatalogPath, controlResolvePath, controlPlanPath, controlApplyPath]),
      ...(sessionInspectPath === null ? [] : [sessionInspectPath, sessionRenamePath, sessionArchivePath]),
      ...(skillRepairPath === null ? [] : [skillRepairPath]),
    ],
  }
}
