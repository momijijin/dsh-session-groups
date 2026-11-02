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

import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'
import { probeConnection } from './host/fence.js'
import { resolveRecordPath } from './host/home.js'
import { logInfo, logWarn } from './host/log.js'
import { CONTROL_TOKEN_FILE_NAME, DEBUG_FILE_NAME, DIAGNOSTICS_FILE_NAME } from './host/constants.js'
import { registerRoutes } from './host/routes.js'
import { createStore } from './host/store.js'

/** Cordis function-plugin name (matches the bundle patch row id). */
export const name = 'dsh-session-groups'

/**
 * Plugin-manager configuration schema (Settings → Plugins → this plugin).
 * Diagnostics are off by default; the form switch turns the local trace/HUD on.
 */
export const Config = z.object({
  diagnostics: z.boolean().default(false).description('Enable local drag diagnostics (HUD + NDJSON trace)'),
  debugProbe: z
    .boolean()
    .default(false)
    .description('Enable the temporary dialog layout probe and its local .debug.ndjson route'),
  controlApi: z
    .boolean()
    .default(false)
    .description('Enable the local AI control API (state/plan/apply); default off'),
  controlDestructive: z
    .boolean()
    .default(false)
    .description('Allow destructive AI control operations such as group deletion'),
})

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
  const diagnosticsFilePath =
    typeof config.diagnosticsFilePath === 'string' && config.diagnosticsFilePath.length > 0
      ? config.diagnosticsFilePath
      : // Co-located with the record file: in production that is
        // `dshHomePath('storages')`, and a test seam that overrides `filePath`
        // can never point diagnostics at the real home.
        join(dirname(record.filePath), DIAGNOSTICS_FILE_NAME)
  let controlToken = null
  let controlTokenPath = null
  if (config?.controlApi === true) {
    controlToken = randomBytes(32).toString('hex')
    controlTokenPath = join(dirname(record.filePath), CONTROL_TOKEN_FILE_NAME)
    try {
      mkdirSync(dirname(controlTokenPath), { recursive: true })
      writeFileSync(controlTokenPath, controlToken, { encoding: 'utf8', mode: 0o600 })
      ctx.effect(
        () => () => {
          try {
            unlinkSync(controlTokenPath)
          } catch {
            /* token already removed */
          }
        },
        'dsh-session-groups: remove control token',
      )
    } catch (error) {
      controlToken = null
      logWarn(ctx, `dsh-session-groups: control token unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const mounted = registerRoutes(ctx, store, {
    diagnosticsFilePath,
    debugFilePath: join(dirname(record.filePath), DEBUG_FILE_NAME),
    diagnosticsEnabled: config?.diagnostics === true,
    debugProbeEnabled: config?.debugProbe === true,
    controlApiEnabled: config?.controlApi === true,
    controlDestructiveEnabled: config?.controlDestructive === true,
    controlToken,
  })
  const probe = probeConnection(ctx)

  logInfo(
    ctx,
    `[dsh-session-groups] host ready: file=${record.filePath} storageSource=${
      record.storageSource
    } diagnostics=${diagnosticsFilePath} routes=${mounted.routes.join(',')} connectionAtApply=${
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
      diagnosticsFilePath,
      debugFilePath: join(dirname(record.filePath), DEBUG_FILE_NAME),
      mounted,
    })
  }
}
