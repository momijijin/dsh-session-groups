/**
 * Host locale-service wiring for the plugin composition root.
 *
 * Resolves the optional locale service, registers packaged dictionaries,
 * subscribes for host locale changes and exposes the translator/direction/date
 * helpers consumed by the runtime bridge. Kept separate from createPlugin so the
 * composition root stays orchestration-only.
 */
import { createTranslator, directionForLocale, dictionaries, formatDateTime, LOCALE_NS, resolveLocaleId } from './locale.js'

const resolveLocaleService = (ctx) => {
  try {
    const service = ctx.get?.('locale') ?? null
    if (service !== null) return service
  } catch {
    /* optional service */
  }
  try {
    return typeof ctx?.locale === 'object' && ctx.locale !== null ? ctx.locale : null
  } catch {
    return null
  }
}

export const createLocaleRuntime = ({ ctx, store }) => {
  const localeService = resolveLocaleService(ctx)
  const getLocaleSnapshot = () => {
    try {
      return localeService?.getSnapshot?.() ?? localeService?.getLocale?.() ?? null
    } catch {
      return null
    }
  }
  const t = createTranslator(getLocaleSnapshot)
  let localeDisposer = null
  let subscriptionDisposer = null
  try {
    const disposer = localeService?.register?.(LOCALE_NS, dictionaries)
    if (typeof disposer === 'function') localeDisposer = disposer
    const unsubscribe = localeService?.subscribe?.(() => {
      try {
        store?.dispatch('locale-changed')
      } catch {
        /* locale refresh must not break the view */
      }
    })
    if (typeof unsubscribe === 'function') subscriptionDisposer = unsubscribe
  } catch {
    /* locale service optional */
  }

  return {
    t,
    getLocaleSnapshot,
    direction: () => {
      try {
        return directionForLocale(resolveLocaleId(getLocaleSnapshot))
      } catch {
        return 'ltr'
      }
    },
    formatAbsoluteTime: (value) => {
      try {
        return formatDateTime(value, resolveLocaleId(getLocaleSnapshot))
      } catch {
        return null
      }
    },
    dispose: () => {
      if (typeof localeDisposer === 'function') localeDisposer()
      if (typeof subscriptionDisposer === 'function') subscriptionDisposer()
      localeDisposer = null
      subscriptionDisposer = null
    },
  }
}
