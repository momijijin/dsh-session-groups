/**
 * Versioned DSH adapter selector.
 *
 * DSH does not currently expose a stable public runtime-version service to
 * plugins, so the normal path remains capability detection. This selector is
 * the extension point for a future release line: add a sibling adapter file,
 * register it here, and let the host pass an exact version when available.
 */
import { DSH_0_2_ADAPTER } from './dsh-0.2.js'

export const DSH_ADAPTERS = Object.freeze([DSH_0_2_ADAPTER])

/**
 * Select an adapter by exact host version, or return null when the version is
 * absent/unsupported. Never guesses a supported release from a partial token.
 */
export const selectDshAdapter = (version) => {
  if (typeof version !== 'string' || version.trim() === '') return null
  return DSH_ADAPTERS.find((adapter) => adapter.supports(version)) ?? null
}

/**
 * Read an exact host version when the current DSH composition exposes one.
 * Both names are optional future-facing seams; absence is normal and falls
 * back to capability detection.
 */
export const resolveDshVersion = (ctx) => {
  for (const name of ['dshVersion', 'runtimeVersion']) {
    try {
      const value = ctx?.get?.(name)
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    } catch {
      /* service not provided */
    }
  }
  return null
}
