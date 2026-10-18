/**
 * Feature-detect a Cordis service without throwing.
 *
 * Real Cordis contexts expose services through `ctx.get(name)` (and a direct
 * property read can throw before the service is provided / injected). Test and
 * integration doubles frequently attach services as plain properties instead,
 * so both shapes are accepted: `get()` first, then a guarded property read.
 */

export const serviceOf = (ctx, name) => {
  try {
    if (typeof ctx?.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined && value !== null) return value
    }
  } catch {
    // fall through to the property read
  }
  try {
    return ctx?.[name] ?? undefined
  } catch {
    return undefined
  }
}
