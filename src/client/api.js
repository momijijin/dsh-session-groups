/**
 * Client HTTP for the group-doc routes.
 *
 * Same-origin only: every request is resolved against `document.baseURI`
 * (never a hardcoded host/port), matching CONTRACTS §4. The module is pure
 * enough to unit-test by injecting `fetchImpl` / `baseURI`.
 */

/** Relative load route (host mounts it at the origin root). */
export const LOAD_PATH = 'dsh-session-groups/load'
/** Relative commit route. */
export const COMMIT_PATH = 'dsh-session-groups/commit'

/** Error codes surfaced to the shell (all non-ok outcomes). */
export const API_ERRORS = Object.freeze({
  NETWORK: 'network',
  NOT_JSON: 'not-json',
  FENCE: 'fence-unavailable',
  IO: 'io',
  INVALID: 'invalid',
  UNSUPPORTED_VERSION: 'unsupported-version',
  CONFLICT: 'conflict',
  HTTP: 'http',
})

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const resolveUrl = (path, baseURI) => {
  try {
    return new URL(path, baseURI).toString()
  } catch {
    return path
  }
}

const classifyStatus = (status) => {
  if (status === 503) return API_ERRORS.FENCE
  if (status === 409) return API_ERRORS.CONFLICT
  if (status === 422) return API_ERRORS.INVALID
  if (status === 413 || status === 415) return API_ERRORS.HTTP
  return API_ERRORS.HTTP
}

/**
 * Create the API facade.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   baseURI?: string,
 *   documentRef?: { baseURI?: string },
 * }} [options]
 */
export const createApi = ({ fetchImpl = globalThis.fetch, baseURI, documentRef = globalThis.document } = {}) => {
  const base = baseURI ?? documentRef?.baseURI ?? 'http://localhost/'
  const url = (path) => resolveUrl(path, base)

  const request = async (path, init) => {
    if (typeof fetchImpl !== 'function') return { networkError: 'fetch-unavailable' }
    try {
      const response = await fetchImpl(url(path), init)
      const contentType = typeof response.headers?.get === 'function' ? response.headers.get('content-type') : null
      let body = null
      if (typeof response.json === 'function') {
        try {
          body = await response.json()
        } catch {
          body = null
        }
      }
      return { status: response.status, ok: response.ok === true, contentType, body }
    } catch (error) {
      return { networkError: String(error?.message ?? error) }
    }
  }

  /** Map a raw response to a stable client outcome. */
  const classify = (raw, { committed = false } = {}) => {
    if (raw.networkError) return { ok: false, code: API_ERRORS.NETWORK, message: raw.networkError }
    const body = isObject(raw.body) ? raw.body : null
    if (committed && raw.status === 409) {
      if (body?.code === API_ERRORS.CONFLICT || body?.code === undefined) {
        return { ok: false, code: API_ERRORS.CONFLICT, conflict: true, status: raw.status, revision: body?.revision, doc: body?.doc, message: body?.message }
      }
      if (body?.code === API_ERRORS.UNSUPPORTED_VERSION) {
        return { ok: false, code: API_ERRORS.UNSUPPORTED_VERSION, status: raw.status, message: body?.message }
      }
    }
    if (body && body.ok === false) {
      return { ok: false, code: body.code ?? classifyStatus(raw.status), status: raw.status, message: body.message }
    }
    if (raw.ok && body && body.ok === true) {
      return { ok: true, status: raw.status, revision: body.revision, doc: body.doc, warning: body.warning }
    }
    if (body === null) {
      // Removed plugin / SPA fallback answers 404 without JSON (CONTRACTS §6).
      return { ok: false, code: API_ERRORS.NOT_JSON, status: raw.status, message: 'non-json response' }
    }
    return { ok: false, code: classifyStatus(raw.status), status: raw.status, message: body?.message ?? `http ${raw.status}` }
  }

  /** GET the group document. */
  const load = async () => {
    const raw = await request(LOAD_PATH, { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } })
    const result = classify(raw)
    if (!result.ok && result.code === API_ERRORS.NOT_JSON && raw.status === 404) {
      return { ...result, code: API_ERRORS.NOT_JSON, routeUnavailable: true }
    }
    return result
  }

  /** POST a new doc with optimistic concurrency. */
  const commit = async (doc, baseRevision) => {
    const raw = await request(COMMIT_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ baseRevision, doc }),
    })
    return classify(raw, { committed: true })
  }

  return { load, commit, url }
}
