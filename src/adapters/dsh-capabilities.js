/**
 * DSH compatibility preflight.
 *
 * DSH plugins are bundled once for a DSH release line. There is no
 * per-host-version preprocessor or runtime "switch" in the plugin: the package
 * `engines.dsh` range is the release gate, and this module detects the actual
 * service/slot signatures the current build needs. A future breaking change is
 * therefore reported explicitly instead of being hidden behind a guessed
 * version branch.
 */

/** Release line this build is tested against; keep in sync with package.json. */
export const SUPPORTED_DSH_RANGE = '>=0.2.0-rc.2 <0.3.0'

const has = (value, key) => value !== null && typeof value === 'object' && typeof value[key] === 'function'

/**
 * Read a Cordis service without triggering its "must inject first" guard.
 * `ctx.get` is safe for optional lookups; direct property access can throw.
 */
const serviceOf = (ctx, name) => {
  try {
    const value = ctx?.get?.(name)
    if (value !== undefined) return value
  } catch {
    /* optional service is not declared/injected */
  }
  try {
    return ctx?.[name]
  } catch {
    return undefined
  }
}

/** Required host capabilities. Missing any of these should fail closed/log. */
export const HOST_REQUIRED = Object.freeze(['webServerRegister'])

/** Required client capabilities for the sidebar view to mount. */
export const CLIENT_REQUIRED = Object.freeze(['slotsRegister', 'sessionsService'])

/** Detect host-side signatures used by this build. */
export const detectHostCapabilities = (ctx) => ({
  webServerRegister: has(serviceOf(ctx, 'webServer'), 'register'),
  toolsRegister: has(serviceOf(ctx, 'tools'), 'register'),
  toolsInject: typeof ctx?.inject === 'function',
  sessionsService: serviceOf(ctx, 'sessions') !== undefined,
  workspacesService: serviceOf(ctx, 'workspaces') !== undefined,
  workspaceRegistryService: serviceOf(ctx, 'workspaceRegistry') !== undefined,
  sessionTitleService: serviceOf(ctx, 'sessionTitle') !== undefined,
})

/** Detect client-side services/slots used by this build. */
export const detectClientCapabilities = (ctx, services = {}) => ({
  slotsRegister: has(serviceOf(ctx, 'slots'), 'register'),
  slotsInject: has(serviceOf(ctx, 'slots'), 'inject'),
  sessionsService: services.sessions !== null && services.sessions !== undefined,
  workspacesService: services.workspaces !== null && services.workspaces !== undefined,
  uiWorkspaceService: services.uiWorkspace !== null && services.uiWorkspace !== undefined,
  localeService: serviceOf(ctx, 'locale') !== undefined,
  configFormsService: serviceOf(ctx, 'configForms') !== undefined,
})

/**
 * Compare a capability snapshot with a required list.
 * @returns {{ supported: boolean, missing: string[] }}
 */
export const compatibilityReport = (capabilities, required) => {
  const missing = required.filter((key) => capabilities?.[key] !== true)
  return { supported: missing.length === 0, missing }
}
