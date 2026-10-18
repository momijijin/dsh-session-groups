import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { COMMIT_PATH, LOAD_PATH, MAX_BODY_BYTES } from '../../src/host/constants.js'
import { commitResponse, loadResponse, parseCommitBody } from '../../src/host/routes.js'
import { createStore } from '../../src/host/store.js'
import { makeRequest, makeResponse, makeTempStore, mountRoutes, sampleDoc } from './helpers.js'

/** Fake connection mimicking the host fence: Host/Origin + session cookie. */
const cookieConnection = () => ({
  requestRejection(request) {
    const host = request.headers.host
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host ?? '')) return 403
    if (request.headers['sec-fetch-site'] === 'cross-site') return 403
    const origin = request.headers.origin
    if (typeof origin === 'string') {
      try {
        if (new URL(origin).host !== host) return 403
      } catch {
        return 403
      }
    }
    return request.headers.cookie === 'token=ok' ? undefined : 401
  },
})

const allowedHeaders = { cookie: 'token=ok', 'content-type': 'application/json', origin: 'http://127.0.0.1:4400' }

const commitBody = (baseRevision, doc) => JSON.stringify({ baseRevision, doc })

test('route registration mounts exactly the two frozen paths', async (t) => {
  const mounted = await mountRoutes()
  t.after(() => mounted.cleanup())
  assert.deepEqual(
    mounted.routes.map((route) => `${route.kind}:${route.path}`).sort(),
    [`exact:${COMMIT_PATH}`, `exact:${LOAD_PATH}`].sort(),
  )
  assert.deepEqual(mounted.mounted.routes, [LOAD_PATH, COMMIT_PATH])
})

test('the fence runs first: no connection -> 503 fence-unavailable on both routes', async (t) => {
  const mounted = await mountRoutes()
  t.after(() => mounted.cleanup())

  const load = await mounted.call(LOAD_PATH, makeRequest())
  assert.equal(load.res.statusCode, 503)
  assert.deepEqual(load.json, {
    ok: false,
    code: 'fence-unavailable',
    message: 'connection.requestRejection is unavailable; refusing to serve group routes',
  })

  const commit = await mounted.call(
    COMMIT_PATH,
    makeRequest({ method: 'POST', headers: { 'content-type': 'application/json' }, body: commitBody(0, sampleDoc()) }),
  )
  assert.equal(commit.res.statusCode, 503)
  assert.equal(commit.json.code, 'fence-unavailable')
})

test('the host fence statuses pass through (401 no cookie, 403 foreign host/cross-origin)', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const noCookie = await mounted.call(LOAD_PATH, makeRequest())
  assert.equal(noCookie.res.statusCode, 401)

  const foreignHost = await mounted.call(
    LOAD_PATH,
    makeRequest({ headers: { cookie: 'token=ok', host: 'evil.example:4400' } }),
  )
  assert.equal(foreignHost.res.statusCode, 403)

  const crossOrigin = await mounted.call(
    COMMIT_PATH,
    makeRequest({
      method: 'POST',
      headers: { cookie: 'token=ok', 'content-type': 'application/json', origin: 'http://evil.example' },
      body: commitBody(0, sampleDoc()),
    }),
  )
  assert.equal(crossOrigin.res.statusCode, 403)
})

test('GET load returns 200 JSON, no CORS, no-store, and the empty document', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())
  const { res, json } = await mounted.call(LOAD_PATH, makeRequest({ headers: { cookie: 'token=ok' } }))
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.headers['access-control-allow-origin'], undefined)
  assert.deepEqual(json, {
    ok: true,
    revision: 0,
    doc: { version: 1, revision: 0, groups: [], ungrouped: [] },
  })
})

test('method mismatch returns 405 with an Allow header', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const load = await mounted.call(LOAD_PATH, makeRequest({ method: 'POST', headers: { cookie: 'token=ok' } }))
  assert.equal(load.res.statusCode, 405)
  assert.equal(load.res.headers.allow, 'GET')

  const commit = await mounted.call(COMMIT_PATH, makeRequest({ method: 'GET', headers: { cookie: 'token=ok' } }))
  assert.equal(commit.res.statusCode, 405)
  assert.equal(commit.res.headers.allow, 'POST')
})

test('POST commit: 200 on success, then 409 conflict with the current doc on a stale base', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const first = await mounted.call(
    COMMIT_PATH,
    makeRequest({ method: 'POST', headers: allowedHeaders, body: commitBody(0, { ...sampleDoc(), revision: 999 }) }),
  )
  assert.equal(first.res.statusCode, 200)
  assert.equal(first.json.ok, true)
  assert.equal(first.json.revision, 1)
  assert.equal(first.json.doc.revision, 1)

  const stale = await mounted.call(
    COMMIT_PATH,
    makeRequest({ method: 'POST', headers: allowedHeaders, body: commitBody(0, sampleDoc()) }),
  )
  assert.equal(stale.res.statusCode, 409)
  assert.equal(stale.json.ok, false)
  assert.equal(stale.json.code, 'conflict')
  assert.equal(stale.json.revision, 1)
  assert.equal(stale.json.doc.revision, 1)
})

test('POST commit rejects malformed bodies with 422 invalid', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const cases = [
    { name: 'malformed JSON', body: '{', expected: /not valid JSON/ },
    { name: 'non-object body', body: '[]', expected: /must be a JSON object/ },
    { name: 'missing baseRevision', body: JSON.stringify({ doc: sampleDoc() }), expected: /baseRevision/ },
    { name: 'invalid doc', body: commitBody(0, { version: 1, groups: [{ id: 'g-a', name: 'A', parentId: null, sessionIds: ['s1'] }], ungrouped: ['s1'] }), expected: /duplicate-session:s1/ },
    { name: 'wrong version', body: commitBody(0, { ...sampleDoc(), version: 2 }), expected: /version must be 1/ },
  ]
  for (const item of cases) {
    const { res, json } = await mounted.call(
      COMMIT_PATH,
      makeRequest({ method: 'POST', headers: allowedHeaders, body: item.body }),
    )
    assert.equal(res.statusCode, 422, item.name)
    assert.equal(json.code, 'invalid', item.name)
    assert.match(json.message, item.expected, item.name)
  }
})

test('POST commit rejects non-JSON content types with 415', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())
  const { res, json } = await mounted.call(
    COMMIT_PATH,
    makeRequest({
      method: 'POST',
      headers: { cookie: 'token=ok', 'content-type': 'text/plain' },
      body: '{}',
    }),
  )
  assert.equal(res.statusCode, 415)
  assert.equal(json.code, 'unsupported-media-type')
})

test('POST commit rejects bodies over 256 KiB with 413 (streamed and declared)', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const streamed = await mounted.call(
    COMMIT_PATH,
    makeRequest({ method: 'POST', headers: allowedHeaders, body: 'x'.repeat(MAX_BODY_BYTES + 2) }),
  )
  assert.equal(streamed.res.statusCode, 413)
  assert.equal(streamed.json.code, 'payload-too-large')

  const declared = await mounted.call(
    COMMIT_PATH,
    makeRequest({
      method: 'POST',
      headers: { ...allowedHeaders, 'content-length': String(MAX_BODY_BYTES + 1) },
      body: '{}',
    }),
  )
  assert.equal(declared.res.statusCode, 413)
})

test('POST commit returns 400 when the request stream is unreadable', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())
  const request = {
    method: 'POST',
    headers: { host: '127.0.0.1:4400', cookie: 'token=ok', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    resume() {},
    async *[Symbol.asyncIterator]() {
      throw new Error('socket reset')
    },
  }
  const res = makeResponse()
  await mounted.routes.find((route) => route.path === COMMIT_PATH).handler(request, res)
  assert.equal(res.statusCode, 400)
  assert.match(String(res.body), /bad-request/)
})

test('load maps unsupported-version to 409 and corrupt/invalid files to 200 + warning', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  await writeFile(mounted.filePath, JSON.stringify({ version: 2, revision: 5, groups: [], ungrouped: [] }), 'utf8')
  const unsupported = await mounted.call(LOAD_PATH, makeRequest({ headers: { cookie: 'token=ok' } }))
  assert.equal(unsupported.res.statusCode, 409)
  assert.equal(unsupported.json.code, 'unsupported-version')

  await writeFile(mounted.filePath, 'not json', 'utf8')
  const corrupt = await mounted.call(LOAD_PATH, makeRequest({ headers: { cookie: 'token=ok' } }))
  assert.equal(corrupt.res.statusCode, 200)
  assert.equal(corrupt.json.warning, 'corrupt-file')
  assert.match(corrupt.json.quarantinedTo, /dsh-session-groups\.corrupt-.*\.json$/)
  assert.deepEqual(corrupt.json.doc, { version: 1, revision: 0, groups: [], ungrouped: [] })
})

test('load maps a genuine IO failure to 503 io', async (t) => {
  const temp = await makeTempStore()
  t.after(temp.cleanup)
  await mkdir(temp.filePath, { recursive: true })
  const store = createStore({ filePath: temp.filePath })
  const mounted = await mountRoutes({
    connection: cookieConnection(),
    store,
    filePath: temp.filePath,
    dir: temp.dir,
  })
  const { res, json } = await mounted.call(LOAD_PATH, makeRequest({ headers: { cookie: 'token=ok' } }))
  assert.equal(res.statusCode, 503)
  assert.equal(json.code, 'io')
})

test('parseCommitBody ignores the client revision and validates the frozen shape', () => {
  assert.equal(parseCommitBody(null).ok, false)
  assert.equal(parseCommitBody({ baseRevision: 0 }).ok, false)
  assert.equal(parseCommitBody({ baseRevision: -1, doc: sampleDoc() }).ok, false)

  const parsed = parseCommitBody({ baseRevision: 7, doc: { ...sampleDoc(), revision: 123 } })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.baseRevision, 7)
  assert.equal(parsed.doc.revision, 0)
})

test('loadResponse/commitResponse map store results to the frozen wire shapes', () => {
  const loaded = loadResponse({ kind: 'ok', doc: { version: 1, revision: 4, groups: [], ungrouped: [] }, revision: 4 })
  assert.equal(loaded.status, 200)
  assert.equal(loaded.body.revision, 4)

  const conflict = commitResponse({ kind: 'conflict', doc: { version: 1, revision: 9, groups: [], ungrouped: [] }, revision: 9 })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.code, 'conflict')
  assert.equal(conflict.body.revision, 9)

  assert.equal(commitResponse({ kind: 'invalid', errors: ['duplicate-session:s1'] }).status, 422)
  assert.equal(commitResponse({ kind: 'unsupported-version', version: 2 }).status, 409)
})
