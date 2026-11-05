/**
 * Dictionary selection + translator construction.
 *
 * This is the public i18n entry point; keep the UI-facing surface as
 * `t(key, params)` and leave resource loading, id resolution and plural
 * assembly in their own modules.
 */
import { FALLBACK_LANGUAGE, dictionaries } from './resources.js'
import { baseLanguage, detectEnvironmentLocale, resolveLocaleId } from './locale-id.js'
import { formatMessage } from './message-format.js'

/** Pick a dictionary for a locale id, falling back to English. */
export const dictionaryFor = (localeId) => dictionaries[baseLanguage(localeId)] ?? dictionaries[FALLBACK_LANGUAGE]

/**
 * Create a translator bound to a host locale snapshot getter.
 * @param {() => ({ active?: string, id?: string } | null | undefined)} [getLocaleSnapshot]
 * @param {() => string} [getEnvironmentLocale]
 */
export const createTranslator = (getLocaleSnapshot, getEnvironmentLocale = detectEnvironmentLocale) => (key, params) => {
  const localeId = resolveLocaleId(getLocaleSnapshot, getEnvironmentLocale)
  return formatMessage(dictionaryFor(localeId), key, params, localeId)
}
