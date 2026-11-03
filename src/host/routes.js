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
import {
  COMMIT_PATH,
  CONTROL_APPLY_PATH,
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

const sendJson = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

const sendEmpty = (res, status) => {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.end()
}

const sendMethodNotAllowed = (res, allow) => {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('cache-control', 'no-store')
  res.end()
}

const contentTypeOf = (req) => {
  const raw = req?.headers?.['content-type']
  if (typeof raw !== 'string') return ''
  return raw.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Read a bounded request body; drains past the ceiling so the socket settles. */
const readBoundedBody = async (req, limit = MAX_BODY_BYTES) => {
  const declaredLength = Number(req?.headers?.['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    req.resume?.()
    return { tooLarge: true }
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > limit) {
      req.resume?.()
      return { tooLarge: true }
    }
    chunks.push(chunk)
  }
  return { text: Buffer.concat(chunks, size).toString('utf8') }
}

const controlPlanHash = (baseRevision, operations) =>
  createHash('sha256').update(JSON.stringify({ baseRevision, operations })).digest('hex')

const unexpectedControlField = (body, allowed) => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  return Object.keys(body).find((key) => !allowed.has(key)) ?? null
}

/** Map a store load result to the wire response. */
export const loadResponse = (result) => {  if (result.kind === 'unsupported-version') {
    return {
      status: 409,
      body: {
        ok: false,
        code: 'unsupported-version',
        message: `document version ${String(result.version)} is newer than this host supports`,
        version: result.version,
      },
    }
  }
  const body = { ok: true, revision: result.revision, doc: result.doc }
  if (result.warning !== undefined) {
    body.warning = result.warning
    if (result.detail !== undefined) body.detail = result.detail
    if (result.quarantinedTo !== null && result.quarantinedTo !== undefined) {
      body.quarantinedTo = basename(result.quarantinedTo)
    }
  }
  return { status: 200, body }
}

/** Map a store commit result to the wire response. */
export const commitResponse = (result) => {
  switch (result.kind) {
    case 'ok':
      return { status: 200, body: { ok: true, revision: result.revision, doc: result.doc } }
    case 'conflict':
      return {
        status: 409,
        body: {
          ok: false,
          code: 'conflict',
          message: 'revision mismatch',
          revision: result.revision,
          doc: result.doc,
        },
      }
    case 'invalid':
      return { status: 422, body: { ok: false, code: 'invalid', message: result.errors.join('; ') } }
    case 'unsupported-version':
      return {
        status: 409,
        body: {
          ok: false,
          code: 'unsupported-version',
          message: `document version ${String(result.version)} is newer than this host supports`,
          version: result.version,
        },
      }
    default:
      throw new Error(`unknown store result ${JSON.stringify(result.kind)}`)
  }
}

/** Validate one commit request body; returns `{ ok, baseRevision, doc }`. */
export const parseCommitBody = (body) => {
  if (!isObject(body)) return { ok: false, message: 'body must be a JSON object' }
  const { baseRevision, doc } = body
  if (!Number.isInteger(baseRevision) || baseRevision < 0) {
    return { ok: false, message: 'baseRevision must be a non-negative integer' }
  }
  if (!isObject(doc)) return { ok: false, message: 'doc must be a JSON object' }
  // The host owns revision: ignore whatever the client sent and validate the
  // frozen shape/invariants via the shared model.
  const candidate = {
    version: doc.version,
    revision: 0,
    groups: doc.groups,
    ungrouped: doc.ungrouped,
  }
  if (candidate.version !== DOC_VERSION) {
    return { ok: false, message: `version must be ${String(DOC_VERSION)}` }
  }
  // 0.2.7: normalize a valid custom hex (short form/uppercase -> canonical
  // lowercase #rrggbb) before validation. Invalid/alpha values stay as-is so
  // validateDoc rejects them with a `group-color-hex` error.
  candidate.groups = Array.isArray(candidate.groups)
    ? candidate.groups.map((group) => {
        if (!isObject(group) || group.colorHex === undefined) return group
        const hex = normalizeColorHex(group.colorHex)
        return hex ? { ...group, colorHex: hex } : group
      })
    : candidate.groups
  const verdict = validateDoc(candidate)
  if (!verdict.ok) return { ok: false, message: verdict.errors.join('; ') }
  // 0.2.6 additive: validation accepts a missing `color` (legacy docs), while
  // the host normalizes every persisted group to an explicit palette id so new
  // writes never depend on the client-side blue fallback.
  candidate.groups = candidate.groups.map((group) => ({ ...group, color: normalizeColor(group.color) }))
  return { ok: true, baseRevision, doc: candidate }
}

/**
 * Validate one diagnostics batch. The route is append-only and never validates
 * event internals: the client owns the schema, the host only enforces a bounded
 * batch so one request cannot grow the file without limit.
 *
 * @returns {{ ok: true, runId: string|null, schemaVersion: number|null, events: object[] } | { ok: false, message: string }}
 */
export const parseDiagnosticsBody = (body) => {
  if (!isObject(body)) return { ok: false, message: 'body must be a JSON object' }
  const { events } = body
  if (!Array.isArray(events)) return { ok: false, message: 'events must be an array' }
  if (events.length === 0) return { ok: false, message: 'events must not be empty' }
  if (events.length > MAX_DIAGNOSTICS_EVENTS) {
    return { ok: false, message: `events must contain at most ${String(MAX_DIAGNOSTICS_EVENTS)} entries` }
  }
  if (!events.every((event) => isObject(event))) return { ok: false, message: 'events must be JSON objects' }
  const runId = typeof body.runId === 'string' && body.runId.length > 0 ? body.runId.slice(0, 128) : null
  const schemaVersion = Number.isInteger(body.schemaVersion) && body.schemaVersion > 0 ? body.schemaVersion : null
  return { ok: true, runId, schemaVersion, events }
}

/**
 * Register the routes on the composition's webServer. Each registration is
 * wrapped in `ctx.effect` so it disappears when the plugin is disposed.
 * Fail-soft: a composition without a webServer only logs a warning.
 *
 * @param {object} ctx Cordis context.
 * @param {object} store group document store.
 * @param {{ diagnosticsFilePath?: string | null, debugFilePath?: string | null, diagnosticsEnabled?: boolean | (() => boolean), debugProbeEnabled?: boolean | (() => boolean) }} [options] host-half options
 *   (`diagnosticsFilePath` is resolved from `dshHomePath('storages')`; diagnostics default true for direct route
 *   tests, while the Cordis entry passes the plugin config flag).
 * @returns {{ registered: boolean, routes: string[] }}
 */
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
      `dsh-session-groups: POST ${CONTROL_SESSION_INSPECT_PATH}`,
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
      `dsh-session-groups: POST ${CONTROL_SESSION_RENAME_PATH}`,
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
      `dsh-session-groups: POST ${CONTROL_SESSION_ARCHIVE_PATH}`,
    )
  }

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
          const result = repairManagedSkill({ dshHome: skillDshHome, force: true })
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
      ...(controlStatePath === null ? [] : [controlStatePath, controlResolvePath, controlPlanPath, controlApplyPath]),
      ...(sessionInspectPath === null ? [] : [sessionInspectPath, sessionRenamePath, sessionArchivePath]),
      ...(skillRepairPath === null ? [] : [skillRepairPath]),
    ],
  }
}
