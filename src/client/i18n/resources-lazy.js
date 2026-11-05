/**
 * Lazy client locale resources (bundle-time alias of resources.js).
 *
 * Only the English fallback and Simplified Chinese are in the main bundle.
 * The other dictionaries are generated as `lib/client.locale-*.js` chunks and
 * loaded through the host's `require.async('./client.<name>.js')` transport
 * when the active locale needs them. Node tests keep importing the static
 * resources.js facade instead of this module.
 */
import zh from '../../../locale/zh.json' with { type: 'json' }
import en from '../../../locale/en.json' with { type: 'json' }

export const LOCALE_NS = 'dsh-session-grove'
export const FALLBACK_LANGUAGE = 'en'
export { en, zh }
export const dictionaries = Object.freeze({ en, zh })

// Named placeholder exports keep locale.js's public facade shape stable; the
// real dictionaries arrive at runtime through registerRuntimeDictionary.
export const ja = undefined
export const ko = undefined
export const de = undefined
export const fr = undefined
export const es = undefined
export const pt = undefined
export const it = undefined
export const nl = undefined
export const pl = undefined
export const tr = undefined
export const vi = undefined
export const th = undefined
export const id = undefined
export const ru = undefined
export const hi = undefined
export const ar = undefined
export const zhHant = undefined

const LAZY_FILES = Object.freeze({
  ja: 'client.locale-ja.js',
  ko: 'client.locale-ko.js',
  de: 'client.locale-de.js',
  fr: 'client.locale-fr.js',
  es: 'client.locale-es.js',
  pt: 'client.locale-pt.js',
  it: 'client.locale-it.js',
  nl: 'client.locale-nl.js',
  pl: 'client.locale-pl.js',
  tr: 'client.locale-tr.js',
  vi: 'client.locale-vi.js',
  th: 'client.locale-th.js',
  id: 'client.locale-id.js',
  ru: 'client.locale-ru.js',
  hi: 'client.locale-hi.js',
  ar: 'client.locale-ar.js',
  'zh-Hant': 'client.locale-zh-Hant.js',
})

const asyncRequire = typeof require === 'function' && typeof require.async === 'function' ? require.async.bind(require) : null
const loading = new Map()

const lazyKey = (localeId) => {
  const normalized = String(localeId ?? '').trim().toLowerCase()
  if (normalized.startsWith('zh-hant') || normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo') return 'zh-Hant'
  if (normalized.startsWith('zh')) return 'zh'
  const base = normalized.split(/[-_]/)[0]
  return base
}

/** Whether a locale needs a package-local lazy chunk. */
export const needsLazyDictionary = (localeId) => {
  const key = lazyKey(localeId)
  return key !== 'en' && key !== 'zh' && Object.hasOwn(LAZY_FILES, key)
}

/**
 * Load one lazy dictionary. Returns null for en/zh, unknown locales, or when
 * the host has no asynchronous require transport (Node tests use static
 * resources and never call this path).
 * @param {unknown} localeId
 * @returns {Promise<{ language: string, dictionary: object } | null>}
 */
export const loadLazyDictionary = (localeId) => {
  const key = lazyKey(localeId)
  const fileName = LAZY_FILES[key]
  if (fileName === undefined) return Promise.resolve(null)
  if (asyncRequire === null) return Promise.resolve(null)
  if (loading.has(key)) return loading.get(key)
  const request = asyncRequire(`./${fileName}`)
    .then((loaded) => {
      const dictionary = loaded?.dictionary ?? loaded?.default?.dictionary ?? null
      return dictionary === null ? null : { language: key, dictionary }
    })
    .catch(() => null)
    .finally(() => {
      loading.delete(key)
    })
  loading.set(key, request)
  return request
}

export { lazyKey }
