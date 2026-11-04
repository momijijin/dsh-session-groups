/**
 * Pure request/response helpers for the group-store routes.
 * Extracted from routes.js without changing the wire contract.
 */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { DOC_VERSION } from '../shared/constants.js'
import { normalizeColor, normalizeColorHex, validateDoc } from '../shared/model.js'
import { MAX_BODY_BYTES, MAX_DIAGNOSTICS_EVENTS } from './constants.js'

export const sendJson = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

export const sendEmpty = (res, status) => {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.end()
}

export const sendMethodNotAllowed = (res, allow) => {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.setHeader('cache-control', 'no-store')
  res.end()
}

export const contentTypeOf = (req) => {
  const raw = req?.headers?.['content-type']
  if (typeof raw !== 'string') return ''
  return raw.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Read a bounded request body; drains past the ceiling so the socket settles. */
export const readBoundedBody = async (req, limit = MAX_BODY_BYTES) => {
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

export const controlPlanHash = (baseRevision, operations) =>
  createHash('sha256').update(JSON.stringify({ baseRevision, operations })).digest('hex')

export const unexpectedControlField = (body, allowed) => {
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
