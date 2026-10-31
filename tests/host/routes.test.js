import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import {
  COMMIT_PATH,
  DEBUG_PATH,
  DIAGNOSTICS_PATH,
  LOAD_PATH,
  MAX_BODY_BYTES,
  MAX_DIAGNOSTICS_BODY_BYTES,
  MAX_DIAGNOSTICS_EVENTS,
} from '../../src/host/constants.js'
import {
  commitResponse,
  loadResponse,
  parseCommitBody,
  parseDiagnosticsBody,
} from '../../src/host/routes.js'
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

test('route registration mounts the frozen paths, diagnostics and debug probe', async (t) => {
  const mounted = await mountRoutes()
  t.after(() => mounted.cleanup())
  assert.deepEqual(
    mounted.routes.map((route) => `${route.kind}:${route.path}`).sort(),
    [`exact:${COMMIT_PATH}`, `exact:${DEBUG_PATH}`, `exact:${DIAGNOSTICS_PATH}`, `exact:${LOAD_PATH}`].sort(),
  )
  assert.deepEqual(mounted.mounted.routes, [LOAD_PATH, COMMIT_PATH, DIAGNOSTICS_PATH, DEBUG_PATH])
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
    diagnostics: true,
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

test('POST commit round-trips palette colors and normalizes legacy groups to blue', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const doc = sampleDoc()
  doc.groups[0] = { ...doc.groups[0], color: 'purple' }
  const first = await mounted.call(
    COMMIT_PATH,
    makeRequest({ method: 'POST', headers: allowedHeaders, body: commitBody(0, doc) }),
  )
  assert.equal(first.res.statusCode, 200)
  assert.equal(first.json.ok, true)
  assert.equal(first.json.doc.groups[0].color, 'purple', 'chosen palette id persists')
  assert.equal(first.json.doc.groups[1].color, 'blue', 'missing color normalizes to the blue default on write')

  const loaded = await mounted.call(LOAD_PATH, makeRequest({ headers: { cookie: 'token=ok' } }))
  assert.equal(loaded.res.statusCode, 200)
  assert.equal(loaded.json.doc.groups[0].color, 'purple')
  assert.equal(loaded.json.doc.groups[1].color, 'blue')

  // A legacy document on disk (no color) still loads; display falls back to blue.
  const legacy = sampleDoc()
  delete legacy.groups[0].color
  const legacyWrite = await mounted.call(
    COMMIT_PATH,
    makeRequest({ method: 'POST', headers: allowedHeaders, body: commitBody(1, legacy) }),
  )
  assert.equal(legacyWrite.res.statusCode, 200)
  assert.equal(legacyWrite.json.doc.groups[0].color, 'blue')
})

test('POST commit normalizes custom colorHex and rejects alpha/invalid values', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const doc = sampleDoc()
  doc.groups[0] = { ...doc.groups[0], color: 'purple', colorHex: '#A1B2C3' }
  const write = await mounted.call(
    COMMIT_PATH,
    makeRequest({ method: 'POST', headers: allowedHeaders, body: commitBody(0, doc) }),
  )
  assert.equal(write.res.statusCode, 200)
  assert.equal(write.json.doc.groups[0].colorHex, '#a1b2c3', 'valid hex is normalized to lowercase')
  assert.equal(write.json.doc.groups[0].color, 'purple', 'palette identity is preserved alongside the custom color')

  const loaded = await mounted.call(LOAD_PATH, makeRequest({ headers: { cookie: 'token=ok' } }))
  assert.equal(loaded.json.doc.groups[0].colorHex, '#a1b2c3')

  for (const [name, colorHex, pattern] of [
    ['alpha hex', '#11223344', /group-color-hex/],
    ['alpha short', '#abcd', /group-color-hex/],
    ['named color', 'red', /group-color-hex/],
  ]) {
    const invalid = sampleDoc()
    invalid.groups[0] = { ...invalid.groups[0], colorHex }
    const { res, json } = await mounted.call(
      COMMIT_PATH,
      makeRequest({ method: 'POST', headers: allowedHeaders, body: commitBody(1, invalid) }),
    )
    assert.equal(res.statusCode, 422, name)
    assert.match(json.message, pattern, name)
  }
})

test('POST commit rejects unknown palette ids with 422 group-color', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const doc = sampleDoc()
  doc.groups[0] = { ...doc.groups[0], color: 'chartreuse' }
  const { res, json } = await mounted.call(
    COMMIT_PATH,
    makeRequest({ method: 'POST', headers: allowedHeaders, body: commitBody(0, doc) }),
  )
  assert.equal(res.statusCode, 422)
  assert.equal(json.code, 'invalid')
  assert.match(json.message, /group-color:g-aaaaaaaaaaaa/)
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
    { name: 'unknown group color', body: commitBody(0, { ...sampleDoc(), groups: [{ ...sampleDoc().groups[0], color: 'chartreuse' }] }), expected: /group-color/ },
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
  assert.equal(parsed.doc.groups[0].color, 'blue', 'the route stamps the default palette id')
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

// ---------------------------------------------------------------------------
// Diagnostics route (0.2.5)
// ---------------------------------------------------------------------------

const diagnosticsBatch = (events = [{ type: 'handler', handler: 'onDragOverSession', ms: 0.4 }], extra = {}) =>
  JSON.stringify({ runId: 'run-test', schemaVersion: 1, events, ...extra })

test('POST diagnostics appends NDJSON under storages and never touches the record file', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const first = await mounted.call(
    DIAGNOSTICS_PATH,
    makeRequest({
      method: 'POST',
      headers: { cookie: 'token=ok', 'content-type': 'application/json' },
      body: diagnosticsBatch([
        { type: 'native.dragover', phase: 'capture', x: 10, y: 20 },
        { type: 'dropTarget.change', from: null, to: { kind: 'session-before' } },
      ]),
    }),
  )
  assert.equal(first.res.statusCode, 200)
  assert.deepEqual(first.json, { ok: true, appended: 2 })

  const second = await mounted.call(
    DIAGNOSTICS_PATH,
    makeRequest({
      method: 'POST',
      headers: { cookie: 'token=ok', 'content-type': 'application/json' },
      body: diagnosticsBatch([{ type: 'run.start' }], { runId: 'run-second' }),
    }),
  )
  assert.equal(second.res.statusCode, 200)

  const text = await readFile(mounted.diagnosticsFilePath, 'utf8')
  const lines = text.trimEnd().split('\n')
  assert.equal(lines.length, 3, 'append-only: the second batch keeps the first lines')
  const records = lines.map((line) => JSON.parse(line))
  assert.equal(records[0].runId, 'run-test')
  assert.equal(records[0].schemaVersion, 1)
  assert.match(records[0].receivedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(records[0].event.type, 'native.dragover')
  assert.equal(records[2].runId, 'run-second')

  // The official record file must not exist: diagnostics only writes its file.
  await assert.rejects(access(mounted.filePath), /ENOENT/)
  assert.deepEqual((await readdir(mounted.storages)).sort(), ['dsh-session-groups.diagnostics.ndjson'])
})

test('POST diagnostics status matrix: methods, content type, JSON shape, size', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection() })
  t.after(() => mounted.cleanup())

  const get = await mounted.call(DIAGNOSTICS_PATH, makeRequest({ headers: { cookie: 'token=ok' } }))
  assert.equal(get.res.statusCode, 405)
  assert.equal(get.res.headers.allow, 'POST')

  const fenceMissing = await mountRoutes()
  t.after(() => fenceMissing.cleanup())
  const fenced = await fenceMissing.call(
    DIAGNOSTICS_PATH,
    makeRequest({ method: 'POST', headers: { 'content-type': 'application/json' }, body: diagnosticsBatch() }),
  )
  assert.equal(fenced.res.statusCode, 503)
  assert.equal(fenced.json.code, 'fence-unavailable')

  const wrongType = await mounted.call(
    DIAGNOSTICS_PATH,
    makeRequest({ method: 'POST', headers: { cookie: 'token=ok', 'content-type': 'text/plain' }, body: '{}' }),
  )
  assert.equal(wrongType.res.statusCode, 415)

  const malformed = await mounted.call(
    DIAGNOSTICS_PATH,
    makeRequest({
      method: 'POST',
      headers: { cookie: 'token=ok', 'content-type': 'application/json' },
      body: '{',
    }),
  )
  assert.equal(malformed.res.statusCode, 422)
  assert.equal(malformed.json.code, 'invalid')

  for (const body of [
    JSON.stringify({ runId: 'x', schemaVersion: 1 }),
    JSON.stringify({ runId: 'x', schemaVersion: 1, events: [] }),
    JSON.stringify({ runId: 'x', schemaVersion: 1, events: ['nope'] }),
    JSON.stringify({
      runId: 'x',
      schemaVersion: 1,
      events: Array.from({ length: MAX_DIAGNOSTICS_EVENTS + 1 }, () => ({ type: 'x' })),
    }),
  ]) {
    const invalid = await mounted.call(
      DIAGNOSTICS_PATH,
      makeRequest({ method: 'POST', headers: { cookie: 'token=ok', 'content-type': 'application/json' }, body }),
    )
    assert.equal(invalid.res.statusCode, 422, body.slice(0, 80))
    assert.equal(invalid.json.code, 'invalid')
  }

  const tooLarge = await mounted.call(
    DIAGNOSTICS_PATH,
    makeRequest({
      method: 'POST',
      headers: { cookie: 'token=ok', 'content-type': 'application/json' },
      body: 'x'.repeat(MAX_DIAGNOSTICS_BODY_BYTES + 2),
    }),
  )
  assert.equal(tooLarge.res.statusCode, 413)
})

test('parseDiagnosticsBody keeps the client runId/schemaVersion and bounds the batch', () => {
  assert.equal(parseDiagnosticsBody(null).ok, false)
  assert.equal(parseDiagnosticsBody({ events: 'nope' }).ok, false)
  assert.equal(parseDiagnosticsBody({ events: [] }).ok, false)
  assert.equal(parseDiagnosticsBody({ events: [null] }).ok, false)

  const parsed = parseDiagnosticsBody({
    runId: 'dsg-abc',
    schemaVersion: 1,
    events: [{ type: 'run.start', t: 0 }],
  })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.runId, 'dsg-abc')
  assert.equal(parsed.schemaVersion, 1)
  assert.equal(parsed.events.length, 1)

  const unbounded = parseDiagnosticsBody({
    runId: 'x'.repeat(400),
    schemaVersion: 'nope',
    events: [{ type: 'x' }],
  })
  assert.equal(unbounded.ok, true)
  assert.equal(unbounded.runId.length, 128)
  assert.equal(unbounded.schemaVersion, null)
})

test('0.2.18 diagnostics disabled: load advertises off and ingest is refused', async (t) => {
  const mounted = await mountRoutes({ connection: cookieConnection(), diagnosticsEnabled: false })
  t.after(() => mounted.cleanup())
  const loaded = await mounted.call(LOAD_PATH, makeRequest({ headers: { cookie: 'token=ok' } }))
  assert.equal(loaded.res.statusCode, 200)
  assert.equal(loaded.json.diagnostics, false)
  const posted = await mounted.call(
    DIAGNOSTICS_PATH,
    makeRequest({
      method: 'POST',
      headers: allowedHeaders,
      body: JSON.stringify({ runId: 'r', schemaVersion: 1, events: [{ type: 'x' }] }),
    }),
  )
  assert.equal(posted.res.statusCode, 403)
  assert.equal(posted.json.code, 'diagnostics-disabled')
})
