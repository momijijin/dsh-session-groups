/**
 * Cordis host plugin entry for dsh-session-groups.
 *
 * Frozen contract: docs/CONTRACTS.md §2 / §6.5.
 * - Host half only: mounts GET /dsh-session-groups/load and
 *   POST /dsh-session-groups/commit, guarded by the host connection fence.
 * - Records live under `dshHomePath('storages')` (fallback chain logged).
 * - Never writes workspace.json, session headers/logs, or any other host state.
 * - `apply` returns void: Cordis 4.0.5 treats a plugin's return value as its
 *   effect list, so returning data would unload the plugin. The entry is also
 *   synchronous (home resolution is sync) so route registration happens before
 *   Cordis inspects the effect list.
 *
 * @module dsh-session-groups
 */

import { probeConnection } from './host/fence.js'
import { resolveRecordPath } from './host/home.js'
import { logInfo } from './host/log.js'
import { registerRoutes } from './host/routes.js'
import { createStore } from './host/store.js'

/** Cordis function-plugin name (matches the bundle patch row id). */
export const name = 'dsh-session-groups'

/**
 * The route carrier is required. `connection` is feature-detected per request
 * (it is provided by a sibling row and may be absent from synthetic
 * compositions); a missing fence fails the routes closed with 503.
 */
export const inject = ['webServer']

/** Cordis function plugin body. Must not return data (see module comment). */
export const apply = (ctx, config = {}) => {
  const record = resolveRecordPath(ctx, config)
  const store = createStore({ filePath: record.filePath })
  const mounted = registerRoutes(ctx, store)
  const probe = probeConnection(ctx)

  logInfo(
    ctx,
    `[dsh-session-groups] host ready: file=${record.filePath} storageSource=${
      record.storageSource
    } routes=${mounted.routes.join(',')} connectionAtApply=${
      probe.connection === undefined ? 'deferred' : 'present'
    } webServerPort=${String(ctx?.webServer?.port)}`,
  )

  // Test seam only; production callers do not pass onReady.
  if (typeof config.onReady === 'function') {
    config.onReady({
      store,
      filePath: record.filePath,
      storageDir: record.storageDir,
      storageSource: record.storageSource,
      mounted,
    })
  }
}
