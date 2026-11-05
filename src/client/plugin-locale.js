/**
 * Host locale-service wiring for the plugin composition root.
 *
 * Resolves the optional locale service, registers packaged dictionaries, loads
 * non-fallback dictionaries on demand from package-local client chunks, and
 * exposes the translator/direction/date helpers consumed by the runtime bridge.
 */
import { createTranslator, directionForLocale, dictionaries, formatDateTime, loadLazyDictionary, LOCALE_NS, needsLazyDictionary, registerRuntimeDictionary, resolveLocaleId } from './locale.js'

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
  let subscriptionDisposer = null
  const localeDisposers = []
  const loadedLanguages = new Set()
  let registered = { ...dictionaries }

  const registerDictionaries = () => {
    try {
      const disposer = localeService?.register?.(LOCALE_NS, registered)
      if (typeof disposer === 'function') localeDisposers.push(disposer)
    } catch {
      /* locale service optional */
    }
  }

  const ensureDictionary = async (localeId) => {
    if (!needsLazyDictionary(localeId)) return
    const loaded = await loadLazyDictionary(localeId)
    if (loaded === null || loadedLanguages.has(loaded.language)) return
    loadedLanguages.add(loaded.language)
    registerRuntimeDictionary(loaded.language, loaded.dictionary)
    registered = { ...registered, [loaded.language]: loaded.dictionary }
    registerDictionaries()
    try {
      store?.dispatch('locale-changed')
    } catch {
      /* locale refresh must not break the view */
    }
  }

  registerDictionaries()
  try {
    const unsubscribe = localeService?.subscribe?.(() => {
      void ensureDictionary(resolveLocaleId(getLocaleSnapshot))
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
  void ensureDictionary(resolveLocaleId(getLocaleSnapshot))

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
      for (const disposer of localeDisposers) {
        try {
          disposer()
        } catch {
          /* already disposed */
        }
      }
      localeDisposers.length = 0
      if (typeof subscriptionDisposer === 'function') subscriptionDisposer()
      subscriptionDisposer = null
    },
  }
}
