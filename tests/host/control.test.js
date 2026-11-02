import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTROL_APPLY_PATH,
  CONTROL_PLAN_PATH,
  CONTROL_STATE_PATH,
  LOAD_PATH,
} from '../../src/host/constants.js'
import { mountRoutes, sampleDoc, makeRequest } from './helpers.js'

const connection = () => ({
  requestRejection(request) {
    const host = request.headers.host
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host ?? '')) return 403
    if (request.headers['sec-fetch-site'] === 'cross-site') return 403
    return request.headers.cookie === 'token=ok' ? undefined : 401
  },
})

const headers = { cookie: 'token=ok', 'content-type': 'application/json' }
const post = (body) => makeRequest({ method: 'POST', headers, body: JSON.stringify(body) })

test('control routes stay unmounted unless the API setting is enabled', async (t) => {
  const off = await mountRoutes({ connection: connection() })
  t.after(() => off.cleanup())
  assert.equal(off.routes.some((route) => route.path === CONTROL_STATE_PATH), false)

  const on = await mountRoutes({ connection: connection(), controlApiEnabled: true })
  t.after(() => on.cleanup())
  assert.deepEqual(on.mounted.routes.slice(-3), [CONTROL_STATE_PATH, CONTROL_PLAN_PATH, CONTROL_APPLY_PATH])
})

test('control state, plan and apply use revision CAS and idempotency', async (t) => {
  const mounted = await mountRoutes({ connection: connection(), controlApiEnabled: true })
  t.after(() => mounted.cleanup())
  await mounted.store.save(sampleDoc())

  const state = await mounted.call(CONTROL_STATE_PATH, makeRequest({ headers }))
  assert.equal(state.res.statusCode, 200)
  assert.equal(state.json.revision, 1)
  assert.equal(state.json.groups[0].name, '施工中')
  assert.deepEqual(state.json.ungrouped, ['s-4'])

  const operations = [{ op: 'group.create', name: 'AI group', parentId: null, index: 0 }]
  const plan = await mounted.call(CONTROL_PLAN_PATH, post({ baseRevision: 1, operations }))
  assert.equal(plan.res.statusCode, 200)
  assert.equal(plan.json.ok, true)
  assert.equal(plan.json.changes.length, 1)
  assert.match(plan.json.planHash, /^[0-9a-f]{64}$/)

  const apply = await mounted.call(
    CONTROL_APPLY_PATH,
    post({ baseRevision: 1, operations, planHash: plan.json.planHash, idempotencyKey: 'test-1' }),
  )
  assert.equal(apply.res.statusCode, 200)
  assert.equal(apply.json.revision, 2)
  assert.equal(apply.json.doc.groups.some((group) => group.name === 'AI group'), true)

  const replay = await mounted.call(
    CONTROL_APPLY_PATH,
    post({ baseRevision: 1, operations, planHash: plan.json.planHash, idempotencyKey: 'test-1' }),
  )
  assert.equal(replay.res.statusCode, 200)
  assert.equal(replay.json.revision, 2)

  const stale = await mounted.call(
    CONTROL_APPLY_PATH,
    post({ baseRevision: 1, operations, planHash: plan.json.planHash, idempotencyKey: 'test-2' }),
  )
  assert.equal(stale.res.statusCode, 409)
  assert.equal(stale.json.code, 'conflict')

  const loaded = await mounted.call(LOAD_PATH, makeRequest({ headers }))
  assert.equal(loaded.json.revision, 2)
})

test('control bearer token bypasses the browser cookie fence only for control routes', async (t) => {
  const mounted = await mountRoutes({
    connection: connection(),
    controlApiEnabled: true,
    controlToken: 'secret-token',
  })
  t.after(() => mounted.cleanup())
  await mounted.store.save(sampleDoc())

  const state = await mounted.call(
    CONTROL_STATE_PATH,
    makeRequest({ headers: { authorization: 'Bearer secret-token' } }),
  )
  assert.equal(state.res.statusCode, 200)
  assert.equal(state.json.revision, 1)

  const bad = await mounted.call(
    CONTROL_STATE_PATH,
    makeRequest({ headers: { authorization: 'Bearer wrong-token' } }),
  )
  assert.equal(bad.res.statusCode, 401)
})

test('control rejects extra top-level fields and malformed idempotency keys', async (t) => {
  const mounted = await mountRoutes({ connection: connection(), controlApiEnabled: true })
  t.after(() => mounted.cleanup())
  await mounted.store.save(sampleDoc())
  const operations = [{ op: 'group.create', name: 'X', parentId: null, index: 0 }]

  const extra = await mounted.call(
    CONTROL_PLAN_PATH,
    post({ baseRevision: 1, operations, surprise: true }),
  )
  assert.equal(extra.res.statusCode, 422)
  assert.equal(extra.json.code, 'unexpected-field')
  assert.equal(extra.json.field, 'surprise')

  const badKey = await mounted.call(
    CONTROL_APPLY_PATH,
    post({ baseRevision: 1, operations, planHash: 'x'.repeat(64), idempotencyKey: 42 }),
  )
  assert.equal(badKey.res.statusCode, 422)
  assert.equal(badKey.json.code, 'invalid-idempotency-key')

  const badOperation = await mounted.call(
    CONTROL_PLAN_PATH,
    post({ baseRevision: 1, operations: [{ ...operations[0], surprise: true }] }),
  )
  assert.equal(badOperation.res.statusCode, 422)
  assert.equal(badOperation.json.code, 'invalid-operation')
  assert.equal(badOperation.json.operationIndex, 0)

  const loaded = await mounted.call(LOAD_PATH, makeRequest({ headers }))
  assert.equal(loaded.json.revision, 1)
})

test('destructive control operations require the separate switch', async (t) => {
  const guarded = await mountRoutes({ connection: connection(), controlApiEnabled: true })
  t.after(() => guarded.cleanup())
  await guarded.store.save(sampleDoc())
  const groupId = sampleDoc().groups[0].id
  const operations = [{ op: 'group.delete', groupId, destinationId: null }]
  const denied = await guarded.call(CONTROL_PLAN_PATH, post({ baseRevision: 1, operations }))
  assert.equal(denied.res.statusCode, 422)
  assert.equal(denied.json.message, 'destructive-disabled')

  const allowed = await mountRoutes({
    connection: connection(),
    controlApiEnabled: true,
    controlDestructiveEnabled: true,
  })
  t.after(() => allowed.cleanup())
  await allowed.store.save(sampleDoc())
  const plan = await allowed.call(CONTROL_PLAN_PATH, post({ baseRevision: 1, operations }))
  assert.equal(plan.res.statusCode, 200)
  const applied = await allowed.call(
    CONTROL_APPLY_PATH,
    post({ baseRevision: 1, operations, planHash: plan.json.planHash }),
  )
  assert.equal(applied.res.statusCode, 200)
  assert.equal(applied.json.doc.groups.some((group) => group.id === groupId), false)
})
