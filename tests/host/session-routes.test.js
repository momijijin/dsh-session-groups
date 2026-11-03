import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTROL_SESSION_ARCHIVE_PATH,
  CONTROL_SESSION_INSPECT_PATH,
  CONTROL_SESSION_RENAME_PATH,
} from '../../src/host/constants.js'
import { makeRequest, mountRoutes } from './helpers.js'

const connection = () => ({
  requestRejection(request) {
    if (request.headers.cookie !== 'token=ok') return 401
    return undefined
  },
})

const headers = {
  cookie: 'token=ok',
  'content-type': 'application/json',
  origin: 'http://127.0.0.1:4400',
}

const post = (path, body, options = {}) =>
  makeRequest({ method: 'POST', url: path, headers: { ...headers, ...options }, body: JSON.stringify(body) })

const setup = async (overrides = {}) => {
  const live = { id: 's-live', title: 'Old title' }
  const registry = {
    archivedSessionIds: ['s-archived'],
    archiveCalls: [],
    unarchiveCalls: [],
    async archiveSession(id, options) {
      this.archiveCalls.push([id, options])
      this.archivedSessionIds = [...this.archivedSessionIds, id]
    },
    async unarchiveSession(id) {
      this.unarchiveCalls.push(id)
      this.archivedSessionIds = this.archivedSessionIds.filter((value) => value !== id)
    },
  }
  const title = {
    get(session) { return { title: session.title } },
    rename(session, next) { session.title = next; return { title: next } },
  }
  const sessions = { get: (id) => (id === live.id ? live : undefined) }
  const mounted = await mountRoutes({
    connection: connection(),
    controlApiEnabled: true,
    controlSessionsEnabled: true,
    services: { sessions, sessionTitle: title, workspaceRegistry: registry },
    ...overrides,
  })
  return { mounted, live, registry, title, sessions }
}

test('session routes gate on controlApi, controlSessions and HTTP method', async (t) => {
  const disabled = await setup({ controlApiEnabled: false })
  t.after(() => disabled.mounted.cleanup())
  const apiOff = await disabled.mounted.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId: 's-live' }))
  assert.equal(apiOff.res.statusCode, 404)
  assert.equal(apiOff.json.code, 'control-disabled')

  const sessionsOff = await setup({ controlSessionsEnabled: false })
  t.after(() => sessionsOff.mounted.cleanup())
  const sessionsDisabled = await sessionsOff.mounted.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId: 's-live' }))
  assert.equal(sessionsDisabled.res.statusCode, 404)
  assert.equal(sessionsDisabled.json.code, 'session-controls-disabled')

  const wrongMethod = await setup()
  t.after(() => wrongMethod.mounted.cleanup())
  const methodResult = await wrongMethod.mounted.call(CONTROL_SESSION_INSPECT_PATH, makeRequest({ method: 'GET', headers }))
  assert.equal(methodResult.res.statusCode, 405)
})

test('session inspect validates body and reports live, archived, missing and unavailable states', async (t) => {
  const { mounted } = await setup()
  t.after(() => mounted.cleanup())

  const badField = await mounted.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId: 's-live', extra: true }))
  assert.equal(badField.res.statusCode, 422)
  assert.equal(badField.json.code, 'unexpected-field')

  for (const sessionId of [undefined, '', 'bad\nid', 42]) {
    const invalid = await mounted.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId }))
    assert.equal(invalid.res.statusCode, 422)
    assert.equal(invalid.json.code, 'invalid-session-id')
  }

  const live = await mounted.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId: 's-live' }))
  assert.equal(live.res.statusCode, 200)
  assert.deepEqual(live.json, { ok: true, sessionId: 's-live', live: true, archived: false, title: 'Old title' })

  const archived = await mounted.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId: 's-archived' }))
  assert.equal(archived.res.statusCode, 200)
  assert.deepEqual(archived.json, { ok: true, sessionId: 's-archived', live: false, archived: true, title: null })

  const missing = await mounted.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId: 'missing' }))
  assert.equal(missing.res.statusCode, 404)
  assert.equal(missing.json.code, 'session-not-found')
})

test('session inspect degrades to title null when the title service throws', async (t) => {
  const { mounted, title } = await setup()
  t.after(() => mounted.cleanup())
  title.get = () => { throw new Error('title unavailable') }
  const result = await mounted.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId: 's-live' }))
  assert.equal(result.res.statusCode, 200)
  assert.equal(result.json.title, null)
})

test('session inspect returns 503 only when both session services are unavailable', async (t) => {
  const { mounted } = await setup()
  t.after(() => mounted.cleanup())
  const noServices = await mountRoutes({ connection: connection(), controlApiEnabled: true, controlSessionsEnabled: true })
  t.after(() => noServices.cleanup())
  const result = await noServices.call(CONTROL_SESSION_INSPECT_PATH, post(CONTROL_SESSION_INSPECT_PATH, { sessionId: 's-live' }))
  assert.equal(result.res.statusCode, 503)
  assert.equal(result.json.code, 'service-unavailable')
})

test('session rename validates fields, live state, expectedTitle and failures', async (t) => {
  const { mounted, live, title } = await setup()
  t.after(() => mounted.cleanup())

  const badField = await mounted.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, { sessionId: 's-live', title: 'New', extra: 1 }))
  assert.equal(badField.res.statusCode, 422)
  assert.equal(badField.json.code, 'unexpected-field')

  for (const body of [
    { sessionId: '', title: 'New' },
    { sessionId: 's-live', title: '' },
    { sessionId: 's-live', title: 'bad\n' },
  ]) {
    const invalid = await mounted.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, body))
    assert.equal(invalid.res.statusCode, 422)
    const expectedCode = body.sessionId === '' ? 'invalid-session-id' : 'invalid-title'
    assert.equal(invalid.json.code, expectedCode)
  }

  const invalidExpected = await mounted.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, { sessionId: 's-live', title: 'New', expectedTitle: 1 }))
  assert.equal(invalidExpected.res.statusCode, 422)
  assert.equal(invalidExpected.json.code, 'invalid-title')
  assert.equal(invalidExpected.json.field, 'expectedTitle')

  const notLive = await mounted.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, { sessionId: 'missing', title: 'New' }))
  assert.equal(notLive.res.statusCode, 409)
  assert.equal(notLive.json.code, 'session-not-live')

  const mismatch = await mounted.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, { sessionId: 's-live', title: 'New', expectedTitle: 'Other' }))
  assert.equal(mismatch.res.statusCode, 409)
  assert.equal(mismatch.json.code, 'title-changed')
  assert.equal(mismatch.json.title, 'Old title')

  const same = await mounted.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, { sessionId: 's-live', title: 'Old title' }))
  assert.equal(same.res.statusCode, 200)
  assert.equal(live.title, 'Old title')

  const renamed = await mounted.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, { sessionId: 's-live', title: 'New title', expectedTitle: 'Old title' }))
  assert.equal(renamed.res.statusCode, 200)
  assert.equal(renamed.json.title, 'New title')
  assert.equal(live.title, 'New title')

  title.rename = () => { throw new Error('rename failed') }
  const failed = await mounted.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, { sessionId: 's-live', title: 'Again' }))
  assert.equal(failed.res.statusCode, 422)
  assert.equal(failed.json.code, 'session-operation-failed')
  assert.match(failed.json.message, /rename failed/)
})

test('session rename returns 503 when session or title services are incomplete', async (t) => {
  const { mounted } = await setup()
  t.after(() => mounted.cleanup())
  const noServices = await mountRoutes({ connection: connection(), controlApiEnabled: true, controlSessionsEnabled: true })
  t.after(() => noServices.cleanup())
  const result = await noServices.call(CONTROL_SESSION_RENAME_PATH, post(CONTROL_SESSION_RENAME_PATH, { sessionId: 's-live', title: 'New' }))
  assert.equal(result.res.statusCode, 503)
  assert.equal(result.json.code, 'service-unavailable')
})

test('session archive validates fields, expectedArchived, no-op and stopActivity forwarding', async (t) => {
  const { mounted, registry } = await setup()
  t.after(() => mounted.cleanup())

  for (const body of [
    { sessionId: '', archived: true },
    { sessionId: 's-live', archived: 'yes' },
    { sessionId: 's-live', archived: true, expectedArchived: 'yes' },
    { sessionId: 's-live', archived: true, stopActivity: 'yes' },
  ]) {
    const invalid = await mounted.call(CONTROL_SESSION_ARCHIVE_PATH, post(CONTROL_SESSION_ARCHIVE_PATH, body))
    assert.equal(invalid.res.statusCode, 422)
  }

  const badField = await mounted.call(CONTROL_SESSION_ARCHIVE_PATH, post(CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-live', archived: true, extra: 1 }))
  assert.equal(badField.res.statusCode, 422)
  assert.equal(badField.json.code, 'unexpected-field')

  const mismatch = await mounted.call(CONTROL_SESSION_ARCHIVE_PATH, post(CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-live', archived: true, expectedArchived: true }))
  assert.equal(mismatch.res.statusCode, 409)
  assert.equal(mismatch.json.code, 'archive-changed')

  const noop = await mounted.call(CONTROL_SESSION_ARCHIVE_PATH, post(CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-archived', archived: true }))
  assert.equal(noop.res.statusCode, 200)
  assert.equal(noop.json.archived, true)
  assert.deepEqual(registry.archiveCalls, [])

  const archived = await mounted.call(CONTROL_SESSION_ARCHIVE_PATH, post(CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-live', archived: true, stopActivity: true }))
  assert.equal(archived.res.statusCode, 200)
  assert.deepEqual(registry.archiveCalls, [['s-live', { stopActivity: true }]])

  const unarchived = await mounted.call(CONTROL_SESSION_ARCHIVE_PATH, post(CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-archived', archived: false }))
  assert.equal(unarchived.res.statusCode, 200)
  assert.deepEqual(registry.unarchiveCalls, ['s-archived'])
})

test('session archive returns 503 and 409 on unavailable or failing registry', async (t) => {
  const { mounted, registry } = await setup()
  t.after(() => mounted.cleanup())
  const noServices = await mountRoutes({ connection: connection(), controlApiEnabled: true, controlSessionsEnabled: true })
  t.after(() => noServices.cleanup())
  const unavailable = await noServices.call(CONTROL_SESSION_ARCHIVE_PATH, post(CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-live', archived: true }))
  assert.equal(unavailable.res.statusCode, 503)
  assert.equal(unavailable.json.code, 'service-unavailable')

  registry.archiveSession = async () => { throw new Error('archive failed') }
  const failed = await mounted.call(CONTROL_SESSION_ARCHIVE_PATH, post(CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-live', archived: true }))
  assert.equal(failed.res.statusCode, 409)
  assert.equal(failed.json.code, 'session-operation-failed')
  assert.match(failed.json.message, /archive failed/)
})
