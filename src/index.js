/**
 * Cordis host plugin entry for dsh-session-groups.
 *
 * Frozen contract: docs/CONTRACTS.md §2 / §6.5.
 * - Host half mounts load/commit, diagnostics/debug, control/session routes,
 *   skill repair and the SSE revision stream; every route is guarded by the
 *   host connection fence and the relevant config gate.
 * - Records live under `dshHomePath('storages')` (fallback chain logged).
 * - Never writes workspace.json, session logs, or the official workspace
 *   registry. Session title/archive changes go through Host session services
 *   only when `controlSessions` is enabled.
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
import { createChangeHub } from './host/change-hub.js'
import { removeManagedSkill, repairManagedSkill } from './host/skill-install.js'
import { createControlTool } from './host/tool.js'
import { HOST_REQUIRED, SUPPORTED_DSH_RANGE, compatibilityReport, detectHostCapabilities } from './adapters/dsh-capabilities.js'
import { resolveDshVersion, selectDshAdapter } from './adapters/dsh-selector.js'
import { PLUGIN_VERSION } from './shared/constants.js'

/** Cordis function-plugin name (matches the bundle patch row id). */
export const name = 'dsh-session-groups'

/**
 * Plugin-manager configuration schema (Settings → Plugins → this plugin).
 * Diagnostics are off by default; the form switch turns the local trace/HUD on.
 */
export const Config = z.object({
  diagnostics: z.boolean().default(false).volatile().description('Enable local drag diagnostics (HUD + NDJSON trace)'),
  debugProbe: z
    .boolean()
    .default(false)
    .volatile()
    .description('Enable the temporary dialog layout probe and its local .debug.ndjson route'),
  controlApi: z
    .boolean()
    .default(false)
    .volatile()
    .description('Enable the local AI control API (state/plan/apply); default off'),
  controlDestructive: z
    .boolean()
    .default(false)
    .volatile()
    .description('Allow destructive AI control operations such as group deletion'),
  controlSessions: z
    .boolean()
    .default(false)
    .volatile()
    .description('Allow AI control of session title and archived status; requires controlApi'),
})

/**
 * The route carrier is required. `connection` is feature-detected per request
 * (it is provided by a sibling row and may be absent from synthetic
 * compositions); a missing fence fails the routes closed with 503.
 */
export const inject = ['webServer']

/** Cordis function plugin body. Must not return data (see module comment). */
export const apply = (ctx, config = {}) => {
  const declaredVersion = resolveDshVersion(ctx)
  const selectedAdapter = selectDshAdapter(declaredVersion)
  if (declaredVersion !== null && selectedAdapter === null) {
    logWarn(ctx, `dsh-session-groups: unsupported DSH runtime version ${declaredVersion}; refusing to mount`)
    return
  }
  const hostCapabilities = selectedAdapter === null ? detectHostCapabilities(ctx) : selectedAdapter.detectHost(ctx)
  const requiredHost = selectedAdapter?.requiredHost ?? HOST_REQUIRED
  const hostCompatibility = compatibilityReport(hostCapabilities, requiredHost)
  if (!hostCompatibility.supported) {
    logWarn(ctx, `dsh-session-groups: missing host capabilities: ${hostCompatibility.missing.join(', ')}`)
  }
  const readFlag = (key) => {
    const value = config?.[key]
    if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get() === true
    return value === true
  }
  const record = resolveRecordPath(ctx, config)
  const store = createStore({ filePath: record.filePath })
  const changeHub = createChangeHub()
  ctx.effect(
    () => () => changeHub.close(),
    'dsh-session-groups: close change stream',
  )
  const diagnosticsFilePath =
    typeof config.diagnosticsFilePath === 'string' && config.diagnosticsFilePath.length > 0
      ? config.diagnosticsFilePath
      : // Co-located with the record file: in production that is
        // `dshHomePath('storages')`, and a test seam that overrides `filePath`
        // can never point diagnostics at the real home.
        join(dirname(record.filePath), DIAGNOSTICS_FILE_NAME)
  let controlToken = null
  let controlTokenPath = null
  const dshHome = dirname(record.storageDir)
  let skillStatus = null
  if (readFlag('controlApi')) {
    try {
      skillStatus = repairManagedSkill({ dshHome })
      ctx.effect(
        () => () => {
          try {
            removeManagedSkill(dshHome)
          } catch {
            /* managed skill cleanup is best effort */
          }
        },
        'dsh-session-groups: remove managed skill',
      )
    } catch (error) {
      logWarn(ctx, `dsh-session-groups: skill install failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  {
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
    diagnosticsEnabled: () => readFlag('diagnostics'),
    debugProbeEnabled: () => readFlag('debugProbe'),
    controlApiEnabled: () => readFlag('controlApi'),
    controlDestructiveEnabled: () => readFlag('controlDestructive'),
    controlSessionsEnabled: () => readFlag('controlSessions'),
    controlToken,
    skillDshHome: dshHome,
    changeHub,
  })
  const doctorReport = async () => {
    const serviceNames = ['sessions', 'workspaces', 'workspaceRegistry', 'sessionTitle', 'tools', 'locale', 'configForms']
    const services = {}
    for (const serviceName of serviceNames) {
      try {
        services[serviceName] = ctx.get?.(serviceName) !== undefined
      } catch {
        services[serviceName] = false
      }
    }
    const probe = probeConnection(ctx)
    return {
      ok: true,
      protocol: 1,
      plugin: {
        name,
        version: PLUGIN_VERSION,
        supportedRange: SUPPORTED_DSH_RANGE,
        adapter: selectedAdapter?.id ?? null,
      },
      host: {
        declaredVersion,
        capabilities: hostCapabilities,
        required: [...requiredHost],
        compatibility: hostCompatibility,
        connection: probe.connection === undefined ? 'deferred' : 'present',
        webServerPort: Number.isInteger(ctx?.webServer?.port) ? ctx.webServer.port : null,
      },
      gates: {
        controlApi: readFlag('controlApi'),
        controlDestructive: readFlag('controlDestructive'),
        controlSessions: readFlag('controlSessions'),
      },
      storage: {
        filePath: record.filePath,
        storageDir: record.storageDir,
        source: record.storageSource,
      },
      services,
      routes: [...mounted.routes],
    }
  }
  const registerControlTool = (toolCtx) => {
    if (toolCtx?.tools === undefined || typeof toolCtx.tools.register !== 'function') return
    const effect = toolCtx.effect ?? ctx.effect
    effect(
      () =>
        toolCtx.tools.register(
          createControlTool({
            store,
            getService: (serviceName) => {
              try {
                return toolCtx.get?.(serviceName) ?? ctx.get?.(serviceName) ?? null
              } catch {
                return null
              }
            },
            controlApiEnabled: () => readFlag('controlApi'),
            controlSessionsEnabled: () => readFlag('controlSessions'),
            controlDestructiveEnabled: () => readFlag('controlDestructive'),
            onCommit: (revision, source) => changeHub.publish(revision, source),
            doctorReport,
          }),
        ),
      'dsh-session-groups: register control tool',
    )
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], registerControlTool)
  } else {
    const tools = ctx.get?.('tools')
    if (tools !== undefined) registerControlTool({ ...ctx, tools })
  }
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
