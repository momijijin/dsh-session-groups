/**
 * Dictionary selection + translator construction.
 *
 * This is the public i18n entry point; keep the UI-facing surface as
 * `t(key, params)` and leave resource loading, id resolution and plural
 * assembly in their own modules.
 */
import { FALLBACK_LANGUAGE, dictionaries } from './resources.js'
import { detectEnvironmentLocale, localeCandidates, resolveLocaleId } from './locale-id.js'
import { formatMessage } from './message-format.js'

const registryByLowerId = new Map(Object.entries(dictionaries).filter(([, dictionary]) => dictionary != null).map(([id, dictionary]) => [id.toLowerCase(), dictionary]))

/** Register a dictionary loaded at runtime (lazy client chunks). */
export const registerRuntimeDictionary = (language, dictionary) => {
  if (typeof language === 'string' && language !== '' && dictionary != null) registryByLowerId.set(language.toLowerCase(), dictionary)
}

/** Pick a dictionary for a locale id, falling back to English. */
export const dictionaryFor = (localeId) => {
  for (const candidate of localeCandidates(localeId)) {
    const dictionary = registryByLowerId.get(candidate)
    if (dictionary !== undefined) return dictionary
  }
  return registryByLowerId.get(FALLBACK_LANGUAGE) ?? null
}

/**
 * Create a translator bound to a host locale snapshot getter.
 * @param {() => ({ active?: string, id?: string } | null | undefined)} [getLocaleSnapshot]
 * @param {() => string} [getEnvironmentLocale]
 */
export const createTranslator = (getLocaleSnapshot, getEnvironmentLocale = detectEnvironmentLocale) => (key, params) => {
  const localeId = resolveLocaleId(getLocaleSnapshot, getEnvironmentLocale)
  return formatMessage(dictionaryFor(localeId), key, params, localeId)
}
