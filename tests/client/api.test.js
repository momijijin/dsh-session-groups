import test from 'node:test'
import assert from 'node:assert/strict'
import { API_ERRORS, COMMIT_PATH, LOAD_PATH, createApi } from '../../src/client/api.js'

const response = (status, body, contentType = 'application/json') => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
  json: async () => {
    if (body === undefined) throw new Error('no body')
    return body
  },
})

const fakeFetch = (handler) => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

const doc = { version: 1, revision: 3, groups: [], ungrouped: [] }

test('load resolves the relative route against document.baseURI', async () => {
  const fetchImpl = fakeFetch(() => response(200, { ok: true, revision: 3, doc }))
  const api = createApi({ fetchImpl, baseURI: 'http://127.0.0.1:4401/' })
  const result = await api.load()
  assert.equal(result.ok, true)
  assert.equal(result.revision, 3)
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:4401/dsh-session-groups/load')
  assert.match(fetchImpl.calls[0].url, new RegExp(LOAD_PATH))
})

test('load surfaces corrupt-file warnings and upgraded docs', async () => {
  const fetchImpl = fakeFetch(() => response(200, { ok: true, revision: 0, doc, warning: 'corrupt-file' }))
  const result = await createApi({ fetchImpl, baseURI: 'http://x/' }).load()
  assert.equal(result.ok, true)
  assert.equal(result.warning, 'corrupt-file')
})

test('non-JSON 404 is a route-unavailable fallback (not a crash)', async () => {
  const fetchImpl = fakeFetch(() => response(404, undefined, 'text/html'))
  const result = await createApi({ fetchImpl, baseURI: 'http://x/' }).load()
  assert.equal(result.ok, false)
  assert.equal(result.code, API_ERRORS.NOT_JSON)
  assert.equal(result.routeUnavailable, true)
})

test('network failure is classified without throwing', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('ECONNREFUSED')
  })
  const result = await createApi({ fetchImpl, baseURI: 'http://x/' }).load()
  assert.equal(result.ok, false)
  assert.equal(result.code, API_ERRORS.NETWORK)
})

test('commit success returns the new revision and doc', async () => {
  const next = { ...doc, revision: 4 }
  const fetchImpl = fakeFetch((url, init) => {
    const payload = JSON.parse(init.body)
    assert.equal(payload.baseRevision, 3)
    assert.equal(url, 'http://x/dsh-session-groups/commit')
    assert.match(init.headers['content-type'], /json/)
    return response(200, { ok: true, revision: 4, doc: next })
  })
  const result = await createApi({ fetchImpl, baseURI: 'http://x/' }).commit({ ...doc, revision: 999 }, 3)
  assert.equal(result.ok, true)
  assert.equal(result.revision, 4)
  assert.equal(result.doc, next)
  assert.match(fetchImpl.calls[0].url, new RegExp(COMMIT_PATH))
})

test('commit conflict adopts the server doc (409)', async () => {
  const serverDoc = { ...doc, revision: 9 }
  const fetchImpl = fakeFetch(() => response(409, { ok: false, code: 'conflict', revision: 9, doc: serverDoc }))
  const result = await createApi({ fetchImpl, baseURI: 'http://x/' }).commit(doc, 3)
  assert.equal(result.ok, false)
  assert.equal(result.code, API_ERRORS.CONFLICT)
  assert.equal(result.conflict, true)
  assert.equal(result.revision, 9)
  assert.equal(result.doc, serverDoc)
})

test('commit 422/503 classify to stable codes', async () => {
  const invalid = fakeFetch(() => response(422, { ok: false, code: 'invalid', message: 'duplicate session id: s1' }))
  const invalidResult = await createApi({ fetchImpl: invalid, baseURI: 'http://x/' }).commit(doc, 0)
  assert.equal(invalidResult.code, API_ERRORS.INVALID)
  assert.equal(invalidResult.message, 'duplicate session id: s1')

  const fence = fakeFetch(() => response(503, { ok: false, code: 'fence-unavailable' }))
  const fenceResult = await createApi({ fetchImpl: fence, baseURI: 'http://x/' }).commit(doc, 0)
  assert.equal(fenceResult.code, API_ERRORS.FENCE)
})

test('unsupported-version 409 does not look like a doc conflict', async () => {
  const fetchImpl = fakeFetch(() => response(409, { ok: false, code: 'unsupported-version' }))
  const result = await createApi({ fetchImpl, baseURI: 'http://x/' }).commit(doc, 0)
  assert.equal(result.code, API_ERRORS.UNSUPPORTED_VERSION)
  assert.equal(result.conflict, undefined)
})
