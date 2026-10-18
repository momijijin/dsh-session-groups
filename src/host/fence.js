/**
 * Request fence for the group routes.
 *
 * Frozen contract: docs/CONTRACTS.md §2 / §6.5.
 * - `ctx.connection.requestRejection(req)` is REQUIRED; on DSH 0.2.1-rc.2 it
 *   enforces the Host/Origin browser-trust fence and the browser-session
 *   cookie (401 without cookie, 403 for foreign Host / cross-site markers).
 * - Missing fence -> fail closed with 503 `fence-unavailable`. A weak
 *   loopback-only fallback must not ship.
 * - `ctx.connection.fetch.register` is P1 evaluation only: it is probed for
 *   diagnostics, never used as the production path.
 */

import { serviceOf } from './service.js'

export { serviceOf }

/**
 * Probe the composition's connection service without throwing.
 * @returns {{ connection: object | undefined, requestRejection: boolean,
 *   fetchRegister: boolean, mode: 'requestRejection' | 'fail-closed' }}
 */
export const probeConnection = (ctx) => {
  const connection = serviceOf(ctx, 'connection')
  const requestRejection = typeof connection?.requestRejection === 'function'
  const fetchRegister = typeof connection?.fetch?.register === 'function'
  return {
    connection,
    requestRejection,
    fetchRegister,
    // fetchRegister is reported, not activated: it mounts under /api with a
    // different client base and its wire shape is a P1 spike item.
    mode: requestRejection ? 'requestRejection' : 'fail-closed',
  }
}

/**
 * Apply the required fence to one request.
 * @returns {{ available: boolean, allowed: boolean, status?: number,
 *   via: string, reason?: string }}
 */
export const fenceRequest = (ctx, req) => {
  const probe = probeConnection(ctx)
  if (!probe.requestRejection) {
    return {
      available: false,
      allowed: false,
      status: 503,
      via: 'fail-closed',
      reason: 'connection.requestRejection is unavailable',
    }
  }
  let rejection
  try {
    rejection = probe.connection.requestRejection(req)
  } catch (error) {
    // A throwing fence must fail closed, never open.
    return {
      available: true,
      allowed: false,
      status: 403,
      via: 'connection.requestRejection',
      reason: `fence threw: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (rejection === undefined || rejection === null) {
    return { available: true, allowed: true, via: 'connection.requestRejection' }
  }
  return {
    available: true,
    allowed: false,
    status: typeof rejection === 'number' ? rejection : 403,
    via: 'connection.requestRejection',
    reason: 'connection requestRejection',
  }
}
