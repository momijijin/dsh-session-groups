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
    const host = request.headers.host
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host ?? '')) return 403
    return request.headers.cookie === 'token=ok' ? undefined : 401
  },
})
const headers = { cookie: 'token=ok', 'content-type': 'application/json' }
const post = (body) => makeRequest({ method: 'POST', headers, body: JSON.stringify(body) })

const sessionServices = () => {
  const session = { id: 's-1', title: 'old title' }
  const registry = {
    archivedSessionIds: [],
    async archiveSession(sessionId, options) {
      if (sessionId !== 's-1') throw new Error('unknown session')
      registry.archivedSessionIds = [sessionId]
      registry.lastArchiveOptions = options
    },
    async unarchiveSession(sessionId) {
      registry.archivedSessionIds = registry.archivedSessionIds.filter((id) => id !== sessionId)
    },
  }
  return {
    session,
    registry,
    services: {
      sessions: { get: (id) => (id === 's-1' ? session : undefined) },
      sessionTitle: {
        get: (value) => ({ title: value.title }),
        rename: (value, title) => {
          value.title = title
          return { title }
        },
      },
      workspaceRegistry: registry,
    },
  }
}

test('session control routes require the session mutation switch', async (t) => {
  const services = sessionServices()
  const off = await mountRoutes({ connection: connection(), controlApiEnabled: true, services: services.services })
  t.after(() => off.cleanup())
  assert.equal(off.routes.some((route) => route.path === CONTROL_SESSION_INSPECT_PATH), false)

  const on = await mountRoutes({
    connection: connection(),
    controlApiEnabled: true,
    controlSessionsEnabled: true,
    services: services.services,
  })
  t.after(() => on.cleanup())
  assert.deepEqual(on.mounted.routes.slice(-3), [
    CONTROL_SESSION_INSPECT_PATH,
    CONTROL_SESSION_RENAME_PATH,
    CONTROL_SESSION_ARCHIVE_PATH,
  ])
})

test('session inspect, rename and archive use explicit preconditions', async (t) => {
  const state = sessionServices()
  const mounted = await mountRoutes({
    connection: connection(),
    controlApiEnabled: true,
    controlSessionsEnabled: true,
    services: state.services,
  })
  t.after(() => mounted.cleanup())

  const inspected = await mounted.call(CONTROL_SESSION_INSPECT_PATH, post({ sessionId: 's-1' }))
  assert.equal(inspected.res.statusCode, 200)
  assert.equal(inspected.json.title, 'old title')
  assert.equal(inspected.json.archived, false)

  const renamed = await mounted.call(
    CONTROL_SESSION_RENAME_PATH,
    post({ sessionId: 's-1', title: 'new title', expectedTitle: 'old title' }),
  )
  assert.equal(renamed.res.statusCode, 200)
  assert.equal(renamed.json.title, 'new title')
  assert.equal(state.session.title, 'new title')

  const stale = await mounted.call(
    CONTROL_SESSION_RENAME_PATH,
    post({ sessionId: 's-1', title: 'third title', expectedTitle: 'old title' }),
  )
  assert.equal(stale.res.statusCode, 409)
  assert.equal(stale.json.code, 'title-changed')

  const archived = await mounted.call(
    CONTROL_SESSION_ARCHIVE_PATH,
    post({ sessionId: 's-1', archived: true, expectedArchived: false }),
  )
  assert.equal(archived.res.statusCode, 200)
  assert.deepEqual(state.registry.archivedSessionIds, ['s-1'])

  const idempotent = await mounted.call(
    CONTROL_SESSION_ARCHIVE_PATH,
    post({ sessionId: 's-1', archived: true }),
  )
  assert.equal(idempotent.res.statusCode, 200)
  assert.equal(idempotent.json.archived, true)

  const restored = await mounted.call(
    CONTROL_SESSION_ARCHIVE_PATH,
    post({ sessionId: 's-1', archived: false, expectedArchived: true }),
  )
  assert.equal(restored.res.statusCode, 200)
  assert.deepEqual(state.registry.archivedSessionIds, [])
})

test('session control rejects extra or mistyped fields', async (t) => {
  const state = sessionServices()
  const mounted = await mountRoutes({
    connection: connection(),
    controlApiEnabled: true,
    controlSessionsEnabled: true,
    services: state.services,
  })
  t.after(() => mounted.cleanup())

  for (const [path, body] of [
    [CONTROL_SESSION_INSPECT_PATH, {}],
    [CONTROL_SESSION_INSPECT_PATH, { sessionId: '' }],
    [CONTROL_SESSION_INSPECT_PATH, { sessionId: 42 }],
    [CONTROL_SESSION_INSPECT_PATH, { sessionId: 's-1', extra: true }],
    [CONTROL_SESSION_RENAME_PATH, { sessionId: 's-1', title: 42 }],
    [CONTROL_SESSION_RENAME_PATH, { title: 'no id' }],
    [CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-1', archived: 'yes' }],
    [CONTROL_SESSION_ARCHIVE_PATH, { archived: true }],
    [CONTROL_SESSION_ARCHIVE_PATH, { sessionId: 's-1', archived: true, stopActivity: 'yes' }],
  ]) {
    const response = await mounted.call(path, post(body))
    assert.equal(response.res.statusCode, 422)
    if (!('sessionId' in body) || typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
      assert.equal(response.json.code, 'invalid-session-id')
    }
  }
  assert.equal(state.session.title, 'old title')
  assert.deepEqual(state.registry.archivedSessionIds, [])
})
