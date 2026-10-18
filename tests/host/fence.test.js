import test from 'node:test'
import assert from 'node:assert/strict'
import { fenceRequest, probeConnection } from '../../src/host/fence.js'
import { serviceOf } from '../../src/host/service.js'
import { makeContext, makeRequest } from './helpers.js'

test('probeConnection reports requestRejection as the required production fence', () => {
  const requestRejection = () => undefined
  const connection = { requestRejection, fetch: { register: () => () => {} } }
  const { ctx } = makeContext({ connection })
  assert.deepEqual(probeConnection(ctx), {
    connection,
    requestRejection: true,
    fetchRegister: true,
    mode: 'requestRejection',
  })
})

test('probeConnection is fail-closed when requestRejection is absent (H9)', () => {
  const fetchOnly = makeContext({ connection: { fetch: { register: () => () => {} } } })
  assert.equal(probeConnection(fetchOnly.ctx).mode, 'fail-closed')
  assert.equal(probeConnection(fetchOnly.ctx).fetchRegister, true)

  const absent = makeContext()
  assert.equal(probeConnection(absent.ctx).mode, 'fail-closed')
  assert.equal(serviceOf(absent.ctx, 'connection'), undefined)
})

test('fenceRequest allows a request the host fence accepts', () => {
  const { ctx } = makeContext({ connection: { requestRejection: () => undefined } })
  assert.deepEqual(fenceRequest(ctx, makeRequest()), {
    available: true,
    allowed: true,
    via: 'connection.requestRejection',
  })
})

test('fenceRequest maps host rejection statuses (401 no cookie / 403 untrusted)', () => {
  for (const status of [401, 403]) {
    const { ctx } = makeContext({ connection: { requestRejection: () => status } })
    assert.deepEqual(fenceRequest(ctx, makeRequest()), {
      available: true,
      allowed: false,
      status,
      via: 'connection.requestRejection',
      reason: 'connection requestRejection',
    })
  }
})

test('fenceRequest fails closed when the host fence throws', () => {
  const { ctx } = makeContext({
    connection: {
      requestRejection() {
        throw new Error('boom')
      },
    },
  })
  const verdict = fenceRequest(ctx, makeRequest())
  assert.equal(verdict.available, true)
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.status, 403)
  assert.match(verdict.reason, /boom/)
})

test('fenceRequest fails closed with 503 and never uses a weak loopback fallback', () => {
  const absent = makeContext()
  assert.deepEqual(fenceRequest(absent.ctx, makeRequest()), {
    available: false,
    allowed: false,
    status: 503,
    via: 'fail-closed',
    reason: 'connection.requestRejection is unavailable',
  })

  // Loopback remote + same-origin headers + loopback Host grant nothing.
  const loopbackLooking = makeContext()
  const request = makeRequest({ headers: { origin: 'http://127.0.0.1:4400', 'sec-fetch-site': 'same-origin' } })
  assert.equal(fenceRequest(loopbackLooking.ctx, request).allowed, false)

  const fetchOnly = makeContext({ connection: { fetch: { register: () => () => {} } } })
  assert.equal(fenceRequest(fetchOnly.ctx, makeRequest()).status, 503)
})
