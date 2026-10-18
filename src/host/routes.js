/**
 * The two host routes.
 *
 * GET  /dsh-session-groups/load    -> current revision + document
 * POST /dsh-session-groups/commit  -> compare-and-set write
 *
 * Frozen contract: docs/CONTRACTS.md §2.
 * Status matrix: 200 / 400 (unreadable body) / 405+Allow / 409 conflict /
 * 409 unsupported-version / 413 / 415 / 422 / 503 fence-unavailable|io.
 * Responses are JSON, `cache-control: no-store`, and never set CORS headers.
 * The fence runs before method/body handling.
 */

import { basename } from 'node:path'
import { DOC_VERSION } from '../shared/constants.js'
import { validateDoc } from '../shared/model.js'
import { COMMIT_PATH, LOAD_PATH, MAX_BODY_BYTES } from './constants.js'
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
const readBoundedBody = async (req) => {
  const declaredLength = Number(req?.headers?.['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    req.resume?.()
    return { tooLarge: true }
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume?.()
      return { tooLarge: true }
    }
    chunks.push(chunk)
  }
  return { text: Buffer.concat(chunks, size).toString('utf8') }
}

/** Map a store load result to the wire response. */
export const loadResponse = (result) => {
  if (result.kind === 'unsupported-version') {
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
  const verdict = validateDoc(candidate)
  if (!verdict.ok) return { ok: false, message: verdict.errors.join('; ') }
  return { ok: true, baseRevision, doc: candidate }
}

/**
 * Register both routes on the composition's webServer. Each registration is
 * wrapped in `ctx.effect` so it disappears when the plugin is disposed.
 * Fail-soft: a composition without a webServer only logs a warning.
 * @returns {{ registered: boolean, routes: string[] }}
 */
export const registerRoutes = (ctx, store) => {
  if (typeof ctx?.webServer?.register !== 'function') {
    logWarn(ctx, 'dsh-session-groups: webServer.register is unavailable; host routes are not mounted')
    return { registered: false, routes: [] }
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
        sendJson(res, status, body)
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
        sendJson(res, status, payload)
      } catch (error) {
        logWarn(ctx, `dsh-session-groups: commit failed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(res, 503, { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) })
      }
    },
    `dsh-session-groups: POST ${COMMIT_PATH}`,
  )

  return { registered: true, routes: [loadPath, commitPath] }
}
